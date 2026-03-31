#!/usr/bin/env bash
# deterministic third-party inventory for sub-repos/core (compose images, go.mod, npm lockfiles)
set -euo pipefail

usage() {
  printf '%s\n' "usage: $(basename "$0") [--write | --check]" >&2
  printf '%s\n' "  default: print full THIRD_PARTY_NOTICES.md to stdout" >&2
  printf '%s\n' "  --write: update THIRD_PARTY_NOTICES.md under core root" >&2
  printf '%s\n' "  --check: exit 1 if THIRD_PARTY_NOTICES.md differs from generated output" >&2
}

CORE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_MD="${CORE_ROOT}/THIRD_PARTY_NOTICES.md"
MODE="stdout"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --write) MODE="write" ;;
    --check) MODE="check" ;;
    -h | --help) usage; exit 0 ;;
    *) printf 'unknown arg: %s\n' "$1" >&2; usage; exit 2 ;;
  esac
  shift
done

export LC_ALL=C

collect_compose_images() {
  # prints: image<TAB>relative_path_to_compose
  find "${CORE_ROOT}" -type f \( -name 'docker-compose*.yml' -o -name 'docker-compose*.yaml' \) \
    -not -path '*/.git/*' \
    -not -path '*/node_modules/*' 2>/dev/null \
    | sort \
    | while read -r f; do
        rel="${f#"${CORE_ROOT}"/}"
        while IFS= read -r line; do
          img="${line#image:}"
          img="${img#"${img%%[![:space:]]*}"}"
          img="${img%${img##*[![:space:]]}}"
          img="${img#\"}"
          img="${img%\"}"
          img="${img#\'}"
          img="${img%\'}"
          [[ -n "${img}" ]] || continue
          printf '%s\t%s\n' "${img}" "${rel}"
        done < <(grep -E '^[[:space:]]+image:[[:space:]]+' "$f" 2>/dev/null | sed -E 's/^[[:space:]]+image:[[:space:]]+//')
      done
}

section_compose_images() {
  printf '%s\n' "## Container images (compose)"
  printf '%s\n' ""
  printf '%s\n' "Extracted from \`docker-compose*.yml\` / \`docker-compose*.yaml\` under this tree (sorted, de-duplicated by image)."
  printf '%s\n' ""
  local tmp
  tmp="$(mktemp)"
  collect_compose_images | sort -t $'\t' -k1,1 -k2,2 -u >"${tmp}"
  if [[ ! -s "${tmp}" ]]; then
    printf '%s\n' "_No image directives found._"
    rm -f "${tmp}"
    printf '%s\n' ""
    return
  fi
  local cur=""
  while IFS=$'\t' read -r img rel; do
    if [[ "${img}" != "${cur}" ]]; then
      [[ -z "${cur}" ]] || printf '%s\n' ""
      printf '%s\n' "### \`${img}\`"
      cur="${img}"
    fi
    printf '%s\n' "- \`${rel}\`"
  done <"${tmp}"
  rm -f "${tmp}"
  printf '%s\n' ""
}

