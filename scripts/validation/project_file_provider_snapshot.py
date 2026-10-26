#!/usr/bin/env python3
"""Offline, explicitly scoped Traefik v2.11.41 file-provider projection.

Requires PyYAML. This is neither a collector nor a deployment-completeness claim.
The existing deployment comparator owns value comparison and opaque change paths.
"""
import argparse
import hashlib
import ipaddress
import json
from pathlib import Path
import re
import sys

import yaml
from yaml.nodes import MappingNode, ScalarNode, SequenceNode
from yaml.tokens import AliasToken, AnchorToken, DirectiveToken, TagToken

from compare_deployment_snapshots import (
    COLLECTIONS, InvalidSnapshot, _dynamic_inventory, _named_inventory,
    _reject_constant, _unique_object, _validate_strings, compare_snapshots,
)

SCHEMA = 'peermesh.file-provider-projection.v1'
SCOPE = {
    'provider': 'file', 'protocol': 'http', 'traefik_version': '2.11.41',
    'middleware_types': ['headers', 'rateLimit', 'chain', 'forwardAuth', 'buffering', 'ipAllowList'],
    'collections': list(COLLECTIONS),
    'excluded': ['http.services', 'static_configuration', 'tls', 'tcp', 'udp'],
    'semantics': 'literal_configuration_with_file_reference_and_whole_second_duration_normalization',
    'rate_limit_period_unit': 'seconds',
    'forward_auth_observed_trust_default': False,
}
INTEGER = re.compile(r'-?(?:0|[1-9][0-9]*)\Z')
DURATION = re.compile(r'(?:(0|[1-9][0-9]*)h)?(?:(0|[1-9][0-9]*)m)?(?:(0|[1-9][0-9]*)s)?\Z')
CHAIN_REFERENCE = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.-]*(?:@file)?\Z')
HEADER_NAME = re.compile(r'[A-Za-z0-9][A-Za-z0-9-]*\Z')
AUTH_ADDRESS = re.compile(r'https?://([A-Za-z0-9.-]+)(?::([1-9][0-9]{0,4}))?(/[A-Za-z0-9._~/-]*)\Z')
HOST_LABEL = re.compile(r'[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\Z')
RAW_KEYS = {'routers', 'middlewares', 'services', 'tcpRouters', 'tcpMiddlewares', 'tcpServices', 'udpRouters', 'udpServices'}


def read_json(path):
    """Reuse strict duplicate/constant/string checks; fractional scalars are unsupported."""
    def no_fraction(value):
        raise InvalidSnapshot('unsupported_fractional_scalar')
    try:
        data = json.loads(Path(path).read_text(encoding='utf-8'), object_pairs_hook=_unique_object,
                          parse_float=no_fraction, parse_constant=_reject_constant)
        _validate_strings(data)
        return data
    except InvalidSnapshot:
        raise
    except (OSError, UnicodeError, ValueError, RecursionError):
        raise InvalidSnapshot('invalid_json_input') from None


