# Core Gotchas

This document captures the deployment issues most likely to waste time during first rollout.

## 1) Directory Instead of File Mounts

When a bind-mounted file path does not exist on the host, Docker may create a directory instead.
This breaks apps that expect a file (`homeserver.yaml`, `config.json`, etc).

Symptoms:
- Container starts then exits with file parse errors
- App logs report `is a directory` for a config path

Prevention:
- Run `./scripts/init-volumes.sh` before first full startup
- Keep expected config files present under `examples/*/config`

Fix:
```bash
# Remove incorrect mount target and create file
rm -rf examples/matrix/config/homeserver.yaml
: > examples/matrix/config/homeserver.yaml
```

## 2) Non-Root Volume Permission Denied

Some images run as non-root users (for example Synapse `991`, Redis `999`, PeerTube `1000`).
If Docker volume ownership is wrong, startup fails.

Symptoms:
- `permission denied`
- `cannot write to /data` or `/config`

Prevention:
- Run `./scripts/init-volumes.sh`
- Re-run after adding new services with non-root containers

Fix:
```bash
./scripts/init-volumes.sh
```

## 3) Database Table Already Exists / Init Script Collisions

Reusing initialized data volumes with changed app setup can cause migration collisions.

Symptoms:
- Startup errors like `relation already exists`
- App migration loops

Prevention:
- Use dedicated DB names per app
- Do not reuse old data volumes across incompatible schema versions

Fix:
```bash
# Inspect first
./launch_pm-core.sh logs postgres -n 200

# If this is a disposable environment, reset volumes
./launch_pm-core.sh down --volumes
./launch_pm-core.sh up --profile=postgresql -d
```

## 4) URL / Domain Mismatch

Several apps require URLs that match Traefik host routing.

Symptoms:
- Redirect loops
- Callback failures
- Wrong absolute URLs in generated links

Prevention:
- Set `DOMAIN` and service URL variables in `.env`
- Run `./scripts/generate-secrets.sh --validate` before deploy

Minimum URL fields:
- `GHOST_URL`
- `PEERTUBE_HOSTNAME`
- `SYNAPSE_SERVER_NAME`
- `SOLID_BASE_URL`

## 5) SCP / Deploy File Permissions

Copied files can end up with wrong ownership or insecure mode bits.

Symptoms:
- App starts but cannot read secret/config files
- Webhook/deploy scripts fail with permission errors

Prevention:
- Keep secrets at `600` and directories at `700` where applicable
- Ensure deploy user owns project files

Fix:
```bash
# Example hardening
find secrets -type f -exec chmod 600 {} \;
find secrets -type d -exec chmod 700 {} \;
chmod +x scripts/*.sh
```

## 6) Compose Drift Between Override Files

Adding multiple `-f` files can silently override values.

Prevention:
```bash
# Always inspect merged config before full start
./scripts/deploy.sh --validate -f docker-compose.dc.yml
```

## 7) Traefik Entrypoints Not Binding (80 works, 443/8448/8080 missing)

On some Traefik image builds, the image wrapper may rewrite command arguments and drop critical flags.
Symptom pattern:
- Host shows docker-proxy listening on `443`, but TLS requests hang or fail
- Inside Traefik container, only `:80` is listening
- Traefik dashboard/API on `127.0.0.1:8080` is unavailable

Prevention:
- Keep explicit Traefik service entrypoint in compose:

```yaml
entrypoint: ["traefik"]
```

Validation:
```bash
docker inspect pmdl_traefik --format '{{json .Config.Cmd}}'
docker exec pmdl_traefik sh -lc 'netstat -tln'
```

Expected:
- listeners include `:80`, `:443`, `:8448`, and `:8080`

## 8) ACME Certificate Stuck On Traefik Default Cert

Let's Encrypt can fail silently into fallback `TRAEFIK DEFAULT CERT` if ACME registration/order fails.

Common causes:
- `ADMIN_EMAIL` uses placeholder/test domain (`example.com`) rejected by ACME
- Dynamic DNS domain family is rate-limited (for example `nip.io`)

Validation:
```bash
echo | openssl s_client -connect your-domain:443 -servername your-domain 2>/dev/null | openssl x509 -noout -subject -issuer
```

Expected:
- certificate issuer is a trusted public CA (not `TRAEFIK DEFAULT CERT`)

## 9) Database Containers Fail With cap_drop ALL And no-new-privileges

Database entrypoints (PostgreSQL, MySQL, MongoDB) require specific Linux capabilities
to change file ownership during first-time initialization. Using `cap_drop: ALL` alone
without adding back the required capabilities causes `chown: Operation not permitted`.

Symptoms:
- Database container exits immediately on first start
- Logs show `chown: /var/lib/postgresql/data: Operation not permitted`
- Subsequent starts may work if data volume was already initialized

