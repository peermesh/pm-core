# WordPress Example

WordPress example profile for content/CMS workloads on Docker Lab foundation.

## Profiles Required
- Foundation (`docker-compose.yml`)
- MySQL (`profiles/mysql/docker-compose.mysql.yml`)
- WordPress example (`examples/wordpress/docker-compose.wordpress.yml`)

## Quick Start
```bash
./scripts/generate-secrets.sh
cp examples/wordpress/.env.example examples/wordpress/.env

# If needed, tune DB user/name in examples/wordpress/.env

docker compose \
  -f docker-compose.yml \
  -f profiles/mysql/docker-compose.mysql.yml \
  -f examples/wordpress/docker-compose.wordpress.yml \
  --profile wordpress \
  up -d
```

## Smoke Check
```bash
./scripts/testing/smoke-example-app.sh --app wordpress --base-url https://wordpress.example.com
```

## Notes
- Uses `mysql_app_password` from shared secrets contract.
- Defaults to MySQL `ghost` database/user for compatibility with current profile defaults.
- For dedicated WordPress database/user, align MySQL profile env and this example env before deploy.
