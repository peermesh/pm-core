#!/usr/bin/env python3
"""One-shot, bounded observation of an explicitly owned synthetic Docker fixture."""
import base64
import ipaddress
import json
import os
from pathlib import Path
import re
import shlex
import sys
import time

import project_docker_provider_snapshot as projection
from capture_file_provider_snapshot import (
    CaptureError, Commands, IMAGES, MAX_BYTES, NODE_HTTP, PATH_PATTERN, Parser,
    SSH, digest, safe_path,
)
from compare_deployment_snapshots import _unique_object, _reject_constant

HELPERS = {
    'capture_file_provider_snapshot.py': '44843e7dd8841c4cb7867ca820390e0b7b1dd67216a686ed099c90651aa984b4',
    'project_docker_provider_snapshot.py': '1467154ca3fb8eef61f93c1f5e57c687866ca1adfc9c212c29197dfc6debe352',
    'project_file_provider_snapshot.py': 'f3297d90fd4d8466de7a2317a9050f9355442cbc4547b25a6ad1da34ce3b31d4',
    'compare_deployment_snapshots.py': 'c113609c78eaf03d58d84ed86932612e4a3b0cd8599c0962f63e0674a7285c2b',
}
FLAGS = ['--api=true', '--api.dashboard=false', '--api.insecure=false', '--providers.docker=true',
         '--providers.docker.endpoint=tcp://fixture-api:2375', '--providers.docker.exposedbydefault=false',
         '--providers.docker.swarmmode=false', '--providers.docker.watch=false', '--providers.docker.httpclienttimeout=3s',
         '--providers.file.directory=/dynamic', '--providers.file.watch=false', '--entrypoints.web.address=:8080',
         '--entrypoints.websecure.address=:8443', '--global.checknewversion=false',
         '--global.sendanonymoususage=false', '--log.level=DEBUG']
IDS = ('traefik_id', 'api_id', 'client_id', 'network_id')
HASHES = ('api_script_sha256', 'dynamic_fixture_sha256')
IMAGE_ENV = ['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin']
NODE_ENV = IMAGE_ENV + ['NODE_VERSION=22.23.4', 'YARN_VERSION=1.22.22']
REASONS = frozenset('''unsafe_local_path output_collision overlapping_capture_storage
    invalid_fixture_contract input_limit_exceeded unstable_local_file projection_helper_mismatch
    transport_unavailable capture_timeout capture_limit_exceeded fixture_network_boundary
    fixture_identity_mismatch fixture_not_running fixture_container_boundary
    fixture_mount_or_command_boundary fixture_address_boundary unsafe_runtime_file_tree
    runtime_fixture_hash_mismatch invalid_api_capture runtime_identity_changed runtime_files_changed
    runtime_api_changed invalid_comparison_outcome source_or_helper_changed source_binding_unavailable
    outcome_write_failed invalid_arguments invalid_or_unavailable_input stable_bracket'''.split())
API_FILES = r"""const fs = require('node:fs');
const names = ['docker-api.js', 'state.json'];
if (JSON.stringify(fs.readdirSync('/fixture').sort()) !== JSON.stringify(names)) process.exit(2);
const result = {};
for (const name of names) {
  const path = '/fixture/' + name;
  const before = fs.lstatSync(path);
  if (!before.isFile() || before.size > 1048576) process.exit(2);
  const body = fs.readFileSync(path);
  const after = fs.lstatSync(path);
  if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || body.length !== before.size) process.exit(2);
  result[name] = body.toString('base64');
}
console.log(JSON.stringify(result));
"""


