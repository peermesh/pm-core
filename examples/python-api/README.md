# Python API Example (HTTPBin)

Python API example profile using HTTPBin to validate API-style deployment and routing behavior.

## Profiles Required
- Foundation (`docker-compose.yml`)
- Python API example (`examples/python-api/docker-compose.python-api.yml`)

## Quick Start
```bash
cp examples/python-api/.env.example examples/python-api/.env

docker compose \
  -f docker-compose.yml \
  -f examples/python-api/docker-compose.python-api.yml \
  --profile python-api \
  up -d
```

## Smoke Check
```bash
./scripts/testing/smoke-example-app.sh --app python-api --base-url https://api.example.com
```

## Notes
- This profile is intentionally stateless and low-resource.
- Use it as the baseline for Python API routing, headers, and edge behavior.