def strict_yaml(raw):
    """Construct only JSON-compatible nodes; do not apply YAML 1.1 coercions."""
    def value(node, path=()):
        if isinstance(node, MappingNode) and node.tag == 'tag:yaml.org,2002:map':
            pairs = [(value(key), value(item, path + (key.value,))) for key, item in node.value]
            if any(not isinstance(key, str) or key == '<<' for key, _ in pairs):
                raise InvalidSnapshot('unsupported_yaml_key')
            return _unique_object(pairs)
        if isinstance(node, SequenceNode) and node.tag == 'tag:yaml.org,2002:seq':
            return [value(item, path) for item in node.value]
        if not isinstance(node, ScalarNode):
            raise InvalidSnapshot('unsupported_yaml_node')
        tag = node.tag.removeprefix('tag:yaml.org,2002:')
        if tag == 'str':
            # PyYAML treats 1e3 and 0o12 as plain strings; other YAML parsers
            # can assign numeric types. Require quotes for numeric-looking text.
            period = (len(path) == 5 and path[:2] == ('http', 'middlewares')
                      and path[-2:] == ('rateLimit', 'period') and DURATION.fullmatch(node.value))
            if node.style is None and re.match(r'^[+-]?(?:[0-9]|\.[0-9])', node.value) and not period:
                raise InvalidSnapshot('ambiguous_plain_scalar')
            return node.value
        if tag == 'bool' and node.value in ('true', 'false'):
            return node.value == 'true'
        if tag == 'int' and INTEGER.fullmatch(node.value):
            return int(node.value)
        if tag == 'null' and node.value == 'null':
            return None
        raise InvalidSnapshot('unsupported_yaml_scalar')

    try:
        text = raw.decode('utf-8')
        if '{{' in text:
            raise InvalidSnapshot('unsupported_template')
        if any(isinstance(token, (AliasToken, AnchorToken, DirectiveToken, TagToken))
               for token in yaml.scan(text)):
            raise InvalidSnapshot('unsupported_yaml_feature')
        data = value(yaml.compose(text, Loader=yaml.SafeLoader))
        _validate_strings(data)
        return data
    except (UnicodeError, yaml.YAMLError, RecursionError, ValueError) as error:
        if isinstance(error, InvalidSnapshot):
            raise
        raise InvalidSnapshot('invalid_yaml_input') from None


def file_inventory(root, inventory):
    """Require an explicit inventory equal to the physical, symlink-free tree."""
    root = Path(root)
    if not root.is_dir() or any(part.is_symlink() for part in (root, *root.parents)):
        raise InvalidSnapshot('unsafe_file_root')
    if (not isinstance(inventory, dict) or set(inventory) != {'schema', 'capture_status', 'files'}
            or inventory['schema'] != 'peermesh.file-inventory.v1'
            or inventory['capture_status'] != 'complete' or not isinstance(inventory['files'], list)
            or not inventory['files'] or any(not isinstance(name, str) for name in inventory['files'])):
        raise InvalidSnapshot('invalid_file_inventory')
    names = inventory['files']
    if len(set(names)) != len(names):
        raise InvalidSnapshot('duplicate_file_name')
    _dynamic_inventory({name: '0' * 64 for name in names})
    paths = list(root.rglob('*'))
    if any(p.is_symlink() or not (p.is_file() or p.is_dir()) for p in paths):
        raise InvalidSnapshot('unsafe_file_tree')
    if set(names) != {p.relative_to(root).as_posix() for p in paths if p.is_file()}:
        raise InvalidSnapshot('incomplete_file_inventory')
    if any(Path(name).suffix not in ('.yaml', '.yml') for name in names):
        raise InvalidSnapshot('unsupported_file_format')
    try:
        files = {name: (root / name).read_bytes() for name in sorted(names)}
    except OSError:
        raise InvalidSnapshot('unreadable_file') from None
    return files, {name: hashlib.sha256(raw).hexdigest() for name, raw in files.items()}


def rate_limit(config, projected=False):
    """Only explicit positive integer rates, whole-second periods and header/default criteria."""
    if (not isinstance(config, dict) or not {'average', 'burst', 'period'} <= set(config)
            or set(config) - {'average', 'burst', 'period', 'sourceCriterion'}):
        raise InvalidSnapshot('unsupported_rate_limit_configuration')
    if any(type(config[key]) is not int or not 1 <= config[key] <= 2**63 - 1
           for key in ('average', 'burst')):
        raise InvalidSnapshot('invalid_rate_limit_integer')
    period = config['period']
    if projected:
        if type(period) is not int or not 1 <= period <= (2**63 - 1) // 1000000000:
            raise InvalidSnapshot('invalid_projected_period')
    else:
        match = DURATION.fullmatch(period) if isinstance(period, str) and len(period) <= 32 else None
        if not match or not period:
            raise InvalidSnapshot('unsupported_rate_limit_period')
        period = sum(int(value or 0) * scale for value, scale in zip(match.groups(), (3600, 60, 1)))
        if not 1 <= period <= (2**63 - 1) // 1000000000:
            raise InvalidSnapshot('unsupported_rate_limit_period')
    if 'sourceCriterion' in config:
        criterion = config['sourceCriterion']
        if (not isinstance(criterion, dict) or set(criterion) != {'requestHeaderName'}
                or not isinstance(criterion['requestHeaderName'], str)
                or not HEADER_NAME.fullmatch(criterion['requestHeaderName'])):
            raise InvalidSnapshot('unsupported_source_criterion')
    return dict(config, period=period)


