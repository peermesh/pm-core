#!/usr/bin/env python3
"""One-shot observation of an explicitly owned, isolated Core166 GPU fixture."""
import argparse
import base64
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import shlex
import stat
import subprocess
import sys
import time

import project_file_provider_snapshot as projection

SSH = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'gpu-server']
IMAGES = {'traefik': 'sha256:7256cb4222acb3ecfcae35e1a7c83d6949ecb1a019d76684a48d074d0d1b8819',
          'client': 'sha256:ae59e9992c6b3e963dd9dac9c476287048177ad8f90ac646669afb738705f56d'}
HELPERS = {'project_file_provider_snapshot.py': 'f3297d90fd4d8466de7a2317a9050f9355442cbc4547b25a6ad1da34ce3b31d4',
           'compare_deployment_snapshots.py': 'c113609c78eaf03d58d84ed86932612e4a3b0cd8599c0962f63e0674a7285c2b'}
FLAGS = ['--api=true', '--api.dashboard=false', '--api.insecure=false', '--providers.file.directory=/dynamic',
         '--providers.file.watch=true', '--entrypoints.web.address=:8080', '--global.checknewversion=false',
         '--global.sendanonymoususage=false', '--log.level=DEBUG']
MAX_BYTES = 1024 * 1024
MAX_FILES = 32
PATH_PATTERN = re.compile(r'^/(routers|middlewares|dynamic_files)(/(k-[0-9a-f]{64}|[0-9]+))+$')
# Unchanged accepted18:11 Node HTTP transport; stdout remains protected raw evidence.
NODE_HTTP = r"""const http = require('node:http');
const crypto = require('node:crypto');
const host = process.argv[1];
const request = http.get({host, port: 8080, path: '/api/rawdata', headers: {Host: 'api.fixture.invalid'}}, response => {
  const chunks = [];
  response.on('data', chunk => chunks.push(chunk));
  response.on('end', () => {
    const body = Buffer.concat(chunks);
    console.log(JSON.stringify({
      receipt: {schema: 'peermesh.rawdata-receipt.v1', method: 'GET', path: '/api/rawdata',
        status: response.statusCode, complete: response.complete,
        content_type: response.headers['content-type'], body_sha256: crypto.createHash('sha256').update(body).digest('hex'), body_bytes: body.length},
      headers: response.headers, raw_headers: response.rawHeaders, body_base64: body.toString('base64')
    }));
  });
});
request.setTimeout(3000, () => request.destroy(new Error('fixture timeout')));
request.on('error', error => { console.log(JSON.stringify({error: error.message})); process.exitCode = 1; });
"""


class CaptureError(Exception):
    """Only fixed local reason codes may cross into the redacted outcome."""


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def safe_path(path, kind):
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts:
        raise CaptureError('unsafe_local_path')
    for parent in path.parents:
        if not stat.S_ISDIR(parent.lstat().st_mode):
            raise CaptureError('unsafe_local_path')
    if kind == 'new':
        try:
            path.lstat()
        except FileNotFoundError:
            return path
        raise CaptureError('output_collision')
    info = path.lstat()
    if not (stat.S_ISDIR(info.st_mode) if kind == 'directory' else stat.S_ISREG(info.st_mode)):
        raise CaptureError('unsafe_local_path')
    return path


def fixture_contract(path):
    fixture = projection.read_json(path)
    if (not isinstance(fixture, dict) or set(fixture) != {'schema', 'namespace', 'traefik_id', 'client_id', 'network_id'}
            or fixture['schema'] != 'peermesh.owned-file-fixture.v1'
            or not isinstance(fixture['namespace'], str)
            or re.fullmatch(r'pm166-drift-capture-[0-9]{6}', fixture['namespace']) is None
            or any(not isinstance(fixture[k], str) or re.fullmatch(r'[0-9a-f]{64}', fixture[k]) is None
                   for k in ('traefik_id', 'client_id', 'network_id'))
            or len({fixture[k] for k in ('traefik_id', 'client_id', 'network_id')}) != 3):
        raise CaptureError('invalid_fixture_contract')
    return fixture


