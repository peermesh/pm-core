"""Only new one-shot runner boundaries; no replay of projection/comparator suites."""
import base64
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts/validation'))
import capture_file_provider_snapshot as capture

SOURCE = {'http': {'routers': {'api': {'entryPoints': ['web'], 'priority': 100, 'rule': 'PathPrefix(`/api`)',
    'service': 'api@internal', 'middlewares': ['fixture']}},
    'middlewares': {'fixture': {'headers': {'customResponseHeaders': {'X-Fixture': 'PRIVATE_VALUE'}}}}}}


class FakeTransport:
    def __init__(self, commands, fixture, source, fault=None):
        self.source = source
        self.fault = fault
        self.api_calls = self.identity_calls = self.file_calls = 0
        self.raw_file = (source / 'fixture.yaml').read_bytes()

    def identity(self):
        self.identity_calls += 1
        if self.fault == 'stopped':
            raise capture.CaptureError('fixture_not_running')
        return {'identity': 'different' if self.fault == 'identity' and self.identity_calls == 2 else 'same'}

    def files(self):
        self.file_calls += 1
        raw = self.raw_file
        if self.fault == 'files' and self.file_calls == 2:
            raw += b'\n# runtime changed\n'
        if self.fault == 'drift':
            raw = raw.replace(b'PRIVATE_VALUE', b'CHANGED_VALUE')
        return {'fixture.yaml': raw}

    def api(self):
        self.api_calls += 1
        data = copy.deepcopy(SOURCE['http'])
        data['routers'] = {'api@file': dict(data['routers']['api'], middlewares=['fixture@file'], status='enabled', using=['web'])}
        data['middlewares'] = {'fixture@file': dict(data['middlewares']['fixture'], status='enabled', usedBy=['api@file'])}
        if self.fault == 'drift' or (self.fault == 'api' and self.api_calls == 2):
            data['middlewares']['fixture@file']['headers']['customResponseHeaders']['X-Fixture'] = 'CHANGED_VALUE'
        if self.fault == 'source' and self.api_calls == 2:
            (self.source / 'fixture.yaml').write_bytes(self.raw_file + b'\n# source changed\n')
        raw = (json.dumps(data) + '\n').encode()
        receipt = {'schema': 'peermesh.rawdata-receipt.v1', 'method': 'GET', 'path': '/api/rawdata', 'status': 200,
            'complete': True, 'content_type': 'application/json', 'body_sha256': capture.digest(raw), 'body_bytes': len(raw)}
        if self.fault == 'truncated':
            receipt['complete'] = False
        if self.fault == 'failed':
            receipt['status'] = 503
        return {'receipt': receipt, 'body_base64': base64.b64encode(raw).decode(), 'headers': {'x-fixture': 'PRIVATE_VALUE'}}


MIDDLEWARE_SOURCE = copy.deepcopy(SOURCE)
MIDDLEWARE_SOURCE['http']['middlewares'].update({
    'rate-one': {'rateLimit': {'average': 30, 'burst': 1, 'period': '1h',
                             'sourceCriterion': {'requestHeaderName': 'X-Private-Actor'}}},
    'rate-two': {'rateLimit': {'average': 45, 'burst': 3, 'period': '90s'}},
    'chain': {'chain': {'middlewares': ['rate-one', 'rate-two@file']}}})
SECURITY_SOURCE = copy.deepcopy(MIDDLEWARE_SOURCE)
SECURITY_SOURCE['http']['middlewares'].update({
    'auth-true': {'forwardAuth': {'address': 'http://auth.invalid:9000/check', 'trustForwardHeader': True,
                                'authResponseHeaders': ['X-Identity', 'x-Role', 'X-Identity']}},
    'auth-false': {'forwardAuth': {'address': 'https://auth.invalid/check', 'trustForwardHeader': False,
                                 'authResponseHeaders': ['X-Identity']}},
    'buffer': {'buffering': {'maxRequestBodyBytes': 1048576, 'memRequestBodyBytes': 16384}},
    'allow': {'ipAllowList': {'sourceRange': ['192.0.2.0/24', '2001:db8::/32', '192.0.2.0/24']}}})
