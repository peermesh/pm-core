"""Exercise deploy-vps with synthetic files and recording-only command stubs.

Run with Python unittest discovery. DEPLOY_VPS_BASH may select Bash 4+.
Optional DEPLOY_VPS_RECEIPTS records JSONL command/exit/argument evidence.
No real Docker, deploy guard, environment file or credentials are used.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / 'scripts/deploy-vps.sh'
BASH = os.environ.get('DEPLOY_VPS_BASH') or shutil.which('bash')
FILES = (
    'docker-compose.yml',
    'docker-compose.production.yml',
    'docker-compose.authentik-production.yml',
    'profiles/observability-lite/docker-compose.observability-lite.yml',
    'profiles/observability-full/docker-compose.observability-full.yml',
)
PREFIX = ['compose', '--profile', 'postgresql'] + [arg for name in FILES for arg in ('-f', name)]
PS = ['ps', '--format', 'table {{.Name}}\\t{{.Service}}\\t{{.Status}}']
APPROVAL = 'PEERMESH_PRODUCTION_AUTHENTIK_APPLY_APPROVAL'
PLAN = 'PLAN-CORE-RECONCILE-001-REV-AUTHENTIK-PRESERVE'
STUB = '''import json, os, pathlib, sys
kind = "docker" if pathlib.Path(sys.argv[0]).name == "docker" else "guard"
assert pathlib.Path.cwd() == pathlib.Path(os.environ["DOCKER_LAB_DIR"])
with open(os.environ["STUB_RECORD"], "a") as handle:
    handle.write(json.dumps({"kind": kind, "argv": sys.argv[1:], "cwd": os.getcwd()}) + "\\n")
if kind == "guard":
    raise SystemExit(int(os.environ["STUB_GUARD_EXIT"]))
if "--dry-run" in sys.argv:
    raise SystemExit(int(os.environ["STUB_PREVIEW_EXIT"]))
if sys.argv[-2:] == ["config", "--quiet"]:
    raise SystemExit(int(os.environ["STUB_CONFIG_EXIT"]))
if sys.argv[-2:] == ["config", "--services"]:
    print("synthetic-service")
'''


class TestDeployVps(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not BASH:
            raise RuntimeError('Bash 4+ is required; set DEPLOY_VPS_BASH')
        version = subprocess.check_output([BASH, '--noprofile', '--norc', '-c',
                                           'printf "%s" "${BASH_VERSINFO[0]}"'],
                                          env={'PATH': '/usr/bin:/bin'}, text=True)
        if int(version) < 4:
            raise RuntimeError('Bash 4+ is required; set DEPLOY_VPS_BASH')

    def invoke(self, name, command, *, missing=None, guard_exit=0, guard_present=True,
               approval=None, confirmation='', preview_exit=0, config_exit=0):
        with tempfile.TemporaryDirectory(prefix='deploy vps fixture ') as directory:
            root = Path(directory)
            lab, binary = root / 'lab with spaces', root / 'bin'
            lab.mkdir()
            binary.mkdir()
            for relative in FILES:
                if relative != missing:
                    path = lab / relative
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text('services: {}\n')
            guard = lab / 'scripts/deploy-guard.sh'
            guard.parent.mkdir()
            for stub in [binary / 'docker'] + ([guard] if guard_present else []):
                stub.write_text(f'#!{sys.executable}\n' + STUB)
                stub.chmod(0o755)
            record = root / 'calls.jsonl'
            env = {'PATH': str(binary) + ':/usr/bin:/bin', 'HOME': str(root),
                   'DOCKER_LAB_DIR': str(lab), 'STUB_RECORD': str(record),
                   'STUB_GUARD_EXIT': str(guard_exit), 'STUB_PREVIEW_EXIT': str(preview_exit),
                   'STUB_CONFIG_EXIT': str(config_exit), 'LC_ALL': 'C'}
            if approval is not None:
                # A fixture token tests branching; it is not owner authorization.
                env[APPROVAL] = approval
            self.assertEqual(shutil.which('docker', path=env['PATH']), str(binary / 'docker'))
            argv = [BASH, '--noprofile', '--norc', str(SCRIPT), *command]
            result = subprocess.run(argv, env=env, cwd=root, input=confirmation,
                                    capture_output=True, text=True, timeout=10)
            calls = [json.loads(line) for line in record.read_text().splitlines()] if record.exists() else []
            receipt = {'case': name, 'argv': argv, 'exit': result.returncode,
                       'stdout': result.stdout, 'stderr': result.stderr, 'calls': calls,
                       'missing_file': missing, 'guard_exit': guard_exit,
                       'guard_present': guard_present, 'preview_exit': preview_exit,
                       'config_exit': config_exit, 'synthetic_approval_fixture': approval == PLAN,
                       'confirmation': confirmation, 'script': str(SCRIPT),
                       'docker_resolution': str(binary / 'docker'), 'real_docker': False}
            if os.environ.get('DEPLOY_VPS_RECEIPTS'):
                with open(os.environ['DEPLOY_VPS_RECEIPTS'], 'a') as output:
                    output.write(json.dumps(receipt) + '\n')
            self.assertFalse((lab / '.env').exists())
            for call in calls:
                self.assertEqual(call['cwd'], str(lab))
                if call['kind'] == 'guard':
                    self.assertEqual(call['argv'], ['--env-file', str(lab / '.env'), '--profile', 'postgresql'])
                else:
                    self.assertEqual(call['argv'][:len(PREFIX)], PREFIX)
            return result, calls

    def test_missing_first_or_last_file_never_calls_docker(self):
        for subcommand in ('ps', 'config', 'dry-run', 'up', 'reconcile'):
            for missing in (FILES[0], FILES[-1]):
                with self.subTest(command=subcommand, missing=missing):
                    result, calls = self.invoke(f'missing-{subcommand}-{missing}', [subcommand, '--yes'],
                                                missing=missing, approval=PLAN)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn('missing compose file:', result.stderr)
                    self.assertEqual([call for call in calls if call['kind'] == 'docker'], [])
                    self.assertEqual(len(calls), 0 if subcommand == 'ps' else 1)

    def test_successful_read_commands_preserve_complete_arguments(self):
        for command, tails in [('ps', [PS]), ('config', [['config', '--quiet'], ['config', '--services']]),
                               ('dry-run', [['--dry-run', 'up', '-d', '--remove-orphans']])]:
            with self.subTest(command=command):
                result, calls = self.invoke(f'present-{command}', [command])
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual([c['argv'] for c in calls if c['kind'] == 'docker'], [PREFIX + tail for tail in tails])
                self.assertEqual([c['kind'] for c in calls], ([] if command == 'ps' else ['guard']) + ['docker'] * len(tails))

    def test_guard_failure_or_absence_stops_before_docker(self):
        for command in ('config', 'dry-run', 'up', 'reconcile'):
            with self.subTest(command=command):
                result, calls = self.invoke(f'guard-failed-{command}', [command, '--yes'], guard_exit=23, approval=PLAN)
                self.assertEqual(result.returncode, 23)
                self.assertEqual([c['kind'] for c in calls], ['guard'])
        for command in ('config', 'dry-run'):
            with self.subTest(missing_guard=command):
                result, calls = self.invoke(f'guard-absent-{command}', [command], guard_present=False)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(calls, [])

    def test_unapproved_mutations_stop_before_any_stub(self):
        for command in ('up', 'reconcile'):
            for approval in (None, 'incorrect-synthetic-token'):
                with self.subTest(command=command, approval=approval):
                    result, calls = self.invoke(f'unapproved-{command}-{approval}', [command, '--yes'], approval=approval)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn('production mutation blocked:', result.stderr)
                    self.assertEqual(calls, [])

    def test_synthetic_approval_preserves_confirmation_and_mutation_vectors(self):
        for command in ('up', 'reconcile'):
            apply = ['up', '-d', '--remove-orphans'] + (['--no-recreate'] if command == 'reconcile' else [])
            for flag, reply in [('--yes', ''), ('-y', ''), ('', 'y\n'), ('', 'n\n')]:
                with self.subTest(command=command, flag=flag, reply=reply):
                    result, calls = self.invoke(f'fixture-{command}-{flag}-{reply.strip()}',
                                                [command] + ([flag] if flag else []), approval=PLAN, confirmation=reply)
                    tails = [['config', '--quiet'], ['--dry-run'] + apply]
                    if reply == 'n\n':
                        self.assertNotEqual(result.returncode, 0)
                        self.assertIn('aborted', result.stderr)
                    else:
                        self.assertEqual(result.returncode, 0, result.stderr)
                        tails += [apply, PS]
                    self.assertEqual([c['kind'] for c in calls], ['guard'] + ['docker'] * len(tails))
                    self.assertEqual([c['argv'] for c in calls if c['kind'] == 'docker'], [PREFIX + tail for tail in tails])

    def test_existing_preview_failure_policy_is_preserved(self):
        for command in ('up', 'reconcile'):
            with self.subTest(command=command):
                result, calls = self.invoke(f'preview-failed-{command}', [command, '--yes'], approval=PLAN, preview_exit=29)
                self.assertEqual(result.returncode, 0)
                apply = ['up', '-d', '--remove-orphans'] + (['--no-recreate'] if command == 'reconcile' else [])
                tails = [['config', '--quiet'], ['--dry-run'] + apply, apply, PS]
                self.assertEqual([c['argv'] for c in calls if c['kind'] == 'docker'], [PREFIX + tail for tail in tails])

    def test_config_failure_stops_before_preview_and_mutation(self):
        for command in ('up', 'reconcile'):
            with self.subTest(command=command):
                result, calls = self.invoke(f'config-failed-{command}', [command, '--yes'], approval=PLAN, config_exit=31)
                self.assertEqual(result.returncode, 31)
                self.assertEqual([c['kind'] for c in calls], ['guard', 'docker'])
                self.assertEqual(calls[-1]['argv'], PREFIX + ['config', '--quiet'])


if __name__ == '__main__':
    unittest.main()
