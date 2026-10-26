"""Offline synthetic evidence only; actual Docker/TLS API parity is unqualified."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parents[2] / 'scripts' / 'validation'
sys.path.insert(0, str(SCRIPTS))
import project_docker_provider_snapshot as projector
from compare_deployment_snapshots import InvalidSnapshot

SYNTHETIC_USERS = ['synthetic-user:{SHA}QUFBQUFBQUFBQUFBQUFBQUFBQUE=',
                   'synthetic-other:{SHA}QkJCQkJCQkJCQkJCQkJCQkJCQkI=']


def resolved_input():
    """Canonical label spelling/values with only synthetic domain and auth resolution."""
    return {'schema': projector.INPUT_SCHEMA, 'capture_status': 'complete',
            'provider': {'exposedByDefault': False, 'swarmMode': False}, 'services': {
        'traefik': {
            'traefik.enable': 'true',
            'traefik.http.routers.traefik-dashboard.rule': 'Host(`traefik.synthetic.invalid`)',
            'traefik.http.routers.traefik-dashboard.entrypoints': 'websecure',
            'traefik.http.routers.traefik-dashboard.tls.certresolver': 'letsencrypt',
            'traefik.http.routers.traefik-dashboard.service': 'api@internal',
            'traefik.http.routers.traefik-dashboard.middlewares': 'noindex-private@file,dashboard-auth,dashboard-auth-ratelimit',
            'traefik.http.routers.catchall-https.rule': 'Host(`synthetic.invalid`) || HostRegexp(`{subdomain:.+}.synthetic.invalid`)',
            'traefik.http.routers.catchall-https.entrypoints': 'websecure',
            'traefik.http.routers.catchall-https.tls': 'true',
            'traefik.http.routers.catchall-https.priority': '1',
            'traefik.http.routers.catchall-https.service': 'api@internal',
            'traefik.http.routers.catchall-https.middlewares': 'deny-all@file',
            'traefik.http.middlewares.dashboard-auth.basicauth.users': SYNTHETIC_USERS[0],
            'traefik.http.middlewares.dashboard-auth.basicauth.realm': 'Traefik Dashboard',
            'traefik.http.middlewares.dashboard-auth-ratelimit.ratelimit.average': '5',
            'traefik.http.middlewares.dashboard-auth-ratelimit.ratelimit.burst': '10',
            'traefik.http.middlewares.dashboard-auth-ratelimit.ratelimit.period': '1m',
        },
        'dashboard': {
            'traefik.enable': 'true',
            'traefik.http.routers.dashboard.rule': 'Host(`synthetic.invalid`)',
            'traefik.http.routers.dashboard.entrypoints': 'websecure',
            'traefik.http.routers.dashboard.tls.certresolver': 'letsencrypt',
            'traefik.http.services.dashboard.loadbalancer.server.port': '8080',
            'traefik.http.routers.dashboard.middlewares': 'dashboard-security,dashboard-ratelimit',
            'traefik.http.middlewares.dashboard-security.headers.browserxssfilter': 'true',
            'traefik.http.middlewares.dashboard-security.headers.contenttypenosniff': 'true',
            'traefik.http.middlewares.dashboard-security.headers.frameDeny': 'true',
            'traefik.http.middlewares.dashboard-security.headers.stsSeconds': '31536000',
            'traefik.http.middlewares.dashboard-security.headers.stsIncludeSubdomains': 'true',
            'traefik.http.middlewares.dashboard-security.headers.stsPreload': 'true',
            'traefik.http.middlewares.dashboard-security.headers.customResponseHeaders.X-Robots-Tag': 'noindex,nofollow',
            'traefik.http.middlewares.dashboard-security.headers.customResponseHeaders.X-Permitted-Cross-Domain-Policies': 'none',
            'traefik.http.middlewares.dashboard-ratelimit.ratelimit.average': '10',
            'traefik.http.middlewares.dashboard-ratelimit.ratelimit.burst': '20',
            'traefik.http.middlewares.dashboard-ratelimit.ratelimit.period': '1m',
        },
        'minio': {
            'traefik.enable': 'true',
            'traefik.http.routers.minio-api.rule': 'Host(`s3.synthetic.invalid`)',
            'traefik.http.routers.minio-api.entrypoints': 'websecure',
            'traefik.http.routers.minio-api.tls.certresolver': 'letsencrypt',
            'traefik.http.routers.minio-api.service': 'minio-api',
            'traefik.http.services.minio-api.loadbalancer.server.port': '9000',
            'traefik.http.routers.minio-console.rule': 'Host(`minio.synthetic.invalid`)',
            'traefik.http.routers.minio-console.entrypoints': 'websecure',
            'traefik.http.routers.minio-console.tls.certresolver': 'letsencrypt',
            'traefik.http.routers.minio-console.service': 'minio-console',
            'traefik.http.services.minio-console.loadbalancer.server.port': '9001',
        },
        'disabled': {'traefik.enable': 'false'},
        'unlabelled': {'example.non-traefik': '${deliberately_excluded}'},
    }}


def synthetic_rawdata():
    """Independent handwritten API expectation; never described as a captured response."""
    routers = {}
    for name, host, service, middleware in (
        ('traefik-dashboard', 'traefik.synthetic.invalid', 'api@internal',
         ['noindex-private@file', 'dashboard-auth@docker', 'dashboard-auth-ratelimit@docker']),
        ('dashboard', 'synthetic.invalid', 'dashboard', ['dashboard-security@docker', 'dashboard-ratelimit@docker']),
        ('minio-api', 's3.synthetic.invalid', 'minio-api', []),
        ('minio-console', 'minio.synthetic.invalid', 'minio-console', []),
    ):
        routers[name + '@docker'] = {'rule': 'Host(`' + host + '`)', 'entryPoints': ['websecure'],
            'service': service, 'tls': {'certResolver': 'letsencrypt'}, 'status': 'enabled', 'using': ['websecure']}
        if middleware:
            routers[name + '@docker']['middlewares'] = middleware
    routers['catchall-https@docker'] = {'rule': 'Host(`synthetic.invalid`) || HostRegexp(`{subdomain:.+}.synthetic.invalid`)',
        'entryPoints': ['websecure'], 'tls': {}, 'priority': 1, 'service': 'api@internal',
        'middlewares': ['deny-all@file'], 'status': 'enabled', 'using': ['websecure']}
    return {'routers': routers, 'middlewares': {
        'dashboard-auth@docker': {'basicAuth': {'users': [SYNTHETIC_USERS[0]], 'realm': 'Traefik Dashboard'}, 'status': 'enabled'},
        'dashboard-auth-ratelimit@docker': {'rateLimit': {'average': 5, 'burst': 10, 'period': '1m0s'}, 'status': 'enabled'},
        'dashboard-security@docker': {'headers': {'browserXssFilter': True, 'contentTypeNosniff': True,
            'frameDeny': True, 'stsSeconds': 31536000, 'stsIncludeSubdomains': True, 'stsPreload': True,
            'customResponseHeaders': {'X-Robots-Tag': 'noindex,nofollow', 'X-Permitted-Cross-Domain-Policies': 'none'}}, 'status': 'enabled'},
        'dashboard-ratelimit@docker': {'rateLimit': {'average': 10, 'burst': 20, 'period': '1m0s'}, 'status': 'enabled'},
    }, 'services': {'api@internal': {'status': 'enabled'}, 'dashboard@docker': {'status': 'enabled'}}}


def receipt_for(raw):
    return {'schema': 'peermesh.rawdata-receipt.v1', 'method': 'GET', 'path': '/api/rawdata',
            'status': 200, 'complete': True, 'content_type': 'application/json',
            'body_sha256': hashlib.sha256(raw).hexdigest(), 'body_bytes': len(raw)}


class DockerProjectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def observed(self, data=None):
        raw = json.dumps(synthetic_rawdata() if data is None else data).encode()
        path = self.root / 'body.json'
        path.write_bytes(raw)
        return projector.project_observed(path, receipt_for(raw))

    def test_canonical_five_routers_four_middlewares_equal(self):
        expected = projector.project_source(resolved_input())
        self.assertEqual(len(expected['collections']['routers']), 5)
        self.assertEqual(len(expected['collections']['middlewares']), 4)
        self.assertEqual(expected['excluded_services'], {'disabled': 'disabled', 'unlabelled': 'unlabelled'})
        self.assertEqual(projector.compare_projections(expected, self.observed())['status'], 'equivalent')
        self.assertEqual(expected['collections']['dynamic_files'], {})

    def test_tls_priority_service_and_reference_semantics(self):
        items = projector.project_source(resolved_input())['collections']['routers']
        self.assertEqual(items['dashboard@docker']['service'], 'dashboard@docker')
        self.assertEqual(items['dashboard@docker']['priority'], 0)
        self.assertEqual(items['catchall-https@docker']['priority'], 1)
        self.assertEqual(items['catchall-https@docker']['tls'], {})
        self.assertEqual(items['minio-api@docker']['tls'], {'certResolver': 'letsencrypt'})
        self.assertEqual(items['catchall-https@docker']['middlewares'], ['deny-all@file'])

    def test_exact_router_field_drift(self):
        expected = projector.project_source(resolved_input())
        for key, value in [('rule', 'Host(`changed.invalid`)'), ('priority', 2), ('entryPoints', ['alternate']),
                           ('service', 'other'), ('middlewares', ['deny-all@file']), ('tls', {}),
                           ('tls', {'certResolver': 'other'})]:
            with self.subTest(field=key):
                raw = synthetic_rawdata()
                raw['routers']['dashboard@docker'][key] = value
                self.assertEqual(projector.compare_projections(expected, self.observed(raw))['status'], 'drift')
        raw = synthetic_rawdata()
        del raw['routers']['dashboard@docker']['tls']
        self.assertEqual(projector.compare_projections(expected, self.observed(raw))['status'], 'drift')

    def test_literal_header_commas_boolean_defaults_and_integer_drift(self):
        expected = projector.project_source(resolved_input())
        headers = expected['collections']['middlewares']['dashboard-security@docker']['headers']
        self.assertEqual(headers['customResponseHeaders']['X-Robots-Tag'], 'noindex,nofollow')
        for key, value in [('stsSeconds', 31536001), ('frameDeny', False),
                           ('customResponseHeaders', {'X-Robots-Tag': 'nofollow,noindex'})]:
            raw = synthetic_rawdata()
            raw['middlewares']['dashboard-security@docker']['headers'][key] = value
            self.assertEqual(projector.compare_projections(expected, self.observed(raw))['status'], 'drift')
        labels = resolved_input()
        labels['services']['dashboard']['traefik.http.middlewares.dashboard-security.headers.frameDeny'] = 'false'
        raw = synthetic_rawdata()
        del raw['middlewares']['dashboard-security@docker']['headers']['frameDeny']
        self.assertEqual(projector.compare_projections(projector.project_source(labels), self.observed(raw))['status'], 'equivalent')

    def test_basic_auth_domain_digest_order_count_and_redaction(self):
        config = {'realm': 'Synthetic realm', 'users': SYNTHETIC_USERS}
        result = projector.basic_auth(config)
        digest = hashlib.sha256(b'peermesh.docker-provider.basic-auth-users.v1\0' +
            json.dumps(SYNTHETIC_USERS, separators=(',', ':')).encode()).hexdigest()
        self.assertEqual(result, {'realm': 'Synthetic realm', 'users_count': 2, 'users_sha256': digest})
        self.assertNotEqual(result, projector.basic_auth(dict(config, users=list(reversed(SYNTHETIC_USERS)))))
        self.assertNotEqual(result, projector.basic_auth(dict(config, users=SYNTHETIC_USERS * 2)))
        serialized = json.dumps(projector.project_source(resolved_input()))
        self.assertNotIn('synthetic-user', serialized)
        self.assertNotIn('{SHA}', serialized)

    def test_basic_auth_credential_and_realm_drift_paths_are_opaque(self):
        expected = projector.project_source(resolved_input())
        for key, value in [('users', [SYNTHETIC_USERS[1]]), ('realm', 'Different synthetic realm')]:
            raw = synthetic_rawdata()
            raw['middlewares']['dashboard-auth@docker']['basicAuth'][key] = value
            result = projector.compare_projections(expected, self.observed(raw))
            self.assertEqual(result['status'], 'drift')
            self.assertTrue(result['changed_paths'])
            self.assertNotIn('dashboard-auth', json.dumps(result))
            self.assertNotIn('synthetic-', json.dumps(result))
            self.assertTrue(all(path.startswith('/middlewares/k-') for path in result['changed_paths']))

    def test_basic_auth_unknown_masked_empty_and_unresolved_rejected(self):
        cases = [{}, {'realm': 'Synthetic'}, {'realm': 'Synthetic', 'users': []},
                 {'realm': 'Synthetic', 'users': ['masked:*****']},
                 {'realm': 'Synthetic', 'users': ['synthetic:']},
                 {'realm': 'Synthetic', 'users': ['${SECRET}']},
                 {'realm': 'Synthetic', 'users': ['synthetic:$SECRET']},
                 {'realm': 'Synthetic', 'users': SYNTHETIC_USERS, 'usersFile': '/synthetic-only'},
                 {'realm': '', 'users': SYNTHETIC_USERS}]
        for config in cases:
            with self.subTest(case=cases.index(config)), self.assertRaises(InvalidSnapshot):
                projector.basic_auth(config)

    def test_supported_crypt_dollar_syntax_is_not_interpolation(self):
        for credential in ('$2y$10$' + 'A' * 53, '$apr1$syntheti$' + 'A' * 22):
            labels = resolved_input()
            labels['services']['traefik']['traefik.http.middlewares.dashboard-auth.basicauth.users'] = 'synthetic:' + credential
            self.assertEqual(projector.project_source(labels)['collections']['middlewares']['dashboard-auth@docker']['basicAuth']['users_count'], 1)

    def test_missing_or_multiple_implicit_service_rejected(self):
        for extra in (False, True):
            data = resolved_input()
            labels = data['services']['dashboard']
            if extra:
                labels['traefik.http.services.other.loadbalancer.server.port'] = '8081'
            else:
                del labels['traefik.http.services.dashboard.loadbalancer.server.port']
            with self.assertRaisesRegex(InvalidSnapshot, '^ambiguous_implicit_service$'):
                projector.project_source(data)

    def test_explicit_service_does_not_require_inference(self):
        data = resolved_input()
        labels = data['services']['dashboard']
        labels['traefik.http.routers.dashboard.service'] = 'dashboard'
        labels['traefik.http.services.other.loadbalancer.server.port'] = '8081'
        self.assertEqual(projector.project_source(data)['collections']['routers']['dashboard@docker']['service'], 'dashboard@docker')

    def test_default_router_and_missing_rule_rejected(self):
        for labels in ({'traefik.enable': 'true'}, {'traefik.enable': 'true',
                'traefik.http.routers.extra.entrypoints': 'websecure', 'traefik.http.routers.extra.service': 'api@internal'}):
            data = resolved_input()
            data['services']['extra'] = labels
            with self.assertRaises(InvalidSnapshot):
                projector.project_source(data)

    def test_cross_service_router_and_middleware_duplicates_rejected(self):
        data = resolved_input()
        data['services']['replica'] = copy.deepcopy(data['services']['traefik'])
        with self.assertRaisesRegex(InvalidSnapshot, '^duplicate_router_definition$'):
            projector.project_source(data)
        data = resolved_input()
        data['services']['dashboard']['traefik.http.middlewares.dashboard-auth.basicauth.users'] = SYNTHETIC_USERS[0]
        data['services']['dashboard']['traefik.http.middlewares.dashboard-auth.basicauth.realm'] = 'Traefik Dashboard'
        with self.assertRaisesRegex(InvalidSnapshot, '^duplicate_middleware_definition$'):
            projector.project_source(data)

    def test_unknown_case_colliding_and_mixed_label_paths(self):
        for key, value in [('traefik.unknown', 'true'), ('traefik.tcp.routers.extra.rule', 'synthetic'),
                           ('traefik.http.routers.dashboard.tls.options', 'other'),
                           ('traefik.http.middlewares.dashboard-security.headers.unknown', 'true'),
                           ('traefik.http.middlewares.dashboard-security.ratelimit.average', '1'),
                           ('TRAEFIK.HTTP.ROUTERS.dashboard.rule', 'Host(`other.invalid`)')]:
            data = resolved_input()
            data['services']['dashboard'][key] = value
            with self.subTest(key=key), self.assertRaises(InvalidSnapshot):
                projector.project_source(data)

    def test_unknown_labels_rejected_even_when_disabled(self):
        data = resolved_input()
        data['services']['disabled']['traefik.unknown'] = 'synthetic'
        with self.assertRaises(InvalidSnapshot):
            projector.project_source(data)

    def test_unresolved_and_ambiguous_lists_numbers(self):
        for field, value in [('rule', 'Host(`${DOMAIN}`)'), ('rule', '{{ template }}'), ('rule', '$DOMAIN'),
                             ('entrypoints', 'websecure, other'), ('entrypoints', 'websecure,'),
                             ('entrypoints', 'websecure,websecure'), ('middlewares', 'one,,two'),
                             ('priority', '01'), ('priority', '1.0'), ('priority', '0'),
                             ('priority', '-1'), ('priority', str(2**63))]:
            data = resolved_input()
            data['services']['dashboard']['traefik.http.routers.dashboard.' + field] = value
            with self.subTest(field=field, value=value), self.assertRaises(InvalidSnapshot):
                projector.project_source(data)
        for value in ('0', '65536', '+8080'):
            data = resolved_input()
            data['services']['dashboard']['traefik.http.services.dashboard.loadbalancer.server.port'] = value
            with self.assertRaises(InvalidSnapshot):
                projector.project_source(data)

    def test_tls_false_unknown_and_nonobject_rejected(self):
        data = resolved_input()
        data['services']['dashboard']['traefik.http.routers.dashboard.tls'] = 'false'
        with self.assertRaises(InvalidSnapshot):
            projector.project_source(data)
        for tls in (False, True, None, {'unknown': 'value'}, {'certResolver': ''}):
            raw = synthetic_rawdata()
            raw['routers']['dashboard@docker']['tls'] = tls
            with self.assertRaises(InvalidSnapshot):
                self.observed(raw)

    def test_rate_limit_reuses_whole_second_validator(self):
        expected = projector.project_source(resolved_input())
        self.assertEqual(expected['collections']['middlewares']['dashboard-ratelimit@docker']['rateLimit']['period'], 60)
        for field, value in [('average', 11), ('burst', 21), ('period', '61s'),
                             ('sourceCriterion', {'requestHeaderName': 'X-Synthetic'})]:
            raw = synthetic_rawdata()
            raw['middlewares']['dashboard-ratelimit@docker']['rateLimit'][field] = value
            self.assertEqual(projector.compare_projections(expected, self.observed(raw))['status'], 'drift')
        for period in ('0s', '1.5s', '1000ms'):
            raw = synthetic_rawdata()
            raw['middlewares']['dashboard-ratelimit@docker']['rateLimit']['period'] = period
            with self.assertRaises(InvalidSnapshot):
                self.observed(raw)

    def test_failed_partial_hash_size_and_content_type_receipts(self):
        raw = json.dumps(synthetic_rawdata()).encode()
        body = self.root / 'receipt-body.json'
        body.write_bytes(raw)
        for key, value in [('status', 503), ('status', True), ('complete', False),
                           ('body_sha256', '0' * 64), ('body_bytes', len(raw) - 1),
                           ('content_type', 'text/html'), ('method', 'POST'), ('path', '/other')]:
            receipt = dict(receipt_for(raw), **{key: value})
            with self.subTest(field=key), self.assertRaisesRegex(InvalidSnapshot, '^invalid_api_receipt$'):
                projector.project_observed(body, receipt)

    def test_duplicate_json_keys_nonfinite_and_fractional_rejected(self):
        for raw in (b'{"routers":{},"routers":{},"middlewares":{}}', b'{"value":NaN}', b'{"value":1.5}', b'not json'):
            body = self.root / 'invalid-body.json'
            body.write_bytes(raw)
            with self.assertRaises(InvalidSnapshot):
                projector.project_observed(body, receipt_for(raw))
        labels = self.root / 'duplicate-labels.json'
        labels.write_text('{"schema":"one","schema":"two"}')
        with self.assertRaisesRegex(InvalidSnapshot, '^duplicate_json_key$'):
            projector.read_json(labels)

    def test_wrong_provider_and_tcp_udp_inventories_rejected(self):
        for section in ('routers', 'middlewares', 'services'):
            raw = synthetic_rawdata()
            name = next(iter(raw[section]))
            raw[section][name.split('@')[0] + '@foreign'] = raw[section].pop(name)
            with self.subTest(section=section), self.assertRaises(InvalidSnapshot):
                self.observed(raw)
        for section in ('tcpRouters', 'tcpMiddlewares', 'tcpServices', 'udpRouters', 'udpServices'):
            raw = synthetic_rawdata()
            raw[section] = {'synthetic@docker': {'status': 'enabled'}}
            with self.assertRaisesRegex(InvalidSnapshot, '^unsupported_transport_scope$'):
                self.observed(raw)

    def test_file_internal_exclusions_are_explicit(self):
        raw = synthetic_rawdata()
        raw['routers']['synthetic@file'] = {'unsupported_outside_scope': True}
        raw['middlewares']['synthetic@internal'] = {'unsupported_outside_scope': True}
        result = self.observed(raw)
        self.assertEqual(len(result['collections']['routers']), 5)
        self.assertEqual(len(result['collections']['middlewares']), 4)
        self.assertIn('providers.file', result['scope']['excluded'])
        self.assertIn('providers.internal', result['scope']['excluded'])

    def test_unhealthy_unknown_fields_and_metadata_rejected(self):
        for key, value in [('status', 'disabled'), ('error', ['synthetic diagnostic']),
                           ('using', 'websecure'), ('unknown', 'synthetic value')]:
            raw = synthetic_rawdata()
            raw['routers']['dashboard@docker'][key] = value
            with self.subTest(key=key), self.assertRaises(InvalidSnapshot):
                self.observed(raw)
        raw = synthetic_rawdata()
        raw['middlewares']['dashboard-auth@docker']['basicAuth']['usersFile'] = '/synthetic'
        with self.assertRaises(InvalidSnapshot):
            self.observed(raw)

    def test_malformed_empty_and_overbroad_input_scopes(self):
        for key, value in [('schema', 'other'), ('capture_status', 'partial'), ('services', {}),
                           ('services', []), ('provider', {'exposedByDefault': True, 'swarmMode': False}),
                           ('provider', {'exposedByDefault': False, 'swarmMode': True}),
                           ('provider', {'exposedByDefault': 0, 'swarmMode': False})]:
            data = dict(resolved_input(), **{key: value})
            with self.assertRaises(InvalidSnapshot):
                projector.project_source(data)
        for data in (None, [], {'extra': 'value'}):
            with self.assertRaises(InvalidSnapshot):
                projector.project_source(data)
        data = resolved_input()
        data['services'] = {'unlabelled': {}}
        with self.assertRaisesRegex(InvalidSnapshot, '^empty_scoped_capture$'):
            projector.project_source(data)

    def test_forged_projection_scope_and_configuration_rejected(self):
        expected, observed = projector.project_source(resolved_input()), self.observed()
        mutations = [lambda d: d['scope'].update(exposedByDefault=0),
                     lambda d: d['scope'].update(extra=True), lambda d: d.update(origin='source'),
                     lambda d: d['collections'].update(dynamic_files={'synthetic.yml': '0' * 64}),
                     lambda d: d['collections'].update(routers={}),
                     lambda d: d['collections']['routers']['dashboard@docker'].pop('priority'),
                     lambda d: d['collections']['middlewares']['dashboard-auth@docker']['basicAuth'].update(users=SYNTHETIC_USERS)]
        for mutate in mutations:
            altered = copy.deepcopy(observed)
            mutate(altered)
            with self.assertRaises(InvalidSnapshot):
                projector.compare_projections(expected, altered)

    def test_cli_equal_drift_invalid_and_output_collision(self):
        def run(*args):
            return subprocess.run([sys.executable, '-B', str(SCRIPTS / 'project_docker_provider_snapshot.py'), *map(str, args)],
                                  capture_output=True, text=True)
        source = self.root / 'source.json'
        source.write_text(json.dumps(resolved_input()))
        expected = self.root / 'expected.json'
        self.assertEqual(run('source', '--input', source, '--output', expected).returncode, 0)
        original = expected.read_bytes()
        self.assertEqual(run('source', '--input', source, '--output', expected).returncode, 2)
        self.assertEqual(expected.read_bytes(), original)
        observed = self.root / 'observed.json'
        observed.write_text(json.dumps(self.observed()))
        equal = run('compare', expected, observed)
        self.assertEqual(equal.returncode, 0)
        drift = json.loads(observed.read_text())
        drift['collections']['routers']['dashboard@docker']['priority'] = 12
        observed.write_text(json.dumps(drift))
        changed = run('compare', expected, observed)
        self.assertEqual(changed.returncode, 1)
        observed.write_text('{"synthetic-secret": malformed}')
        invalid = run('compare', expected, observed)
        self.assertEqual(invalid.returncode, 2)
        bad_args = run('--unknown', SYNTHETIC_USERS[0])
        self.assertEqual(bad_args.returncode, 2)
        for result in (equal, changed, invalid, bad_args):
            self.assertEqual(result.stderr, '')
            for forbidden in ('synthetic-secret', 'synthetic-user', '{SHA}', 'Host(', 'dashboard@docker'):
                self.assertNotIn(forbidden, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
