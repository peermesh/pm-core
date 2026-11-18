#!/usr/bin/env python3
"""Convert supplied resolved Compose JSON into a private Docker label inventory."""
from decimal import Decimal
import json
import os
from pathlib import Path
import stat
import sys

import project_docker_provider_snapshot as projection
from capture_docker_provider_snapshot import stable_read
from capture_file_provider_snapshot import CaptureError, MAX_BYTES, digest, safe_path
from compare_deployment_snapshots import InvalidSnapshot, _reject_constant, _unique_object, _validate_strings

SOURCE_FILES = ('extract_compose_docker_labels.py', 'project_docker_provider_snapshot.py',
    'project_file_provider_snapshot.py', 'compare_deployment_snapshots.py',
    'capture_docker_provider_snapshot.py', 'capture_file_provider_snapshot.py')
RENDER_FLAG = '--compose-config-render'


def unescape_compose_render_value(value):
    """Undo one `docker compose config` escape: `$$` becomes `$`, a lone `$` is refused."""
    if '$' in value.replace('$$', ''):
        raise InvalidSnapshot('unresolved_label_expression')
    return value.replace('$$', '$')


def extract_labels(compose, provider, *, compose_config_render=False):
    """Return the exact four-field inventory after unchanged projector validation.

    Completeness is relative to the supplied services map. Provider scope is a
    caller assertion. Other Compose settings are neither rendered nor proved.
    Only with compose_config_render are label values unescaped, before every check.
    """
    if (not isinstance(compose, dict) or 'include' in compose
            or not isinstance(compose.get('services'), dict) or not compose['services']):
        raise InvalidSnapshot('invalid_compose_inventory')
    services = {}
    for name, service in compose['services'].items():
        if not isinstance(service, dict) or {'extends', 'label_file'} & set(service):
            raise InvalidSnapshot('unresolved_compose_service')
        labels = service.get('labels', {})
        if not isinstance(labels, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in labels.items()):
            raise InvalidSnapshot('invalid_resolved_labels')
        if compose_config_render:
            labels = {key: unescape_compose_render_value(value) for key, value in labels.items()}
        for key, value in labels.items():
            # Traefik's validator owns the crypt-dollar exception. Non-Traefik
            # labels are retained verbatim, but cannot contain unresolved syntax.
            if any(token in key or token in value for token in ('${', '{{', '}}')):
                raise InvalidSnapshot('unresolved_label_expression')
            if '$' in key or ('$' in value and not key.lower().startswith('traefik.')):
                raise InvalidSnapshot('unresolved_label_expression')
        services[name] = dict(labels)
    result = {'schema': projection.INPUT_SCHEMA, 'capture_status': 'complete',
        'provider': provider.copy() if isinstance(provider, dict) else provider, 'services': services}
    projection.project_source(result)
    return result


def load_private_json(path):
    """Read at most the existing one-MiB limit; bind exact bytes, not a global snapshot."""
    raw, binding = stable_read(path)
    if stat.S_IMODE(binding['identity'][2]) & 0o077:
        raise InvalidSnapshot('input_not_private')
    data = json.loads(raw.decode('utf-8'), object_pairs_hook=_unique_object,
        parse_float=Decimal, parse_constant=_reject_constant)
    _validate_strings(data)
    return data, {'sha256': binding['sha256'], 'bytes': len(raw)}


def extract_compose_labels(compose_path, provider_scope_path, output_path, *, compose_config_render=False):
    """Write an exclusive mode0600 inventory and return only hash/length bindings."""
    sources = {}
    for name in SOURCE_FILES:
        raw, binding = stable_read(Path(__file__).absolute().parent / name)
        sources[name] = {'sha256': binding['sha256'], 'bytes': len(raw)}
    compose, compose_binding = load_private_json(compose_path)
    provider, provider_binding = load_private_json(provider_scope_path)
    result = extract_labels(compose, provider, compose_config_render=compose_config_render)
    raw = (json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True) + '\n').encode('utf-8')
    if len(raw) > MAX_BYTES:
        raise InvalidSnapshot('output_limit_exceeded')
    output = safe_path(output_path, 'new')
    if stat.S_IMODE(output.parent.lstat().st_mode) & 0o077:
        raise InvalidSnapshot('output_parent_not_private')
    # O_EXCL never follows or overwrites an existing path. Remove only this
    # invocation's inode if a write/readback fails; caller files remain intact.
    fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    created = os.fstat(fd)
    try:
        with os.fdopen(fd, 'wb') as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        actual, binding = stable_read(output)
        if actual != raw or stat.S_IMODE(binding['identity'][2]) != 0o600:
            raise InvalidSnapshot('output_verification_failed')
    except BaseException:
        current = output.lstat()
        if (current.st_dev, current.st_ino) == (created.st_dev, created.st_ino):
            output.unlink()
        raise
    return {'status': 'extracted', 'schema': projection.INPUT_SCHEMA,
        'bindings': {'sources': sources, 'compose': compose_binding, 'provider_scope': provider_binding,
            'output': {'sha256': digest(raw), 'bytes': len(raw)}}}


def main(argv=None):
    try:
        # Matched exactly, outside argparse: registering it there would make the
        # existing prefix spellings of --compose, such as --comp, ambiguous.
        argv = list(sys.argv[1:] if argv is None else argv)
        compose_config_render = RENDER_FLAG in argv
        if compose_config_render:
            argv.remove(RENDER_FLAG)
        parser = projection.SafeParser(prog='extract_compose_docker_labels.py', description=__doc__,
            epilog=RENDER_FLAG + ': the input is compose config JSON; unescape label values. Default off.')
        parser.add_argument('--compose', required=True)
        parser.add_argument('--provider-scope', required=True)
        parser.add_argument('--output', required=True)
        args = parser.parse_args(argv)
        outcome = extract_compose_labels(args.compose, args.provider_scope, args.output,
            compose_config_render=compose_config_render)
        print(json.dumps(outcome, sort_keys=True))
        return 0
    except (InvalidSnapshot, CaptureError, OSError, ValueError, TypeError, KeyError, RecursionError):
        # Exception text and caller arguments may contain labels, credentials or
        # paths. Keep the entire failure surface fixed, including parse errors.
        print(json.dumps({'status': 'invalid', 'reason': 'invalid_or_unavailable_input'}, sort_keys=True))
        return 2


if __name__ == '__main__':
    sys.exit(main())
