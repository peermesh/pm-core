#!/usr/bin/env bash
# todo-oriented skeleton for dependency license auditing; safe no-op (prints only)
set -euo pipefail

printf '%s\n' "# Third-party license audit — TODO report"
printf '%s\n' ""
printf '%s\n' "This script does not scan the repository. Use the checklist below and update THIRD_PARTY_NOTICES.md."
printf '%s\n' ""
printf '%s\n' "## Container images"
printf '%s\n' "- [ ] Extract image:tag from docker compose files and profiles"
printf '%s\n' "- [ ] For each image: record license + notice URL or path"
printf '%s\n' ""
printf '%s\n' "## Language packages"
printf '%s\n' "- [ ] Go: review go.mod / go.sum under services and modules"
printf '%s\n' "- [ ] Node: review package-lock.json where present"
printf '%s\n' "- [ ] Add other ecosystems (Python, Ruby, etc.) if introduced"
printf '%s\n' ""
printf '%s\n' "## Vendored code, submodules, large snippets"
printf '%s\n' "- [ ] List paths; attach upstream LICENSE references"
printf '%s\n' ""
printf '%s\n' "## Distribution (images, binaries, archives)"
printf '%s\n' "- [ ] Generate or attach SBOM / SPDX for anything you ship to users"
printf '%s\n' ""
