# AGENTS.md - Docker Lab

**Global Rules**: This project follows the universal AI agent rules at `~/.agents/AGENTS.md`

---

## Project Overview

**Docker Lab** is a production-ready Docker Compose boilerplate for self-hosted applications on commodity VPS instances.

**Tech Stack**: Docker Compose, Traefik v3, Go (dashboard), HTMX/Alpine.js (frontend)

**Current Version**: 0.1.0 (Released 2025-12-31)

---

## Key Locations

| Resource | Path |
|----------|------|
| Main README | `README.md` |
| Architecture | `docs/ARCHITECTURE.md` |
| Security Architecture | `docs/SECURITY-ARCHITECTURE.md` |
| ADR Index | `docs/decisions/INDEX.md` |
| Foundation Module System | `foundation/README.md` |
| Profiles | `profiles/README.md` |
| AI Artifacts (Parent) | `../../.dev/ai/` |
| Recovery Snapshots (Parent) | `../../.dev/ai/recovery/` |
| Security Findings (Parent) | `../../.dev/ai/security/SECURITY-FINDINGS.md` |

---

## Child `.dev` Policy

`sub-repos/docker-lab/.dev/` is forbidden in this project.

- Write all AI artifacts to the parent project `.dev/` tree.
- Keep links pointing to `../../.dev/...` (or deeper relative paths as needed).
- If a local `.dev/` is created accidentally, migrate contents to parent and delete it immediately.

---

## External Research Index

**Master Research Index:** `~/.agents/knowledge-sources/project-indexes/2026-02-04_docker-lab_master-index.md`

Key external research topics mapped to this project:

| Topic | External Source |
|-------|-----------------|
| **Microservices & Hot-Pluggable Modules** | `~/Downloads/INBOX-markdown/PeerMesh microservices and hot-pluggable modules.md` |
| Event Bus Patterns | `~/.agents/.dev/ai/master-control/research/decision-event-bus/` |
| Module Architecture | `~/.agents/docs/MODULAR-ARCHITECTURE-GOVERNANCE.md` |
| Config Management | `~/.agents/.dev/ai/research/large-config-management-patterns-research-2025.md` |
| Plugin Architecture | `~/.agents/.dev/ai/proposals/2026-01-19-02-17-34Z-tool-plugin-architecture-proposal.md` |
| Provider Abstraction | `~/.agents/.dev/ai/proposals/2025-12-15-13-06-06-provider-abstraction-harness-integration.md` |
| Message Queues | `~/work/peermesh/repo/peer-mesh-docker-lab/.dev/ai/research/R8-message-queue-messaging-decisions.md` |
| Identity/DID | `~/work/obsidian-vault/🕸️ PeerMesh.org/research/05-decentralized-identity/` |

---

## Development Workflow

### Running the Project

```bash
# Initialize configuration
./launch_peermesh.sh config init

# Start services with profiles
./launch_peermesh.sh up --profile=postgresql,redis

# Check status
./launch_peermesh.sh status

# View logs
./launch_peermesh.sh logs traefik -f
```

### Dashboard Service (Go)

```bash
cd services/dashboard
go build -o dashboard .
```

### Secrets

All secrets are file-based, located in `secrets/` (gitignored). Generate with:

```bash
./scripts/generate-secrets.sh
```

---

## Commit Guidelines

- Use conventional commits: `feat:`, `fix:`, `docs:`, `test:`
- Commit messages should explain the "why" not just "what"
- Keep commits focused and atomic

---

## Project Status

- **MASTER-PLAN Phase 5**: COMPLETE (2026-01-21)
- **Next Phase**: 2.2 - First Real Module (Backup Service)
- **Open Security Finding**: SEC-009 (Content Trust) - Low priority

---

## AI Development Notes

### Work in Progress
- Demo mode implementation complete, pending production deployment
- Glossary documentation uncommitted
- Dashboard handler improvements uncommitted

### Known Issues
- Dashboard detection false positive in `foundation/lib/dashboard-register.sh`
- Foundation CLI install/uninstall are placeholders
- No test coverage for Go code

### Do Not Modify Without Review
- `docker-compose.yml` network topology
- `foundation/schemas/*.json` (affects module compatibility)
- Security-related configurations in `configs/traefik/`

---

*Last updated: 2026-02-18*