def stable_read(path):
    """Reject links, oversized reads and replacement/modification during a read."""
    path = safe_path(path, 'file')
    before = path.lstat()
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as stream:
        opened = os.fstat(stream.fileno())
        raw = stream.read(MAX_BYTES + 1)
        after = os.fstat(stream.fileno())
    if len(raw) > MAX_BYTES:
        raise CaptureError('input_limit_exceeded')
    key = lambda info: (info.st_dev, info.st_ino, info.st_mode, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
    if key(before) != key(opened) or key(opened) != key(after) or key(after) != key(path.lstat()):
        raise CaptureError('unstable_local_file')
    return raw, {'sha256': digest(raw), 'identity': list(key(after))}


def fixture_contract(raw):
    value = json.loads(raw, object_pairs_hook=_unique_object, parse_constant=_reject_constant)
    if (not isinstance(value, dict) or set(value) != {'schema', 'namespace', *IDS, *HASHES}
            or value['schema'] != 'peermesh.owned-docker-fixture.v1'
            or not isinstance(value['namespace'], str)
            or re.fullmatch(r'pm166-docker-capture-[0-9]{6}', value['namespace']) is None
            or any(not isinstance(value[k], str) or re.fullmatch(r'[0-9a-f]{64}', value[k]) is None for k in IDS + HASHES)
            or len({value[k] for k in IDS}) != len(IDS)):
        raise CaptureError('invalid_fixture_contract')
    return value


def input_binding(source, fixture_path):
    sources = {'input': source, 'fixture': fixture_path, 'runner': Path(__file__).absolute()}
    sources.update({name: Path(__file__).absolute().parent / name for name in HELPERS})
    data, binding = {}, {}
    for name, path in sources.items():
        data[name], binding[name] = stable_read(path)
        if name in HELPERS and binding[name]['sha256'] != HELPERS[name]:
            raise CaptureError('projection_helper_mismatch')
    return data, binding


class DockerTransport:
    """Only fixed read commands against the four caller-admitted full identities."""
    def __init__(self, commands, fixture):
        self.commands, self.fixture, self.ip = commands, fixture, None

    def docker(self, argv):
        result = self.commands.run(SSH + [shlex.join(['docker'] + argv)])
        if result.returncode:
            raise CaptureError('transport_unavailable')
        return result.stdout

    def identity(self):
        f = self.fixture
        containers = json.loads(self.docker(['inspect', '--type', 'container', *(f[k] for k in IDS[:3])]))
        networks = json.loads(self.docker(['network', 'inspect', f['network_id']]))
        name = f['namespace'] + '-internal'
        if len(networks) != 1:
            raise CaptureError('fixture_network_boundary')
        network = networks[0]
        if (network['Id'] != f['network_id'] or network['Name'] != name or network['Internal'] is not True
                or network.get('Driver') != 'bridge' or network.get('Scope') != 'local'
                or network.get('Labels', {}).get('peermesh.fixture') != f['namespace']
                or set(network['Containers']) != {f[k] for k in IDS[:3]}):
            raise CaptureError('fixture_network_boundary')
        if len(containers) != 3:
            raise CaptureError('fixture_identity_mismatch')
        for kind, c in zip(('traefik', 'api', 'client'), containers):
            host, config = c['HostConfig'], c['Config']
            if c['Id'] != f[kind + '_id'] or c['Image'] != IMAGES['traefik' if kind == 'traefik' else 'client']:
                raise CaptureError('fixture_identity_mismatch')
            if c['State']['Running'] is not True or c['State'].get('Paused') or c['State'].get('Restarting'):
                raise CaptureError('fixture_not_running')
            if (config.get('Labels', {}).get('peermesh.fixture') != f['namespace']
                    or config.get('Env') != (IMAGE_ENV if kind == 'traefik' else NODE_ENV)
                    or host.get('PortBindings') or host.get('PublishAllPorts') or host.get('Privileged')
                    or host.get('ReadonlyRootfs') is not True or host.get('CapDrop') != ['ALL'] or host.get('CapAdd')
                    or host.get('SecurityOpt') != ['no-new-privileges:true']
                    or host.get('NanoCpus') != 1000000000 or host.get('PidsLimit') != 128
                    or host.get('Memory') != (256 if kind == 'traefik' else 128) * 1024 * 1024
                    or host.get('RestartPolicy') != {'Name': 'no', 'MaximumRetryCount': 0}
                    or host.get('NetworkMode') != name or host.get('PidMode') or host.get('IpcMode') == 'host'
                    or host.get('Devices') or host.get('DeviceRequests') or host.get('VolumesFrom')
                    or host.get('ExtraHosts') or host.get('Links') or host.get('Tmpfs')
                    or set(c['NetworkSettings']['Networks']) != {name}
                    or any(value for value in (c['NetworkSettings'].get('Ports') or {}).values())):
                raise CaptureError('fixture_container_boundary')
            mounts = c['Mounts']
            if kind == 'traefik':
                command = config.get('Cmd')
                valid_command = (isinstance(command, list) and len(command) == len(FLAGS)
                                 and sorted(command) == sorted(FLAGS) and config.get('Entrypoint') == ['traefik']
                                 and config.get('User', '') in ('', '0', '0:0'))
                directory, target = 'dynamic', '/dynamic'
                ip = c['NetworkSettings']['Networks'][name]['IPAddress']
                address = ipaddress.ip_address(ip)
                if address.version != 4 or not address.is_private or address.is_loopback or address.is_unspecified or address.is_link_local:
                    raise CaptureError('fixture_address_boundary')
                self.ip = ip
            else:
                valid_command = (config.get('Cmd') == (['node', '/fixture/docker-api.js'] if kind == 'api'
                                 else ['node', '-e', 'setInterval(() => {}, 1000)'])
                                 and config.get('Entrypoint') == ['docker-entrypoint.sh'] and config.get('User') == '65534:65534')
                directory, target = 'api', '/fixture'
            if not valid_command:
                raise CaptureError('fixture_mount_or_command_boundary')
            if kind == 'client':
                if mounts:
                    raise CaptureError('fixture_mount_or_command_boundary')
            elif (len(mounts) != 1 or mounts[0].get('Type') != 'bind' or mounts[0].get('RW') is not False
                    or mounts[0].get('Source') != '/tmp/' + f['namespace'] + '/' + directory
                    or mounts[0].get('Destination') != target):
                raise CaptureError('fixture_mount_or_command_boundary')
            if kind == 'api' and 'fixture-api' not in (c['NetworkSettings']['Networks'][name].get('Aliases') or []):
                raise CaptureError('fixture_network_boundary')
        return {'containers': containers, 'network': network}

    def files(self):
        cid = self.fixture['traefik_id']
        if (self.docker(['exec', cid, 'find', '/dynamic', '!', '-type', 'd', '!', '-type', 'f']).strip()
                or sorted(self.docker(['exec', cid, 'find', '/dynamic']).decode().splitlines()) != ['/dynamic', '/dynamic/fixture.yaml']):
            raise CaptureError('unsafe_runtime_file_tree')
        size = int(self.docker(['exec', cid, 'wc', '-c', '/dynamic/fixture.yaml']).split()[0])
        if size > MAX_BYTES:
            raise CaptureError('capture_limit_exceeded')
        dynamic = self.docker(['exec', cid, 'cat', '/dynamic/fixture.yaml'])
        data = json.loads(self.docker(['exec', self.fixture['api_id'], 'node', '-e', API_FILES]))
        if set(data) != {'docker-api.js', 'state.json'} or len(dynamic) != size:
            raise CaptureError('unsafe_runtime_file_tree')
        return {'fixture.yaml': dynamic, **{name: base64.b64decode(raw, validate=True) for name, raw in data.items()}}

    def api(self):
        if self.ip is None:
            raise CaptureError('fixture_address_boundary')
        return json.loads(self.docker(['exec', self.fixture['client_id'], 'node', '-e', NODE_HTTP, self.ip]))


def save_json(path, value):
    with path.open('x') as stream:
        json.dump(value, stream, indent=2, sort_keys=True)
        stream.write('\n')


def save_files(output, phase, files, fixture):
    if (set(files) != {'docker-api.js', 'state.json', 'fixture.yaml'}
            or any(not isinstance(raw, bytes) or not raw or len(raw) > MAX_BYTES for raw in files.values())):
        raise CaptureError('unsafe_runtime_file_tree')
    directory = output / 'raw' / phase
    directory.mkdir(mode=0o700)
    for name, raw in files.items():
        with (directory / name).open('xb') as stream:
            stream.write(raw)
    if (digest(files['docker-api.js']) != fixture['api_script_sha256']
            or digest(files['fixture.yaml']) != fixture['dynamic_fixture_sha256']):
        raise CaptureError('runtime_fixture_hash_mismatch')
    projection.project_source(projection.read_json(directory / 'state.json'))
    return {name: digest(raw) for name, raw in files.items()}


def save_api(output, phase, response):
    directory = output / 'raw' / phase
    directory.mkdir(mode=0o700)
    save_json(directory / 'response.json', response)
    encoded = response.get('body_base64')
    if not isinstance(encoded, str) or len(encoded) > 4 * ((MAX_BYTES + 2) // 3):
        raise CaptureError('invalid_api_capture')
    body = base64.b64decode(encoded, validate=True)
    if not body or len(body) > MAX_BYTES:
        raise CaptureError('invalid_api_capture')
    with (directory / 'body.json').open('xb') as stream:
        stream.write(body)
    receipt = response.get('receipt')
    save_json(directory / 'receipt.json', receipt)
    observed = projection.project_observed(directory / 'body.json', receipt)
    return {'sha256': digest(body), 'bytes': len(body)}, observed


def outcome(status, reason, paths=None):
    return {'schema': 'peermesh.docker-provider-capture-outcome.v1', 'status': status,
            'exit_code': {'equal': 0, 'drift': 1, 'invalid_unavailable': 2}[status],
            'scope': projection.SCOPE, 'reason': reason if reason in REASONS else 'invalid_or_unavailable_input',
            'changed_paths': paths or [],
            'observation_limit': 'stable_bracket_is_not_atomic_or_authenticated_deployment_capture'}


def run(source, fixture_path, output, transport_factory=DockerTransport):
    created = False
    previous_umask = os.umask(0o077)
    try:
        source, fixture_path = safe_path(source, 'file'), safe_path(fixture_path, 'file')
        output = safe_path(output, 'new')
        owner = Path(__file__).absolute().parent
        if (output == owner or owner in output.parents or output in owner.parents
                or any(output == p or output in p.parents for p in (source, fixture_path))):
            raise CaptureError('overlapping_capture_storage')
        data, binding = input_binding(source, fixture_path)
        fixture = fixture_contract(data['fixture'])
        output.mkdir(mode=0o700)
        created = True
        (output / 'raw').mkdir(mode=0o700)
        save_json(output / 'raw/input-before.json', binding)
        (output / 'raw/source.json').write_bytes(data['input'])
        (output / 'raw/fixture.json').write_bytes(data['fixture'])
        expected = projection.project_source(projection.read_json(output / 'raw/source.json'))
        save_json(output / 'expected.json', expected)
        save_json(output / 'raw/expected-binding.json', {'sha256': digest((output / 'expected.json').read_bytes()),
            'before_any_runtime_observation': True, 'created_unix_ns': time.time_ns(), 'inputs': binding})
        commands = Commands(output)
        transport = transport_factory(commands, fixture)
        identity_before = transport.identity()
        save_json(output / 'raw/identity-before.json', identity_before)
        save_json(output / 'raw/http-origin.json', {'traefik_id': fixture['traefik_id'],
            'client_id': fixture['client_id'], 'network_id': fixture['network_id'],
            'inspected_traefik_ip': transport.ip, 'method': 'GET', 'path': '/api/rawdata',
            'port': 8080, 'host_header': 'api.fixture.invalid', 'request_timeout_ms': 3000,
            'node_http_sha256': digest(NODE_HTTP.encode())})
        files_before = save_files(output, 'files-before', transport.files(), fixture)
        first, observed = save_api(output, 'api-first', transport.api())
        second, _ = save_api(output, 'api-second', transport.api())
        files_after = save_files(output, 'files-after', transport.files(), fixture)
        identity_after = transport.identity()
        save_json(output / 'raw/identity-after.json', identity_after)
        save_json(output / 'raw/bracket.json', {'files_before': files_before, 'files_after': files_after,
            'first': first, 'second': second, 'identity_equal': identity_before == identity_after})
        if identity_before != identity_after:
            raise CaptureError('runtime_identity_changed')
        if files_before != files_after:
            raise CaptureError('runtime_files_changed')
        if first != second:
            raise CaptureError('runtime_api_changed')
        save_json(output / 'observed.json', observed)
        comparison = projection.compare_projections(expected, observed)
        paths = comparison.get('changed_paths')
        if (comparison.get('scope') != projection.SCOPE or not isinstance(paths, list) or len(paths) > 256
                or any(not isinstance(p, str) or len(p) > 1024 or not PATH_PATTERN.fullmatch(p) for p in paths)
                or comparison.get('status') != ('drift' if paths else 'equivalent')):
            raise CaptureError('invalid_comparison_outcome')
        save_json(output / 'raw/comparison.json', comparison)
        result = outcome('drift' if paths else 'equal', 'stable_bracket', paths)
    except Exception as error:
        result = outcome('invalid_unavailable', str(error) if isinstance(error, CaptureError) else 'invalid_or_unavailable_input')
        if created:
            try:
                save_json(output / 'raw/failure.json', {'type': type(error).__name__, 'detail': str(error)})
            except OSError:
                pass
    finally:
        if created:
            try:
                _, final_binding = input_binding(source, fixture_path)
                save_json(output / 'raw/input-after.json', final_binding)
                if final_binding != binding:
                    result = outcome('invalid_unavailable', 'source_or_helper_changed')
            except Exception:
                result = outcome('invalid_unavailable', 'source_binding_unavailable')
            try:
                save_json(output / 'outcome.json', result)
            except OSError:
                result = outcome('invalid_unavailable', 'outcome_write_failed')
        os.umask(previous_umask)
    return result


def main(argv=None):
    parser = Parser(description=__doc__, allow_abbrev=False)
    for name in ('input', 'fixture', 'output'):
        parser.add_argument('--' + name, required=True)
    try:
        args = parser.parse_args(argv)
        result = run(Path(args.input), Path(args.fixture), Path(args.output))
    except Exception:
        result = outcome('invalid_unavailable', 'invalid_arguments')
    print(json.dumps(result, sort_keys=True))
    return result['exit_code']


if __name__ == '__main__':
    sys.exit(main())