def input_binding(source, inventory, fixture_path):
    files, hashes = projection.file_inventory(source, projection.read_json(inventory))
    if len(files) > MAX_FILES or any(len(raw) > MAX_BYTES for raw in files.values()):
        raise CaptureError('input_limit_exceeded')
    helpers = {}
    for name, expected in HELPERS.items():
        path = safe_path(Path(__file__).resolve().parent / name, 'file')
        helpers[name] = digest(path.read_bytes())
        if helpers[name] != expected:
            raise CaptureError('projection_helper_mismatch')
    return {'files': hashes, 'inventory_sha256': digest(inventory.read_bytes()),
            'fixture_contract_sha256': digest(fixture_path.read_bytes()), 'helpers': helpers,
            'runner_sha256': digest(Path(__file__).read_bytes())}


class Commands:
    def __init__(self, output):
        self.output = output
        self.rows = []
        self.deadline = time.monotonic() + 90

    def run(self, argv):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise CaptureError('capture_timeout')
        try:
            result = subprocess.run(argv, capture_output=True, timeout=min(20, remaining))
        except subprocess.TimeoutExpired as error:
            self.rows.append({'argv': argv, 'timeout': True, 'stdout_base64': base64.b64encode(error.stdout or b'').decode(),
                              'stderr_base64': base64.b64encode(error.stderr or b'').decode()})
            self.save()
            raise CaptureError('capture_timeout') from None
        self.rows.append({'argv': argv, 'exit': result.returncode, 'stdout_base64': base64.b64encode(result.stdout).decode(),
                          'stderr_base64': base64.b64encode(result.stderr).decode()})
        self.save()
        if len(result.stdout) > 4 * MAX_BYTES or len(result.stderr) > MAX_BYTES:
            raise CaptureError('capture_limit_exceeded')
        return result

    def save(self):
        (self.output / 'raw/commands.json').write_text(json.dumps(self.rows, indent=2) + '\n')


class FixtureTransport:
    def __init__(self, commands, fixture):
        self.commands = commands
        self.fixture = fixture
        self.ip = None

    def docker(self, argv):
        result = self.commands.run(SSH + [shlex.join(['docker'] + argv)])
        if result.returncode:
            raise CaptureError('transport_unavailable')
        return result.stdout

    def identity(self):
        f = self.fixture
        containers = json.loads(self.docker(['inspect', '--type', 'container', f['traefik_id'], f['client_id']]))
        network = json.loads(self.docker(['network', 'inspect', f['network_id']]))[0]
        network_name = f['namespace'] + '-internal'
        if (network['Id'] != f['network_id'] or network['Name'] != network_name or not network['Internal']
                or network.get('Labels', {}).get('peermesh.fixture') != f['namespace']
                or set(network['Containers']) != {f['traefik_id'], f['client_id']}):
            raise CaptureError('fixture_network_boundary')
        if len(containers) != 2:
            raise CaptureError('fixture_identity_mismatch')
        stable = {'network_id': network['Id'], 'network_name': network_name, 'containers': {}}
        for key, container in zip(('traefik', 'client'), containers):
            host = container['HostConfig']
            if container['Id'] != f[key + '_id'] or container['Image'] != IMAGES[key]:
                raise CaptureError('fixture_identity_mismatch')
            if not container['State']['Running'] or container['State'].get('Paused') or container['State'].get('Restarting'):
                raise CaptureError('fixture_not_running')
            if (container['Config'].get('Labels', {}).get('peermesh.fixture') != f['namespace']
                    or host.get('PortBindings') or host.get('Privileged') or not host.get('ReadonlyRootfs')
                    or 'ALL' not in (host.get('CapDrop') or []) or host.get('CapAdd')
                    or 'no-new-privileges:true' not in (host.get('SecurityOpt') or [])
                    or host.get('NetworkMode') != network_name
                    or set(container['NetworkSettings']['Networks']) != {network_name}):
                raise CaptureError('fixture_container_boundary')
            mounts = container['Mounts']
            if key == 'traefik':
                if (len(mounts) != 1 or mounts[0]['Type'] != 'bind' or mounts[0]['RW']
                        or mounts[0]['Destination'] != '/dynamic'
                        or mounts[0]['Source'] != '/tmp/' + f['namespace'] + '/dynamic'
                        or sorted(container['Config']['Cmd']) != sorted(FLAGS)
                        or container['Config']['Entrypoint'] != ['traefik']):
                    raise CaptureError('fixture_mount_or_command_boundary')
                ip = container['NetworkSettings']['Networks'][network_name]['IPAddress']
                if not ipaddress.ip_address(ip).is_private:
                    raise CaptureError('fixture_address_boundary')
                self.ip = ip
            elif mounts or container['Config']['Cmd'] != ['node', '-e', 'setInterval(() => {}, 1000)']:
                raise CaptureError('fixture_client_boundary')
            stable['containers'][key] = {'id': container['Id'], 'image': container['Image'], 'mounts': mounts,
                'networks': container['NetworkSettings']['Networks'], 'started_at': container['State']['StartedAt'],
                'pid': container['State']['Pid'], 'restart_count': container['RestartCount']}
        return stable

    def files(self):
        cid = self.fixture['traefik_id']
        if self.docker(['exec', cid, 'find', '/dynamic', '!', '-type', 'd', '!', '-type', 'f']).strip():
            raise CaptureError('unsafe_runtime_file_tree')
        listing = self.docker(['exec', cid, 'find', '/dynamic', '-type', 'f']).decode('utf-8').splitlines()
        if not listing or len(listing) > MAX_FILES or len(set(listing)) != len(listing) or any(not name.startswith('/dynamic/') for name in listing):
            raise CaptureError('invalid_runtime_inventory')
        names = sorted(name.removeprefix('/dynamic/') for name in listing)
        projection._dynamic_inventory({name: '0' * 64 for name in names})
        if any(Path(name).suffix not in ('.yaml', '.yml') for name in names):
            raise CaptureError('unsupported_runtime_file_format')
        files = {name: self.docker(['exec', cid, 'cat', '/dynamic/' + name]) for name in names}
        if any(len(raw) > MAX_BYTES for raw in files.values()):
            raise CaptureError('capture_limit_exceeded')
        return files

    def api(self):
        raw = self.docker(['exec', self.fixture['client_id'], 'node', '-e', NODE_HTTP, self.ip])
        return json.loads(raw)