SECURITY_DRIFT = {
    'auth-true': {'forwardAuth': {'address': 'https://changed.invalid/PRIVATE', 'trustForwardHeader': False,
                                'authResponseHeaders': ['x-Role', 'X-Changed', 'X-Identity']}},
    'buffer': {'buffering': {'maxRequestBodyBytes': 2097152, 'memRequestBodyBytes': 32768}},
    'allow': {'ipAllowList': {'sourceRange': ['2001:db8:1::/48', '198.51.100.0/24']}}}


class MiddlewareTransport(FakeTransport):
    """Actual pinned API duration/reference forms through the existing capture path."""
    def files(self):
        files = super().files()
        if self.fault == 'middleware-drift':
            data = json.loads(files['fixture.yaml'])
            data['http']['middlewares']['rate-one']['rateLimit']['average'] = 31
            data['http']['middlewares']['chain']['chain']['middlewares'] = ['rate-two', 'fixture']
            files['fixture.yaml'] = json.dumps(data).encode()
        elif self.fault == 'security-drift':
            data = json.loads(files['fixture.yaml'])
            data['http']['middlewares'].update(copy.deepcopy(SECURITY_DRIFT))
            files['fixture.yaml'] = json.dumps(data).encode()
        return files

    def api(self):
        result = super().api()
        data = json.loads(base64.b64decode(result['body_base64']))
        data['middlewares'].update({
            'rate-one@file': {'rateLimit': {'average': 30, 'burst': 1, 'period': '1h0m0s',
                'sourceCriterion': {'requestHeaderName': 'X-Private-Actor'}}, 'status': 'enabled'},
            'rate-two@file': {'rateLimit': {'average': 45, 'burst': 3, 'period': '1m30s'}, 'status': 'enabled'},
            'chain@file': {'chain': {'middlewares': ['rate-one@file', 'rate-two@file']}, 'status': 'enabled'}})
        if self.fault == 'middleware-drift':
            data['middlewares']['rate-one@file']['rateLimit']['average'] = 31
            data['middlewares']['chain@file']['chain']['middlewares'] = ['rate-two@file', 'fixture@file']
        elif self.fault == 'foreign-chain':
            data['middlewares']['chain@file']['chain']['middlewares'] = ['PRIVATE@docker']
        elif self.fault == 'unknown-rate':
            data['middlewares']['rate-one@file']['rateLimit']['private'] = 'PRIVATE_VALUE'
        source = json.loads(self.raw_file)['http']['middlewares']
        for name in ('auth-true', 'auth-false', 'buffer', 'allow'):
            if name in source:
                config = copy.deepcopy(SECURITY_DRIFT[name] if self.fault == 'security-drift' and name in SECURITY_DRIFT else source[name])
                if 'forwardAuth' in config and config['forwardAuth']['trustForwardHeader'] is False and self.fault != 'security-explicit-false':
                    del config['forwardAuth']['trustForwardHeader']
                data['middlewares'][name + '@file'] = dict(config, status='enabled')
        if self.fault == 'security-unknown':
            data['middlewares']['buffer@file']['buffering']['PRIVATE'] = 'CANARY'
        elif self.fault == 'security-trust-string':
            data['middlewares']['auth-true@file']['forwardAuth']['trustForwardHeader'] = 'PRIVATE'
        elif self.fault == 'security-bad-cidr':
            data['middlewares']['allow@file']['ipAllowList']['sourceRange'] = ['PRIVATE']
        raw = (json.dumps(data) + '\n').encode()
        result['body_base64'] = base64.b64encode(raw).decode()
        result['receipt'].update(body_sha256=capture.digest(raw), body_bytes=len(raw))
        return result


class CaptureTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name).resolve()
        self.source = self.root / 'source'
        self.source.mkdir()
        (self.source / 'fixture.yaml').write_text(json.dumps(SOURCE))
        self.inventory = self.root / 'inventory.json'
        self.inventory.write_text(json.dumps({'schema': 'peermesh.file-inventory.v1', 'capture_status': 'complete', 'files': ['fixture.yaml']}))
        self.fixture = self.root / 'fixture.json'
        self.contract = {'schema': 'peermesh.owned-file-fixture.v1', 'namespace': 'pm166-drift-capture-190710',
                         'traefik_id': '1' * 64, 'client_id': '2' * 64, 'network_id': '3' * 64}
        self.fixture.write_text(json.dumps(self.contract))
        self.created = []

    def invoke(self, name, fault=None):
        def factory(commands, fixture):
            transport = FakeTransport(commands, fixture, self.source, fault)
            self.created.append(transport)
            return transport
        return capture.run(self.source, self.inventory, self.fixture, self.root / name, factory)

    def test_equal_drift_invalid_and_redacted_outcomes(self):
        for name, fault, code in [('equal', None, 0), ('drift', 'drift', 1), ('invalid', 'stopped', 2)]:
            with self.subTest(name=name):
                result = self.invoke(name, fault)
                self.assertEqual(result['exit_code'], code)
                rendered = json.dumps(result)
                for private in ('PRIVATE_VALUE', 'CHANGED_VALUE', 'PathPrefix', str(self.source), 'api@file', '1' * 64):
                    self.assertNotIn(private, rendered)
                self.assertEqual(json.loads((self.root / name / 'outcome.json').read_text()), result)

    def test_output_collision_preserves_all_prior_bytes(self):
        self.assertEqual(self.invoke('prior')['exit_code'], 0)
        prior = {p.relative_to(self.root / 'prior').as_posix(): p.read_bytes() for p in (self.root / 'prior').rglob('*') if p.is_file()}
        count = len(self.created)
        result = self.invoke('prior')
        self.assertEqual(result['reason'], 'output_collision')
        self.assertEqual(len(self.created), count)
        self.assertEqual(prior, {p.relative_to(self.root / 'prior').as_posix(): p.read_bytes() for p in (self.root / 'prior').rglob('*') if p.is_file()})

    def test_failed_new_capture_preserves_prior_output(self):
        self.invoke('prior')
        digest = capture.digest((self.root / 'prior/outcome.json').read_bytes())
        self.assertEqual(self.invoke('failed', 'failed')['exit_code'], 2)
        self.assertEqual(capture.digest((self.root / 'prior/outcome.json').read_bytes()), digest)

    def test_source_change_is_invalid(self):
        self.assertEqual(self.invoke('changed', 'source')['reason'], 'source_or_helper_changed')

    def test_identity_file_and_api_changes_are_invalid(self):
        for fault, reason in [('identity', 'runtime_identity_changed'), ('files', 'runtime_files_changed'), ('api', 'runtime_api_changed')]:
            with self.subTest(fault=fault):
                self.assertEqual(self.invoke(fault, fault)['reason'], reason)

    def test_failed_and_truncated_receipts_are_invalid(self):
        for fault in ('failed', 'truncated'):
            with self.subTest(fault=fault):
                self.assertEqual(self.invoke(fault, fault)['reason'], 'invalid_api_capture')

    def test_unsafe_paths_overlap_and_dangling_output_link(self):
        link = self.root / 'link'
        link.symlink_to(self.root / 'absent')
        self.assertEqual(self.invoke('link')['reason'], 'output_collision')
        result = capture.run(self.source, self.inventory, self.fixture, self.source / 'output')
        self.assertEqual(result['reason'], 'overlapping_capture_storage')
        source_link = self.root / 'source-link'
        source_link.symlink_to(self.source)
        result = capture.run(source_link, self.inventory, self.fixture, self.root / 'output')
        self.assertEqual(result['reason'], 'unsafe_local_path')

    def test_transport_arguments_reject_arbitrary_hosts_ids_and_namespaces(self):
        for change in ({'traefik_id': '$(touch forbidden)'}, {'namespace': 'production'}, {'url': 'https://private.invalid'}):
            self.fixture.write_text(json.dumps(dict(self.contract, **change)))
            with self.subTest(change=change):
                self.assertEqual(self.invoke('never-created')['reason'], 'invalid_fixture_contract')
                self.assertFalse((self.root / 'never-created').exists())
        self.assertEqual(self.created, [])

    def test_timeout_captures_raw_diagnostics_without_leaking_outcome(self):
        output = self.root / 'timeout'
        (output / 'raw').mkdir(parents=True)
        commands = capture.Commands(output)
        with patch.object(capture.subprocess, 'run', side_effect=subprocess.TimeoutExpired(['secret'], 1, b'PRIVATE_VALUE', b'PRIVATE_VALUE')):
            with self.assertRaisesRegex(capture.CaptureError, '^capture_timeout$'):
                commands.run(['secret'])
        self.assertTrue((output / 'raw/commands.json').is_file())

    def test_raw_comparison_paths_cannot_escape_redaction(self):
        real = capture.Commands.run
        def altered(commands, argv):
            response = real(commands, argv)
            if 'compare' in argv:
                value = json.loads(response.stdout)
                value['changed_paths'] = ['/routers/PRIVATE_VALUE']
                value['status'] = 'drift'
                return subprocess.CompletedProcess(argv, 1, json.dumps(value).encode(), b'')
            return response
        with patch.object(capture.Commands, 'run', altered):
            result = self.invoke('bad-path')
        self.assertEqual(result['reason'], 'invalid_comparison_outcome')
        self.assertNotIn('PRIVATE_VALUE', json.dumps(result))

    def test_helper_drift_refuses_before_transport(self):
        with patch.dict(capture.HELPERS, {'project_file_provider_snapshot.py': '0' * 64}):
            result = self.invoke('bad-helper')
        self.assertEqual(result['reason'], 'projection_helper_mismatch')
        self.assertEqual(self.created, [])

    def invoke_middleware(self, name, fault=None, security=False):
        (self.source / 'fixture.yaml').write_text(json.dumps(SECURITY_SOURCE if security else MIDDLEWARE_SOURCE))
        def factory(commands, fixture):
            transport = MiddlewareTransport(commands, fixture, self.source, fault)
            self.created.append(transport)
            return transport
        return capture.run(self.source, self.inventory, self.fixture, self.root / name, factory)

    def test_integrated_pin_scope_and_unchanged_header_capture(self):
        self.assertEqual(capture.HELPERS['project_file_provider_snapshot.py'],
                         'f3297d90fd4d8466de7a2317a9050f9355442cbc4547b25a6ad1da34ce3b31d4')
        helper = Path(capture.__file__).parent / 'project_file_provider_snapshot.py'
        self.assertEqual(capture.digest(helper.read_bytes()), capture.HELPERS[helper.name])
        result = self.invoke('headers-retained')
        self.assertEqual(result['exit_code'], 0)
        self.assertEqual(result['scope']['middleware_types'], ['headers', 'rateLimit', 'chain', 'forwardAuth', 'buffering', 'ipAllowList'])
        self.assertEqual(result['scope']['rate_limit_period_unit'], 'seconds')

    def test_integrated_rate_chain_equal_drift_unavailable_preserve_all_outputs(self):
        equal = self.invoke_middleware('middleware-equal')
        self.assertEqual(equal['exit_code'], 0)
        expected = json.loads((self.root / 'middleware-equal/expected.json').read_text())
        self.assertEqual(expected['collections']['middlewares']['rate-one@file']['rateLimit']['period'], 3600)
        drift = self.invoke_middleware('middleware-drift', 'middleware-drift')
        self.assertEqual(drift['exit_code'], 1)
        self.assertEqual({p.split('/')[1] for p in drift['changed_paths']}, {'middlewares', 'dynamic_files'})
        for private in ('X-Private-Actor', 'PRIVATE_VALUE', 'rate-one@file', 'chain@file'):
            self.assertNotIn(private, json.dumps(drift))
        prior = {p.relative_to(self.root).as_posix(): p.read_bytes()
                 for name in ('middleware-equal', 'middleware-drift') for p in (self.root / name).rglob('*') if p.is_file()}
        failed = self.invoke_middleware('middleware-unavailable', 'stopped')
        self.assertEqual(failed['exit_code'], 2)
        self.assertEqual(failed['status'], 'invalid_unavailable')
        self.assertTrue(all((self.root / name).read_bytes() == raw for name, raw in prior.items()))
        self.assertFalse((self.root / 'middleware-unavailable/observed.json').exists())

    def test_integrated_new_type_refusals_are_redacted(self):
        for fault in ('foreign-chain', 'unknown-rate'):
            with self.subTest(fault=fault):
                result = self.invoke_middleware(fault, fault)
                self.assertEqual(result['exit_code'], 2)
                self.assertEqual(result['reason'], 'observed_projection_invalid')
                self.assertNotIn('PRIVATE', json.dumps(result))
                self.assertFalse((self.root / fault / 'observed.json').exists())

    def test_security_equal_drift_unavailable_preserves_all_prior_outputs(self):
        self.assertEqual(self.invoke_middleware('security-equal', security=True)['exit_code'], 0)
        expected = json.loads((self.root / 'security-equal/expected.json').read_text())
        self.assertIs(expected['collections']['middlewares']['auth-false@file']['forwardAuth']['trustForwardHeader'], False)
        result = self.invoke_middleware('security-drift', 'security-drift', security=True)
        self.assertEqual(result['exit_code'], 1)
        self.assertEqual({p.split('/')[1] for p in result['changed_paths']}, {'middlewares', 'dynamic_files'})
        for private in ('PRIVATE', 'changed.invalid', 'X-Identity', '192.0.2', 'buffer@file'):
            self.assertNotIn(private, json.dumps(result))
        prior = {p.relative_to(self.root).as_posix(): p.read_bytes() for name in ('security-equal', 'security-drift')
                 for p in (self.root / name).rglob('*') if p.is_file()}
        failed = self.invoke_middleware('security-unavailable', 'stopped', security=True)
        self.assertEqual(failed['exit_code'], 2)
        self.assertFalse((self.root / 'security-unavailable/observed.json').exists())
        self.assertTrue(all((self.root / name).read_bytes() == raw for name, raw in prior.items()))

    def test_security_explicit_false_and_observed_refusals(self):
        self.assertEqual(self.invoke_middleware('explicit-false', 'security-explicit-false', security=True)['exit_code'], 0)
        for fault in ('security-unknown', 'security-trust-string', 'security-bad-cidr'):
            result = self.invoke_middleware(fault, fault, security=True)
            with self.subTest(fault=fault):
                self.assertEqual(result['exit_code'], 2)
                self.assertEqual(result['reason'], 'observed_projection_invalid')
                self.assertNotIn('PRIVATE', json.dumps(result))
                self.assertFalse((self.root / fault / 'observed.json').exists())

    def test_security_missing_source_trust_fails_before_transport(self):
        data = copy.deepcopy(SECURITY_SOURCE)
        del data['http']['middlewares']['auth-false']['forwardAuth']['trustForwardHeader']
        (self.source / 'fixture.yaml').write_text(json.dumps(data))
        def forbidden(*args):
            self.fail('Invalid source must fail before runtime observation')
        result = capture.run(self.source, self.inventory, self.fixture, self.root / 'missing-trust', forbidden)
        self.assertEqual(result['exit_code'], 2)
        self.assertEqual(result['reason'], 'source_projection_invalid')

    def test_old_projector_pin_is_rejected_before_new_scope_transport(self):
        with patch.dict(capture.HELPERS, {'project_file_provider_snapshot.py':
                '75dc111709d500152d6632bb641ef4883246c7662a6de2e749221a1c28d4789b'}):
            result = self.invoke_middleware('old-pin')
        self.assertEqual(result['exit_code'], 2)
        self.assertEqual(result['reason'], 'projection_helper_mismatch')
        self.assertEqual(self.created, [])

    def test_old_comparison_scope_is_rejected(self):
        real = capture.Commands.run
        def old_scope(commands, argv):
            result = real(commands, argv)
            if 'compare' in argv:
                body = json.loads(result.stdout)
                body['scope'] = dict(body['scope'], middleware_types=['headers'])
                return subprocess.CompletedProcess(argv, result.returncode, json.dumps(body).encode(), result.stderr)
            return result
        with patch.object(capture.Commands, 'run', old_scope):
            result = self.invoke_middleware('old-scope')
        self.assertEqual(result['exit_code'], 2)
        self.assertEqual(result['reason'], 'invalid_comparison_outcome')

    def test_runtime_inventory_rejects_nonregular_and_unsafe_paths(self):
        transport = capture.FixtureTransport(None, self.contract)
        with patch.object(transport, 'docker', return_value=b'/dynamic/fifo\n'):
            with self.assertRaisesRegex(capture.CaptureError, 'unsafe_runtime_file_tree'):
                transport.files()

    def test_identity_refuses_isolation_and_ownership_violations(self):
        namespace = self.contract['namespace']
        network_name = namespace + '-internal'
        network = {'Id': self.contract['network_id'], 'Name': network_name, 'Internal': True,
            'Labels': {'peermesh.fixture': namespace}, 'Containers': {self.contract['traefik_id']: {}, self.contract['client_id']: {}}}
        containers = []
        for index, key in enumerate(('traefik', 'client')):
            containers.append({'Id': self.contract[key + '_id'], 'Image': capture.IMAGES[key], 'RestartCount': 0,
                'State': {'Running': True, 'Paused': False, 'Restarting': False, 'StartedAt': 'fixed-start', 'Pid': index + 1},
                'HostConfig': {'PortBindings': {}, 'Privileged': False, 'ReadonlyRootfs': True, 'CapDrop': ['ALL'],
                    'CapAdd': [], 'SecurityOpt': ['no-new-privileges:true'], 'NetworkMode': network_name},
                'Config': {'Labels': {'peermesh.fixture': namespace}, 'Entrypoint': ['traefik'],
                    'Cmd': capture.FLAGS.copy() if key == 'traefik' else ['node', '-e', 'setInterval(() => {}, 1000)']},
                'NetworkSettings': {'Networks': {network_name: {'IPAddress': '172.20.0.' + str(index + 2)}}},
                'Mounts': [{'Type': 'bind', 'Source': '/tmp/' + namespace + '/dynamic', 'Destination': '/dynamic', 'RW': False}] if key == 'traefik' else []})
        transport = capture.FixtureTransport(None, self.contract)
        with patch.object(transport, 'docker', side_effect=[json.dumps(containers).encode(), json.dumps([network]).encode()]):
            self.assertEqual(len(transport.identity()['containers']), 2)
        mutations = [
            ('published', lambda c, n: c[0]['HostConfig'].update(PortBindings={'8080/tcp': [{'HostPort': '8080'}]})),
            ('privileged', lambda c, n: c[0]['HostConfig'].update(Privileged=True)),
            ('socket', lambda c, n: c[0]['Mounts'][0].update(Source='/var/run/docker.sock')),
            ('provider', lambda c, n: c[0]['Config']['Cmd'].append('--providers.docker=true')),
            ('image', lambda c, n: c[0].update(Image='sha256:' + '0' * 64)),
            ('label', lambda c, n: c[1]['Config']['Labels'].update({'peermesh.fixture': 'unowned'})),
            ('paused', lambda c, n: c[1]['State'].update(Paused=True)),
            ('external', lambda c, n: n.update(Internal=False)),
            ('extra_member', lambda c, n: n['Containers'].update({'4' * 64: {}})),
        ]
        for name, mutate in mutations:
            changed, changed_network = copy.deepcopy(containers), copy.deepcopy(network)
            mutate(changed, changed_network)
            with self.subTest(name=name), patch.object(transport, 'docker', side_effect=[json.dumps(changed).encode(), json.dumps([changed_network]).encode()]):
                with self.assertRaises(capture.CaptureError):
                    transport.identity()
        with patch.object(transport, 'docker', side_effect=[b'', b'/dynamic/../escape.yaml\n']):
            with self.assertRaises(capture.projection.InvalidSnapshot):
                transport.files()


if __name__ == '__main__':
    unittest.main(verbosity=2)
