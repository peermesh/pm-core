# Glossary Maintenance Guide

**Purpose**: How to add, update, and maintain the project glossary to ensure consistent nomenclature.

---

## When to Update the Glossary

### Mandatory Updates (Agent Triggers)

AI agents MUST update the glossary when:

1. **Adding a new module** - Add namespace prefix and variable table
2. **Adding a new service** - Add service name and config prefix
3. **Creating new environment variables** - Verify namespace compliance
4. **Renaming existing components** - Update all references
5. **Finding naming conflicts** - Add disambiguation entry

### Suggested Updates

Consider updating when:

- Documentation uses inconsistent terminology
- Users report confusion about naming
- New patterns emerge that should be standardized

---

## How to Add a New Term

### 1. Check for Conflicts

Before adding:

```bash
# Search for existing uses of the term
grep -ri "your_term" docs/ .env.example docker-compose*.yml
```

### 2. Choose a Namespace Prefix

| If adding... | Prefix pattern | Example |
|--------------|----------------|---------|
| New module | Module directory name | `MYMODULE_` |
| New profile service | Service name | `MYSERVICE_` |
| Dashboard feature | `DOCKERLAB_` | `DOCKERLAB_FEATURE_X` |
| Traefik feature | `TRAEFIK_` | `TRAEFIK_FEATURE_X` |

**Rules:**
- Prefix MUST be unique (not used by other components)
- Prefix MUST be ALL_CAPS
- Prefix MUST end with underscore

### 3. Add to GLOSSARY.md

Add entry in the appropriate section:

```markdown
### Component Name

**Canonical Name**: Full Official Name
**Service Name**: `service-name`
**Config Prefix**: `PREFIX_`
**Profile**: `profile-name` (if applicable)

Brief description of what this component does.

| Variable | Purpose |
|----------|---------|
| `PREFIX_SETTING` | What it controls |
```

### 4. Update Disambiguation Table (if needed)

If the term could be confused with something else:

```markdown
| Term | Refers To | NOT |
|------|-----------|-----|
| "new term" | What it means | What it doesn't mean |
```

---

## Namespace Registry

**Reserved prefixes** (cannot be used for new components):

| Prefix | Owner |
|--------|-------|
| `DOCKERLAB_` | Core Dashboard |
| `TRAEFIK_` | Traefik reverse proxy |
| `POSTGRES_` | PostgreSQL |
| `MYSQL_` | MySQL |
| `REDIS_` | Redis |
| `MINIO_` | MinIO |
| `MONGO_` | MongoDB |
| `BACKUP_` | Backup module |
| `PKI_` | PKI module |
| `MASTODON_` | Mastodon module |
| `SOCKET_PROXY_` | Socket proxy |

To register a new prefix, add it to both:
1. This list
2. The "Quick Reference" table in GLOSSARY.md

---

## Validation Checklist

Before committing changes:

- [ ] New variables use registered namespace prefix
- [ ] No generic names (e.g., `PASSWORD`, `USERNAME`, `PORT`)
- [ ] Service names are lowercase with hyphens
- [ ] Environment variables are UPPER_SNAKE_CASE
- [ ] GLOSSARY.md updated if new component added
- [ ] Disambiguation table updated if term is ambiguous

---

## Agent Instructions

### For AI Agents Working on This Project

When you encounter these triggers, update the glossary:

**Trigger: New module created**
```
Action: Add module to GLOSSARY.md with:
- Canonical name
- Directory path
- Config prefix
- Variable table
```

**Trigger: New environment variable added**
```
Action:
1. Verify it uses a registered prefix
2. If new prefix needed, register it first
3. Add to appropriate component's variable table
```

**Trigger: Naming conflict or confusion found**
```
Action:
1. Add entry to Disambiguation Table
2. Consider renaming if possible
3. Document in findings if rename is breaking change
```

**Trigger: User asks "what is X?" for a component**
```
Action:
1. Check if X is in glossary
2. If not, add it
3. If ambiguous, add disambiguation entry
```

### Glossary Update Template

When updating, use this commit message format:

```
docs(glossary): add {component} nomenclature

- Added {PREFIX_} namespace
- Documented {N} environment variables
- Updated disambiguation table
```

---

## Migration: Deprecated Names

When renaming variables (like `DASHBOARD_*` → `DOCKERLAB_*`):

1. **Keep old name working** (backwards compatibility)
2. **Log deprecation warning** if old name used
3. **Document in glossary** with "DEPRECATED" marker
4. **Set removal date** (typically next major version)

Example:

```markdown
| `DASHBOARD_PASSWORD` | **DEPRECATED** - use `DOCKERLAB_PASSWORD` | Removed in v2.0 |
```

---

## Related Documents

- [GLOSSARY.md](./GLOSSARY.md) - The authoritative term reference
- [CONFIGURATION.md](./CONFIGURATION.md) - Environment variable details
- AGENTS.md - Agent operating rules are maintained in the private PeerMeshCore repo and are not published in this repository.

---

## Changelog

### 1.0.0 - 2026-01-23

- Initial guide created
- Defined update triggers
- Established namespace registry
- Created validation checklist
