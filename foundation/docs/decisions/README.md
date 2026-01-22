# Foundation Architecture Decisions

This directory provides convenient access to the **foundation-layer ADRs** that define the core infrastructure patterns.

## Symlink Structure

All files in this directory are symlinks to the canonical ADRs in `docs/decisions/`. This design:

- **Single source of truth**: ADRs live in one place (`docs/decisions/`)
- **Convenient access**: Foundation-specific ADRs accessible from foundation context
- **No duplication**: Changes to ADRs automatically reflected here

## Foundation ADRs (0001-0004)

| ADR | Title | Description |
|-----|-------|-------------|
| [0001](./0001-traefik-reverse-proxy.md) | Traefik as Reverse Proxy | Why Traefik over Caddy/nginx for reverse proxy |
| [0002](./0002-four-network-topology.md) | Four-Network Topology | Security network architecture |
| [0003](./0003-file-based-secrets.md) | File-Based Secrets | Secrets via `_FILE` suffix pattern |
| [0004](./0004-docker-socket-proxy.md) | Docker Socket Proxy | Filtered Docker API access |

## Legacy Reference Mapping

Historical documentation may reference decisions using the legacy "D#.#" naming scheme. Here's the mapping:

| Legacy Reference | Current ADR |
|------------------|-------------|
| D1.1 Reverse Proxy | [ADR-0001](./0001-traefik-reverse-proxy.md) |
| D3.1 Secret Management | [ADR-0003](./0003-file-based-secrets.md) |
| D3.2 Container Security | [ADR-0004](./0004-docker-socket-proxy.md), [ADR-0200](../../../docs/decisions/0200-non-root-containers.md) |
| D3.3 Network Isolation | [ADR-0002](./0002-four-network-topology.md) |
| D4.1 Health Checks | [ADR-0300](../../../docs/decisions/0300-health-check-strategy.md) |
| D4.3 Startup Ordering | [ADR-0300](../../../docs/decisions/0300-health-check-strategy.md) |
| D2.4 Backup Recovery | [ADR-0300](../../../docs/decisions/0300-health-check-strategy.md) (backup context) |

## Full Decision Index

For all ADRs including databases, security, operations, and structure, see the [complete ADR Index](../../../docs/decisions/INDEX.md).

---

*Created: 2026-01-21*
*Part of Architecture Cleanup WO-001 Phase 5-6*
