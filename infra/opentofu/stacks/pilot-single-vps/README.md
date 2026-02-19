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
