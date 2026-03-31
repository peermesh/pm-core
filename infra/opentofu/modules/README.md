# OpenTofu Modules

This directory contains provider-agnostic module contracts for pilot infrastructure scope.

Current modules:

- `pilot-contract`: captures the single-VPS host/DNS/firewall contract summary while enforcing runtime boundary invariants.
- `phase-2-multi-vps-contract`: **non-production scaffold** (`PEERMESH_OPENTOFU_PHASE2_SCAFFOLD_NON_PRODUCTION=1`); placeholder contract locals/outputs only—no provider resources.
