"""New synthetic offline proof; never render Compose or contact a runtime."""
import copy
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / 'scripts/validation'
sys.path.insert(0, str(SCRIPTS))
import extract_compose_docker_labels as adapter
import project_docker_provider_snapshot as projector
from compare_deployment_snapshots import InvalidSnapshot

PROVIDER = {'exposedByDefault': False, 'swarmMode': False}
CANARY = 'SYNTHETIC_PRIVATE_CANARY_166_ONLY'
USER = 'synthetic:$2y$12$' + 'A' * 53
APR1_USER = 'synthetic:$apr1$' + 'b' * 8 + '$' + 'C' * 22
USERS_LABEL = 'traefik.http.middlewares.auth.basicauth.users'
INVALID = {'reason': 'invalid_or_unavailable_input', 'status': 'invalid'}


def compose_fixture():
    return {'name': 'synthetic-offline', 'services': {
        'gateway': {'image': 'synthetic-only', 'profiles': ['admin'], 'labels': {
            'traefik.enable': 'true',
            'traefik.http.routers.gateway.rule': 'Host(`gateway.invalid`)',
            'traefik.http.routers.gateway.entrypoints': 'websecure',
            'traefik.http.routers.gateway.service': 'api@internal',
            'traefik.http.routers.gateway.middlewares': 'security,auth,rate,security@docker',
            'traefik.http.routers.gateway.tls': 'true',
            'traefik.http.middlewares.security.headers.frameDeny': 'true',
            'traefik.http.middlewares.security.headers.customResponseHeaders.X-Robots-Tag': 'noindex,nofollow',
            'traefik.http.middlewares.auth.basicauth.realm': 'Synthetic realm',
            'traefik.http.middlewares.auth.basicauth.users': USER,
            'traefik.http.middlewares.rate.ratelimit.average': '20',
            'traefik.http.middlewares.rate.ratelimit.burst': '5',
            'traefik.http.middlewares.rate.ratelimit.period': '1m',
            'org.example.note': '  exact  café  ', 'org.example.empty': ''}},
        'catalog': {'cpus': 0.5, 'labels': {
            'traefik.enable': 'true',
            'traefik.http.routers.catalog.rule': 'Host(`catalog.invalid`)',
            'traefik.http.routers.catalog.entrypoints': 'web',
            'traefik.http.services.catalog.loadbalancer.server.port': '8080'}},
        'disabled': {'labels': {'traefik.enable': 'false', 'org.example.note': 'retained'}},
        'unlabelled': {'image': 'synthetic-only', 'environment': {'OUTSIDE_SCOPE': '${UNREAD}'}}}}


def with_users(users):
    source = compose_fixture()
    source['services']['gateway']['labels'][USERS_LABEL] = users
    return source


