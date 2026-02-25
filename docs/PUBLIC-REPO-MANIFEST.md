# Public Repository Manifest

This repository is intended to remain safe for open-source publication.

## Public (Commit)

- `docker-compose*.yml`
- `profiles/`
- `examples/`
- `domains/`
- `scripts/`
- `docs/`
- `secrets/*.enc.yaml`
- `secrets/.sops.yaml`
- `secrets/.sops.yaml.example`
- `secrets/README.md`
- `secrets/justfile`

## Private / Local-Only (Do Not Commit)

- `.env`
- plaintext secret files under `secrets/` (except explicitly allow-listed metadata)
- private keys (`*.key`, `*.pem`, deploy keys)
- local machine config overrides

## Sanitization Rules

Before release:

1. Replace host-specific domains with neutral examples where they are not required.
2. Ensure no absolute workstation paths remain.
3. Ensure references to AI workspaces do not require child `.dev/` directories.
4. Run pre-commit secret checks and encrypted secrets validation.

## Standalone Validation

```bash
# from repository root
./scripts/deploy.sh --validate

docker compose -f docker-compose.yml -f docker-compose.dc.yml config -q
```
