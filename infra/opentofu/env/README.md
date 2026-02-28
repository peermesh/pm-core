# Environment Contract

Purpose: variable contract and environment-specific input examples for pilot execution.

Tracked examples:

- `pilot-single-vps.auto.tfvars.example`
- `pilot-single-vps.credentials.env.example`

Canonical credential file (live, untracked):

- `${XDG_CONFIG_HOME:-$HOME/.config}/docker-lab/opentofu/pilot-single-vps.credentials.env`

Usage:

```bash
./infra/opentofu/scripts/tofu.sh -chdir=infra/opentofu/stacks/pilot-single-vps validate

# 0) Create credential file from tracked example (outside git)
mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}/docker-lab/opentofu"
cp ./infra/opentofu/env/pilot-single-vps.credentials.env.example \
  "${XDG_CONFIG_HOME:-$HOME/.config}/docker-lab/opentofu/pilot-single-vps.credentials.env"
chmod 600 "${XDG_CONFIG_HOME:-$HOME/.config}/docker-lab/opentofu/pilot-single-vps.credentials.env"

# For apply-path readiness evidence:
# 1) Capture/update required provider keys in a secure local file (outside git by default)
./infra/opentofu/scripts/pilot-credentials.sh setup \
  --var-file /absolute/path/to/pilot-single-vps.auto.tfvars

# 2) Run readiness gate (credentials loaded from env file)
OPENTOFU_PILOT_APPLY_APPROVED=true \
OPENTOFU_PILOT_CHANGE_REF=WO-PMDL-2026-02-20-036 \
./infra/opentofu/scripts/pilot-apply-readiness.sh \
  --var-file /absolute/path/to/pilot-single-vps.auto.tfvars \
  --env-file "${XDG_CONFIG_HOME:-$HOME/.config}/docker-lab/opentofu/pilot-single-vps.credentials.env"
```

Credential file format (Hetzner-only pilot):

```env
HCLOUD_TOKEN=REPLACE_WITH_HETZNER_API_TOKEN
```

If and only if `dns_provider=cloudflare`:

```env
HCLOUD_TOKEN=REPLACE_WITH_HETZNER_API_TOKEN
CLOUDFLARE_API_TOKEN=REPLACE_WITH_CLOUDFLARE_API_TOKEN
```

Strict apply-readiness rule:

1. `pilot-apply-readiness.sh` rejects `*.example` var files unless `--allow-example-inputs` is explicitly set for dry-run evidence.
2. Live apply workflows must use an untracked, operator-provided var file path.
3. Credential env files must remain untracked and private (`chmod 600`).
4. Do not commit live credential files; only commit `*.example` placeholders.

Required variable names and defaults policy are defined in:

- `/Users/grig/work/peermesh/repo/peer-mesh-docker-lab/.dev/ai/research/opentofu-integration/OPENTOFU-PILOT-SCAFFOLD-AND-STATE-POLICY.md`
