# phase-2-multi-vps stack (non-production scaffold)

**`PEERMESH_OPENTOFU_PHASE2_SCAFFOLD_NON_PRODUCTION=1`**

This stack is a **non-production** execution scaffold for **Phase-2 multi-VPS** design. It composes the placeholder module `modules/phase-2-multi-vps-contract` only.

Rules:

- Do **not** `tofu apply` this stack for production workloads.
- Do **not** commit state, secrets, or `.auto.tfvars` with real credentials under this path.
- Pilot single-VPS (`stacks/pilot-single-vps/`) remains the validated single-host path; this stack does not replace or modify it.

When Phase-2 is ready for implementation, replace placeholder locals with real modules and add env/backend docs under `env/` following the pilot pattern.
