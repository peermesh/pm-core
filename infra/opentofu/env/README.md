# Environment Contract

Purpose: variable contract and environment-specific input examples for pilot execution.

Tracked example:

- `pilot-single-vps.auto.tfvars.example`

Usage:

```bash
./infra/opentofu/scripts/tofu.sh -chdir=infra/opentofu/stacks/pilot-single-vps plan \
  -var-file=../../env/pilot-single-vps.auto.tfvars.example
```

Required variable names and defaults policy are defined in:

- `/Users/grig/work/peermesh/repo/knowledge-graph-lab-alpha/.dev/modules/peer-mesh-docker-lab/.dev/ai/research/opentofu-integration/OPENTOFU-PILOT-SCAFFOLD-AND-STATE-POLICY.md`