def forward_auth(config, observed=False):
    """Admit explicit literals; only observed omission of the bool normalizes to false."""
    if not isinstance(config, dict):
        raise InvalidSnapshot('unsupported_forward_auth_configuration')
    config = dict(config)
    if observed and 'trustForwardHeader' not in config:
        config['trustForwardHeader'] = False
    if (set(config) != {'address', 'trustForwardHeader', 'authResponseHeaders'}
            or type(config['trustForwardHeader']) is not bool):
        raise InvalidSnapshot('unsupported_forward_auth_configuration')
    address = config['address']
    match = AUTH_ADDRESS.fullmatch(address) if isinstance(address, str) else None
    if not match:
        raise InvalidSnapshot('unsupported_forward_auth_address')
    host, port, path = match.groups()
    if (len(host) > 253 or any(not HOST_LABEL.fullmatch(label) for label in host.split('.'))
            or (port is not None and int(port) > 65535)
            or '//' in path or any(part in ('.', '..') for part in path.split('/'))):
        raise InvalidSnapshot('unsupported_forward_auth_address')
    if all(char in '0123456789.' for char in host):
        try:
            if str(ipaddress.IPv4Address(host)) != host:
                raise ValueError
        except ValueError:
            raise InvalidSnapshot('unsupported_forward_auth_address') from None
    headers = config['authResponseHeaders']
    if (not isinstance(headers, list) or not headers
            or any(not isinstance(name, str) or not HEADER_NAME.fullmatch(name) for name in headers)):
        raise InvalidSnapshot('unsupported_auth_response_headers')
    return config


def configuration(kind, config, source=False, projected=False):
    """Keep all admitted fields; reject scope/metadata collisions explicitly."""
    if not isinstance(config, dict) or not config:
        raise InvalidSnapshot('invalid_configuration')
    if set(config) & {'status', 'error', 'using', 'usedBy'}:
        raise InvalidSnapshot('configuration_metadata_collision')
    if kind == 'middlewares':
        if len(config) != 1 or next(iter(config)) not in SCOPE['middleware_types']:
            raise InvalidSnapshot('unsupported_middleware_type')
        if 'headers' in config:
            if not isinstance(config['headers'], dict) or not config['headers']:
                raise InvalidSnapshot('unsupported_middleware_type')
        elif 'rateLimit' in config:
            config = {'rateLimit': rate_limit(config['rateLimit'], projected)}
        elif 'chain' in config:
            chain = config['chain']
            if (not isinstance(chain, dict) or set(chain) != {'middlewares'}
                    or not isinstance(chain['middlewares'], list) or not chain['middlewares']
                    or any(not isinstance(ref, str) or not CHAIN_REFERENCE.fullmatch(ref)
                           or (projected and not ref.endswith('@file')) for ref in chain['middlewares'])):
                raise InvalidSnapshot('unsupported_chain_configuration')
            # Actual API: attached chains are qualified; inert chains retain bare names.
            config = {'chain': {'middlewares': [ref if '@' in ref else ref + '@file'
                                                for ref in chain['middlewares']]}}
        elif 'forwardAuth' in config:
            config = {'forwardAuth': forward_auth(config['forwardAuth'], observed=not source and not projected)}
        elif 'buffering' in config:
            buffering = config['buffering']
            if (not isinstance(buffering, dict) or set(buffering) != {'maxRequestBodyBytes', 'memRequestBodyBytes'}
                    or any(type(value) is not int or not 1 <= value <= 2**63 - 1 for value in buffering.values())):
                raise InvalidSnapshot('unsupported_buffering_configuration')
        elif 'ipAllowList' in config:
            allow = config['ipAllowList']
            if (not isinstance(allow, dict) or set(allow) != {'sourceRange'}
                    or not isinstance(allow['sourceRange'], list) or not allow['sourceRange']):
                raise InvalidSnapshot('unsupported_ip_allow_list_configuration')
            for cidr in allow['sourceRange']:
                try:
                    if (not isinstance(cidr, str) or '/' not in cidr or '%' in cidr
                            or str(ipaddress.ip_network(cidr, strict=True)) != cidr):
                        raise ValueError
                except ValueError:
                    raise InvalidSnapshot('unsupported_ip_allow_list_cidr') from None
    else:
        if 'tls' in config:
            raise InvalidSnapshot('unsupported_tls_scope')
        if (not isinstance(config.get('entryPoints'), list) or not config['entryPoints']
                or any(not isinstance(v, str) or not v for v in config['entryPoints'])
                or type(config.get('priority')) is not int or config['priority'] == 0
                or not isinstance(config.get('rule'), str) or not config['rule']
                or not isinstance(config.get('service'), str) or not config['service']):
            raise InvalidSnapshot('router_requires_explicit_configuration')
        if 'middlewares' in config:
            if (not isinstance(config['middlewares'], list)
                    or any(not isinstance(v, str) or not v or v.count('@') > 1
                           or ('@' in v and not v.endswith('@file')) or v == '@file'
                           for v in config['middlewares'])):
                raise InvalidSnapshot('unsupported_middleware_reference')
            if source:
                config = dict(config, middlewares=[v if '@' in v else v + '@file' for v in config['middlewares']])
    return config


