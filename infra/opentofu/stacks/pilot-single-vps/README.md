# Pilot Stack: single-VPS

This stack composes pilot-scope module contracts into one reproducible single-VPS baseline.

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
OPENTOFU_PILOT_APPLY_APPROVED=true \
OPENTOFU_PILOT_CHANGE_REF=WO-PMDL-2026-02-20-035 \
HCLOUD_TOKEN=... \
CLOUDFLARE_API_TOKEN=... \
./infra/opentofu/scripts/pilot-apply-readiness.sh \
  --var-file /path/to/pilot-single-vps.auto.tfvars \
  --backend-config /path/to/backend.hcl
```

Notes:

1. `pilot-apply-readiness.sh` is fail-closed and blocks apply when required env vars are missing.
2. Provider env requirements are auto-derived from `compute_provider` and `dns_provider` values in the var file.
3. For dry-run evidence only, use `--allow-example-inputs`.
