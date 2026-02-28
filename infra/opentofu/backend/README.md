# Backend Profiles

Purpose: backend policy and profile examples for `pilot-single-vps`.

Tracked examples:

- `backend.local.hcl.example`
- `backend.s3.hcl.example`

Usage:

```bash
# Example local init
./infra/opentofu/scripts/tofu.sh -chdir=infra/opentofu/stacks/pilot-single-vps init \
  -backend-config=../../backend/backend.local.hcl.example
```

Policy source:

- `/Users/grig/work/peermesh/repo/peer-mesh-docker-lab/.dev/ai/research/opentofu-integration/OPENTOFU-PILOT-SCAFFOLD-AND-STATE-POLICY.md`