def envelope(origin, collections):
    return {'schema': SCHEMA, 'scope': SCOPE, 'origin': origin,
            'capture_status': 'complete_within_scope', 'collections': collections}


def project_source(root, inventory):
    files, hashes = file_inventory(root, inventory)
    items = {'routers': {}, 'middlewares': {}, 'dynamic_files': hashes}
    for raw in files.values():
        data = strict_yaml(raw)
        if not isinstance(data, dict) or set(data) != {'http'} or not isinstance(data['http'], dict):
            raise InvalidSnapshot('unsupported_source_root')
        http = data['http']
        if not http or set(http) - {'routers', 'middlewares', 'services'}:
            raise InvalidSnapshot('unsupported_http_scope')
        if 'services' in http and not isinstance(http['services'], dict):
            raise InvalidSnapshot('invalid_excluded_service_inventory')
        for kind in ('routers', 'middlewares'):
            for name, config in _named_inventory(http.get(kind, {})).items():
                if '@' in name or name + '@file' in items[kind]:
                    raise InvalidSnapshot('duplicate_or_qualified_source_name')
                items[kind][name + '@file'] = configuration(kind, config, source=True)
    if not items['routers'] or not items['middlewares']:
        raise InvalidSnapshot('empty_scoped_capture')
    return envelope('source', items)