section_go_modules() {
  printf '%s\n' "## Go modules"
  printf '%s\n' ""
  local found=0
  while IFS= read -r gomod; do
    found=1
    rel="${gomod#"${CORE_ROOT}"/}"
    printf '%s\n' "### \`${rel}\`"
    printf '%s\n' ""
    if grep -qE '^[[:space:]]*require[[:space:]]+\(' "${gomod}"; then
      awk '
        /^require[[:space:]]*\(/ { inb=1; next }
        inb && /^[[:space:]]*\)/ { inb=0; next }
        inb {
          gsub(/^[[:space:]]+|[[:space:]]+$/, "", $0)
          if ($0 == "" || $0 ~ /^\/\//) next
          print "- `" $0 "`"
        }
        !inb && /^require[[:space:]]+/ && $0 !~ /\(/ {
          sub(/^require[[:space:]]+/, "", $0)
          print "- `" $0 "`"
        }
      ' "${gomod}"
    elif grep -qE '^require[[:space:]]+[^([]' "${gomod}"; then
      grep -E '^require[[:space:]]+[^([]' "${gomod}" | while read -r _ rest; do
        printf '%s\n' "- \`${rest}\`"
      done
    else
      printf '%s\n' "_No third-party \`require\` entries (stdlib / empty module list)._"
    fi
    printf '%s\n' ""
  done < <(find "${CORE_ROOT}" -type f -name go.mod -not -path '*/.git/*' | sort)
  if [[ "${found}" -eq 0 ]]; then
    printf '%s\n' "_No go.mod files found._"
    printf '%s\n' ""
  fi
}

section_npm_lockfiles() {
  printf '%s\n' "## npm packages (package-lock.json)"
  printf '%s\n' ""
  python3 - "${CORE_ROOT}" <<'PY'
import json
import os
import sys

root = sys.argv[1]
locks = []
for dirpath, dirnames, filenames in os.walk(root):
    parts = set(dirpath.split(os.sep))
    if "node_modules" in parts or ".git" in parts:
        continue
    if "package-lock.json" in filenames:
        locks.append(os.path.join(dirpath, "package-lock.json"))
locks.sort()
if not locks:
    print("_No package-lock.json files found._\n")
    raise SystemExit
for path in locks:
    rel = os.path.relpath(path, root)
    print(f"### `{rel}`\n")
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    packages = data.get("packages") or {}
    rows = []
    for key, meta in packages.items():
        if key == "":
            continue
        name = key[13:] if key.startswith("node_modules/") else key
        ver = meta.get("version") or ""
        lic = meta.get("license", "")
        if isinstance(lic, list):
            lic = ", ".join(str(x) for x in lic)
        elif isinstance(lic, dict):
            lic = lic.get("type", "") or str(lic)
        rows.append((name, ver, str(lic)))
    rows.sort(key=lambda r: (r[0].lower(), r[1], r[2]))
    if not rows:
        print("_No packages entry in lockfile._\n")
        continue
    for name, ver, lic in rows:
        licbit = f" — license: `{lic}`" if lic else ""
        print(f"- `{name}` @ `{ver}`{licbit}")
    print()
PY
}

emit_generated_body() {
  printf '%s\n' "## Automated inventory (generated)"
  printf '%s\n' ""
  printf '%s\n' "Regenerate locally:"
  printf '%s\n' ""
  printf '%s\n' '```bash'
  printf '%s\n' "./scripts/generate-third-party-notices.sh --write   # from repo root (parent)"
  printf '%s\n' "# or, from sub-repos/core:"
  printf '%s\n' "./scripts/generate-third-party-notices.sh --write"
  printf '%s\n' '```'
  printf '%s\n' ""
  section_compose_images
  section_go_modules
  section_npm_lockfiles
  printf '%s\n' "_Generator version: third-party-notices v1 (bash + python3 stdlib)._"
  printf '%s\n' ""
}

emit_full_document() {
  cat <<'EOF'
# Third-party notices

## Scope

This repository combines **original PeerMesh materials** (licensed under PolyForm Noncommercial 1.0.0; see [`LICENSE`](LICENSE)) with **third-party components**. Third-party software, data, and container images **remain under their own licenses**. The project license does **not** apply to them and does **not** grant rights to third-party trademarks.

This file includes a **machine-assisted inventory** (compose image lines, Go `require` summaries, npm lockfile packages). It is **not** a complete legal attribution list. Maintain a full bill of materials for production distributions (for example via SBOM tools). See [`DEPENDENCY-LICENSE-POLICY.md`](DEPENDENCY-LICENSE-POLICY.md).

## Container images and runtime services

Docker Compose profiles pull upstream images (for example reverse proxy, databases, caches, object storage, observability). Each image is subject to its **upstream license** and notices on the registry or inside the image. The **Automated inventory** section lists `image:` references found under this tree.

## Go modules

Go code under `services/` uses modules declared in `go.mod`. Third-party modules are listed in the **Automated inventory** section when present.

## JavaScript / Node dependencies

Projects using `package-lock.json` list resolved packages (with SPDX `license` fields when present) in the **Automated inventory** section.

## OpenTofu / Terraform providers

Infrastructure code under `infra/opentofu/` uses providers and modules governed by their respective licenses and provider terms.

## Example and template content

`examples/`, `foundation/templates/`, and similar paths may reference **upstream patterns** or **sample applications**. Treat those as separate projects for licensing when copied or deployed.

EOF
  emit_generated_body
}

gen_to_file() {
  local target="$1"
  emit_full_document >"${target}"
}

case "${MODE}" in
  stdout) emit_full_document ;;
  write) gen_to_file "${OUT_MD}" ;;
  check)
    tmp="$(mktemp)"
    gen_to_file "${tmp}"
    if ! diff -u "${OUT_MD}" "${tmp}"; then
      rm -f "${tmp}"
      printf '%s\n' "THIRD_PARTY_NOTICES.md is out of date; run: ./scripts/generate-third-party-notices.sh --write" >&2
      exit 1
    fi
    rm -f "${tmp}"
    ;;
esac
