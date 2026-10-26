"""Focused new projection checks; does not replay the accepted comparator suite."""
import copy
import contextlib
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts/validation'))
import project_file_provider_snapshot as p

ROUTER = {'entryPoints': ['web'], 'priority': 100, 'rule': 'PathPrefix(`/api`)',
          'service': 'api@internal', 'middlewares': ['fixture']}
MIDDLEWARE = {'headers': {'customResponseHeaders': {'X-Fixture': 'v1'}}}
SOURCE = {'http': {'routers': {'api': ROUTER}, 'middlewares': {'fixture': MIDDLEWARE}}}
SECURITY = {
    'auth-true': {'forwardAuth': {'address': 'http://auth.invalid:9000/check', 'trustForwardHeader': True,
                                'authResponseHeaders': ['X-Identity', 'x-Role', 'X-Identity']}},
    'auth-false': {'forwardAuth': {'address': 'https://127.0.0.1/check', 'trustForwardHeader': False,
                                 'authResponseHeaders': ['X-Identity']}},
    'buffer': {'buffering': {'maxRequestBodyBytes': 1048576, 'memRequestBodyBytes': 16384}},
    'allow': {'ipAllowList': {'sourceRange': ['192.0.2.0/24', '2001:db8::/32', '192.0.2.0/24']}}}


class ProjectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.files = self.root / 'files'
        self.files.mkdir()
        self.file = self.files / 'fixture.yaml'
        self.file.write_text(json.dumps(SOURCE))
        self.inventory = {'schema': 'peermesh.file-inventory.v1', 'capture_status': 'complete', 'files': ['fixture.yaml']}
        self.body = self.root / 'raw.json'
        self.raw = {'routers': {'api@file': dict(ROUTER, middlewares=['fixture@file'], status='enabled', using=['web'])},
                    'middlewares': {'fixture@file': dict(MIDDLEWARE, status='enabled', usedBy=['api@file'])},
                    'services': {'api@internal': {'status': 'enabled'}}}
        self.write_raw()

    def write_raw(self):
        raw = (json.dumps(self.raw) + '\n').encode()
        self.body.write_bytes(raw)
        self.receipt = {'schema': 'peermesh.rawdata-receipt.v1', 'method': 'GET', 'path': '/api/rawdata',
                        'status': 200, 'complete': True, 'content_type': 'application/json',
                        'body_sha256': hashlib.sha256(raw).hexdigest(), 'body_bytes': len(raw)}

    def source(self):
        return p.project_source(self.files, self.inventory)

    def observed(self):
        return p.project_observed(self.files, self.inventory, self.body, self.receipt)

    def test_equivalence_metadata_and_explicit_service_exclusion(self):
        result = p.compare_projections(self.source(), self.observed())
        self.assertEqual(result['status'], 'equivalent')
        self.assertIn('http.services', result['scope']['excluded'])

    def test_yaml_duplicates_alias_merge_template_and_scalar_refusals(self):
        cases = ['http: {}\nhttp: {}', 'http: &h {}', 'http: {routers: *h}', 'http: {<<: {}}',
                 'http: {{ value }}', 'value: yes', 'value: 012', 'value: 0x10', 'value: 2026-10-24',
                 'value: .nan', 'value: 1.25', 'value: ~', 'value: !!str hello', 'value: !!set {a: null}',
                 'value: {1: x}', '---\nhttp: {}\n---\nhttp: {}']
        for text in cases:
            with self.subTest(text=text), self.assertRaises(p.InvalidSnapshot):
                p.strict_yaml(text.encode())

    def test_duplicate_names_across_files(self):
        (self.files / 'other.yaml').write_bytes(self.file.read_bytes())
        self.inventory['files'].append('other.yaml')
        with self.assertRaises(p.InvalidSnapshot):
            self.source()

    def test_ambiguous_plain_numeric_text_requires_quotes(self):
        for text in ('1e3', '-1E-2', '0o12', '+0x12', '123.example'):
            with self.subTest(text=text), self.assertRaises(p.InvalidSnapshot):
                p.strict_yaml(('value: ' + text).encode())
            self.assertEqual(p.strict_yaml(('value: "' + text + '"').encode()), {'value': text})

    def test_missing_extra_duplicate_unsafe_and_symlink_inventory(self):
        for names in ([], ['missing.yaml'], ['fixture.yaml', 'fixture.yaml'], ['../fixture.yaml'], ['/fixture.yaml']):
            with self.subTest(names=names), self.assertRaises(p.InvalidSnapshot):
                p.file_inventory(self.files, dict(self.inventory, files=names))
        with self.assertRaises(p.InvalidSnapshot):
            p.file_inventory(self.files, dict(self.inventory, capture_status='partial'))
        link = self.files / 'link.yaml'
        link.symlink_to(self.file)
        with self.assertRaises(p.InvalidSnapshot):
            self.source()
        link.unlink()
        (self.files / 'extra.yaml').write_text('http: {}')
        with self.assertRaises(p.InvalidSnapshot):
            self.source()

    def test_source_scope_empty_and_explicit_router_requirements(self):
        for data in ({}, {'tcp': {}}, {'http': {}}, {'http': {'routers': {}}},
                     {'http': {'models': {}}}, {'http': {'routers': {'a': {'rule': 'x'}}}}):
            self.file.write_text(json.dumps(data))
            with self.subTest(data=data), self.assertRaises(p.InvalidSnapshot):
                self.source()

    def test_receipt_missing_failed_incomplete_hash_and_size(self):
        for changes in ({'status': 503}, {'complete': False}, {'body_sha256': '0' * 64},
                        {'body_bytes': 1}, {'path': '/api/http/routers'}, {'content_type': 'text/plain'}):
            with self.subTest(changes=changes), self.assertRaises(p.InvalidSnapshot):
                p.project_observed(self.files, self.inventory, self.body, dict(self.receipt, **changes))
        del self.receipt['complete']
        with self.assertRaises(p.InvalidSnapshot):
            self.observed()

    def test_malformed_duplicate_truncated_and_empty_body(self):
        for raw in (b'', b'{', b'{"routers":{},"routers":{}}', b'null', b'{}', b'{"n":NaN}'):
            self.body.write_bytes(raw)
            self.receipt.update(body_sha256=hashlib.sha256(raw).hexdigest(), body_bytes=len(raw))
            with self.subTest(raw=raw), self.assertRaises(p.InvalidSnapshot):
                self.observed()

    def test_raw_scope_provider_missing_empty_and_transport(self):
        original = copy.deepcopy(self.raw)
        variants = [{k: v for k, v in original.items() if k != 'middlewares'},
                    dict(original, routers={}), dict(original, extra={}),
                    dict(original, tcpRouters={'a@file': {}}),
                    dict(original, routers={'a@docker': original['routers']['api@file']})]
        for data in variants:
            self.raw = data
            self.write_raw()
            with self.subTest(data=data), self.assertRaises(p.InvalidSnapshot):
                self.observed()

    def test_disabled_error_and_malformed_metadata(self):
        for kind, name, usage in (('routers', 'api@file', 'using'), ('middlewares', 'fixture@file', 'usedBy')):
            original = copy.deepcopy(self.raw[kind][name])
            for changes in ({'status': 'disabled'}, {'status': None}, {'error': ['bad']}, {'error': {}}, {usage: 'web'}):
                self.raw[kind][name] = dict(original, **changes)
                self.write_raw()
                with self.subTest(kind=kind, changes=changes), self.assertRaises(p.InvalidSnapshot):
                    self.observed()
            self.raw[kind][name] = original

    def test_unknown_empty_zero_false_and_array_order_preserved_as_drift(self):
        source = self.source()
        for value in (False, 0, '', [], {}, None, ['b', 'a']):
            expected = copy.deepcopy(source)
            expected['collections']['middlewares']['fixture@file']['headers']['futureField'] = value
            result = p.compare_projections(expected, self.observed())
            with self.subTest(value=value):
                self.assertEqual(result['status'], 'drift')
        data = copy.deepcopy(SOURCE)
        data['http']['middlewares']['fixture']['headers'].update(zero=0, disabled=False, empty='', ordered=['a', 'b'])
        self.file.write_text(json.dumps(data))
        expected = self.source()
        fields = expected['collections']['middlewares']['fixture@file']['headers']
        self.assertIs(fields['disabled'], False)
        self.assertIs(type(fields['zero']), int)
        self.assertEqual(fields['empty'], '')
        observed = copy.deepcopy(expected)
        observed['origin'] = 'observed'
        observed['collections']['middlewares']['fixture@file']['headers']['ordered'].reverse()
        self.assertEqual(len(p.compare_projections(expected, observed)['changed_paths']), 2)
        observed['collections']['middlewares']['fixture@file']['headers']['zero'] = False
        self.assertEqual(len(p.compare_projections(expected, observed)['changed_paths']), 3)

    def test_comment_changes_only_hash(self):
        before = self.source()
        self.file.write_text(self.file.read_text() + '\n# byte-only change\n')
        after = self.source()
        observed = copy.deepcopy(before)
        observed['origin'] = 'observed'
        paths = p.compare_projections(after, observed)['changed_paths']
        self.assertEqual(len(paths), 1)
        self.assertTrue(paths[0].startswith('/dynamic_files/'))

    def test_projection_scope_origin_and_missing_collection(self):
        for field, value in (('schema', 'peermesh.deployment-snapshot.v1'), ('scope', {}),
                             ('origin', 'observed'), ('capture_status', 'complete')):
            expected = self.source()
            expected[field] = value
            with self.subTest(field=field), self.assertRaises(p.InvalidSnapshot):
                p.compare_projections(expected, self.observed())
        expected = self.source()
        del expected['collections']['dynamic_files']
        with self.assertRaises(p.InvalidSnapshot):
            p.compare_projections(expected, self.observed())

    def new_types(self, security=False):
        """Use source/API forms actually recorded from the pinned owned fixture."""
        data = copy.deepcopy(SOURCE)
        data['http']['middlewares'].update({
            'rate': {'rateLimit': {'average': 30, 'burst': 1, 'period': '1h'}},
            'actor': {'rateLimit': {'average': 45, 'burst': 3, 'period': '90s',
                                   'sourceCriterion': {'requestHeaderName': 'X-Synthetic-Actor'}}},
            'chain': {'chain': {'middlewares': ['rate', 'actor@file', 'rate']}}})
        self.file.write_text(json.dumps(data))
        self.raw['middlewares'].update({
            'rate@file': {'rateLimit': {'average': 30, 'burst': 1, 'period': '1h0m0s'}, 'status': 'enabled'},
            'actor@file': {'rateLimit': {'average': 45, 'burst': 3, 'period': '1m30s',
                                      'sourceCriterion': {'requestHeaderName': 'X-Synthetic-Actor'}}, 'status': 'enabled'},
            'chain@file': {'chain': {'middlewares': ['rate@file', 'actor@file', 'rate@file']}, 'status': 'enabled'}})
        if security:
            data['http']['middlewares'].update(copy.deepcopy(SECURITY))
            self.file.write_text(json.dumps(data))
            for name, config in SECURITY.items():
                self.raw['middlewares'][name + '@file'] = dict(copy.deepcopy(config), status='enabled')
            del self.raw['middlewares']['auth-false@file']['forwardAuth']['trustForwardHeader']
        self.write_raw()
        return data

    def test_security_types_equivalent_and_observed_false_omission_only(self):
        self.new_types(security=True)
        expected = self.source()
        self.assertEqual(p.compare_projections(expected, self.observed())['status'], 'equivalent')
        self.assertIs(expected['collections']['middlewares']['auth-false@file']['forwardAuth']['trustForwardHeader'], False)
        self.raw['middlewares']['auth-false@file']['forwardAuth']['trustForwardHeader'] = False
        self.write_raw()
        self.assertEqual(p.compare_projections(expected, self.observed())['status'], 'equivalent')
        for origin in ('source', 'observed'):
            malformed = copy.deepcopy(expected)
            malformed['origin'] = origin
            del malformed['collections']['middlewares']['auth-false@file']['forwardAuth']['trustForwardHeader']
            with self.subTest(origin=origin), self.assertRaises(p.InvalidSnapshot):
                p.validate_projection(malformed, origin)
        omitted = copy.deepcopy(SECURITY['auth-false'])
        del omitted['forwardAuth']['trustForwardHeader']
        with self.assertRaises(p.InvalidSnapshot):
            p.configuration('middlewares', omitted, source=True)

    def test_every_security_field_and_order_has_opaque_drift(self):
        self.new_types(security=True)
        expected = self.source()
        for name, kind, field, value in (
                ('auth-true', 'forwardAuth', 'address', 'https://changed.invalid/PRIVATE'),
                ('auth-true', 'forwardAuth', 'trustForwardHeader', False),
                ('auth-true', 'forwardAuth', 'authResponseHeaders', ['x-Role', 'X-Identity', 'X-Identity']),
                ('auth-true', 'forwardAuth', 'authResponseHeaders', ['x-identity', 'x-Role', 'X-Identity']),
                ('auth-true', 'forwardAuth', 'authResponseHeaders', ['X-Identity', 'x-Role']),
                ('buffer', 'buffering', 'maxRequestBodyBytes', 1048577),
                ('buffer', 'buffering', 'memRequestBodyBytes', 16385),
                ('allow', 'ipAllowList', 'sourceRange', ['2001:db8::/32', '192.0.2.0/24', '192.0.2.0/24']),
                ('allow', 'ipAllowList', 'sourceRange', ['198.51.100.0/24', '2001:db8::/32']),
                ('allow', 'ipAllowList', 'sourceRange', ['192.0.2.0/24', '2001:db8::/32'])):
            changed = self.observed()
            changed['collections']['middlewares'][name + '@file'][kind][field] = value
            result = p.compare_projections(expected, changed)
            with self.subTest(name=name, field=field, value=value):
                self.assertEqual(result['status'], 'drift')
                self.assertTrue(result['changed_paths'])
                for private in ('auth-true', '192.0.2', 'X-Identity', 'PRIVATE', 'changed.invalid'):
                    self.assertNotIn(private, json.dumps(result))

    def test_forward_auth_restricted_address_boolean_headers_and_unknown_fields(self):
        valid = SECURITY['auth-true']['forwardAuth']
        bad = [{}, None, dict(valid, tls={}), dict(valid, authRequestHeaders=[]), dict(valid, authResponseHeadersRegex='PRIVATE')]
        bad += [{key: value for key, value in valid.items() if key != missing} for missing in ('address', 'authResponseHeaders')]
        bad += [dict(valid, trustForwardHeader=value) for value in (None, 0, 1, 'false', [], {})]
        bad += [dict(valid, authResponseHeaders=value) for value in ([], None, 'X-Identity', [1], [''], ['X_Identity'], ['X Bad'], ['X\r\nBad'], ['É'])]
        bad += [dict(valid, address=value) for value in ('', None, 1, 'ftp://host/check', 'HTTP://host/check',
            'http://host', 'http://user@host/check', 'http://host/check?q=x', 'http://host/check#fragment',
            'http://host/%2Fcheck', 'http://host/../check', 'http://host//check', 'http://host/./check',
            'http://host:0/check', 'http://host:65536/check', 'http://host:080/check', 'http://host:abc/check',
            'http://host./check', 'http://-host/check', 'http://host_/check', 'http://127.1/check',
            'http://127.000.0.1/check', 'http://[::1]/check', 'http://host/é', 'http://host/\\check',
            'http://host/{{value}}', 'http://host/check\n', 'http://host /check')]
        for config in bad:
            for mode in ({'source': True}, {}, {'projected': True}):
                with self.subTest(config=config, mode=mode), self.assertRaises(p.InvalidSnapshot):
                    p.configuration('middlewares', {'forwardAuth': config}, **mode)
        for address in ('http://authentik-server:9000/outpost.goauthentik.io/auth/traefik',
                        'https://Host.invalid:65535/a-b_~.c/', 'http://127.0.0.1/'):
            config = dict(valid, address=address)
            self.assertEqual(p.configuration('middlewares', {'forwardAuth': config}, source=True)['forwardAuth'], config)

    def test_buffering_exact_positive_int64_fields_in_all_input_roles(self):
        valid = SECURITY['buffer']['buffering']
        bad = [{}, None, {'maxRequestBodyBytes': 1}, dict(valid, retryExpression='PRIVATE'),
               dict(valid, maxResponseBodyBytes=1), dict(valid, memResponseBodyBytes=1)]
        bad += [dict(valid, **{field: value}) for field in valid
                for value in (True, False, 0, -1, 1.5, '1', None, 2**63)]
        for config in bad:
            for mode in ({'source': True}, {}, {'projected': True}):
                with self.subTest(config=config, mode=mode), self.assertRaises(p.InvalidSnapshot):
                    p.configuration('middlewares', {'buffering': config}, **mode)
        boundary = {'maxRequestBodyBytes': 2**63 - 1, 'memRequestBodyBytes': 1}
        self.assertEqual(p.configuration('middlewares', {'buffering': boundary}, source=True)['buffering'], boundary)

    def test_ip_allow_list_strict_cidr_order_duplicates_and_refusals(self):
        valid = SECURITY['allow']
        self.assertEqual(p.configuration('middlewares', valid, source=True), valid)
        bad = [{}, None, {'sourceRange': []}, {'sourceRange': '192.0.2.0/24'},
               {'sourceRange': ['192.0.2.0/24'], 'ipStrategy': {}}, {'sourceRange': ['192.0.2.0/24'], 'extra': True}]
        bad += [{'sourceRange': [value]} for value in (None, 1, '', '192.0.2.1', '192.0.2.1/24', '192.0.2.0/024',
            '192.0.2.0/255.255.255.0', '192.000.2.0/24', '192.0.2.0/33', '2001:DB8::/32',
            '2001:0db8::/32', '2001:db8::1/32', '2001:db8::/129', 'fe80::%eth0/64', ' 192.0.2.0/24')]
        for config in bad:
            for mode in ({'source': True}, {}, {'projected': True}):
                with self.subTest(config=config, mode=mode), self.assertRaises(p.InvalidSnapshot):
                    p.configuration('middlewares', {'ipAllowList': config}, **mode)

    def test_security_mixed_types_unknown_raw_fields_and_stale_scope(self):
        self.new_types(security=True)
        for name, config in SECURITY.items():
            with self.subTest(name=name), self.assertRaises(p.InvalidSnapshot):
                p.configuration('middlewares', dict(config, headers=MIDDLEWARE['headers']), source=True)
            original = copy.deepcopy(self.raw['middlewares'][name + '@file'])
            self.raw['middlewares'][name + '@file'][next(iter(config))]['PRIVATE'] = 'CANARY'
            self.write_raw()
            with self.assertRaises(p.InvalidSnapshot):
                self.observed()
            self.raw['middlewares'][name + '@file'] = original
        self.write_raw()
        expected = copy.deepcopy(self.source())
        expected['scope']['middleware_types'] = ['headers', 'rateLimit', 'chain']
        with self.assertRaises(p.InvalidSnapshot):
            p.compare_projections(expected, self.observed())

    def test_security_cli_refusal_redacts_source_and_observed_without_output(self):
        data = self.new_types(security=True)
        inventory_path = self.root / 'inventory.json'
        inventory_path.write_text(json.dumps(self.inventory))
        for origin in ('source', 'observed'):
            output = self.root / (origin + '-must-not-exist.json')
            argv = [origin, '--files', str(self.files), '--inventory', str(inventory_path), '--output', str(output)]
            if origin == 'source':
                data['http']['middlewares']['auth-true']['forwardAuth']['address'] = 'http://PRIVATE@host/check'
                self.file.write_text(json.dumps(data))
            else:
                self.raw['middlewares']['auth-true@file']['forwardAuth']['address'] = 'http://PRIVATE@host/check'
                self.write_raw()
                receipt = self.root / 'receipt.json'
                receipt.write_text(json.dumps(self.receipt))
                argv += ['--body', str(self.body), '--receipt', str(receipt)]
            stream = io.StringIO()
            with contextlib.redirect_stdout(stream):
                code = p.main(argv)
            self.assertEqual(code, 2)
            self.assertFalse(output.exists())
            self.assertNotIn('PRIVATE', stream.getvalue())

    def test_rate_and_chain_actual_forms_equivalent_without_mutating_inputs(self):
        self.new_types()
        saved = copy.deepcopy(self.raw)
        expected = self.source()
        self.assertEqual(p.compare_projections(expected, self.observed())['status'], 'equivalent')
        self.assertEqual(expected['collections']['middlewares']['rate@file']['rateLimit']['period'], 3600)
        self.assertEqual(expected['collections']['middlewares']['actor@file']['rateLimit']['period'], 90)
        for refs in (['rate', 'actor@file', 'rate'], ['rate@file', 'actor@file', 'rate@file']):
            self.raw['middlewares']['chain@file']['chain']['middlewares'] = refs
            self.write_raw()
            self.assertEqual(p.compare_projections(expected, self.observed())['status'], 'equivalent')
        self.assertEqual(self.raw, saved)

    def test_each_rate_parameter_and_criterion_drift_is_opaque(self):
        self.new_types()
        expected = self.source()
        observed = self.observed()
        for key, value in (('average', 31), ('burst', 2), ('period', 3601),
                           ('sourceCriterion', {'requestHeaderName': 'X-Changed-Private-Actor'})):
            changed = copy.deepcopy(observed)
            changed['collections']['middlewares']['rate@file']['rateLimit'][key] = value
            result = p.compare_projections(expected, changed)
            with self.subTest(field=key):
                self.assertEqual(result['status'], 'drift')
                self.assertTrue(result['changed_paths'])
                self.assertNotIn('X-Changed-Private-Actor', json.dumps(result))
                self.assertNotIn('rate@file', json.dumps(result))
        changed = copy.deepcopy(observed)
        del changed['collections']['middlewares']['actor@file']['rateLimit']['sourceCriterion']
        self.assertEqual(p.compare_projections(expected, changed)['status'], 'drift')

    def test_chain_order_reference_and_duplicate_count_drift(self):
        self.new_types()
        expected = self.source()
        for refs in (['actor@file', 'rate@file', 'rate@file'],
                     ['fixture@file', 'actor@file', 'rate@file'], ['rate@file', 'actor@file']):
            changed = self.observed()
            changed['collections']['middlewares']['chain@file']['chain']['middlewares'] = refs
            result = p.compare_projections(expected, changed)
            self.assertEqual(result['status'], 'drift')
            self.assertNotIn('actor@file', json.dumps(result))

    def test_explicit_rate_keys_integer_limits_and_duration_refusals(self):
        valid = {'average': 30, 'burst': 1, 'period': '1h'}
        invalid = [{}, {'average': 30}, dict(valid, extra='private'), dict(valid, period=3600)]
        invalid += [dict(valid, **{key: value}) for key in ('average', 'burst')
                    for value in (True, False, 0, -1, 1.5, '1', None, 2**63)]
        invalid += [dict(valid, period=value) for value in
                    ('', '0s', '00s', '01h', '1', '1.5s', '1000ms', '1d', '-1h', '+1h',
                     '1e3s', '1m1h', '1h1h', '1H', '1h ', '9223372037s', None, True, 1.0)]
        for config in invalid:
            for source in (True, False):
                with self.subTest(config=config, source=source), self.assertRaises(p.InvalidSnapshot):
                    p.configuration('middlewares', {'rateLimit': config}, source=source)
        for text, seconds in (('1h', 3600), ('3600s', 3600), ('60m', 3600), ('1h0m0s', 3600),
                              ('2m', 120), ('90s', 90), ('1m30s', 90), ('3s', 3), ('1h2m3s', 3723)):
            self.assertEqual(p.rate_limit(dict(valid, period=text))['period'], seconds)
        self.assertEqual(p.rate_limit(dict(valid, average=2**63 - 1, burst=2**63 - 1))['average'], 2**63 - 1)

    def test_default_ip_and_header_only_criteria_refuse_unsupported_combinations(self):
        valid = {'average': 30, 'burst': 1, 'period': '1h'}
        self.assertNotIn('sourceCriterion', p.rate_limit(valid))
        for criterion in ({}, None, [], {'requestHost': True}, {'ipStrategy': {'depth': 1}},
                          {'requestHeaderName': 'X-Actor', 'requestHost': False},
                          {'requestHeaderName': 'X-Actor', 'ipStrategy': {}},
                          {'requestHeaderName': ''}, {'requestHeaderName': 1},
                          {'requestHeaderName': 'X Actor'}, {'requestHeaderName': 'X-Actor\r\nSecret'}):
            with self.subTest(criterion=criterion), self.assertRaises(p.InvalidSnapshot):
                p.rate_limit(dict(valid, sourceCriterion=criterion))

    def test_mixed_unknown_chain_keys_and_foreign_references_refuse(self):
        rate = {'average': 30, 'burst': 1, 'period': '1h'}
        cases = [{'rateLimit': rate, 'headers': MIDDLEWARE['headers']}, {'unknown': {}},
                 {'chain': {}}, {'chain': {'middlewares': []}},
                 {'chain': {'middlewares': ['rate'], 'extra': 'private'}}]
        cases += [{'chain': {'middlewares': refs}} for refs in
                  ('rate', [None], [1], [''], ['@file'], ['rate@docker'], ['rate@@file'],
                   ['rate@internal'], [' rate'], ['rate/child'], ['r\nsecret'])]
        for config in cases:
            for source in (True, False):
                with self.subTest(config=config, source=source), self.assertRaises(p.InvalidSnapshot):
                    p.configuration('middlewares', config, source=source)

    def test_projection_requires_canonical_new_type_values_and_exact_scope(self):
        self.new_types()
        expected = self.source()
        for value in ('1h', '3600', True, 0, -1, 3600.0, 9223372037):
            changed = copy.deepcopy(expected)
            changed['collections']['middlewares']['rate@file']['rateLimit']['period'] = value
            with self.subTest(value=value), self.assertRaises(p.InvalidSnapshot):
                p.compare_projections(changed, self.observed())
        changed = copy.deepcopy(expected)
        changed['collections']['middlewares']['chain@file']['chain']['middlewares'][0] = 'rate'
        with self.assertRaises(p.InvalidSnapshot):
            p.compare_projections(changed, self.observed())
        changed = copy.deepcopy(expected)
        changed['scope']['middleware_types'] = ['headers']
        with self.assertRaises(p.InvalidSnapshot):
            p.compare_projections(changed, self.observed())

    def test_plain_duration_exception_is_only_rate_period_and_preserves_events_values(self):
        text = 'http:\n  middlewares:\n    rate:\n      rateLimit:\n        average: 30\n        burst: 1\n        period: 1h\n'
        data = p.strict_yaml(text.encode())
        self.assertEqual(data['http']['middlewares']['rate']['rateLimit']['period'], '1h')
        for field in ('value: 1h', 'headers: {value: 1h}', 'http: {middlewares: {a: {headers: {period: 1h}}}}'):
            with self.subTest(field=field), self.assertRaises(p.InvalidSnapshot):
                p.strict_yaml(field.encode())

    def test_invalid_new_type_cli_exit_two_does_not_leak_values_or_write_output(self):
        data = self.new_types()
        data['http']['middlewares']['actor']['rateLimit']['sourceCriterion']['secret'] = 'PRIVATE-CANARY'
        self.file.write_text(json.dumps(data))
        inventory_path = self.root / 'inventory.json'
        inventory_path.write_text(json.dumps(self.inventory))
        output = self.root / 'must-not-exist.json'
        stream = io.StringIO()
        with contextlib.redirect_stdout(stream):
            code = p.main(['source', '--files', str(self.files), '--inventory', str(inventory_path), '--output', str(output)])
        self.assertEqual(code, 2)
        self.assertFalse(output.exists())
        self.assertEqual(json.loads(stream.getvalue()), {'status': 'invalid', 'reason': 'unsupported_source_criterion'})
        self.assertNotIn('PRIVATE-CANARY', stream.getvalue())


if __name__ == '__main__':
    unittest.main(verbosity=2)
