# Dependency and distribution license policy

This document explains how the **project license** (`LICENSE`, PolyForm Noncommercial 1.0.0) relates to **third-party** components. It is guidance for maintainers and distributors; it is not legal advice.

## What the project license covers

- **Covers:** Original creative work committed in this repository by the copyright holder (see [`COPYRIGHT`](COPYRIGHT))—for example foundation scripts, Compose profiles, module scaffolding, Go services, and first-party documentation that are not substantially copied from third-party sources.
- **Does not replace:** Licenses that apply to dependencies, vendor code, container **images**, OS packages inside images, or upstream applications.

## What stays under third-party terms

- **Container images** pulled from registries remain under their respective upstream licenses and image metadata.
- **Go modules, npm packages, and other package ecosystems** (for example under `services/dashboard/`, `modules/*/app/`) remain under their own licenses.
- **Infrastructure tooling** (for example OpenTofu providers) is governed by their respective terms.

## Obligations checklist (typical)

When you distribute this project or artifacts built from it, verify compliance for **each** third-party component you ship or cause to be pulled:

- **Attribution:** Preserve copyright notices and license texts where required.
- **License notices:** Include or link to the license for copyleft or notice-dependent licenses when you distribute corresponding binaries or sources.
- **Source offer:** For licenses that require it when distributing combined works, provide source or a written offer as required by that license.
- **Trademarks:** Do not imply endorsement; respect upstream trademark policies.

## Distribution: repos, containers, and images

- **Source repository:** Keep [`LICENSE`](LICENSE), [`COPYRIGHT`](COPYRIGHT), [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md), and this file accurate as the bill of materials evolves.
- **Container images you build:** Document base images and installed packages; reproduce required notices as appropriate.
- **Pre-built images you publish:** Prefer scanning tools (SBOM, SPDX, CycloneDX) and attach a third-party notice bundle for any image you ship to customers.

## Relationship to PolyForm Noncommercial

The PolyForm Noncommercial terms apply to **this project’s original work** as licensed by the copyright holder. Third-party components are **not** relicensed by PolyForm; you must comply with their license terms in parallel.