def save_observation(output, phase, files, response):
    directory = output / 'raw' / phase
    directory.mkdir(mode=0o700)
    (directory / 'files').mkdir(mode=0o700)
    for name, raw in files.items():
        path = directory / 'files' / name
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with path.open('xb') as stream:
            stream.write(raw)
    receipt = response.get('receipt', {})
    body = base64.b64decode(response.get('body_base64', ''), validate=True)
    (directory / 'api-body.json').write_bytes(body)
    (directory / 'api-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    (directory / 'api-response.json').write_text(json.dumps(response, indent=2) + '\n')
    inventory = {'schema': 'peermesh.file-inventory.v1', 'capture_status': 'complete', 'files': sorted(files)}
    (directory / 'inventory.json').write_text(json.dumps(inventory, indent=2) + '\n')
    if (receipt.get('status') != 200 or receipt.get('complete') is not True
            or receipt.get('body_bytes') != len(body) or receipt.get('body_sha256') != digest(body)
            or receipt.get('path') != '/api/rawdata' or receipt.get('method') != 'GET'
            or receipt.get('content_type') != 'application/json' or not body or len(body) > MAX_BYTES):
        raise CaptureError('invalid_api_capture')
    return {'files': {name: digest(raw) for name, raw in files.items()}, 'api_sha256': digest(body), 'api_bytes': len(body)}


def outcome(status, reason, paths=None):
    code = {'equal': 0, 'drift': 1, 'invalid_unavailable': 2}[status]
    return {'schema': 'peermesh.file-provider-capture-outcome.v1', 'status': status, 'exit_code': code,
            'scope': projection.SCOPE, 'reason': reason, 'changed_paths': paths or [],
            'observation_limit': 'stable_bracket_is_not_atomic_or_authenticated_deployment_capture'}


def run(source, inventory, fixture_path, output, transport_factory=FixtureTransport):
    created = False
    try:
        source = safe_path(source, 'directory')
        inventory = safe_path(inventory, 'file')
        fixture_path = safe_path(fixture_path, 'file')
        output = safe_path(output, 'new')
        if source == output or source in output.parents or output in source.parents:
            raise CaptureError('overlapping_capture_storage')
        if any(output == p or output in p.parents for p in (inventory, fixture_path, Path(__file__).resolve())):
            raise CaptureError('overlapping_capture_storage')
        fixture = fixture_contract(fixture_path)
        binding = input_binding(source, inventory, fixture_path)
        output.mkdir(mode=0o700)
        created = True
        (output / 'raw').mkdir(mode=0o700)
        (output / 'raw/input-before.json').write_text(json.dumps(binding, indent=2) + '\n')
        commands = Commands(output)
        cli = [sys.executable, '-B', str(Path(__file__).resolve().parent / 'project_file_provider_snapshot.py')]
        expected = commands.run(cli + ['source', '--files', str(source), '--inventory', str(inventory), '--output', str(output / 'expected.json')])
        if expected.returncode != 0:
            raise CaptureError('source_projection_invalid')
        (output / 'raw/expected-binding.json').write_text(json.dumps({'sha256': digest((output / 'expected.json').read_bytes()),
            'before_any_runtime_observation': True, 'created_unix_ns': time.time_ns()}) + '\n')
        transport = transport_factory(commands, fixture)
        identity_before = transport.identity()
        (output / 'raw/identity-before.json').write_text(json.dumps(identity_before, indent=2) + '\n')
        first = save_observation(output, 'before', transport.files(), transport.api())
        second = save_observation(output, 'after', transport.files(), transport.api())
        identity_after = transport.identity()
        (output / 'raw/identity-after.json').write_text(json.dumps(identity_after, indent=2) + '\n')
        (output / 'raw/bracket.json').write_text(json.dumps({'before': first, 'after': second,
            'identity_equal': identity_before == identity_after, 'non_atomic_limit': True}, indent=2) + '\n')
        if identity_before != identity_after:
            raise CaptureError('runtime_identity_changed')
        if first['files'] != second['files']:
            raise CaptureError('runtime_files_changed')
        if first['api_sha256'] != second['api_sha256'] or first['api_bytes'] != second['api_bytes']:
            raise CaptureError('runtime_api_changed')
        observed = commands.run(cli + ['observed', '--files', str(output / 'raw/before/files'),
            '--inventory', str(output / 'raw/before/inventory.json'), '--body', str(output / 'raw/before/api-body.json'),
            '--receipt', str(output / 'raw/before/api-receipt.json'), '--output', str(output / 'observed.json')])
        if observed.returncode != 0:
            raise CaptureError('observed_projection_invalid')
        compared = commands.run(cli + ['compare', str(output / 'expected.json'), str(output / 'observed.json')])
        if compared.returncode not in (0, 1):
            raise CaptureError('comparison_invalid')
        comparison = json.loads(compared.stdout)
        paths = comparison.get('changed_paths')
        if (comparison.get('scope') != projection.SCOPE or not isinstance(paths, list) or len(paths) > 256
                or any(not isinstance(path, str) or len(path) > 1024 or not PATH_PATTERN.fullmatch(path) for path in paths)
                or comparison.get('status') != ('equivalent' if compared.returncode == 0 else 'drift')
                or bool(paths) != bool(compared.returncode)):
            raise CaptureError('invalid_comparison_outcome')
        result = outcome('equal' if compared.returncode == 0 else 'drift', 'stable_bracket', paths)
    except Exception as error:
        reason = str(error) if isinstance(error, CaptureError) else 'invalid_or_unavailable_input'
        result = outcome('invalid_unavailable', reason)
        if created:
            try:
                (output / 'raw/failure.json').write_text(json.dumps({'type': type(error).__name__, 'detail': str(error)}, indent=2) + '\n')
            except OSError:
                pass
    if created:
        try:
            final_binding = input_binding(source, inventory, fixture_path)
            (output / 'raw/input-after.json').write_text(json.dumps(final_binding, indent=2) + '\n')
            if final_binding != binding:
                result = outcome('invalid_unavailable', 'source_or_helper_changed')
        except Exception:
            result = outcome('invalid_unavailable', 'source_binding_unavailable')
        try:
            with (output / 'outcome.json').open('x') as stream:
                json.dump(result, stream, sort_keys=True)
                stream.write('\n')
        except OSError:
            return outcome('invalid_unavailable', 'outcome_write_failed')
    return result


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise CaptureError('invalid_arguments')


def main(argv=None):
    parser = Parser(description=__doc__)
    for name in ('source', 'inventory', 'fixture', 'output'):
        parser.add_argument('--' + name, required=True)
    try:
        args = parser.parse_args(argv)
        result = run(Path(args.source), Path(args.inventory), Path(args.fixture), Path(args.output))
    except Exception:
        result = outcome('invalid_unavailable', 'invalid_arguments')
    print(json.dumps(result, sort_keys=True))
    return result['exit_code']


if __name__ == '__main__':
    sys.exit(main())
