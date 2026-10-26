#!/usr/bin/env python3
"""Compare five standalone database services with the canonical root Compose.

Only `docker compose config` is executed. Deployment env/secret files are not
loaded. Reports contain differing field paths, never configuration values.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

FRAGMENTS = {
    'postgres': 'profiles/postgresql/docker-compose.postgresql.yml',
    'mysql': 'profiles/mysql/docker-compose.mysql.yml',
    'mongodb': 'profiles/mongodb/docker-compose.mongodb.yml',
    'redis': 'profiles/redis/docker-compose.redis.yml',
    'minio': 'profiles/minio/docker-compose.minio.yml',
}


def render_compose(path, fixture_dir, raw=False):
    """Return a Compose model with an isolated, synthetic interpolation env."""
    environment = {
        'PATH': os.environ.get('PATH', os.defpath), 'HOME': str(fixture_dir),
        'COMPOSE_DISABLE_ENV_FILE': 'true', 'DOMAIN': 'compose-gate.invalid',
        'ADMIN_EMAIL': 'compose-gate@example.invalid',
        'TRAEFIK_DASHBOARD_AUTH': 'fixture-only-not-a-live-credential',
        'TRAEFIK_ACME_CASERVER': 'https://acme.example.invalid/directory',
    }
    command = ['docker', 'compose', '--project-directory', str(path.parent),
               '--env-file', str(fixture_dir / 'fixture.env'), '--project-name',
               'pmdl-equivalence', '--profile', '*', '-f', str(path),
               'config', '--no-env-resolution', '--format', 'json']
    if raw:
        # The second view preserves ${VAR:?required} and defaults, which a
        # single interpolated fixture value cannot prove equivalent.
        command += ['--no-interpolate', '--no-normalize', '--no-path-resolution']
    response = subprocess.run(command, env=environment, capture_output=True, text=True, timeout=30)
    if response.returncode:
        raise ValueError(f'Compose render refused {path.name}; exit={response.returncode}; raw={raw}')
    return json.loads(response.stdout)


def service_closure(model, initial):
    """Include service dependencies, including shared service namespaces."""
    selected, pending = set(), [initial]
    while pending:
        name = pending.pop()
        if name in selected:
            continue
        service = model.get('services', {}).get(name)
        if service is None:
            raise ValueError(f'Required service absent: {name}')
        selected.add(name)
        pending.extend(service.get('depends_on', []))
        for field in ['network_mode', 'ipc', 'pid']:
            value = service.get(field, '')
            if isinstance(value, str) and value.startswith('service:'):
                pending.append(value.split(':', 1)[1])
        pending.extend(link.split(':', 1)[0] for link in service.get('links', []))
        pending.extend(value.split(':', 1)[0] for value in service.get('volumes_from', []) if not value.startswith('container:'))
    return selected


def project_model(model, initial):
    """Keep complete service settings and every referenced resource definition."""
    services = service_closure(model, initial)
    result = {'services': {name: model['services'][name] for name in sorted(services)}}
    for category in ['networks', 'volumes', 'secrets', 'configs']:
        names = set()
        for service in result['services'].values():
            values = service.get(category, [])
            for value in values:
                if isinstance(value, dict):
                    name = value.get('source')
                    if category == 'volumes' and value.get('type') == 'bind':
                        continue
                else:
                    name = value.split(':', 1)[0]
                if name in model.get(category, {}):
                    names.add(name)
        result[category] = {name: model[category][name] for name in sorted(names)}
    return result


def difference_paths(expected, actual, prefix=''):
    """Return differing JSON field paths without exporting either value."""
    if isinstance(expected, dict) and isinstance(actual, dict):
        found = []
        for name in sorted(set(expected) | set(actual)):
            path = prefix + '/' + name.replace('~', '~0').replace('/', '~1')
            if name not in expected or name not in actual:
                found.append(path)
            else:
                found.extend(difference_paths(expected[name], actual[name], path))
        return found
    return [] if expected == actual else [prefix or '/']


def interpolation_contract(value, path=''):
    """Preserve variable names, required operators and defaults at each field."""
    contract = {}
    if isinstance(value, dict):
        for key, child in value.items():
            contract.update(interpolation_contract(child, path + '/' + key))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            contract.update(interpolation_contract(child, path + '/' + str(index)))
    elif isinstance(value, str):
        expressions = re.findall(r'(?<!\$)\$\{[^}]*\}|(?<!\$)\$[A-Za-z_][A-Za-z0-9_]*', value)
        if expressions:
            contract[path] = expressions
    return contract


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[2])
    args = parser.parse_args()
    root = args.root.resolve()
    results = []
    with tempfile.TemporaryDirectory(prefix='core-compose-equivalence-') as temporary:
        fixture = Path(temporary)
        (fixture / 'fixture.env').write_text('# Synthetic validation only; no deployment env loaded.\n')
        try:
            canonical = render_compose(root / 'docker-compose.yml', fixture)
            canonical_raw = render_compose(root / 'docker-compose.yml', fixture, raw=True)
            for service, fragment in FRAGMENTS.items():
                rendered = render_compose(root / fragment, fixture)
                raw = render_compose(root / fragment, fixture, raw=True)
                paths = difference_paths(project_model(canonical, service), project_model(rendered, service))
                variable_paths = difference_paths(
                    interpolation_contract(project_model(canonical_raw, service)),
                    interpolation_contract(project_model(raw, service)))
                results.append({'service': service, 'fragment': fragment,
                                'equivalent': not paths and not variable_paths,
                                'changed_paths': paths, 'variable_contract_paths': variable_paths})
        except (ValueError, KeyError, OSError, subprocess.TimeoutExpired):
            # Parser stderr can include interpolated data. Fail closed without
            # printing it, including for an unsupported Compose CLI version.
            print(json.dumps({'status': 'RENDER_ERROR', 'results': results}))
            return 2
    passed = all(row['equivalent'] for row in results) and len(results) == len(FRAGMENTS)
    print(json.dumps({'status': 'PASS' if passed else 'DIVERGED', 'results': results}, indent=2))
    return 0 if passed else 1


if __name__ == '__main__':
    raise SystemExit(main())
