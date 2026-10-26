"""New capture boundary tests: all Docker/HTTP observations below are synthetic."""
import base64
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import shlex
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch
from datetime import datetime, timezone

import test_docker_provider_projection as data

SCRIPTS = Path(__file__).resolve().parents[2] / 'scripts/validation'
sys.path.insert(0, str(SCRIPTS))
import capture_docker_provider_snapshot as original


class DockerCaptureTests(unittest.TestCase):
    def setUp(self):
        evidence = os.environ.get('DOCKER_CAPTURE_TEST_EVIDENCE')
        self.root = Path(tempfile.mkdtemp(prefix=self._testMethodName + '-', dir=evidence)).resolve()
        if evidence is None:
            self.addCleanup(shutil.rmtree, self.root)
        self.implementation = self.root / 'implementation'
        self.implementation.mkdir()
        for name in [*original.HELPERS, 'capture_docker_provider_snapshot.py']:
            shutil.copyfile(SCRIPTS / name, self.implementation / name)
        spec = importlib.util.spec_from_file_location('isolated_capture', self.implementation / 'capture_docker_provider_snapshot.py')
        self.capture = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.capture)
        self.source = self.root / 'input.json'
        self.fixture_path = self.root / 'fixture.json'
        self.source.write_text(json.dumps(data.resolved_input()))
        self.files = {'docker-api.js': b'// synthetic API bytes, never executed\n',
                      'fixture.yaml': b'# synthetic pinned fixture bytes\n',
                      'state.json': self.source.read_bytes()}
        self.fixture = {'schema': 'peermesh.owned-docker-fixture.v1', 'namespace': 'pm166-docker-capture-123456',
                        **{key: str(i + 1) * 64 for i, key in enumerate(original.IDS)},
                        'api_script_sha256': original.digest(self.files['docker-api.js']),
                        'dynamic_fixture_sha256': original.digest(self.files['fixture.yaml'])}
        self.fixture_path.write_text(json.dumps(self.fixture))
        self.raw = data.synthetic_rawdata()
        self.network_name = self.fixture['namespace'] + '-internal'
        self.containers = []
        for index, kind in enumerate(('traefik', 'api', 'client')):
            mounts = [] if kind == 'client' else [{'Type': 'bind', 'RW': False,
                'Source': '/tmp/' + self.fixture['namespace'] + ('/dynamic' if kind == 'traefik' else '/api'),
                'Destination': '/dynamic' if kind == 'traefik' else '/fixture'}]
            self.containers.append({'Id': self.fixture[kind + '_id'],
                'Image': original.IMAGES['traefik' if kind == 'traefik' else 'client'],
                'State': {'Running': True, 'Paused': False, 'Restarting': False, 'Pid': 100 + index},
                'Config': {'Labels': {'peermesh.fixture': self.fixture['namespace']},
                    'Env': list(original.IMAGE_ENV if kind == 'traefik' else original.NODE_ENV),
                    'Cmd': list(original.FLAGS) if kind == 'traefik' else (['node', '/fixture/docker-api.js'] if kind == 'api' else ['node', '-e', 'setInterval(() => {}, 1000)']),
                    'Entrypoint': ['traefik'] if kind == 'traefik' else ['docker-entrypoint.sh'],
                    'User': '' if kind == 'traefik' else '65534:65534'},
                'HostConfig': {'ReadonlyRootfs': True, 'CapDrop': ['ALL'], 'SecurityOpt': ['no-new-privileges:true'],
                    'NanoCpus': 1000000000, 'PidsLimit': 128, 'Memory': (256 if kind == 'traefik' else 128) * 1024 * 1024,
                    'RestartPolicy': {'Name': 'no', 'MaximumRetryCount': 0}, 'NetworkMode': self.network_name},
                'Mounts': mounts, 'NetworkSettings': {'Networks': {self.network_name: {'IPAddress': '172.30.0.' + str(2 + index),
                    'Aliases': ['fixture-api'] if kind == 'api' else []}}, 'Ports': {}}})
        self.network = {'Id': self.fixture['network_id'], 'Name': self.network_name, 'Internal': True,
            'Driver': 'bridge', 'Scope': 'local', 'Labels': {'peermesh.fixture': self.fixture['namespace']},
            'Containers': {self.fixture[kind + '_id']: {} for kind in ('traefik', 'api', 'client')}}
        self.mutate = lambda event, count: None
        self.responses = lambda value, count: value
        self.calls = []
        self.events = {}
        self.output_number = 0
        self.extra_tree = False

    def command(self, argv):
        self.assertEqual(argv[:-1], original.SSH)
        args = shlex.split(argv[-1])
        self.assertEqual(args[0], 'docker')
        self.assertTrue((self.output / 'expected.json').is_file())
        expected = json.loads((self.output / 'expected.json').read_text())
        self.assertEqual(len(expected['collections']['routers']), 5)
        self.assertEqual(len(expected['collections']['middlewares']), 4)
        self.assertEqual(json.loads((self.output / 'raw/expected-binding.json').read_text())['sha256'], original.digest((self.output / 'expected.json').read_bytes()))
        event = 'identity' if args[1] == 'inspect' else ('network' if args[1] == 'network' else
            'api' if args[3:6] == ['node', '-e', original.NODE_HTTP] else 'files')
        self.events[event] = self.events.get(event, 0) + 1
        count = self.events[event]
        self.mutate(event, count)
        if args[1] == 'inspect':
            self.assertEqual(args[4:], [self.fixture[k] for k in original.IDS[:3]])
            raw = json.dumps(self.containers).encode()
        elif args[1] == 'network':
            self.assertEqual(args[2:], ['inspect', self.fixture['network_id']])
            raw = json.dumps([self.network]).encode()
        elif args[3] == 'find':
            raw = b'' if '!' in args else b'/dynamic\n/dynamic/fixture.yaml\n' + (b'/dynamic/extra\n' if self.extra_tree else b'')
        elif args[3] == 'wc':
            raw = (str(len(self.files['fixture.yaml'])) + ' /dynamic/fixture.yaml\n').encode()
        elif args[3] == 'cat':
            self.assertEqual(args[2:], [self.fixture['traefik_id'], 'cat', '/dynamic/fixture.yaml'])
            raw = self.files['fixture.yaml']
        elif args[5] == self.capture.API_FILES:
            self.assertEqual(args[2], self.fixture['api_id'])
            raw = json.dumps({name: base64.b64encode(self.files[name]).decode() for name in ('docker-api.js', 'state.json')}).encode()
        else:
            self.assertEqual(args[2:], [self.fixture['client_id'], 'node', '-e', original.NODE_HTTP, '172.30.0.2'])
            body = json.dumps(self.raw).encode()
            response = {'receipt': data.receipt_for(body), 'body_base64': base64.b64encode(body).decode(),
                        'headers': {'content-type': 'application/json', 'private-sentinel': 'synthetic-secret'}, 'raw_headers': []}
            raw = json.dumps(self.responses(response, count)).encode()
        self.calls.append({'argv': argv, 'exit': 0, 'stdout_base64': base64.b64encode(raw).decode(), 'stderr_base64': ''})
        (self.output / 'raw/commands.json').write_text(json.dumps(self.calls, indent=2))
        return subprocess.CompletedProcess(argv, 0, raw, b'')

    def execute(self, expected=0):
        self.output_number += 1
        self.output = self.root / ('output-' + str(self.output_number))
        self.events, self.calls = {}, []
        command = type('SyntheticCommands', (), {'run': lambda _, argv: self.command(argv)})()
        with patch.object(self.capture, 'Commands', return_value=command):
            result = self.capture.run(self.source, self.fixture_path, self.output)
        self.assertEqual(result['exit_code'], expected, result)
        serialized = json.dumps(result)
        for secret in ['synthetic-user', '{SHA}', 'synthetic-secret', 'dashboard', str(self.root), self.fixture['traefik_id']]:
            self.assertNotIn(secret, serialized)
        for p in self.output.rglob('*') if self.output.exists() else []:
            self.assertEqual(stat.S_IMODE(p.stat().st_mode), 0o700 if p.is_dir() else 0o600, p)
        return result

    def test_expected_precedes_all_callbacks_and_equal_private_evidence(self):
        result = self.execute()
        self.assertEqual(self.events['identity'], 2)
        self.assertEqual(self.events['api'], 2)
        self.assertEqual(result['changed_paths'], [])
        self.assertIn('synthetic-user', (self.output / 'raw/api-first/body.json').read_text())
        self.assertEqual(json.loads((self.output / 'raw/input-before.json').read_text()), json.loads((self.output / 'raw/input-after.json').read_text()))

    def test_stable_runtime_label_and_rawdata_drift_uses_original_expected(self):
        labels = data.resolved_input()
        labels['services']['dashboard']['traefik.http.middlewares.dashboard-ratelimit.ratelimit.average'] = '11'
        self.files['state.json'] = json.dumps(labels).encode()
        self.raw['middlewares']['dashboard-ratelimit@docker']['rateLimit']['average'] = 11
        result = self.execute(1)
        self.assertTrue(all(original.PATH_PATTERN.fullmatch(p) for p in result['changed_paths']))
        self.assertEqual(json.loads((self.output / 'expected.json').read_text())['collections']['middlewares']['dashboard-ratelimit@docker']['rateLimit']['average'], 10)

    def test_stopped_paused_restarting_and_unhealthy_rawdata(self):
        for field, value in [('Running', False), ('Paused', True), ('Restarting', True)]:
            with self.subTest(field=field):
                before = self.containers[0]['State'][field]
                self.containers[0]['State'][field] = value
                self.execute(2)
                self.containers[0]['State'][field] = before
        self.raw['routers']['dashboard@docker']['status'] = 'disabled'
        self.execute(2)

    def test_receipt_partial_hash_size_type_status_and_unknown_rejected(self):
        for key, value in [('complete', False), ('body_sha256', '0' * 64), ('body_bytes', 1), ('status', 503),
                           ('status', True), ('content_type', 'text/html'), ('path', '/other'), ('method', 'POST'), ('unknown', True)]:
            with self.subTest(key=key):
                def change(response, count):
                    response['receipt'][key] = value
                    return response
                self.responses = change
                self.execute(2)

    def test_malformed_unsupported_and_oversized_bodies_rejected(self):
        for body in [b'{', b'{}', b'x' * (original.MAX_BYTES + 1), b'{"routers":{},"routers":{}}']:
            with self.subTest(length=len(body)):
                self.responses = lambda response, count: dict(response, body_base64=base64.b64encode(body).decode(), receipt=data.receipt_for(body))
                self.execute(2)
        self.responses = lambda response, count: dict(response, body_base64='!bad!')
        self.execute(2)

    def test_changed_api_body_between_observations(self):
        def mutate(event, count):
            if event == 'api' and count == 2:
                self.raw['middlewares']['dashboard-ratelimit@docker']['rateLimit']['average'] = 11
        self.mutate = mutate
        self.assertEqual(self.execute(2)['reason'], 'runtime_api_changed')

    def test_changed_runtime_source_between_observations(self):
        def mutate(event, count):
            if event == 'api' and count == 2:
                value = data.resolved_input()
                value['services']['dashboard']['traefik.http.middlewares.dashboard-ratelimit.ratelimit.average'] = '11'
                self.files['state.json'] = json.dumps(value).encode()
        self.mutate = mutate
        self.assertEqual(self.execute(2)['reason'], 'runtime_files_changed')

    def test_changed_full_identity_between_observations(self):
        def mutate(event, count):
            if event == 'identity' and count == 2:
                self.containers[0]['State']['Pid'] += 1
        self.mutate = mutate
        self.assertEqual(self.execute(2)['reason'], 'runtime_identity_changed')

    def test_changed_local_input_fixture_runner_or_helper_invalidates_result(self):
        for path in [self.source, self.fixture_path, self.implementation / 'capture_docker_provider_snapshot.py',
                     self.implementation / 'project_docker_provider_snapshot.py']:
            with self.subTest(file=path.name):
                before = path.read_bytes()
                def mutate(event, count):
                    if event == 'api' and count == 2:
                        path.write_bytes(before + b'\n')
                self.mutate = mutate
                result = self.execute(2)
                self.assertIn(result['reason'], ['source_or_helper_changed', 'source_binding_unavailable'])
                path.write_bytes(before)

    def test_fixture_schema_namespace_full_distinct_ids_and_hashes(self):
        cases = [('schema', 'other'), ('namespace', 'pm166-docker-qual-123456'), ('namespace', 'pm166-docker-capture-123456;bad'),
                 ('traefik_id', '1' * 12), ('api_id', 'A' * 64), ('client_id', self.fixture['traefik_id']),
                 ('network_id', 'bad'), ('api_script_sha256', None), ('dynamic_fixture_sha256', 'z' * 64), ('unknown', True)]
        for key, value in cases:
            with self.subTest(key=key):
                self.fixture_path.write_text(json.dumps(dict(self.fixture, **{key: value})))
                self.execute(2)
                self.assertFalse(self.calls)
        value = dict(self.fixture)
        del value['api_id']
        self.fixture_path.write_text(json.dumps(value))
        self.execute(2)

    def test_network_identity_internal_label_members_and_scope(self):
        for key, value in [('Id', '9' * 64), ('Name', 'other'), ('Internal', False), ('Labels', {}),
                           ('Containers', {}), ('Containers', dict(self.network['Containers'], extra={})), ('Driver', 'host'), ('Scope', 'swarm')]:
            with self.subTest(key=key):
                before = self.network[key]
                self.network[key] = value
                self.execute(2)
                self.network[key] = before

    def test_container_identity_image_and_ownership_boundaries(self):
        for index in range(3):
            for key, value in [('Id', '9' * 64), ('Image', 'sha256:' + '9' * 64)]:
                with self.subTest(container=index, key=key):
                    before = self.containers[index][key]
                    self.containers[index][key] = value
                    self.execute(2)
                    self.containers[index][key] = before
        self.containers[1]['Config']['Labels'] = {}
        self.execute(2)

    def test_container_isolation_and_exact_resource_limits(self):
        changes = [('ReadonlyRootfs', False), ('CapDrop', []), ('CapAdd', ['NET_ADMIN']), ('SecurityOpt', []),
                   ('NanoCpus', 0), ('PidsLimit', 0), ('Memory', 0), ('RestartPolicy', {'Name': 'always'}),
                   ('NetworkMode', 'host'), ('PortBindings', {'80/tcp': [{}]}), ('Privileged', True),
                   ('PublishAllPorts', True), ('PidMode', 'host'), ('IpcMode', 'host'), ('Devices', [{}]),
                   ('DeviceRequests', [{}]), ('VolumesFrom', ['other']), ('ExtraHosts', ['other']), ('Tmpfs', {'/socket': ''})]
        for key, value in changes:
            with self.subTest(key=key):
                host = self.containers[1]['HostConfig']
                before = copy.deepcopy(host)
                host[key] = value
                self.execute(2)
                self.containers[1]['HostConfig'] = before

    def test_mount_commands_flags_users_and_network_address(self):
        cases = [(0, 'Mounts', []), (2, 'Mounts', [{'Source': '/var/run/docker.sock'}])]
        for index, key, value in cases:
            before = self.containers[index][key]
            self.containers[index][key] = value
            self.execute(2)
            self.containers[index][key] = before
        for index, key, value in [(0, 'Cmd', original.FLAGS + ['--api.insecure=true']),
                (0, 'Cmd', original.FLAGS[:-1]), (1, 'Cmd', ['node', '/other']), (2, 'Cmd', ['sh']),
                (1, 'Entrypoint', ['sh']), (2, 'User', '0:0')]:
            before = self.containers[index]['Config'][key]
            self.containers[index]['Config'][key] = value
            self.execute(2)
            self.containers[index]['Config'][key] = before
        for value in ['8.8.8.8', '127.0.0.1', '0.0.0.0', '169.254.1.1', '::1']:
            self.containers[0]['NetworkSettings']['Networks'][self.network_name]['IPAddress'] = value
            self.execute(2)

    def test_runtime_code_dynamic_hash_inventory_and_state_rejected(self):
        for name in ['docker-api.js', 'fixture.yaml', 'state.json']:
            before = self.files[name]
            self.files[name] = b'changed'
            self.execute(2)
            self.files[name] = before
        self.extra_tree = True
        self.execute(2)

    def test_environment_cannot_bypass_exact_provider_flags_or_node_command(self):
        for index, value in [(0, 'TRAEFIK_PROVIDERS_DOCKER_ENDPOINT=tcp://other:2375'),
                             (0, 'TRAEFIK_PROVIDERS_HTTP_ENDPOINT=http://other'),
                             (1, 'NODE_OPTIONS=--require=/other'), (2, 'NODE_OPTIONS=--require=/other')]:
            with self.subTest(container=index, value=value):
                self.containers[index]['Config']['Env'].append(value)
                self.execute(2)
                self.containers[index]['Config']['Env'].pop()

    def test_invalid_source_prevents_transport_and_runtime_code_change_rejected(self):
        before = self.source.read_bytes()
        self.source.write_text('{"schema":"unsupported"}')
        self.execute(2)
        self.assertFalse(self.calls)
        self.source.write_bytes(before)
        def mutate(event, count):
            if event == 'api' and count == 2:
                self.files['docker-api.js'] += b'changed'
        self.mutate = mutate
        self.assertEqual(self.execute(2)['reason'], 'runtime_fixture_hash_mismatch')

    def test_collision_preserves_every_existing_byte_and_no_callback(self):
        self.execute()
        before = {str(p): p.read_bytes() for p in self.output.rglob('*') if p.is_file()}
        with patch.object(self.capture, 'Commands', side_effect=AssertionError('must not observe')):
            result = self.capture.run(self.source, self.fixture_path, self.output)
        self.assertEqual(result['reason'], 'output_collision')
        self.assertEqual(before, {str(p): p.read_bytes() for p in self.output.rglob('*') if p.is_file()})

    def test_overlap_symlink_oversized_source_and_helper_tamper(self):
        result = self.capture.run(self.source, self.fixture_path, self.implementation / 'output')
        self.assertEqual(result['reason'], 'overlapping_capture_storage')
        source = self.source.read_bytes()
        self.source.unlink()
        self.source.symlink_to(self.fixture_path)
        self.execute(2)
        self.source.unlink()
        self.source.write_bytes(b'x' * (original.MAX_BYTES + 1))
        self.execute(2)
        self.source.write_bytes(source)
        (self.implementation / 'project_docker_provider_snapshot.py').write_bytes(b'# changed')
        self.execute(2)
        self.assertFalse(self.calls)

    def test_private_exception_is_redacted_even_for_capture_error(self):
        self.mutate = lambda event, count: (_ for _ in ()).throw(original.CaptureError('synthetic-secret synthetic-user /private/path'))
        result = self.execute(2)
        self.assertEqual(result['reason'], 'invalid_or_unavailable_input')
        self.assertIn('synthetic-secret', (self.output / 'raw/failure.json').read_text())

    def test_actual_main_invalid_and_collision_stdout_exit_redaction(self):
        script = self.implementation / 'capture_docker_provider_snapshot.py'
        receipts = []
        for args in [[], ['--host', 'synthetic-secret'], ['--input', str(self.source), '--fixture', str(self.fixture_path), '--output', str(self.source)]]:
            argv = [sys.executable, '-B', str(script), *args]
            started = datetime.now(timezone.utc).isoformat()
            before = original.digest(self.source.read_bytes())
            completed = subprocess.run(argv, cwd=self.root, capture_output=True, text=True)
            receipts.append({'argv': argv, 'cwd': str(self.root), 'started': started,
                'finished': datetime.now(timezone.utc).isoformat(), 'exit': completed.returncode,
                'stdout': completed.stdout, 'stderr': completed.stderr,
                'source_before': before, 'source_after': original.digest(self.source.read_bytes()),
                'ssh_executed': False})
            (self.root / 'cli-receipts.json').write_text(json.dumps(receipts, indent=2))
            self.assertEqual(completed.returncode, 2)
            self.assertEqual(completed.stderr, '')
            value = json.loads(completed.stdout)
            self.assertEqual(value['exit_code'], 2)
            self.assertNotIn('synthetic-secret', completed.stdout)
            self.assertNotIn(str(self.root), completed.stdout)
        self.assertEqual(self.source.read_text(), json.dumps(data.resolved_input()))


if __name__ == '__main__':
    unittest.main()
