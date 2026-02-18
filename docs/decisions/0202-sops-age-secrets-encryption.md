# ADR-0202: SOPS and Age Secrets Encryption

## Metadata

| Field | Value |
|-------|-------|
| **Date** | 2026-01-03 |
| **Status** | accepted |
| **Supersedes** | - |
| **Authors** | AI-assisted |
| **Reviewers** | - |

---

## Context

The project requires a secrets management solution for Docker Compose deployments on VPS infrastructure. The solution must satisfy seven critical constraints:

1. **Local-first operation** - Work without external service dependencies
2. **Zero daily maintenance** - No ongoing infrastructure to manage
3. **Team collaboration** - Support onboarding/offboarding workflows
4. **Audit trail** - Track who changed what and when
5. **Encrypted at rest** - Secrets safe in version control
6. **Compliance ready** - Satisfy SOC2 CC6.1 requirements
7. **File-based secrets** - Compatible with existing ADR-0003 pattern

Current state: Some teams use plain .env files stored on VPS servers, lacking version control, access management, and audit capabilities. This represents technical debt that fails compliance requirements.

The solution must work for teams of 2-15 people deploying Docker Compose applications to commodity VPS providers (Hetzner, DigitalOcean, etc.), with pull-based deployment triggered by webhooks.

---

## Decision

**We will use SOPS with age encryption for secrets management, wrapped in justfile-based tooling for developer ergonomics.**

SOPS (Secrets OPerationS) encrypts configuration files using age's modern cryptography (X25519 + ChaCha20-Poly1305). Team members receive individual age keypairs: public keys are stored in the repository, private keys remain on each developer's machine. Secrets are encrypted before committing to Git, providing version history and audit capabilities through standard Git workflows.

The justfile wrapper provides memorable commands (`just secrets-add`, `just secrets-edit`, `just secrets-member-add`) that hide SOPS/age complexity and enforce security best practices like confirmation prompts, audit logging, and preventing plaintext from touching disk.

**Key aspects of the implementation:**

- Secrets stored as encrypted YAML files in `secrets/*.enc.yaml`
- Team public keys stored in `keys/public/` directory
- `.sops.yaml` defines which keys can decrypt which files
- Deployment uses process substitution: `docker compose --env-file <(sops -d secrets/production.enc.yaml) up -d`
- VPS deploy user has dedicated age keypair for production decryption

---

## Alternatives Considered

### Option A: HashiCorp Vault

**Description**: Enterprise-grade secrets manager with dynamic secrets, fine-grained ACLs, and extensive integrations. Can generate short-lived database credentials and API tokens automatically.

**Pros**:
- Dynamic secrets reduce blast radius of credential exposure
- Comprehensive audit logging with external log shipping
- HSM integration for regulated industries
- Scales to thousands of users across multiple datacenters

**Cons**:
- Significant operational complexity (high availability, unseal procedures, backup)
- Requires dedicated infrastructure to self-host
- Learning curve of 1-2 weeks for basic proficiency
- BSL license change (2023) introduces vendor lock-in concerns
- Overkill for teams under 15 people on VPS infrastructure

**Why not chosen**: Operational complexity exceeds project requirements. The infrastructure overhead and learning curve are not justified for small-to-medium teams deploying to commodity VPS providers.

### Option B: 1Password/Bitwarden Secrets Automation

**Description**: Retrieve secrets at runtime from password manager vaults via CLI or Connect server. Uses `op://vault/item/field` secret references.

**Pros**:
- Teams often already use these for password management
- Excellent audit logging built-in
- SOC2 Type II certified infrastructure
- Easy onboarding via existing password manager accounts
- Immediate access revocation through admin console

**Cons**:
- External service dependency (no offline operation)
- Per-seat monthly cost ($7.99-19.95/user/month)
- Requires internet connection for secret retrieval
- Blast radius of compromised service token includes all authorized vaults

**Why not chosen**: Violates local-first constraint. Introduces external dependency that could cause deployment failures during service outages. Monthly recurring cost for functionality achievable with free tools.

### Option C: Doppler/Infisical SaaS

**Description**: Purpose-built secrets managers with excellent Docker Compose integration via CLI injection (`doppler run -- docker compose up`).

