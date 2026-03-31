# PROJECT-RULES.md

This file defines the **public versus private governance boundary** for the PeerMesh Core repository. It is intended to be **distribution-safe**: no operator-only playbooks, machine-local paths, or unpublished policy text.

## What is intentionally public in this repo

- **Contributor workflow** — [CONTRIBUTING.md](CONTRIBUTING.md): setup, validation gates before PR, secrets rules, commit scope, community process.
- **Documentation set** — [docs/README.md](docs/README.md) and linked guides under `docs/` (architecture, security, deployment, modules, ADRs). These are the canonical **public** instructions for building, operating, and extending Core.
- **What may be committed vs local-only** — [docs/PUBLIC-REPO-MANIFEST.md](docs/PUBLIC-REPO-MANIFEST.md): public tree expectations and files that must never be committed.
- **AI tooling entrypoints shipped here** — [CLAUDE.md](CLAUDE.md) and [AGENTS.md](AGENTS.md): pointers and global agent rules as vendored in this tree. **Core-specific** policy for assistants is limited to this file and to public docs above; deeper project workflow may live only in a private or parent workspace.

## What remains private / non-distributed

- **Internal coordination artifacts** — work orders, session handoffs, and governance drafts that live outside this publishable tree (for example in a parent monorepo `.dev/` tree) are not part of the Core distribution and are not required to contribute.
- **Secrets and local configuration** — plaintext env files, keys, and host-specific overrides (see the manifest).
- **Unpublished runbooks or policy** — anything not already represented in `docs/` or [CONTRIBUTING.md](CONTRIBUTING.md).

Do not add absolute filesystem paths, internal backup locations, or credentials to this repository.

## How contributors and operators should proceed

1. Read [README.md](README.md) for product scope and orientation.
2. Follow [CONTRIBUTING.md](CONTRIBUTING.md) for required checks and PR expectations.
3. Use [docs/README.md](docs/README.md) as the index for deeper topics; use [docs/QUICKSTART.md](docs/QUICKSTART.md) for a short install path.
4. Before sharing or syncing a fork, align with [docs/PUBLIC-REPO-MANIFEST.md](docs/PUBLIC-REPO-MANIFEST.md).
5. For AI-assisted work, follow the read order in [CLAUDE.md](CLAUDE.md); use **this file** only for the public/private boundary summary, not for global agent system details inside [AGENTS.md](AGENTS.md).
