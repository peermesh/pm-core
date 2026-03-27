# Decision Provenance

This document traces the research lineage for architectural decisions in the core project. Understanding where decisions came from helps maintainers evaluate changes and contributors understand design rationale.

---

## Research Methodology

Every architectural decision in this project followed a rigorous process:

1. **Reference Material Analysis**: Study patterns across 13+ open-source Docker repositories representing community best practices
2. **Production Pattern Extraction**: Document patterns from real, battle-tested deployments
3. **Multi-Model Synthesis**: Validate decisions across multiple AI models to reduce individual bias
4. **Constraint Checking**: Verify every decision against the 7 non-negotiable constraints
5. **Wave Execution**: Make decisions in dependency order, with validation checkpoints between phases

This methodology prevented both over-engineering (adding unnecessary complexity) and under-engineering (missing critical requirements).

---

## Reference Repositories Studied

The following repositories informed our design patterns. Each was analyzed for specific patterns relevant to our constraints.

### Infrastructure Patterns

| Repository | Maintainer | Patterns Extracted |
|------------|------------|-------------------|
| [docker/awesome-compose](https://github.com/docker/awesome-compose) | Docker Inc. | Service composition patterns, multi-container examples, volume strategies |
| [docker/docker-bench-security](https://github.com/docker/docker-bench-security) | Docker Inc. | CIS benchmark compliance, container hardening checklist, security scanning patterns |
| [docker/compose](https://github.com/docker/compose) | Docker Inc. | Compose specification features, profile system usage, include directive patterns |
| [stefanprodan/dockprom](https://github.com/stefanprodan/dockprom) | Stefan Prodan | Prometheus/Grafana stack composition, monitoring patterns, alerting rules |
| [lucaslorentz/caddy-docker-proxy](https://github.com/lucaslorentz/caddy-docker-proxy) | Lucas Lorentz | Label-based proxy configuration, alternative to Traefik patterns |
| [serversideup/spin](https://github.com/serversideup/spin) | Server Side Up | VPS deployment patterns, Laravel-centric but applicable infrastructure |

### Operations and Management

| Repository | Maintainer | Patterns Extracted |
|------------|------------|-------------------|
| [louislam/dockge](https://github.com/louislam/dockge) | Louis Lam | Compose file management, web-based orchestration patterns |
| [getwud/wud](https://github.com/getwud/wud) | WUD Team | Container update detection, automated upgrade patterns |
| [NginxProxyManager/nginx-proxy-manager](https://github.com/NginxProxyManager/nginx-proxy-manager) | NginxProxyManager | GUI-based proxy management, Let's Encrypt integration patterns |
| [aquasecurity/trivy](https://github.com/aquasecurity/trivy) | Aqua Security | Container vulnerability scanning, CI/CD security integration |
| [ruanbekker/awesome-docker-compose](https://github.com/ruanbekker/awesome-docker-compose) | Ruan Bekker | Service examples, real-world configurations |
| [Viren070/docker-compose-vps-template](https://github.com/Viren070/docker-compose-vps-template) | Viren070 | VPS-specific deployment patterns |
| [apptension/saas-boilerplate](https://github.com/apptension/saas-boilerplate) | Apptension | Full-stack patterns, production infrastructure |

### Application References

| Repository | Purpose |
|------------|---------|
| [TryGhost/Ghost](https://github.com/TryGhost/Ghost) | CMS deployment patterns, MySQL integration |
| [danny-avila/LibreChat](https://github.com/danny-avila/LibreChat) | AI application patterns, MongoDB integration |
| [spantaleev/matrix-docker-ansible-deploy](https://github.com/spantaleev/matrix-docker-ansible-deploy) | Federation patterns, complex service orchestration |
| [CommunitySolidServer/CommunitySolidServer](https://github.com/CommunitySolidServer/CommunitySolidServer) | Solid protocol patterns, decentralized identity |
| [element-hq/ess-helm](https://github.com/element-hq/ess-helm) | Element/Matrix deployment patterns |

---

## Production Experience

Patterns in this project were also derived from production deployments. These are real systems that have:

- Operated unattended for extended periods
- Survived security scans and audits
- Handled real-world failure scenarios
- Been maintained across version upgrades

We do not name specific clients or deployments, but the patterns reflect operational experience rather than theoretical ideals.

---

## Multi-Model Synthesis

To reduce bias and identify genuine consensus versus repeated assumptions, architectural decisions were validated across multiple AI models:

| Model | Role |
|-------|------|
| Claude (Opus 4.5) | Primary analysis, decision documentation, constraint verification |
| GPT (5.2) | Independent validation, blocker identification, alternative perspectives |
| Gemini | Cross-validation, synthesis review, bias detection |
| Grok | Structure review, security analysis, operations evaluation |

**The Isolation Principle**: Each model ran its analysis independently, without knowledge of other models' conclusions. Only after all analyses were complete were results compared to identify:

- **Consensus points**: High confidence decisions where all models agreed
- **Contested points**: Areas requiring additional research or human judgment
- **Unique insights**: Valuable observations from individual perspectives

This process is documented in the synthesis methodology at the research archive.

---

## Key Pivots

The project underwent several significant architectural pivots based on validation feedback and clarified requirements.

### 1. Universal Docker Foundation Pivot (2026-01-01)

**Before**: Project was being built as a specific application stack (Ghost + LibreChat + Matrix + Solid).

**After**: Project reframed as a **universal Docker foundation** with example applications.

**Key changes**:
- Applications (Ghost, LibreChat, Matrix, Solid) became examples, not core components
- Memory constraints changed from fixed budgets to calculator methodology
- Database support became optional profiles (PostgreSQL, MySQL, MongoDB)

**Insight**: The specific applications were never meant to be "core" - they were stress-tests chosen to validate that the foundation is truly universal.

### 2. Wave Execution Model (2025-12-31)

**Before**: Traditional waterfall approach to decision-making.

**After**: Iterative wave-based execution with validation checkpoints.

**Structure**:
- Wave 0: Foundational decisions (secrets, security, resources)
- Wave 1: Infrastructure core (database selection, VPS hardening)
- Wave 2: Services and data (proxy, backup, authentication)
- Wave 3: Integration and networking (federation, TLS, isolation)

**Insight**: Dependencies between decisions must be explicitly tracked and decisions made in order, not in parallel without coordination.

### 3. Profile System Design (2025-12-31 to 2026-01-01)

**Before**: Monolithic service definitions with all databases included.

**After**: Modular profile system where each database is a complete, production-ready module.

**What a profile includes**:
- Complete Compose configuration
- Security settings (non-root, _FILE secrets)
- Backup scripts with encryption
- Health checks compatible with secrets
- Sizing calculators
- Storage integration (local/attached/remote)

**Insight**: Developers need complete, copy-paste-ready solutions, not just container definitions.

---

## Constraint-First Design

Every decision in this project was validated against 7 non-negotiable constraints from the project vision. If a choice violated any constraint, it was rejected.

### 1. Docker Compose Only

No Kubernetes. Docker Compose is the right tool for single-server deployments, which are what 90% of projects actually need. Kubernetes is a graduation path, not a starting point.

### 2. Local-First

The entire system must work without internet connectivity. No hard dependencies on cloud services. For every external service, there must be a local/OSS alternative (S3 to MinIO, OpenAI to Ollama, Auth0 to self-hosted OIDC).

### 3. Commodity VPS Target

Must run on a $20-50/month VPS. Not enterprise infrastructure. Simple, commodity servers that any developer can afford and control.

### 4. Zero Daily Maintenance

Systems must run for months without human intervention: automated backups, automated security updates, self-healing healthchecks, no "check the server every morning" requirements.

### 5. Security by Default

Security is baked in, not bolted on: no hardcoded secrets, non-root container execution, network isolation, WAF/rate limiting, proper TLS, container resource limits.

### 6. Performance That Matters

No default configurations accepted. Every service tuned for actual hardware: connection pooling, cache configuration, resource limits, measurable before/after metrics.

### 7. Dev/Staging/Production Parity

The same configuration works across all environments. Differences limited to: environment variables, resource limits, feature flags. "Works on my machine" is not acceptable.

---

## Decision Record Lineage

Each ADR in this directory traces back to formal decision documents:

| Public ADR | Research Origin |
|------------|-----------------|
| `0001-traefik-reverse-proxy.md` | D1.1 Reverse Proxy decision (Wave 2) |
| `0002-four-network-topology.md` | D3.3 Network Isolation (Wave 3), D1.2 Federation Networking (Wave 3) |
| `0003-file-based-secrets.md` | D3.1 Secret Management (Wave 0) |
| `0004-docker-socket-proxy.md` | D3.2 Container Security (Wave 0) |
| `0100-multi-database-profiles.md` | D2.1 Database Selection (Wave 1), D2.6 PostgreSQL Extensions (Wave 2) |
| `0200-non-root-containers.md` | D3.2 Container Security (Wave 0) |
| `0201-security-anchors.md` | D3.1 Secret Management (Wave 0), D3.2 Container Security (Wave 0) |
| `0300-health-check-strategy.md` | D4.1 Health Checks (Wave 1), D2.4 Backup Recovery (Wave 2) |
| `0400-profile-system.md` | D5.1 Service Composition (Wave 0), D10 Resource Calculator (Foundation) |
| `0202-sops-age-secrets-encryption.md` | Secrets Management Tooling Research (2026-01-03) |

The full research archive is maintained separately and includes:

- 102 decision-related documents across 8 categories
- Multi-model review synthesis
- Research assignments and findings
- Execution strategy documents
- Handoff records between development sessions

---

## Verification

Any contributor or auditor can verify that decisions in this repository:

1. Trace to documented research
2. Were validated against all 7 constraints
3. Consider alternatives with documented rationale
4. Reflect patterns from multiple production-grade references

Questions about decision provenance should be raised as issues for clarification.

---

*Document created: 2026-01-02*
*Research period: 2025-12-12 to 2026-01-02*
