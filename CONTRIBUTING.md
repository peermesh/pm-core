# Contributing

## Development Setup

```bash
git clone https://github.com/peermesh/docker-lab.git
cd docker-lab
cp .env.example .env
./scripts/generate-secrets.sh
```

## Required Checks Before PR

1. Validate deployment inputs
```bash
./scripts/deploy.sh --validate
```

2. Validate per-app encrypted secrets contract
```bash
just validate ghost production
```

3. Validate compose output
```bash
docker compose -f docker-compose.yml config -q
```

## Secrets Rules

- Never commit plaintext secret files.
- Use encrypted bundles in `secrets/*.enc.yaml`.
- Keep `secrets/.sops.yaml` updated with valid recipients.

Enable the pre-commit guard:

```bash
git config core.hooksPath .githooks
```

## Commit Scope

- Keep infrastructure and docs changes grouped by concern.
- Include migration notes when changing compose contracts.
- Update related docs when changing scripts or profile behavior.

## Pull Request Checklist

- [ ] Change is documented
- [ ] Validation commands pass
- [ ] No plaintext credentials are staged
- [ ] Profile-specific behavior is tested
