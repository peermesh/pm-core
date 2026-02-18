# Docker Lab Gotchas

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
./launch_peermesh.sh logs postgres -n 200

# If this is a disposable environment, reset volumes
./launch_peermesh.sh down --volumes
./launch_peermesh.sh up --profile=postgresql -d
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

## Fast Recovery Checklist

1. `./scripts/deploy.sh --validate`
2. `./scripts/init-volumes.sh --check`
3. `docker compose ps`
4. `./launch_peermesh.sh logs <service> -n 200`