Required capabilities for database entrypoints:
- `CHOWN` - change file owner
- `DAC_OVERRIDE` - bypass file permission checks
- `FOWNER` - bypass ownership checks
- `SETGID` - set group ID
- `SETUID` - set user ID

Prevention:
- Use `docker-compose.hardening.yml` which includes the correct `cap_add` set
- Do NOT apply `cap_drop: ALL` to databases without also adding back these capabilities

Fix:
```bash
# Apply the hardening overlay which includes correct cap_add
docker compose -f docker-compose.yml -f docker-compose.hardening.yml up -d
```

## 10) read_only Database Init Requires Wrapper + tmpfs Runtime Paths

`read_only: true` on database containers works only if runtime write paths
(PID/socket/tmp) are explicitly mapped to tmpfs and the service entrypoint
prepares those paths before handing off to the upstream image entrypoint.

Without this, startup fails with `Read-only file system` errors.

Current resolution (WO-071):
- PostgreSQL wrapper: `profiles/postgresql/init-scripts/00-readonly-wrapper.sh`
- MySQL wrapper: `profiles/mysql/init-scripts/00-readonly-wrapper.sh`
- MongoDB wrapper: `profiles/mongodb/init-scripts/00-readonly-wrapper.sh`
- Hardening overlay applies:
  - `read_only: true`
  - tmpfs runtime paths (`/tmp`, `/var/run/postgresql`, `/var/run/mysqld`, `/var/run/mongodb`)
  - wrapper entrypoint injection via `/docker-entrypoint-initdb.d/00-readonly-wrapper.sh`

Operational note:
- Keep database data directories on persistent volumes (`/var/lib/mysql`, `/var/lib/postgresql/data`, `/data/db`).
- Wrapper maintenance is required if upstream image entrypoint paths change.

Fix/usage:
```bash
docker compose -f docker-compose.yml -f docker-compose.hardening.yml up -d
```

## 11) Traefik Non-Root Breaks ACME Certificate Storage

Setting `user: "65534:65534"` (nobody) on Traefik v2.11 causes ACME certificate
operations to fail because the certificate store volume is owned by root.

Symptoms:
- Traefik starts but cannot write to `/acme/acme.json`
- TLS certificates are not obtained (falls back to TRAEFIK DEFAULT CERT)
- Logs show permission errors on ACME storage

Prevention:
- Keep Traefik running as root until v3 migration
- Use `cap_drop: ALL` + `cap_add: NET_BIND_SERVICE` for capability hardening
- The `docker-compose.hardening.yml` overlay implements this safe configuration

Fix:
```bash
# Remove user: directive from Traefik, rely on capability hardening instead
# The hardening overlay does this correctly
docker compose -f docker-compose.yml -f docker-compose.hardening.yml up -d
```

## 12) Socket Proxy read_only Breaks Entrypoint Config Generation

The `tecnativa/docker-socket-proxy` image generates `haproxy.cfg` from a
template (`haproxy.cfg.template`) at container startup via its entrypoint
script. Both the template and the generated config live in
`/usr/local/etc/haproxy/`.

Setting `read_only: true` blocks the config write. Mounting tmpfs on
`/usr/local/etc/haproxy/` wipes the baked-in template.

Symptoms:

- Container enters restart loop
- Logs show `can't create /usr/local/etc/haproxy/haproxy.cfg: Read-only file system`
- Or `sed: /usr/local/etc/haproxy/haproxy.cfg.template: No such file or directory`

Prevention:

- Do NOT apply `read_only: true` to socket-proxy
- Use `cap_drop: ALL` + `no-new-privileges` instead (effective controls)
- The `docker-compose.hardening.yml` overlay documents this exception

## 13) MinIO Explicit user Override Breaks /data Writes

Forcing MinIO to run with `user: "1000:1000"` can break object store writes when
the mounted `/data` path is owned by root and not pre-chowned to that UID/GID.
This was validated in WO-070 A/B testing.

Symptoms:

- `touch: cannot touch '/data/...': Permission denied`
- `id` inside container shows UID/GID `1000:1000` with no matching user name
- MinIO may start but fail write operations

Prevention:

- Keep MinIO without explicit `user:` override unless you also implement and validate
  volume ownership initialization for the selected UID/GID.
- Retain `no-new-privileges` + `cap_drop: ALL` hardening as baseline controls.

Fix:

```bash
# Remove MinIO user override and restart
docker compose -f docker-compose.yml -f docker-compose.hardening.yml up -d minio
```

## Fast Recovery Checklist

1. `./scripts/deploy.sh --validate`
2. `./scripts/init-volumes.sh --check`
3. `docker compose ps`
4. `./launch_pm-core.sh logs <service> -n 200`
