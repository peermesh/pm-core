# Secrets Workflow

This directory supports a progressive secrets model:

- Tier 1: local development with plain `.env` and local `secrets/*` files (never committed)
- Tier 2: encrypted environment bundles with SOPS + age (`*.enc.yaml`, commit-safe)
- Tier 3: per-app secret contracts (`examples/*/secrets-required.txt`)

## Files

- `.sops.yaml` - active SOPS creation rules (committed)
- `.sops.yaml.example` - verbose template and onboarding reference
- `production.enc.yaml` - encrypted production env bundle
- `staging.enc.yaml` - encrypted staging env bundle
- `development.enc.yaml` - encrypted development env bundle
- `justfile` - secrets lifecycle tooling
- `lib/secrets-lib.sh` - shared shell library for secrets commands
- `keysets/` - canonical/compatibility keyset contract used by parity validation

## Tier 1: Local Development

Use local files while iterating quickly.

```bash
cp .env.example .env
./scripts/generate-secrets.sh --profiles postgresql,ghost
```

Do not commit plaintext secret files.

## Tier 2: Encrypted Bundles (SOPS + age)

Prerequisites:
- `sops`
- `age`

Generate key if needed:
```bash
mkdir -p ~/.config/sops/age
age-keygen -o ~/.config/sops/age/keys.txt
chmod 600 ~/.config/sops/age/keys.txt
```

Encrypt/update bundles:
```bash
# from repo root
just validate ghost production
```

Deploy with encrypted env data:
```bash
cd secrets
just deploy production
```

## Tier 3: Per-App Contracts

Each app should define:
- `.env.example` for app-specific non-secret settings
- `secrets-required.txt` for mandatory secrets

Validation command:
```bash
# from repo root
just validate ghost production
just validate matrix production
just validate peertube production

# contract parity (canonical + compatibility + compose + bundles)
just validate-secrets production
```

## Rotation Policy

Recommended cadence:
- High-value auth secrets: every 90 days
- DB/service account passwords: every 90-180 days
- Recovery/admin credentials: immediately on team changes

Mandatory rotation triggers:
- Team member removal
- Suspected credential exposure
- Infrastructure compromise
- Production incident requiring emergency key reset

After rotation:
1. Update secrets in encrypted bundle
2. Redeploy affected services
3. Verify health checks
4. Record change in changelog or operations notes

## Rotation + Recovery Drill

Run a deterministic drill with evidence output:

```bash
# simulation mode (non-destructive)
just rotate-drill postgres_password staging

# direct invocation
./scripts/secrets-rotation-recovery-drill.sh --environment staging --key postgres_password
```

Evidence default path: `/tmp/pmdl-secrets-drills/`.

## Hook Setup

Enable the included pre-commit plaintext blocker:

```bash
git config core.hooksPath .githooks
```

The hook blocks accidental commits of plaintext secret artifacts.
