# Contributing to Hello Core Module

Welcome! `modules/hello-core` is a near-stock example of the standalone hello module that ships with
PeerMesh Core. If you would like to improve it:

1. Keep the manifest aligned with `foundation/schemas/module.schema.json` and the rest of the module
   system (`lifecycle`, `dashboard`, `config`, `provides`, `requires`, `security`).
2. When you touch `docker-compose.yml`, keep the `extends` block pointing at
   `../../foundation/docker-compose.base.yml` so resource limits stay consistent.
3. Update the text files (README, dashboard assets, and README) so they describe the Hello Core Module
   rather than the original standalone example.
4. Run `./tests/smoke-test.sh` after making changes to the runtime behavior.

If you are adding new files, follow the project conventions for licensing (MIT) and formatting (bash
hooks should have `set -euo pipefail`, etc.).
