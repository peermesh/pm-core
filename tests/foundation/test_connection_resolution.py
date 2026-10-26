"""Actual Bash resolver regression with synthetic manifests and an inert Docker stub."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
RESOLVER = ROOT / 'foundation/lib/connection-resolve.sh'
UNRESOLVED = {'requirement': {'name': 'eventbus', 'type': 'eventbus', 'providers': ['redis']},
              'reason': 'No matching provider installed'}
UNRESOLVED_ALIAS = {'requirement': {'name': 'ignored-synthetic-alias', 'type': 'eventbus', 'providers': ['redis']},
                    'reason': 'No matching provider installed'}
OPTIONAL = {'type': 'eventbus', 'providers': ['redis'], 'required': False, 'alias': 'ignored-synthetic-alias'}
REQUIRED = {'type': 'database', 'providers': ['postgres'], 'required': True, 'name': 'primary-db'}
UNRESOLVED_DB = {'requirement': {'name': 'primary-db', 'type': 'database', 'providers': ['postgres']},
                 'reason': 'No matching provider installed'}
WARNING = "Optional connection 'ignored-synthetic-alias' not available"
MATRIX = {
    'optional': {'requirements': [OPTIONAL], 'exit': 0,
        'json': {'success': True, 'resolved': [], 'unresolved': [UNRESOLVED_ALIAS], 'warnings': [WARNING]},
        'docker_providers': ['redis']},
    'required': {'requirements': [dict(OPTIONAL, required=True)], 'exit': 1,
        'json': {'success': False, 'resolved': [], 'unresolved': [UNRESOLVED_ALIAS], 'warnings': []},
        'docker_providers': ['redis']},
    'omitted': {'requirements': [{'type': 'eventbus', 'providers': ['redis']}], 'exit': 1,
        'json': {'success': False, 'resolved': [], 'unresolved': [UNRESOLVED], 'warnings': []},
        'docker_providers': ['redis']},
    'declared': {'requirements': [{'type': 'eventbus', 'providers': ['nats', 'redis'], 'required': True,
                                  'name': 'named-events', 'alias': 'ignored-synthetic-alias'}],
        'providers': [{'type': 'eventbus', 'provider': 'redis'}], 'exit': 0,
        'json': {'success': True, 'resolved': [{'requirementName': 'named-events', 'providerModule': 'declared-provider',
                 'providerName': 'redis', 'type': 'eventbus', 'config': {}}], 'unresolved': [], 'warnings': []},
        'docker_providers': []},
    'optional_then_required': {'requirements': [OPTIONAL, REQUIRED], 'exit': 1,
        'json': {'success': False, 'resolved': [], 'unresolved': [UNRESOLVED_ALIAS, UNRESOLVED_DB], 'warnings': [WARNING]},
        'docker_providers': ['redis', 'postgres']},
    'required_then_optional': {'requirements': [REQUIRED, OPTIONAL], 'exit': 1,
        'json': {'success': False, 'resolved': [], 'unresolved': [UNRESOLVED_DB, UNRESOLVED_ALIAS], 'warnings': [WARNING]},
        'docker_providers': ['postgres', 'redis']},
}
# Module aliases are defined by the module schema and manifest contract.
MATRIX.update({'alias_only': {'requirements': [{'type': 'eventbus',
                                  'providers': ['noop'],
                                  'required': True,
                                  'alias': 'module-events'}],
                'exit': 0,
                'docker_providers': [],
                'json': {'success': True,
                         'resolved': [{'requirementName': 'module-events',
                                       'providerModule': 'foundation',
                                       'providerName': 'noop',
                                       'type': 'eventbus',
                                       'config': {}}],
                         'unresolved': [],
                         'warnings': []}},
 'distinct_aliases': {'requirements': [{'type': 'eventbus',
                                        'providers': ['noop'],
                                        'required': True,
                                        'alias': 'first-events'},
                                       {'type': 'eventbus',
                                        'providers': ['noop'],
                                        'required': True,
                                        'alias': 'second-events'}],
                      'exit': 0,
                      'docker_providers': [],
                      'json': {'success': True,
                               'resolved': [{'requirementName': 'first-events',
                                             'providerModule': 'foundation',
                                             'providerName': 'noop',
                                             'type': 'eventbus',
                                             'config': {}},
                                            {'requirementName': 'second-events',
                                             'providerModule': 'foundation',
                                             'providerName': 'noop',
                                             'type': 'eventbus',
                                             'config': {}}],
                               'unresolved': [],
                               'warnings': []}}})

# Preference expectations come from the declared interface, independently of selection code.
MATRIX.update({
    'nats_first': {
        'requirements': [{'type': 'eventbus', 'providers': ['nats', 'redis'], 'required': True,
                          'name': 'preferred-events', 'alias': 'ignored-synthetic-alias'}],
        'provider_modules': {'a-redis': [{'type': 'eventbus', 'provider': 'redis'}],
                             'z-nats': [{'type': 'eventbus', 'provider': 'nats'}]},
        'exit': 0, 'docker_providers': [],
        'json': {'success': True, 'resolved': [{'requirementName': 'preferred-events', 'providerModule': 'z-nats',
                 'providerName': 'nats', 'type': 'eventbus', 'config': {}}], 'unresolved': [], 'warnings': []}},
    'redis_first': {
        'requirements': [{'type': 'eventbus', 'providers': ['redis', 'nats'], 'name': 'preferred-events'}],
        'provider_modules': {'a-nats': [{'type': 'eventbus', 'provider': 'nats'}],
                             'z-redis': [{'type': 'eventbus', 'provider': 'redis'}]},
        'exit': 0, 'docker_providers': [],
        'json': {'success': True, 'resolved': [{'requirementName': 'preferred-events', 'providerModule': 'z-redis',
                 'providerName': 'redis', 'type': 'eventbus', 'config': {}}], 'unresolved': [], 'warnings': []}},
    'second_choice': {
        'requirements': [{'type': 'eventbus', 'providers': ['nats', 'redis'], 'required': True}],
        'provider_modules': {'a-redis': [{'type': 'eventbus', 'provider': 'redis'}]},
        'exit': 0, 'docker_providers': [],
        'json': {'success': True, 'resolved': [{'requirementName': 'eventbus', 'providerModule': 'a-redis',
                 'providerName': 'redis', 'type': 'eventbus', 'config': {}}], 'unresolved': [], 'warnings': []}},
    'first_wrong_type': {
        'requirements': [{'type': 'eventbus', 'providers': ['nats', 'redis'], 'required': False}],
        'provider_modules': {'a-nats': [{'type': 'database', 'provider': 'nats'}],
                             'z-redis': [{'type': 'eventbus', 'provider': 'redis'}]},
        'exit': 0, 'docker_providers': [],
        'json': {'success': True, 'resolved': [{'requirementName': 'eventbus', 'providerModule': 'z-redis',
                 'providerName': 'redis', 'type': 'eventbus', 'config': {}}], 'unresolved': [], 'warnings': []}},
    'duplicate_provider': {
        'requirements': [{'type': 'eventbus', 'providers': ['nats', 'redis']}],
        'provider_modules': {'z-nats': [{'type': 'eventbus', 'provider': 'nats'}],
                             'a-nats': [{'type': 'eventbus', 'provider': 'nats'}],
                             '0-redis': [{'type': 'eventbus', 'provider': 'redis'}]},
        'exit': 0, 'docker_providers': [],
        'json': {'success': True, 'resolved': [{'requirementName': 'eventbus', 'providerModule': 'a-nats',
                 'providerName': 'nats', 'type': 'eventbus', 'config': {}}], 'unresolved': [], 'warnings': []}},
    'independent_optional_between': {
        'requirements': [{'type': 'eventbus', 'providers': ['nats', 'redis'], 'required': True, 'name': 'first'},
                         {'type': 'queue', 'providers': ['nats', 'redis'], 'required': False, 'name': 'missing'},
                         {'type': 'eventbus', 'providers': ['redis', 'nats'], 'name': 'second'}],
        'provider_modules': {'a-redis': [{'type': 'eventbus', 'provider': 'redis'}],
                             'z-nats': [{'type': 'eventbus', 'provider': 'nats'}]},
        'exit': 0, 'docker_providers': ['nats', 'redis'],
        'json': {'success': True, 'resolved': [
            {'requirementName': 'first', 'providerModule': 'z-nats', 'providerName': 'nats', 'type': 'eventbus', 'config': {}},
            {'requirementName': 'second', 'providerModule': 'a-redis', 'providerName': 'redis', 'type': 'eventbus', 'config': {}}],
            'unresolved': [{'requirement': {'name': 'missing', 'type': 'queue', 'providers': ['nats', 'redis']},
                            'reason': 'No matching provider installed'}],
            'warnings': ["Optional connection 'missing' not available"]}},
    'independent_failure_before': {
        'requirements': [{'type': 'queue', 'providers': ['nats', 'redis'], 'required': False, 'name': 'missing'},
                         {'type': 'database', 'providers': ['nats', 'redis'], 'required': True, 'name': 'required-db'},
                         {'type': 'eventbus', 'providers': ['nats', 'redis'], 'required': False, 'name': 'last'}],
        'provider_modules': {'a-redis': [{'type': 'eventbus', 'provider': 'redis'}],
                             'z-nats': [{'type': 'eventbus', 'provider': 'nats'}]},
        'exit': 1, 'docker_providers': ['nats', 'redis', 'nats', 'redis'],
        'json': {'success': False, 'resolved': [
            {'requirementName': 'last', 'providerModule': 'z-nats', 'providerName': 'nats', 'type': 'eventbus', 'config': {}}],
            'unresolved': [
                {'requirement': {'name': 'missing', 'type': 'queue', 'providers': ['nats', 'redis']}, 'reason': 'No matching provider installed'},
                {'requirement': {'name': 'required-db', 'type': 'database', 'providers': ['nats', 'redis']}, 'reason': 'No matching provider installed'}],
            'warnings': ["Optional connection 'missing' not available"]}},
    'noop_first': {
        'requirements': [{'type': 'eventbus', 'providers': ['noop', 'nats']}],
        'provider_modules': {'a-nats': [{'type': 'eventbus', 'provider': 'nats'}]},
        'exit': 0, 'docker_providers': [],
        'json': {'success': True, 'resolved': [{'requirementName': 'eventbus', 'providerModule': 'foundation',
                 'providerName': 'noop', 'type': 'eventbus', 'config': {}}], 'unresolved': [], 'warnings': []}},
    'noop_second': {
        'requirements': [{'type': 'eventbus', 'providers': ['nats', 'noop']}],
        'provider_modules': {'a-nats': [{'type': 'eventbus', 'provider': 'nats'}]},
        'exit': 0, 'docker_providers': [],
        'json': {'success': True, 'resolved': [{'requirementName': 'eventbus', 'providerModule': 'a-nats',
                 'providerName': 'nats', 'type': 'eventbus', 'config': {}}], 'unresolved': [], 'warnings': []}},
})

DOCKER_STUB = '''#!/bin/bash
printf '%s\\t' "$@" >> "$DOCKER_TEST_LOG"
printf '\\n' >> "$DOCKER_TEST_LOG"
if [[ "$#" != 5 || "$1" != ps || "$2" != --filter || "$3" != name=pmdl_* || "$4" != --format || "$5" != '{{.Names}}' ]]; then
    exit 97
fi
# Empty declared inventory. Never execute another command or delegate to Docker.
exit 0
'''


class ConnectionResolutionTests(unittest.TestCase):
    def setUp(self):
        evidence = os.environ.get('RESOLVER_TEST_EVIDENCE')
        self.root = Path(tempfile.mkdtemp(prefix=self._testMethodName + '-', dir=evidence)).resolve()
        if evidence is None:
            self.addCleanup(shutil.rmtree, self.root)
        self.bin = self.root / 'bin'
        self.bin.mkdir(mode=0o700)
        self.tools = {}
        for name in ('jq', 'dirname', 'basename', 'grep'):
            executable = shutil.which(name)
            self.assertIsNotNone(executable, 'Existing tool required: ' + name)
            path = Path(executable).resolve()
            self.tools[name] = {'path': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
            wrapper = self.bin / name
            wrapper.write_text('#!/bin/bash\nexec ' + shlex.quote(str(path)) + ' "$@"\n')
            wrapper.chmod(0o700)
        stub = self.bin / 'docker'
        stub.write_text(DOCKER_STUB)
        stub.chmod(0o700)
        self.assertEqual(shutil.which('docker', path=str(self.bin)), str(stub))
        self.assertEqual(set(p.name for p in self.bin.iterdir()), {'docker', 'jq', 'dirname', 'basename', 'grep'})

    def run_case(self, name):
        case = MATRIX[name]
        folder = self.root / name
        folder.mkdir(mode=0o700)
        modules = folder / 'modules'
        consumer = modules / 'consumer'
        consumer.mkdir(parents=True)
        manifest = {'id': 'consumer', 'version': '1.0.0', 'name': 'Synthetic consumer',
                    'foundation': {'minVersion': '1.0.0'}, 'requires': {'connections': case['requirements']}}
        manifest_path = consumer / 'module.json'
        manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
        provider_modules = dict(case.get('provider_modules', {}))
        if 'providers' in case:
            provider_modules['declared-provider'] = case['providers']
        for module_id, connections in provider_modules.items():
            provider = modules / module_id
            provider.mkdir()
            (provider / 'module.json').write_text(json.dumps({'id': module_id, 'version': '1.0.0',
                'name': 'Synthetic declared provider', 'foundation': {'minVersion': '1.0.0'},
                'provides': {'connections': connections}}, indent=2) + '\n')
        foundation = folder / 'foundation'
        foundation.mkdir()
        home = folder / 'home'
        home.mkdir()
        log = folder / 'docker.log'
        environment = {'PATH': str(self.bin), 'HOME': str(home), 'LC_ALL': 'C', 'LANG': 'C',
                       'FOUNDATION_DIR': str(foundation), 'MODULES_DIR': str(modules), 'DOCKER_TEST_LOG': str(log)}
        argv = ['/bin/bash', str(RESOLVER), 'consumer', '--json']
        expected = {'case': name, 'declared_synthetic': True, 'expected': case, 'argv': argv, 'cwd': str(folder),
                    'resolver_sha256': hashlib.sha256(RESOLVER.read_bytes()).hexdigest(),
                    'stub_sha256': hashlib.sha256((self.bin / 'docker').read_bytes()).hexdigest(),
                    'tools': self.tools, 'environment': environment,
                    'manifest_sha256': {str(p.relative_to(folder)): hashlib.sha256(p.read_bytes()).hexdigest() for p in modules.rglob('module.json')},
                    'bound_before_invocation': datetime.now(timezone.utc).isoformat()}
        binding_path = folder / 'expected-before.json'
        binding_path.write_text(json.dumps(expected, indent=2) + '\n')
        started = datetime.now(timezone.utc).isoformat()
        completed = subprocess.run(argv, cwd=folder, env=environment, capture_output=True, text=True, timeout=15)
        finished = datetime.now(timezone.utc).isoformat()
        calls = [line.split('\t')[:-1] for line in log.read_text().splitlines()] if log.exists() else []
        actual = {'case': name, 'argv': argv, 'cwd': str(folder), 'start': started, 'finish': finished,
                  'exit': completed.returncode, 'stdout': completed.stdout, 'stderr': completed.stderr,
                  'docker_stub_calls': calls, 'real_docker_executable_in_path': False,
                  'expected_binding_sha256': hashlib.sha256(binding_path.read_bytes()).hexdigest(),
                  'resolver_sha256_after': hashlib.sha256(RESOLVER.read_bytes()).hexdigest()}
        (folder / 'actual.json').write_text(json.dumps(actual, indent=2) + '\n')
        for p in folder.rglob('*'):
            if p.is_file():
                p.chmod(0o600)
        self.assertEqual(actual['resolver_sha256_after'], expected['resolver_sha256'])
        self.assertEqual(calls, [['ps', '--filter', 'name=pmdl_' + provider, '--format', '{{.Names}}'] for provider in case['docker_providers']])
        self.assertEqual(completed.stderr, '')
        self.assertEqual(completed.returncode, case['exit'], completed.stdout)
        self.assertEqual(json.loads(completed.stdout), case['json'])

    def test_missing_explicit_optional_is_warning(self):
        self.run_case('optional')

    def test_missing_explicit_required_fails(self):
        self.run_case('required')

    def test_missing_omitted_required_defaults_to_required(self):
        self.run_case('omitted')

    def test_declared_provider_keeps_provider_module_and_name(self):
        self.run_case('declared')

    def test_mixed_requirements_keep_failure_in_both_orders(self):
        for name in ('optional_then_required', 'required_then_optional'):
            with self.subTest(order=name):
                self.run_case(name)


    def test_module_alias_only_is_resolved(self):
        self.run_case('alias_only')

    def test_module_aliases_same_type_remain_distinct(self):
        self.run_case('distinct_aliases')


    def test_provider_preference_nats_beats_directory_order(self):
        self.run_case('nats_first')

    def test_provider_preference_redis_beats_directory_order(self):
        self.run_case('redis_first')

    def test_provider_preference_second_metadata_choice(self):
        for name in ('second_choice', 'first_wrong_type'):
            with self.subTest(case=name):
                self.run_case(name)

    def test_provider_preference_duplicate_keeps_module_order(self):
        self.run_case('duplicate_provider')

    def test_provider_preference_requirement_independence(self):
        for name in ('independent_optional_between', 'independent_failure_before'):
            with self.subTest(case=name):
                self.run_case(name)

    def test_provider_preference_explicit_noop_order(self):
        for name in ('noop_first', 'noop_second'):
            with self.subTest(case=name):
                self.run_case(name)


if __name__ == '__main__':
    unittest.main()
