#!/usr/bin/env python3
"""Offline Docker HTTP label/rawdata projection; no collection or runtime parity claim."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

from compare_deployment_snapshots import InvalidSnapshot, _named_inventory, compare_snapshots
from project_file_provider_snapshot import HEADER_NAME, RAW_KEYS, configuration, rate_limit, read_json

SCHEMA = 'peermesh.docker-provider-projection.v1'
INPUT_SCHEMA = 'peermesh.docker-resolved-labels.v1'
AUTH_DOMAIN = 'peermesh.docker-provider.basic-auth-users.v1'
SCOPE = {
    'provider': 'docker', 'protocol': 'http', 'traefik_version': '2.11.41',
    'exposedByDefault': False, 'swarmMode': False,
    'collections': ['routers', 'middlewares', 'dynamic_files'],
    'middleware_types': ['headers', 'rateLimit', 'basicAuth'],
    'excluded': ['http.services', 'providers.file', 'providers.internal', 'dynamic_files',
                 'non_traefik_labels', 'disabled_or_unlabelled_services', 'static_configuration', 'tcp', 'udp'],
    'missing_priority': 0, 'priority_semantics': 'declared_configuration_not_muxer_effective_priority',
    'rate_limit_period_unit': 'seconds', 'basic_auth_users': AUTH_DOMAIN,
    'runtime_parity': 'unqualified',
}
NAME = re.compile(r'[a-z0-9][a-z0-9_-]*\Z')
ENTRYPOINT = re.compile(r'[A-Za-z0-9][A-Za-z0-9_-]*\Z')
DECIMAL = re.compile(r'(?:0|[1-9][0-9]*)\Z')
HEADER_BOOLS = ('browserXssFilter', 'contentTypeNosniff', 'frameDeny', 'stsIncludeSubdomains', 'stsPreload')
HEADER_FIELDS = {name.lower(): name for name in (*HEADER_BOOLS, 'stsSeconds')}
ROUTER_FIELDS = {'rule', 'entrypoints', 'service', 'priority', 'middlewares', 'tls', 'tls.certresolver'}
RATE_FIELDS = {'average': 'average', 'burst': 'burst', 'period': 'period',
               'sourcecriterion.requestheadername': 'requestHeaderName'}


def literal(value, credential=False):
    """Reject unresolved expressions and controls; crypt dollar syntax is checked separately."""
    if (not isinstance(value, str) or not value or value.strip() != value
            or any(ord(c) < 32 or ord(c) == 127 for c in value)
            or '{{' in value or '}}' in value or '${' in value
            or (not credential and '$' in value)):
        raise InvalidSnapshot('unresolved_or_invalid_literal')
    return value


def integer_label(value, maximum=2**63 - 1):
    if not isinstance(value, str) or len(value) > 20 or not DECIMAL.fullmatch(value):
        raise InvalidSnapshot('invalid_label_integer')
    number = int(value)
    if not 1 <= number <= maximum:
        raise InvalidSnapshot('invalid_label_integer')
    return number


def label_list(value):
    """Only comma separators with no empty, escaped or whitespace-padded elements."""
    parts = literal(value, credential=True).split(',')
    if any(not part or part.strip() != part or '\\' in part for part in parts):
        raise InvalidSnapshot('ambiguous_label_list')
    return parts


def reference(value, middleware=False, projected=False):
    literal(value)
    parts = value.split('@')
    allowed = ('docker', 'file') if middleware else ('docker',)
    if not middleware and value == 'api@internal':
        return value
    if (len(parts) > 2 or not NAME.fullmatch(parts[0])
            or (len(parts) == 2 and parts[1] not in allowed)
            or (projected and len(parts) != 2)):
        raise InvalidSnapshot('unsupported_reference')
    return value if len(parts) == 2 else value + '@docker'


def basic_auth(config, projected=False):
    """Hash the ordered raw list with a fixed domain; never retain credential entries."""
    keys = {'realm', 'users_sha256', 'users_count'} if projected else {'realm', 'users'}
    if not isinstance(config, dict) or set(config) != keys:
        raise InvalidSnapshot('unsupported_basic_auth')
    literal(config['realm'])
    if projected:
        if (type(config['users_count']) is not int or config['users_count'] < 1
                or not isinstance(config['users_sha256'], str)
                or not re.fullmatch(r'[0-9a-f]{64}', config['users_sha256'])):
            raise InvalidSnapshot('invalid_basic_auth_digest')
        return dict(config)
    users = config['users']
    if not isinstance(users, list) or not users:
        raise InvalidSnapshot('invalid_basic_auth_users')
    for user in users:
        literal(user, credential=True)
        parts = user.split(':')
        if (len(parts) != 2 or not re.fullmatch(r'[A-Za-z0-9_.-]+', parts[0])
                or not re.fullmatch(r'(?:\{SHA\}[A-Za-z0-9+/]{27}=|\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}|\$apr1\$[./A-Za-z0-9]{1,8}\$[./A-Za-z0-9]{22})', parts[1])):
            raise InvalidSnapshot('unsupported_or_masked_basic_auth_users')
    raw = json.dumps(users, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    return {'realm': config['realm'], 'users_count': len(users),
            'users_sha256': hashlib.sha256(AUTH_DOMAIN.encode('ascii') + b'\0' + raw).hexdigest()}


def docker_middleware(config, projected=False):
    """Constrain Docker headers before reusing the accepted middleware owner."""
    if not isinstance(config, dict) or len(config) != 1:
        raise InvalidSnapshot('unsupported_middleware_configuration')
    if 'basicAuth' in config:
        return {'basicAuth': basic_auth(config['basicAuth'], projected)}
    if 'rateLimit' in config:
        return {'rateLimit': rate_limit(config['rateLimit'], projected)}
    if 'headers' not in config or not isinstance(config['headers'], dict):
        raise InvalidSnapshot('unsupported_middleware_type')
    headers = config['headers']
    if set(headers) - {*HEADER_BOOLS, 'stsSeconds', 'customResponseHeaders'}:
        raise InvalidSnapshot('unsupported_header_field')
    normalized = {name: headers.get(name, False) for name in HEADER_BOOLS}
    if any(type(value) is not bool for value in normalized.values()):
        raise InvalidSnapshot('invalid_header_boolean')
    seconds = headers.get('stsSeconds', 0)
    if type(seconds) is not int or not 0 <= seconds <= 2**63 - 1:
        raise InvalidSnapshot('invalid_header_integer')
    custom = headers.get('customResponseHeaders', {})
    if not isinstance(custom, dict) or len({key.lower() for key in custom}) != len(custom):
        raise InvalidSnapshot('invalid_custom_headers')
    for key, value in custom.items():
        if not HEADER_NAME.fullmatch(key):
            raise InvalidSnapshot('invalid_header_name')
        literal(value)
    normalized.update(stsSeconds=seconds, customResponseHeaders=dict(custom))
    return configuration('middlewares', {'headers': normalized}, projected=True)


def docker_router(config, projected=False):
    if (not isinstance(config, dict) or not {'rule', 'entryPoints', 'service'} <= set(config)
            or set(config) - {'rule', 'entryPoints', 'service', 'priority', 'middlewares', 'tls'}):
        raise InvalidSnapshot('unsupported_router_configuration')
    rule = literal(config['rule'])
    entries = config['entryPoints']
    if (not isinstance(entries, list) or not entries
            or any(not isinstance(v, str) or not ENTRYPOINT.fullmatch(v) for v in entries)
            or len(set(entries)) != len(entries)):
        raise InvalidSnapshot('invalid_entrypoints')
    priority = config.get('priority', 0)
    if type(priority) is not int or not 0 <= priority <= 2**63 - 1001:
        raise InvalidSnapshot('invalid_router_priority')
    middlewares = config.get('middlewares', [])
    if not isinstance(middlewares, list):
        raise InvalidSnapshot('invalid_middleware_references')
    result = {'rule': rule, 'entryPoints': list(entries), 'priority': priority,
              'service': reference(config['service'], projected=projected),
              'middlewares': [reference(v, middleware=True, projected=projected) for v in middlewares]}
    if 'tls' in config:
        tls = config['tls']
        if not isinstance(tls, dict) or set(tls) - {'certResolver'}:
            raise InvalidSnapshot('unsupported_router_tls')
        if 'certResolver' in tls and not ENTRYPOINT.fullmatch(literal(tls['certResolver'])):
            raise InvalidSnapshot('invalid_certificate_resolver')
        result['tls'] = dict(tls)
    return result


def split_labels(labels):
    """Decode only named admitted paths; lower-case field names, preserve map-key spelling."""
    if not isinstance(labels, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in labels.items()):
        raise InvalidSnapshot('invalid_resolved_labels')
    if len({key.lower() for key in labels}) != len(labels):
        raise InvalidSnapshot('colliding_label_paths')
    groups = {'routers': {}, 'middlewares': {}, 'services': {}}
    enabled = None
    for key, value in labels.items():
        lower = key.lower()
        if not lower.startswith('traefik.'):
            continue
        if lower == 'traefik.enable':
            if value not in ('true', 'false'):
                raise InvalidSnapshot('invalid_enable_label')
            enabled = value == 'true'
            continue
        parts = key.split('.')
        if (len(parts) < 5 or parts[1].lower() != 'http' or parts[2].lower() not in groups
                or not NAME.fullmatch(parts[3])):
            raise InvalidSnapshot('unsupported_traefik_label')
        kind, name, field = parts[2].lower(), parts[3], '.'.join(parts[4:]).lower()
        literal(value, credential=kind == 'middlewares' and field == 'basicauth.users')
        valid = (kind == 'routers' and field in ROUTER_FIELDS
                 or kind == 'services' and field == 'loadbalancer.server.port'
                 or kind == 'middlewares' and (field in {'basicauth.users', 'basicauth.realm'}
                     or field.startswith('ratelimit.') and field[10:] in RATE_FIELDS
                     or field.startswith('headers.') and field[8:] in HEADER_FIELDS
                     or len(parts) == 7 and parts[4].lower() == 'headers'
                         and parts[5].lower() == 'customresponseheaders' and HEADER_NAME.fullmatch(parts[6])))
        if not valid:
            raise InvalidSnapshot('unsupported_traefik_label')
        fields = groups[kind].setdefault(name, {})
        fields[field] = (parts[6], value) if field.startswith('headers.customresponseheaders.') else value
    return enabled, groups


def middleware_labels(fields):
    kinds = {key.split('.')[0] for key in fields}
    if len(kinds) != 1:
        raise InvalidSnapshot('mixed_middleware_types')
    kind = next(iter(kinds))
    if kind == 'basicauth':
        if set(fields) != {'basicauth.users', 'basicauth.realm'}:
            raise InvalidSnapshot('unsupported_basic_auth')
        return docker_middleware({'basicAuth': {'users': label_list(fields['basicauth.users']), 'realm': fields['basicauth.realm']}})
    if kind == 'ratelimit':
        config = {}
        for key, value in fields.items():
            field = key[10:]
            if field == 'sourcecriterion.requestheadername':
                config['sourceCriterion'] = {'requestHeaderName': value}
            else:
                config[field] = integer_label(value) if field in ('average', 'burst') else value
        return docker_middleware({'rateLimit': config})
    headers = {}
    for key, value in fields.items():
        field = key[8:]
        if field.startswith('customresponseheaders.'):
            name, text = value
            headers.setdefault('customResponseHeaders', {})[name] = text
        elif field == 'stsseconds':
            headers['stsSeconds'] = integer_label(value)
        else:
            if value not in ('true', 'false'):
                raise InvalidSnapshot('invalid_header_boolean')
            headers[HEADER_FIELDS[field]] = value == 'true'
    return docker_middleware({'headers': headers})


def envelope(origin, collections, exclusions=None):
    return {'schema': SCHEMA, 'scope': dict(SCOPE), 'origin': origin,
            'capture_status': 'complete_within_scope', 'excluded_services': exclusions or {}, 'collections': collections}


def project_source(data):
    if (not isinstance(data, dict) or set(data) != {'schema', 'capture_status', 'provider', 'services'}
            or data['schema'] != INPUT_SCHEMA or data['capture_status'] != 'complete'
            or data['provider'] != {'exposedByDefault': False, 'swarmMode': False}
            or any(type(v) is not bool for v in data['provider'].values())
            or not isinstance(data['services'], dict) or not data['services']):
        raise InvalidSnapshot('invalid_resolved_input_scope')
    items = {'routers': {}, 'middlewares': {}, 'dynamic_files': {}}
    exclusions = {}
    for service, labels in data['services'].items():
        if not isinstance(service, str) or not NAME.fullmatch(service):
            raise InvalidSnapshot('invalid_service_inventory')
        enabled, groups = split_labels(labels)
        if enabled is not True:
            exclusions[service] = 'disabled' if enabled is False else 'unlabelled'
            continue
        if not groups['routers']:
            raise InvalidSnapshot('implicit_default_router_unsupported')
        for ports in groups['services'].values():
            integer_label(ports['loadbalancer.server.port'], 65535)
        for name, fields in groups['routers'].items():
            config = {}
            for field, value in fields.items():
                if field in ('tls', 'tls.certresolver'):
                    if field == 'tls' and value != 'true':
                        raise InvalidSnapshot('unsupported_router_tls')
                    config.setdefault('tls', {})
                    if field == 'tls.certresolver':
                        config['tls']['certResolver'] = value
                elif field in ('entrypoints', 'middlewares'):
                    config['entryPoints' if field == 'entrypoints' else field] = label_list(value)
                else:
                    config[field] = integer_label(value, 2**63 - 1001) if field == 'priority' else value
            if 'service' not in config:
                if len(groups['services']) != 1:
                    raise InvalidSnapshot('ambiguous_implicit_service')
                config['service'] = next(iter(groups['services']))
            if name + '@docker' in items['routers']:
                raise InvalidSnapshot('duplicate_router_definition')
            items['routers'][name + '@docker'] = docker_router(config)
        for name, fields in groups['middlewares'].items():
            if name + '@docker' in items['middlewares']:
                raise InvalidSnapshot('duplicate_middleware_definition')
            items['middlewares'][name + '@docker'] = middleware_labels(fields)
    result = envelope('source', items, exclusions)
    validate_projection(result, 'source')
    return result


def provider_name(name):
    parts = name.split('@')
    if len(parts) != 2 or not parts[0] or parts[1] not in ('docker', 'file', 'internal'):
        raise InvalidSnapshot('unsupported_provider')
    if parts[1] == 'docker' and not NAME.fullmatch(parts[0]):
        raise InvalidSnapshot('unsupported_docker_name')
    return parts[1]


def project_observed(body_path, receipt):
    raw = Path(body_path).read_bytes()
    keys = {'schema', 'method', 'path', 'status', 'complete', 'content_type', 'body_sha256', 'body_bytes'}
    if (not isinstance(receipt, dict) or set(receipt) != keys
            or receipt['schema'] != 'peermesh.rawdata-receipt.v1'
            or receipt['method'] != 'GET' or receipt['path'] != '/api/rawdata'
            or type(receipt['status']) is not int or receipt['status'] != 200
            or receipt['complete'] is not True or receipt['content_type'] != 'application/json'
            or type(receipt['body_bytes']) is not int or receipt['body_bytes'] != len(raw)
            or receipt['body_sha256'] != hashlib.sha256(raw).hexdigest() or not raw):
        raise InvalidSnapshot('invalid_api_receipt')
    data = read_json(body_path)
    if Path(body_path).read_bytes() != raw:
        raise InvalidSnapshot('body_changed_during_read')
    if (not isinstance(data, dict) or set(data) - RAW_KEYS or not {'routers', 'middlewares'} <= set(data)
            or any(not isinstance(value, dict) for value in data.values())):
        raise InvalidSnapshot('invalid_rawdata_scope')
    if any(data.get(key) for key in RAW_KEYS if key.startswith(('tcp', 'udp'))):
        raise InvalidSnapshot('unsupported_transport_scope')
    items = {'routers': {}, 'middlewares': {}, 'dynamic_files': {}}
    for kind in ('routers', 'middlewares', 'services'):
        entries = _named_inventory(data.get(kind, {}))
        if len({name.lower() for name in entries}) != len(entries):
            raise InvalidSnapshot('colliding_api_names')
        for name, config in entries.items():
            if provider_name(name) != 'docker' or kind == 'services':
                continue
            usage = 'using' if kind == 'routers' else 'usedBy'
            if config.get('status') != 'enabled' or config.get('error', []) != []:
                raise InvalidSnapshot('unhealthy_api_configuration')
            refs = config.get(usage, [])
            if not isinstance(refs, list) or any(not isinstance(v, str) or not v for v in refs):
                raise InvalidSnapshot('invalid_api_metadata')
            value = {k: v for k, v in config.items() if k not in {'status', 'error', usage}}
            items[kind][name] = docker_router(value) if kind == 'routers' else docker_middleware(value)
    result = envelope('observed', items)
    validate_projection(result, 'observed')
    return result


def validate_projection(data, origin):
    if (not isinstance(data, dict)
            or set(data) != {'schema', 'scope', 'origin', 'capture_status', 'excluded_services', 'collections'}
            or data['schema'] != SCHEMA or data['scope'] != SCOPE or data['origin'] != origin
            or data['capture_status'] != 'complete_within_scope'
            or not isinstance(data['collections'], dict) or set(data['collections']) != set(SCOPE['collections'])):
        raise InvalidSnapshot('invalid_projection_scope')
    # Python bool/int equality must not make forged scope versions equivalent.
    if json.dumps(data['scope'], sort_keys=True) != json.dumps(SCOPE, sort_keys=True):
        raise InvalidSnapshot('invalid_projection_scope')
    exclusions = data['excluded_services']
    if (not isinstance(exclusions, dict) or origin == 'observed' and exclusions
            or any(not NAME.fullmatch(name) or reason not in ('disabled', 'unlabelled') for name, reason in exclusions.items())):
        raise InvalidSnapshot('invalid_excluded_services')
    items = data['collections']
    if items['dynamic_files'] != {}:
        raise InvalidSnapshot('unsupported_dynamic_files_scope')
    for kind in ('routers', 'middlewares'):
        if not _named_inventory(items[kind]):
            raise InvalidSnapshot('empty_scoped_capture')
        for name, config in items[kind].items():
            if provider_name(name) != 'docker':
                raise InvalidSnapshot('unsupported_projection_provider')
            normalized = docker_router(config, True) if kind == 'routers' else docker_middleware(config, True)
            if normalized != config:
                raise InvalidSnapshot('noncanonical_projection')
    return items


def compare_projections(expected, observed):
    changes = compare_snapshots(validate_projection(expected, 'source'), validate_projection(observed, 'observed'))
    return {'schema': SCHEMA, 'scope': SCOPE, 'status': 'drift' if changes else 'equivalent', 'changed_paths': changes}


class SafeParser(argparse.ArgumentParser):
    def error(self, message):
        raise InvalidSnapshot('invalid_cli_arguments')


def main(argv=None):
    try:
        parser = SafeParser(description=__doc__)
        commands = parser.add_subparsers(dest='command', required=True)
        source = commands.add_parser('source')
        source.add_argument('--input', required=True)
        source.add_argument('--output', required=True)
        observed = commands.add_parser('observed')
        observed.add_argument('--body', required=True)
        observed.add_argument('--receipt', required=True)
        observed.add_argument('--output', required=True)
        compare = commands.add_parser('compare')
        compare.add_argument('expected')
        compare.add_argument('observed')
        args = parser.parse_args(argv)
        if args.command == 'compare':
            result = compare_projections(read_json(args.expected), read_json(args.observed))
            print(json.dumps(result, sort_keys=True))
            return 1 if result['status'] == 'drift' else 0
        result = (project_source(read_json(args.input)) if args.command == 'source'
                  else project_observed(args.body, read_json(args.receipt)))
        # Never replace an existing output, including a caller's input or earlier proof.
        with Path(args.output).open('x', encoding='utf-8') as stream:
            stream.write(json.dumps(result, indent=2, sort_keys=True) + '\n')
        print(json.dumps({'status': 'projected', 'schema': SCHEMA, 'origin': result['origin']}))
        return 0
    except InvalidSnapshot as error:
        print(json.dumps({'status': 'invalid', 'reason': str(error)}, sort_keys=True))
        return 2
    except (OSError, ValueError, TypeError, KeyError, RecursionError, UnicodeError):
        print(json.dumps({'status': 'invalid', 'reason': 'unreadable_or_invalid_input'}, sort_keys=True))
        return 2


if __name__ == '__main__':
    sys.exit(main())
