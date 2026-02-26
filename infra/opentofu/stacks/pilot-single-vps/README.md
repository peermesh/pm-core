# Pilot Stack: single-VPS

This stack defines a provider-backed single-VPS baseline (Hetzner-first) with optional Cloudflare DNS record management.

Naming invariant:

- Environment key: `pilot-single-vps`

Gate invariant:

- This stack must pass the single-VPS validation matrix before any multi-VPS extension work starts.

Validation commands:

```bash
./infra/opentofu/scripts/tofu.sh -chdir=infra/opentofu/stacks/pilot-single-vps init -backend=false
./infra/opentofu/scripts/tofu.sh -chdir=infra/opentofu/stacks/pilot-single-vps validate
./infra/opentofu/scripts/pilot-preflight.sh
```

Apply execution gate:

```bash
# Capture/update required provider keys first
./infra/opentofu/scripts/pilot-credentials.sh setup \
  --var-file /path/to/pilot-single-vps.auto.tfvars

OPENTOFU_PILOT_APPLY_APPROVED=true \
OPENTOFU_PILOT_CHANGE_REF=WO-PMDL-2026-02-20-035 \
./infra/opentofu/scripts/pilot-apply-readiness.sh \
  --var-file /path/to/pilot-single-vps.auto.tfvars \
  --env-file "${XDG_CONFIG_HOME:-$HOME/.config}/docker-lab/opentofu/pilot-single-vps.credentials.env" \
  --backend-config /path/to/backend.hcl
```

Notes:

1. `pilot-apply-readiness.sh` is fail-closed and blocks apply when required env vars are missing.
2. Provider env requirements are auto-derived from `compute_provider` and `dns_provider` values in the var file.
3. `pilot-credentials.sh` manages the operator credential file with hidden input prompts and private file permissions.
4. For dry-run evidence only, use `--allow-example-inputs`.
5. Runtime boundary remains strict: OpenTofu provisions infra resources only; Docker Lab runtime remains Compose/webhook authoritative.
