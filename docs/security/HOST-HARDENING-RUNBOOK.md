# Host Hardening Runbook

This runbook covers host-level hardening steps that are outside compose-only changes.

## Scope

- UFW baseline for inbound traffic control
- verification commands for audit evidence
- rollback commands

## Preconditions

- host access with `sudo`
- PeerMesh services are deployed and healthy
- SSH access must remain available during changes

## Recommended Baseline

Allow only required inbound ports:

- `22/tcp` (SSH)
- `80/tcp` (HTTP challenge + redirect)
- `443/tcp` (HTTPS)
- optional `8448/tcp` only when Matrix federation is required

## Plan Mode (No Changes)

```bash
cd sub-repos/core
./scripts/security/enforce-host-firewall.sh --plan
```

Optional with Matrix federation:

```bash
./scripts/security/enforce-host-firewall.sh --plan --allow-8448
```

## Apply Mode

```bash
cd sub-repos/core
sudo ./scripts/security/enforce-host-firewall.sh --apply --yes
```

Optional with Matrix federation:

```bash
sudo ./scripts/security/enforce-host-firewall.sh --apply --yes --allow-8448
```

## Verification

Run and capture outputs:

```bash
ufw status verbose
iptables -S INPUT
iptables -S DOCKER-USER
ss -tlnp
```

Expected baseline:

- UFW `Status: active`
- explicit allow rules for required ports only
- host no longer relies solely on Docker-managed rules

## Rollback

Emergency rollback:

```bash
sudo ufw --force disable
```

Then re-validate service reachability and SSH access.

## Notes

- This runbook intentionally separates host firewall operations from application deploy logic.
- Pair this with `scripts/security/validate-host-hardening.sh` for repeatable preflight checks.