class ComposeLabelTests(unittest.TestCase):
    def setUp(self):
        proof = os.environ.get('PEERMESH_COMPOSE_PROOF_DIR')
        if proof:
            self.root = Path(proof) / self._testMethodName
            self.root.mkdir(mode=0o700, parents=True)
        else:
            temporary = tempfile.TemporaryDirectory()
            self.addCleanup(temporary.cleanup)
            self.root = Path(temporary.name).resolve()
        self.compose = self.root / 'compose.json'
        self.provider = self.root / 'provider.json'
        self.output = self.root / 'output.json'
        self.write(self.compose, compose_fixture())
        self.write(self.provider, PROVIDER)
        self.calls = 0

    def write(self, path, value):
        path.write_bytes(value if isinstance(value, bytes) else json.dumps(value).encode('utf-8'))
        path.chmod(0o600)

    def invoke(self, extra=None, compose=None, provider=None, output=None, script=None):
        argv = [sys.executable, '-B', str(SCRIPTS / (script or 'extract_compose_docker_labels.py'))]
        argv += extra if extra is not None else ['--compose', str(compose or self.compose),
            '--provider-scope', str(provider or self.provider), '--output', str(output or self.output)]
        done = subprocess.run(argv, cwd=ROOT, capture_output=True, text=True,
            env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'}, timeout=15)
        self.calls += 1
        self.write(self.root / ('cli-' + str(self.calls) + '.json'), {
            'argv': argv, 'cwd': str(ROOT), 'exit': done.returncode,
            'stdout': done.stdout, 'stderr': done.stderr})
        self.assertNotIn(CANARY, done.stdout + done.stderr)
        self.assertNotIn(USER, done.stdout + done.stderr)
        self.assertNotIn(str(self.root), done.stdout + done.stderr)
        self.assertEqual(done.stderr, '')
        return done

    def assert_invalid(self, done):
        self.assertEqual(done.returncode, 2)
        self.assertEqual(json.loads(done.stdout), INVALID)

    def test_complete_inventory_and_exact_strings(self):
        source = compose_fixture()
        original = copy.deepcopy(source)
        result = adapter.extract_labels(source, PROVIDER)
        self.assertEqual(set(result), {'schema', 'capture_status', 'provider', 'services'})
        self.assertEqual(result['schema'], 'peermesh.docker-resolved-labels.v1')
        self.assertEqual(result['capture_status'], 'complete')
        self.assertEqual(set(result['services']), {'gateway', 'catalog', 'disabled', 'unlabelled'})
        for name, service in source['services'].items():
            self.assertEqual(result['services'][name], service.get('labels', {}))
        self.assertEqual(source, original)
        result['services']['gateway']['org.example.note'] = 'changed-copy'
        self.assertEqual(source, original)

    def test_independent_router_and_middleware_semantics(self):
        projected = projector.project_source(adapter.extract_labels(compose_fixture(), PROVIDER))
        self.assertEqual(projected['excluded_services'], {'disabled': 'disabled', 'unlabelled': 'unlabelled'})
        routers, middlewares = projected['collections']['routers'], projected['collections']['middlewares']
        self.assertEqual(set(routers), {'gateway@docker', 'catalog@docker'})
        self.assertEqual(set(middlewares), {'security@docker', 'auth@docker', 'rate@docker'})
        self.assertEqual(routers['gateway@docker'], {'rule': 'Host(`gateway.invalid`)',
            'entryPoints': ['websecure'], 'priority': 0, 'service': 'api@internal',
            'middlewares': ['security@docker', 'auth@docker', 'rate@docker', 'security@docker'], 'tls': {}})
        self.assertEqual(routers['catalog@docker'], {'rule': 'Host(`catalog.invalid`)',
            'entryPoints': ['web'], 'priority': 0, 'service': 'catalog@docker', 'middlewares': []})
        self.assertEqual(middlewares['security@docker']['headers'], {
            'browserXssFilter': False, 'contentTypeNosniff': False, 'frameDeny': True,
            'stsIncludeSubdomains': False, 'stsPreload': False, 'stsSeconds': 0,
            'customResponseHeaders': {'X-Robots-Tag': 'noindex,nofollow'}})
        self.assertEqual(middlewares['rate@docker']['rateLimit'], {'average': 20, 'burst': 5, 'period': 60})
        auth = middlewares['auth@docker']['basicAuth']
        self.assertEqual(auth['realm'], 'Synthetic realm')
        self.assertEqual(auth['users_count'], 1)
        expected = hashlib.sha256(b'peermesh.docker-provider.basic-auth-users.v1\0' +
            json.dumps([USER], separators=(',', ':')).encode()).hexdigest()
        self.assertEqual(auth['users_sha256'], expected)
        self.assertNotIn(USER, json.dumps(projected))
        self.write(self.root / 'semantic-proof.json', projected)

    def test_added_and_removed_services_are_visible(self):
        before = adapter.extract_labels(compose_fixture(), PROVIDER)
        source = compose_fixture()
        del source['services']['catalog']
        source['services']['extra'] = {'labels': {'traefik.enable': 'false'}}
        after = adapter.extract_labels(source, PROVIDER)
        self.assertEqual(set(after['services']), {'gateway', 'disabled', 'unlabelled', 'extra'})
        expected, observed = projector.project_source(before), projector.project_source(after)
        self.assertEqual(set(observed['collections']['routers']), {'gateway@docker'})
        self.assertEqual(observed['excluded_services']['extra'], 'disabled')
        observed['origin'], observed['excluded_services'] = 'observed', {}
        comparison = projector.compare_projections(expected, observed)
        self.assertEqual(comparison['status'], 'drift')
        self.assertIn('/routers/k-' + hashlib.sha256(b'catalog@docker').hexdigest(), comparison['changed_paths'])
        self.write(self.root / 'service-change-proof.json', {'input': after, 'comparison': comparison})

    def test_conflicting_router_and_middleware_names(self):
        for kind, field, value in [('routers', 'rule', 'Host(`duplicate.invalid`)'),
                                   ('middlewares', 'headers.frameDeny', 'true')]:
            with self.subTest(kind=kind):
                source = compose_fixture()
                labels = source['services']['catalog']['labels']
                if kind == 'routers':
                    labels.update({'traefik.http.routers.gateway.rule': value,
                        'traefik.http.routers.gateway.entrypoints': 'web',
                        'traefik.http.routers.gateway.service': 'catalog'})
                else:
                    labels['traefik.http.middlewares.security.' + field] = value
                with self.assertRaises(InvalidSnapshot):
                    adapter.extract_labels(source, PROVIDER)

    def test_case_collisions_even_when_disabled(self):
        for name in ['gateway', 'disabled']:
            source = compose_fixture()
            source['services'][name]['labels']['Traefik.Enable'] = 'false'
            with self.assertRaises(InvalidSnapshot):
                adapter.extract_labels(source, PROVIDER)

    def test_non_string_or_ambiguous_labels(self):
        for labels in [None, [], ['traefik.enable=true'], 'text', {'x': None}, {'x': 1}, {'x': True}, {3: 'x'}]:
            with self.subTest(labels_type=type(labels).__name__):
                source = compose_fixture()
                source['services']['disabled']['labels'] = labels
                with self.assertRaises(InvalidSnapshot):
                    adapter.extract_labels(source, PROVIDER)

    def test_provider_scope_is_explicit_and_exact(self):
        for scope in [None, {}, {'exposedByDefault': False}, {'exposedByDefault': 0, 'swarmMode': False},
            {'exposedByDefault': True, 'swarmMode': False}, {'exposedByDefault': False, 'swarmMode': True},
            {**PROVIDER, 'watch': False}]:
            with self.subTest(scope=scope), self.assertRaises(InvalidSnapshot):
                adapter.extract_labels(compose_fixture(), scope)
        self.write(self.provider, {'exposedByDefault': False, 'swarmMode': True})
        self.assert_invalid(self.invoke())
        self.assertFalse(self.output.exists())

    def test_unsupported_labels_and_unresolved_expressions(self):
        mutations = [('traefik.http.routers.gateway.rule', '${DOMAIN}'),
            ('traefik.http.routers.gateway.rule', '$DOMAIN'),
            ('traefik.http.routers.gateway.rule', '{{ DOMAIN }}'),
            ('traefik.http.routers.gateway.tls', 'false'),
            ('traefik.http.middlewares.auth.basicauth.users', USER.replace('$', '$$')),
            ('traefik.http.middlewares.auth.basicauth.usersfile', '/unread'),
            ('org.example.note', '${CANARY}'), ('org.example.note', '$CANARY')]
        for key, value in mutations:
            with self.subTest(key=key):
                source = compose_fixture()
                source['services']['gateway']['labels'][key] = value
                with self.assertRaises(InvalidSnapshot):
                    adapter.extract_labels(source, PROVIDER)
        source = compose_fixture()
        source['services']['disabled']['labels']['traefik.tcp.routers.unknown.rule'] = 'unsupported'
        with self.assertRaises(InvalidSnapshot):
            adapter.extract_labels(source, PROVIDER)

    def test_unresolved_inventory_shapes_and_names(self):
        cases = [None, [], {}, {'services': {}}, {'services': []}, {'services': {'bad': None}}]
        for field in ['include', 'extends', 'label_file']:
            source = compose_fixture()
            (source if field == 'include' else source['services']['catalog'])[field] = 'not-read'
            cases.append(source)
        source = compose_fixture()
        source['services']['Bad Name'] = source['services'].pop('catalog')
        cases.append(source)
        for source in cases:
            with self.subTest(shape=type(source).__name__), self.assertRaises(InvalidSnapshot):
                adapter.extract_labels(source, PROVIDER)

    def test_cli_adapter_then_actual_projector(self):
        done = self.invoke()
        self.assertEqual(done.returncode, 0)
        outcome = json.loads(done.stdout)
        self.assertEqual(outcome['status'], 'extracted')
        for role, path in [('compose', self.compose), ('provider_scope', self.provider), ('output', self.output)]:
            self.assertEqual(outcome['bindings'][role], {'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                'bytes': path.stat().st_size})
        for name, binding in outcome['bindings']['sources'].items():
            data = (SCRIPTS / name).read_bytes()
            self.assertEqual(binding, {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)})
        self.assertEqual(len(outcome['bindings']['sources']), 6)
        self.assertEqual(stat.S_IMODE(self.output.stat().st_mode), 0o600)
        self.assertEqual(json.loads(self.output.read_text())['services']['gateway']['traefik.http.middlewares.auth.basicauth.users'], USER)
        projected = self.root / 'projected.json'
        done = self.invoke(script='project_docker_provider_snapshot.py', extra=[
            'source', '--input', str(self.output), '--output', str(projected)])
        self.assertEqual(done.returncode, 0)
        self.assertEqual(set(json.loads(projected.read_text())['collections']['routers']), {'gateway@docker', 'catalog@docker'})

    def test_duplicate_json_keys_at_multiple_depths(self):
        raw = json.dumps(compose_fixture())
        for value in [raw.replace('"services":', '"services": {}, "services":', 1),
            raw.replace('"gateway":', '"gateway": {}, "gateway":', 1),
            raw.replace('"traefik.enable": "true"', '"traefik.enable": "true", "traefik.enable": "true"', 1)]:
            self.write(self.compose, value.encode())
            self.assert_invalid(self.invoke())
            self.assertFalse(self.output.exists())
        self.write(self.compose, compose_fixture())
        self.write(self.provider, b'{"exposedByDefault":false,"exposedByDefault":false,"swarmMode":false}')
        self.assert_invalid(self.invoke())

    def test_fixed_error_secret_canary_and_invalid_json(self):
        for raw in [CANARY.encode(), b'\xff', b'{"x":NaN}', b'{"x":Infinity}', rb'{"x":"\ud800"}',
            ('[' * 1500 + CANARY).encode()]:
            self.write(self.compose, raw)
            self.assert_invalid(self.invoke())
        self.assert_invalid(self.invoke(extra=['--' + CANARY, str(self.root / CANARY)]))
        self.assertFalse(self.output.exists())

    def test_missing_directory_fifo_and_relative_inputs(self):
        fifo = self.root / 'fifo'
        os.mkfifo(fifo, 0o600)
        for source in [self.root / CANARY, self.root, fifo, Path('compose.json')]:
            self.assert_invalid(self.invoke(compose=source))
        self.assert_invalid(self.invoke(provider=self.root / 'missing-provider'))
        self.assertFalse(self.output.exists())

    def test_oversized_inputs_and_exact_size_boundary(self):
        original = self.compose.read_bytes()
        self.write(self.compose, original + b' ' * (adapter.MAX_BYTES - len(original)))
        self.assertEqual(self.invoke().returncode, 0)
        self.write(self.compose, original + b' ' * (adapter.MAX_BYTES + 1 - len(original)))
        second = self.root / 'second.json'
        self.assert_invalid(self.invoke(output=second))
        self.assertFalse(second.exists())
        self.write(self.compose, compose_fixture())
        self.write(self.provider, b' ' * (adapter.MAX_BYTES + 1))
        self.assert_invalid(self.invoke(output=second))

    def test_links_and_parent_links_are_rejected(self):
        link = self.root / 'input-link'
        link.symlink_to(self.compose)
        self.assert_invalid(self.invoke(compose=link))
        parent_link = self.root / 'parent-link'
        parent_link.symlink_to(self.root, target_is_directory=True)
        self.assert_invalid(self.invoke(compose=parent_link / 'compose.json'))
        self.assert_invalid(self.invoke(output=parent_link / 'output.json'))
        self.output.symlink_to(self.root / 'missing-target')
        self.assert_invalid(self.invoke())
        self.assertTrue(self.output.is_symlink())

    def test_private_modes_are_required(self):
        self.compose.chmod(0o644)
        self.assert_invalid(self.invoke())
        self.compose.chmod(0o600)
        self.provider.chmod(0o640)
        self.assert_invalid(self.invoke())
        self.provider.chmod(0o600)
        self.root.chmod(0o755)
        try:
            self.assert_invalid(self.invoke())
        finally:
            self.root.chmod(0o700)
        self.assertFalse(self.output.exists())

    def test_existing_output_and_input_collision_preserved(self):
        self.write(self.output, CANARY.encode())
        before = self.output.read_bytes()
        self.assert_invalid(self.invoke())
        self.assertEqual(self.output.read_bytes(), before)
        for path in [self.compose, self.provider]:
            before = path.read_bytes()
            self.assert_invalid(self.invoke(output=path))
            self.assertEqual(path.read_bytes(), before)
        link = self.root / 'hardlink.json'
        os.link(self.compose, link)
        self.assert_invalid(self.invoke(output=link))
        self.assertEqual(link.read_bytes(), self.compose.read_bytes())

    def test_failed_write_removes_only_new_owned_output(self):
        before = self.compose.read_bytes()
        with patch.object(adapter.os, 'fsync', side_effect=OSError(CANARY)):
            with self.assertRaises(OSError):
                adapter.extract_compose_labels(self.compose, self.provider, self.output)
        self.assertFalse(self.output.exists())
        self.assertEqual(self.compose.read_bytes(), before)

    def test_output_stays_private_with_permissive_umask(self):
        previous = os.umask(0)
        try:
            adapter.extract_compose_labels(self.compose, self.provider, self.output)
        finally:
            os.umask(previous)
        self.assertEqual(stat.S_IMODE(self.output.stat().st_mode), 0o600)

    def test_empty_projected_scope_remains_unsupported(self):
        with self.assertRaises(InvalidSnapshot):
            adapter.extract_labels({'services': {'disabled': {'labels': {'traefik.enable': 'false'}},
                'unlabelled': {}}}, PROVIDER)

    def test_render_flag_accepts_doubled_crypt_users(self):
        for users in [USER, APR1_USER, USER + ',' + APR1_USER.replace('synthetic', 'second')]:
            with self.subTest(users=users.split('$')[1]):
                single = adapter.extract_labels(with_users(users), PROVIDER)
                doubled = adapter.extract_labels(with_users(users.replace('$', '$$')), PROVIDER,
                    compose_config_render=True)
                self.assertEqual(doubled, single)
                self.assertEqual(doubled['services']['gateway'][USERS_LABEL], users)
                self.assertEqual(projector.project_source(doubled), projector.project_source(single))

    def test_render_flag_cli_output_matches_single_dollar_input(self):
        for users in [USER, APR1_USER]:
            with self.subTest(users=users.split('$')[1]):
                self.write(self.compose, with_users(users))
                single, doubled = self.root / 'single.json', self.root / 'doubled.json'
                self.assertEqual(self.invoke(output=single).returncode, 0)
                self.write(self.compose, with_users(users.replace('$', '$$')))
                done = self.invoke(extra=['--compose-config-render', '--compose', str(self.compose),
                    '--provider-scope', str(self.provider), '--output', str(doubled)])
                self.assertEqual(done.returncode, 0)
                self.assertEqual(json.loads(done.stdout)['status'], 'extracted')
                self.assertNotIn('$', done.stdout)
                self.assertEqual(doubled.read_bytes(), single.read_bytes())
                self.assertEqual(stat.S_IMODE(doubled.stat().st_mode), 0o600)
                single.unlink()
                doubled.unlink()

    def test_render_flag_off_still_refuses_doubled_users(self):
        for users in [USER, APR1_USER]:
            source = with_users(users.replace('$', '$$'))
            for options in [{}, {'compose_config_render': False}]:
                with self.subTest(users=users.split('$')[1], options=options):
                    with self.assertRaisesRegex(InvalidSnapshot, 'unsupported_or_masked_basic_auth_users'):
                        adapter.extract_labels(source, PROVIDER, **options)
            self.write(self.compose, source)
            self.assert_invalid(self.invoke())
            self.assertFalse(self.output.exists())

    def test_render_flag_refuses_lone_dollar_in_label_value(self):
        mutations = [(USERS_LABEL, USER), (USERS_LABEL, APR1_USER),
            (USERS_LABEL, USER.replace('$', '$$', 2)), (USERS_LABEL, USER.replace('$', '$$') + '$'),
            ('traefik.http.routers.gateway.rule', '$DOMAIN'), ('org.example.note', '$' + CANARY),
            ('org.example.note', 'trailing$'), ('org.example.note', '$$$odd')]
        for key, value in mutations:
            with self.subTest(key=key, run=value.count('$')):
                source = compose_fixture()
                source['services']['gateway']['labels'][key] = value
                with self.assertRaisesRegex(InvalidSnapshot, 'unresolved_label_expression'):
                    adapter.extract_labels(source, PROVIDER, compose_config_render=True)
        source = compose_fixture()
        self.write(self.compose, source)
        self.assert_invalid(self.invoke(extra=['--compose-config-render', '--compose', str(self.compose),
            '--provider-scope', str(self.provider), '--output', str(self.output)]))
        self.assertFalse(self.output.exists())

    def test_render_flag_refuses_unresolved_expression_after_unescape(self):
        for key in [USERS_LABEL, 'traefik.http.routers.gateway.rule', 'org.example.note']:
            for value in ['$${X}', '${X}', '$$${X}', 'prefix-$${X}-suffix', '{{ X }}']:
                with self.subTest(key=key, value=value):
                    source = compose_fixture()
                    source['services']['gateway']['labels'][key] = value
                    with self.assertRaises(InvalidSnapshot):
                        adapter.extract_labels(source, PROVIDER, compose_config_render=True)

    def test_render_flag_keeps_other_dollar_refusals(self):
        users = USER.replace('$', '$$')
        for key, value in [(USERS_LABEL, users.replace('$$', '$$$$')),
                ('traefik.http.routers.gateway.rule', '$$DOMAIN'), ('org.example.note', '$$NOTE'),
                ('org.example.$$note', 'value')]:
            with self.subTest(key=key):
                source = with_users(users)
                source['services']['gateway']['labels'][key] = value
                with self.assertRaises(InvalidSnapshot):
                    adapter.extract_labels(source, PROVIDER, compose_config_render=True)

    def test_render_flag_leaves_non_label_fields_untouched(self):
        source = with_users(USER.replace('$', '$$'))
        source['name'] = 'top$$level'
        source['x-extra'] = {'kept': '$lone'}
        environment = {'DOUBLED': '$$KEEP', 'LONE': '$KEEP', 'UNRESOLVED': '${UNREAD}'}
        source['services']['gateway'].update({'image': 'synthetic$$only', 'environment': environment})
        source['services']['unlabelled']['environment'] = dict(environment)
        original = copy.deepcopy(source)
        provider = copy.deepcopy(PROVIDER)
        result = adapter.extract_labels(source, provider, compose_config_render=True)
        self.assertEqual(source, original)
        self.assertEqual(provider, PROVIDER)
        self.assertEqual(result, adapter.extract_labels(with_users(USER), PROVIDER))
        self.assertEqual(result['services']['unlabelled'], {})
        self.assertEqual(result['services']['gateway']['org.example.note'], '  exact  café  ')
        self.assertEqual(result['services']['gateway']['org.example.empty'], '')

    def test_render_flag_is_matched_exactly_and_prefixes_are_unchanged(self):
        paths = ['--compose', str(self.compose), '--provider-scope', str(self.provider)]
        self.write(self.compose, with_users(USER.replace('$', '$$')))
        for spelling in ['--compose-config-rende', '--compose-c', '--compose-config-render=1']:
            with self.subTest(spelling=spelling):
                self.assert_invalid(self.invoke(extra=[spelling] + paths + ['--output', str(self.output)]))
        flag = '--compose-config-render'
        self.assert_invalid(self.invoke(extra=[flag, flag] + paths + ['--output', str(self.output)]))
        self.assertFalse(self.output.exists())
        self.write(self.compose, compose_fixture())
        done = self.invoke(extra=['--comp', str(self.compose), '--prov', str(self.provider), '--out', str(self.output)])
        self.assertEqual(done.returncode, 0)


if __name__ == '__main__':
    unittest.main()
