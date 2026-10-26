# Contributing

## Development Setup

```bash
git clone https://github.com/peermesh/core.git
cd core
cp .env.example .env
./scripts/generate-secrets.sh
```

Refer to the canonical public install path in [docs/QUICKSTART.md](docs/QUICKSTART.md); that guide mirrors the same clone path and runtime activation steps referenced here.

## Contributor Onboarding Path

1. Read project scope and deployment model in `README.md` and `docs/OPENTOFU-DEPLOYMENT-MODEL.md`.
2. Run validation gates locally before opening a PR.
3. Use issue templates (`Bug`, `Feature`, `Module Request`) for intake consistency.
4. If requested change exceeds quick-fix scope, open/attach a work order in parent workspace governance.

## Required Checks Before PR

1. Validate deployment inputs:
```bash
./scripts/deploy.sh --validate
```
2. Validate per-app encrypted secrets contract:
```bash
just validate ghost production
```
3. Validate compose output:
```bash
make compose-equivalence
docker compose -f docker-compose.yml config -q
```

The equivalence gate compares the PostgreSQL, MySQL, MongoDB, Redis and MinIO
standalone services with `docker-compose.yml`, including their service dependency
closure and referenced networks, volumes, secrets and configs. It uses a synthetic
environment and only runs Compose config parsing. It reports field paths without
values and fails on divergence or a render error. It also checks interpolation
requirements so a fixture default cannot hide a changed required variable.

Standalone fragment paths resolve from the fragment directory. Root-relative
binds and secret/config paths must be rebased there (for example, a root path
`./profiles/postgresql/init-scripts` becomes `./init-scripts`, and root
`./secrets/NAME` becomes `../../secrets/NAME`). Paths are compared after Compose
resolution; security, runtime and credential requirements are not ignored.
Optional services outside the five selected services and their dependency closure
remain outside this gate. A failing baseline must be reconciled, not allowlisted.
4. Run supply-chain validation (if Docker images changed):
```bash
./scripts/security/validate-supply-chain.sh
```

This runs three gates:
- Image policy compliance
- SBOM generation
- Vulnerability threshold gate

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

- [ ] Change is documented.
- [ ] Validation commands pass.
- [ ] No plaintext credentials are staged.
- [ ] Profile-specific behavior is tested.
- [ ] Supply-chain validation gates pass (if Docker images changed).

## Community Process

- Issue intake SLA: first maintainer response within 48 hours.
- Security disclosures use private advisory flow (see issue template config).
- Use labels: `triage`, `bug`, `enhancement`, `module-request`, `good first issue`, `help wanted`, `security`.
