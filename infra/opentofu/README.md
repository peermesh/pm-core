# OpenTofu Infrastructure Layer (Pilot)

This directory contains the OpenTofu infrastructure layer for Docker Lab.

Boundary rules:

1. OpenTofu provisions infrastructure prerequisites only.
2. Docker Compose + webhook pull-deploy remain runtime source of truth.
3. Multi-VPS extension is blocked until single-VPS validation evidence exists.

Canonical deployment model:

1. OpenTofu provisions infra resources through provider APIs.
2. Docker Lab runtime deploys foundation and modules on that infra.

Reference:

- `docs/OPENTOFU-DEPLOYMENT-MODEL.md`

Authoritative planning/policy document:

- Maintained separately in the PeerMeshCore workspace; reach out to owners for access to the pilot state policy

Current layout:

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
    pilot-credentials.sh
    pilot-apply-readiness.sh
  state-backups/
    README.md
```

Current status:

1. Safety/readiness workflows are implemented.
2. Stack now includes provider-backed pilot resources (Hetzner network/firewall/server + optional Cloudflare DNS record).
3. Runtime ownership boundary remains enforced (`manage_runtime_services=false`, `runtime_boundary_mode=compose-webhook-authoritative`).

Operational contract:

1. Never commit state payloads or credentials.
2. Mandatory state backup before any `tofu apply` or `tofu destroy`.
3. Keep naming consistent with `pilot-single-vps` environment key.

Quick start:

```bash
# From repository root
./infra/opentofu/scripts/tofu.sh version
./infra/opentofu/scripts/pilot-preflight.sh
./infra/opentofu/scripts/pilot-credentials.sh --help
./infra/opentofu/scripts/pilot-apply-readiness.sh --help
```

Hetzner-first provider usage:

1. Set `compute_provider = "hetzner"` in your live var file.
2. Capture provider credentials with the secure credential manager (default file is outside git: `~/.config/docker-lab/opentofu/pilot-single-vps.credentials.env`).
3. If DNS is Cloudflare, set `dns_provider = "cloudflare"` and capture `CLOUDFLARE_API_TOKEN` in the same credential file.

Recommended credential flow:

```bash
# 0) Bootstrap credential file (outside git)
mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}/docker-lab/opentofu"
cp ./infra/opentofu/env/pilot-single-vps.credentials.env.example \
  "${XDG_CONFIG_HOME:-$HOME/.config}/docker-lab/opentofu/pilot-single-vps.credentials.env"
chmod 600 "${XDG_CONFIG_HOME:-$HOME/.config}/docker-lab/opentofu/pilot-single-vps.credentials.env"

# 1) Enter/update required provider keys (hidden prompt, secure file mode 600)
./infra/opentofu/scripts/pilot-credentials.sh setup \
  --var-file /absolute/path/to/pilot-single-vps.auto.tfvars

# 2) Check key presence without printing values
./infra/opentofu/scripts/pilot-credentials.sh status \
  --var-file /absolute/path/to/pilot-single-vps.auto.tfvars
```

Apply-readiness gate (required before any mutating apply):

1. `OPENTOFU_PILOT_APPLY_APPROVED=true` must be set.
2. `OPENTOFU_PILOT_CHANGE_REF=<WO-or-change-id>` must be set.
3. Provider credentials are loaded from `--env-file` (or shell env), based on vars derived from `compute_provider`/`dns_provider`.
4. Example var/backend files are rejected in strict mode unless `--allow-example-inputs` is explicitly provided for dry-run evidence.
