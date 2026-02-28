# Secrets Management Runbook

> **Canonical operational reference**: This is the authoritative secrets operations runbook for the project. Related documents:
> - **Beginner-friendly guide**: [SECRETS-PER-APP.md](SECRETS-PER-APP.md) -- per-application secret setup
> - **Pattern reference**: [PATTERNS/secrets-handling.md](PATTERNS/secrets-handling.md) -- reusable technical patterns

Team onboarding guide for SOPS + age encrypted secrets.

## Overview

This project uses **SOPS** (Secrets OPerationS) with **age** encryption for managing secrets. This combination provides:

- **Git-friendly encryption**: Encrypted files can be committed and diffed
- **Team-based access**: Add/remove team members by managing public keys
- **Environment separation**: Production, staging, and development have separate access controls
- **Audit trail**: All operations are logged locally
- **No cloud dependencies**: Works offline, no external services required

## Canonical vs Compatibility Keysets

The secrets lifecycle contract separates canonical runtime keys from compatibility-only keys:

- canonical runtime keyset: `secrets/keysets/canonical-runtime-keys.txt`
- canonical compose keyset: `secrets/keysets/canonical-compose-keys.txt`
- compatibility-only keyset: `secrets/keysets/compatibility-only-keys.txt`

Policy:

- canonical keys are baseline deployment contract and drift is `CRITICAL`
- compatibility keys support optional profiles/apps and cannot silently become canonical
- root compose `secrets:` entries must remain aligned to canonical compose keyset

Run parity validation:

```bash
./scripts/validate-secret-parity.sh --environment production
```

## Quick Start (Existing Team Members)

```bash
# 1. Install tools (macOS)
brew install sops age jq

# 2. Generate your age key (if you don't have one)
mkdir -p ~/.config/sops/age
age-keygen -o ~/.config/sops/age/keys.txt
chmod 600 ~/.config/sops/age/keys.txt

# 3. Get your public key (share with team admin)
grep "public key" ~/.config/sops/age/keys.txt

# 4. After admin adds you, verify access
cd secrets/
just verify
```

## New Team Member Onboarding

### Step 1: Install Dependencies

```bash
# macOS
brew install sops age jq

# Linux (apt)
sudo apt install jq
# Download sops and age from GitHub releases

# Verify installation
sops --version
age --version
```

### Step 2: Generate Your Key

```bash
mkdir -p ~/.config/sops/age
age-keygen -o ~/.config/sops/age/keys.txt
chmod 600 ~/.config/sops/age/keys.txt
```

### Step 3: Share Your Public Key

```bash
# Display your public key
just show-pubkey

# Send this to your team admin via Slack/email:
# age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p
```

### Step 4: Wait for Admin to Add You

Admin runs:

```bash
just member-add your-name age1your_public_key_here
# Then updates .sops.yaml and re-encrypts files
```

### Step 5: Verify Access

```bash
cd secrets/
just init     # Check dependencies and key
just verify   # Verify you can decrypt
```

## Day-to-Day Operations

### View Secrets

```bash
# View secrets (masked values)
just view production
just view staging
just view development

# View secrets (full values - terminal only)
just view production --reveal
```

### Edit Secrets

```bash
# Opens in $EDITOR, auto-encrypts on save
just edit staging
just edit production
```

### Add a Secret

```bash
# Add to specific environment
just add DATABASE_URL "postgres://..." production
just add API_KEY "sk_live_..." staging

# Default is production
just add STRIPE_KEY "sk_test_..."
```

### Rotate a Secret

```bash
# Interactive rotation with checklist
just rotate DB_PASSWORD production
just rotate API_KEY staging

# Prompts for new value (hidden input)
# Shows reminder to update external systems
```

### Rotation + Recovery Drill

Run an auditable drill that validates rotation and recovery workflow without exposing secret values:

```bash
# Non-destructive simulation (default)
./scripts/secrets-rotation-recovery-drill.sh --environment staging --key postgres_password

# Destructive drill (apply candidate, validate, then restore backup)
./scripts/secrets-rotation-recovery-drill.sh --environment staging --key postgres_password --apply
```

Drill artifacts are written to `/tmp/pmdl-secrets-drills/` by default.

### Deploy with Secrets

```bash
# Decrypt and inject into docker compose
just deploy production
just deploy staging
```

## Team Administration

### Add a Team Member

```bash
# 1. Receive their public key
just member-add jane-doe age1ql3z7hjy...

# 2. Update .sops.yaml with new key

# 3. Re-encrypt existing files
sops updatekeys production.enc.yaml --yes
sops updatekeys staging.enc.yaml --yes

# 4. Commit and push
git add . && git commit -m "Add jane-doe to secrets access"
```

