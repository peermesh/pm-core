# Third-party notices

## Scope

This repository combines **original PeerMesh materials** (licensed under PolyForm Noncommercial 1.0.0; see [`LICENSE`](LICENSE)) with **third-party components**. Third-party software, data, and container images **remain under their own licenses**. The project license does **not** apply to them and does **not** grant rights to third-party trademarks.

Nothing in this file is a complete inventory; it lists **known categories** and **examples** visible in this tree. Maintain a full bill of materials for production distributions (for example via SBOM tools). See [`DEPENDENCY-LICENSE-POLICY.md`](DEPENDENCY-LICENSE-POLICY.md).

## Container images and runtime services

Docker Compose profiles pull upstream images (for example reverse proxy, databases, caches, object storage, observability). Each image is subject to its **upstream license** and notices on the registry or inside the image.

## Go modules

The dashboard service and other Go code under `services/` (for example `services/dashboard/go.mod`) depend on open-source modules listed in `go.sum` / `go.mod`. Each module is under its own license (see module documentation and SPDX identifiers where published).

## JavaScript / Node dependencies

Modules such as `modules/social/app/` use `package.json` / `package-lock.json`. Dependencies are each under their own license; see their packages and `LICENSE` fields.

## OpenTofu / Terraform providers

Infrastructure code under `infra/opentofu/` uses providers and modules governed by their respective licenses and provider terms.

## Example and template content

`examples/`, `foundation/templates/`, and similar paths may reference **upstream patterns** or **sample applications**. Treat those as separate projects for licensing when copied or deployed.

## Placeholder: additional vendored or copied code

- **Placeholder —** List any vendored directories, Git submodules, or large snippets with pointers to their LICENSE files.
