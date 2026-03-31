# phase-2-multi-vps-contract (non-production scaffold)

**`PEERMESH_OPENTOFU_PHASE2_SCAFFOLD_NON_PRODUCTION=1`**

This module is a **non-production** Phase-2 multi-VPS **placeholder**. It emits a contract summary object only; it does **not** declare provider resources. Do not use it for live infrastructure until a dedicated work order promotes it.

Boundary:

- Single-VPS pilot remains authoritative for production-adjacent paths under `stacks/pilot-single-vps/`.
- This tree exists so Phase-2 execution can iterate on module inputs/outputs without mutating the pilot stack.