### Remove a Team Member (Offboarding)

```bash
# 1. Remove from secrets
just member-remove jane-doe

# 2. Update .sops.yaml (remove their public key)

# 3. Re-encrypt all files
sops updatekeys production.enc.yaml --yes
sops updatekeys staging.enc.yaml --yes

# 4. Commit changes
git add . && git commit -m "Remove jane-doe from secrets access"
```

## Offboarding Checklist

When a team member leaves:

- [ ] Run `just member-remove NAME`
- [ ] Remove their key from `.sops.yaml`
- [ ] Re-encrypt all secrets files with `sops updatekeys`
- [ ] **CRITICAL**: Rotate all production credentials within 24 hours
- [ ] Rotate all API keys they had access to
- [ ] Update deployment tokens and webhooks
- [ ] Revoke VPS/server SSH access (separate process)
- [ ] Commit and deploy changes

## Emergency Procedures

### Credential Compromise Response

If you suspect a secret has been compromised:

```bash
# 1. Immediately rotate the compromised credential
just rotate COMPROMISED_KEY production

# 2. Update the external service with new credential

# 3. Review audit log for unusual access
just audit 50

# 4. Deploy immediately
just deploy production

# 5. Notify the team and document the incident
```

### Lost Private Key Recovery

If you lose your private key:

1. Generate a new key: `age-keygen -o ~/.config/sops/age/keys.txt`
2. Share new public key with admin
3. Admin adds new key and removes old one
4. Admin re-encrypts all files
5. Old key can no longer decrypt anything

### Key Compromise

If your private key is compromised:

1. **Immediately notify team admin**
2. Admin removes your old key from `.sops.yaml`
3. Admin re-encrypts all files
4. Generate new keypair
5. Admin adds your new public key
6. **Rotate all secrets you had access to**

## FAQ

### How do I get my public key?

```bash
just show-pubkey
# or
grep "public key" ~/.config/sops/age/keys.txt
```

### What if I lose my private key?

You cannot recover a lost private key. You must:

1. Generate a new key
2. Have an admin add your new public key
3. Have them re-encrypt the secrets files

Your old key becomes permanently useless.

### How do secrets get to production?

1. Developer edits encrypted file with `just edit production`
2. Changes are committed to git (still encrypted)
3. CI/CD pipeline decrypts using deployment key
4. Secrets are injected into containers via process substitution
5. Plaintext secrets never touch disk

### Can I decrypt secrets on my laptop?

Only if your public key is in `.sops.yaml` for that environment. Typically:

- **Development**: All developers
- **Staging**: All developers
- **Production**: Ops team only

### What files should I never commit?

```
~/.config/sops/age/keys.txt  # Your private key
*.dec.yaml                    # Decrypted files
.env                          # Plaintext env files
audit.log                     # Local audit trail
```

### How do I check who has access?

```bash
just list-members

# Or check .sops.yaml directly for public keys
```

### How do I see the audit log?

```bash
just audit        # Last 20 operations
just audit 50     # Last 50 operations
```

## File Reference

```
secrets/
  .sops.yaml          # Key configuration (commit this)
  .sops.yaml.example  # Template for new setups
  production.enc.yaml # Encrypted production secrets
  staging.enc.yaml    # Encrypted staging secrets
  development.enc.yaml# Encrypted dev secrets
  justfile            # All commands defined here
  lib/secrets-lib.sh  # Helper functions
  keys/public/        # Team member public keys
  audit.log           # Local operation log (gitignored)
```

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| "failed to decrypt" | Your key not in `.sops.yaml` | Ask admin to add your public key |
| "No matching private key" | Key not at expected path | Check `~/.config/sops/age/keys.txt` exists |
| "sops: command not found" | Not installed | `brew install sops` |
| Can't decrypt after key added | Files not re-encrypted | Admin runs `sops updatekeys file.enc.yaml` |

---

## Related Documentation

**Pattern Guides**:
- [docs/PATTERNS/secrets-handling.md](PATTERNS/secrets-handling.md) - Choosing between `_FILE` suffix vs direct env vars

**Application Requirements**:
- [docs/SECRETS-PER-APP.md](SECRETS-PER-APP.md) - Per-application secret requirements matrix

**Architecture**:
- [docs/SECURITY-ARCHITECTURE.md](SECURITY-ARCHITECTURE.md) - Complete security architecture context
- [docs/decisions/0003-file-based-secrets.md](decisions/0003-file-based-secrets.md) - ADR: File-based secrets pattern
- [docs/decisions/0202-sops-age-secrets-encryption.md](decisions/0202-sops-age-secrets-encryption.md) - ADR: SOPS+age encryption