**Pros**:
- Best-in-class developer experience
- Built-in rotation reminders and partial automation
- Comprehensive audit logging designed for SOC2
- Low learning curve (30-60 minutes)
- Free tier available (5 users for Doppler)

**Cons**:
- External service dependency (no offline operation)
- Secrets not stored in Git (no version history in repository)
- Additional monthly cost beyond free tier
- Vendor lock-in for secrets infrastructure

**Why not chosen**: Violates local-first constraint. While developer experience is excellent, the external dependency introduces failure modes and ongoing cost. SOPS provides similar capabilities without service dependency.

### Option D: Plain .env Files (Current Legacy)

**Description**: Secrets stored only on production servers in files like `/opt/app/.env`, managed via SSH access.

**Pros**:
- Zero learning curve
- No additional tools required
- Works offline

**Cons**:
- No encryption at rest
- No version control or audit trail
- No access control beyond SSH keys
- No backup or recovery procedures
- Does not satisfy SOC2 CC6.1 requirements
- Single point of failure (server loss = secrets loss)

**Why not chosen**: Fails compliance requirements. No audit trail, no access management, no encryption. This pattern represents technical debt that should be migrated away from.

---

## Consequences

### Positive

- **Encrypted in Git**: All secrets are encrypted before commit, enabling version history and audit through standard Git workflows
- **No external dependencies**: Works entirely offline; no SaaS availability concerns
- **Zero daily maintenance**: No infrastructure to manage beyond the repository itself
- **Team-friendly workflows**: `just secrets-member-add/remove` provides clear onboarding/offboarding procedures
- **Compliance ready**: Satisfies SOC2 CC6.1 with Git audit logs and documented access procedures
- **Cost-effective**: SOPS and age are free, open-source tools
- **Compatible with ADR-0003**: File-based secrets pattern works with existing Docker Compose configuration

### Negative

- **No automated rotation**: SOPS does not provide secret rotation automation; must be scripted or manual
- **Key management burden**: Team changes require re-encryption with `sops updatekeys`
- **Learning curve**: Developers need 2-4 hours to learn SOPS/age workflows
- **Manual credential updates**: After offboarding, all secrets must be manually rotated within 24 hours

### Neutral

- Requires `just` installation for wrapper commands (can use raw SOPS commands if preferred)
- Public keys stored in repository (safe, but visible to anyone with repo access)

---

## Implementation Notes

- Install dependencies: `brew install sops age just`
- Age keys stored at `~/.config/sops/age/keys.txt` (chmod 600)
- Pre-commit hook recommended to prevent accidental plaintext commits
- Deployment keys should be separate from developer keys for production access control
- Quarterly rotation schedule recommended for high-priority credentials

### Directory Structure

```
secrets/
├── justfile                  # Command interface
├── .sops.yaml                # Encryption rules and recipients
├── lib/
│   └── secrets-lib.sh        # Helper functions
├── keys/
│   └── public/               # Team public keys
├── staging.enc.yaml          # Encrypted staging secrets
└── production.enc.yaml       # Encrypted production secrets
```

---

## References

### Documentation

- [SOPS GitHub Repository](https://github.com/getsops/sops) - Official SOPS documentation and releases
- [age Encryption Tool](https://age-encryption.org/) - Modern file encryption specification
- [just Command Runner](https://github.com/casey/just) - Justfile documentation

### Research

- `../../.dev/ai/research/secrets-management-team-workflows/RESEARCH-SYNTHESIS.md` - Consolidated research findings and team workflow procedures
- `../../.dev/ai/research/secrets-management-team-workflows/01-storage-patterns-comparison/responses/claude-cli.md` - Detailed comparison of 12 secrets storage patterns
- `../../.dev/ai/proposals/2026-01-03-secrets-management-tooling-design.md` - Justfile wrapper implementation design

### Related ADRs

- [ADR-0003: File-Based Secrets](./0003-file-based-secrets.md) - Establishes pattern for environment-based secrets in Docker Compose

### Compliance References

- [SOC2 CC6.1 Requirements](https://www.isms.online/soc-2/controls/logical-and-physical-access-controls-cc6-1-explained/) - Logical and physical access controls

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-01-03 | Initial draft and accepted | AI-assisted |
