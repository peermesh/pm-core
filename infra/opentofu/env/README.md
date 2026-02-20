# Environment Contract

Purpose: variable contract and environment-specific input examples for pilot execution.

Tracked example:

- `pilot-single-vps.auto.tfvars.example`

Usage:

```bash
./infra/opentofu/scripts/tofu.sh -chdir=infra/opentofu/stacks/pilot-single-vps plan \
  -var-file=../../env/pilot-single-vps.auto.tfvars.example
```

Strict apply-readiness rule:

1. `pilot-apply-readiness.sh` rejects `*.example` var files unless `--allow-example-inputs` is explicitly set for dry-run evidence.
2. Live apply workflows must use an untracked, operator-provided var file path.

Required variable names and defaults policy are defined in:

- `/Users/grig/work/peermesh/repo/knowledge-graph-lab-alpha/.dev/modules/peer-mesh-docker-lab/.dev/ai/research/opentofu-integration/OPENTOFU-PILOT-SCAFFOLD-AND-STATE-POLICY.md`
