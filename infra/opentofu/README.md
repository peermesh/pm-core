# OpenTofu Infrastructure Scaffold (Pilot)

This directory contains the executable OpenTofu pilot scaffold for Docker Lab.

Boundary rules:

1. OpenTofu provisions infrastructure prerequisites only.
2. Docker Compose + webhook pull-deploy remain runtime source of truth.
3. Multi-VPS extension is blocked until single-VPS validation evidence exists.

Authoritative planning/policy document:

- `/Users/grig/work/peermesh/repo/knowledge-graph-lab-alpha/.dev/modules/peer-mesh-docker-lab/.dev/ai/research/opentofu-integration/OPENTOFU-PILOT-SCAFFOLD-AND-STATE-POLICY.md`

Current scaffold:

```text
infra/opentofu/
  README.md
  .gitignore
  backend/
    README.md
    backend.local.hcl.example
    backend.s3.hcl.example
  env/
    README.md
    pilot-single-vps.auto.tfvars.example
  modules/
    README.md
    pilot-contract/
      variables.tf
      main.tf
      outputs.tf
  stacks/
    pilot-single-vps/
      README.md
      versions.tf
      variables.tf
      main.tf
      outputs.tf
  scripts/
    tofu.sh
    state-backup.sh
    pilot-preflight.sh
  state-backups/
    README.md
```

Operational contract:

1. Never commit state payloads or credentials.
2. Mandatory state backup before any `tofu apply` or `tofu destroy`.
3. Keep naming consistent with `pilot-single-vps` environment key.

Quick start:

```bash
# From sub-repos/docker-lab
./infra/opentofu/scripts/tofu.sh version
./infra/opentofu/scripts/pilot-preflight.sh
./infra/opentofu/scripts/pilot-apply-readiness.sh --help
```

Apply-readiness gate (required before any mutating apply):

1. `OPENTOFU_PILOT_APPLY_APPROVED=true` must be set.
2. `OPENTOFU_PILOT_CHANGE_REF=<WO-or-change-id>` must be set.
3. Provider credential env vars must be present (derived from `compute_provider`/`dns_provider`, or provided via `--require-env` / `OPENTOFU_REQUIRED_ENV`).
4. Example var/backend files are rejected in strict mode unless `--allow-example-inputs` is explicitly provided for dry-run evidence.