def project_observed(root, inventory, body_path, receipt):
    raw = Path(body_path).read_bytes()
    required = {'schema', 'method', 'path', 'status', 'complete', 'content_type', 'body_sha256', 'body_bytes'}
    if (not isinstance(receipt, dict) or set(receipt) != required
            or receipt['schema'] != 'peermesh.rawdata-receipt.v1'
            or receipt['method'] != 'GET' or receipt['path'] != '/api/rawdata'
            or type(receipt['status']) is not int or receipt['status'] != 200
            or receipt['complete'] is not True or receipt['content_type'] != 'application/json'
            or type(receipt['body_bytes']) is not int or receipt['body_bytes'] != len(raw)
            or receipt['body_sha256'] != hashlib.sha256(raw).hexdigest() or not raw):
        raise InvalidSnapshot('invalid_api_receipt')
    data = read_json(body_path)
    if (not isinstance(data, dict) or set(data) - RAW_KEYS
            or not {'routers', 'middlewares'} <= set(data)
            or any(not isinstance(v, dict) for v in data.values())):
        raise InvalidSnapshot('invalid_rawdata_scope')
    if any(data.get(key) for key in RAW_KEYS if key.startswith(('tcp', 'udp'))):
        raise InvalidSnapshot('unsupported_transport_scope')
    _, hashes = file_inventory(root, inventory)
    items = {'dynamic_files': hashes}
    for kind in ('routers', 'middlewares'):
        items[kind] = {}
        metadata = {'status', 'error', 'using' if kind == 'routers' else 'usedBy'}
        for name, config in _named_inventory(data[kind]).items():
            if not name.endswith('@file') or name.count('@') != 1 or name == '@file':
                raise InvalidSnapshot('unsupported_provider')
            if config.get('status') != 'enabled' or config.get('error', []) != []:
                raise InvalidSnapshot('unhealthy_api_configuration')
            usage = config.get('using' if kind == 'routers' else 'usedBy', [])
            if not isinstance(usage, list) or any(not isinstance(v, str) or not v for v in usage):
                raise InvalidSnapshot('invalid_api_metadata')
            projected = {key: value for key, value in config.items() if key not in metadata}
            items[kind][name] = configuration(kind, projected)
        if not items[kind]:
            raise InvalidSnapshot('empty_scoped_capture')
    return envelope('observed', items)


def validate_projection(data, origin):
    if (not isinstance(data, dict)
            or set(data) != {'schema', 'scope', 'origin', 'capture_status', 'collections'}
            or data['schema'] != SCHEMA or data['scope'] != SCOPE or data['origin'] != origin
            or data['capture_status'] != 'complete_within_scope'
            or not isinstance(data['collections'], dict) or set(data['collections']) != set(COLLECTIONS)):
        raise InvalidSnapshot('invalid_projection_scope')
    items = data['collections']
    for kind in ('routers', 'middlewares'):
        if not _named_inventory(items[kind]):
            raise InvalidSnapshot('empty_scoped_capture')
        for name, config in items[kind].items():
            if not name.endswith('@file') or name.count('@') != 1 or name == '@file':
                raise InvalidSnapshot('unsupported_provider')
            configuration(kind, config, projected=True)
    if not _dynamic_inventory(items['dynamic_files']):
        raise InvalidSnapshot('empty_file_inventory')
    return items


def compare_projections(expected, observed):
    changes = compare_snapshots(validate_projection(expected, 'source'), validate_projection(observed, 'observed'))
    return {'schema': SCHEMA, 'scope': SCOPE, 'status': 'drift' if changes else 'equivalent', 'changed_paths': changes}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    for name in ('source', 'observed'):
        command = commands.add_parser(name)
        command.add_argument('--files', required=True)
        command.add_argument('--inventory', required=True)
        command.add_argument('--output', required=True)
        if name == 'observed':
            command.add_argument('--body', required=True)
            command.add_argument('--receipt', required=True)
    compare = commands.add_parser('compare')
    compare.add_argument('expected')
    compare.add_argument('observed')
    args = parser.parse_args(argv)
    try:
        if args.command == 'compare':
            result = compare_projections(read_json(args.expected), read_json(args.observed))
            print(json.dumps(result, sort_keys=True))
            return 1 if result['status'] == 'drift' else 0
        inventory = read_json(args.inventory)
        if args.command == 'source':
            result = project_source(args.files, inventory)
        else:
            result = project_observed(args.files, inventory, args.body, read_json(args.receipt))
        Path(args.output).write_text(json.dumps(result, indent=2, sort_keys=True) + '\n', encoding='utf-8')
        print(json.dumps({'status': 'projected', 'schema': SCHEMA, 'origin': result['origin'], 'scope': SCOPE}, sort_keys=True))
        return 0
    except (InvalidSnapshot, OSError, RecursionError) as error:
        code = str(error) if isinstance(error, InvalidSnapshot) else 'unreadable_or_invalid_input'
        print(json.dumps({'status': 'invalid', 'reason': code}, sort_keys=True))
        return 2


if __name__ == '__main__':
    sys.exit(main())
