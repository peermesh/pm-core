# Hello Core Module

A near-stock, in-runtime copy of the standalone hello module example. This module demonstrates the
manifest structure, lifecycle hooks, Traefik routing labels, health checks, and dashboard widget
patterns that every PeerMesh Core module can reuse. It serves a static greeting page through
`nginx` and is delivered as a runnable module inside `modules/hello-core/`.

## Layout

- `module.json` — module manifest (hooks, dashboard, events, configuration).
- `docker-compose.yml` — extends `foundation/docker-compose.base.yml`, binds the web server to
  `pmdl_proxy-external`, and exposes Traefik labels.
- `hooks/` — install/start/stop/health/uninstall helpers that wrap `docker compose`.
- `html/` & `dashboard/` — sample UI assets.
- `tests/smoke-test.sh` — bootstrap smoke test for CI or manual validation.

## Prerequisites

- Ensure the foundation stack (Traefik, socket-proxy, and the networks) is running. From the root of
  the Core repo:

  ```bash
  cd sub-repos/core
  ./launch_core.sh up --profile=postgresql,redis
  ```

- Confirm the external network `pmdl_proxy-external` exists (the hooks will warn if it does not).

## Getting Started

1. Review or create `modules/hello-core/.env` with at least `DOMAIN=<your domain>` set:

   ```bash
   cp modules/hello-core/.env.example modules/hello-core/.env 2>/dev/null || true
   cat <<'EOF' >modules/hello-core/.env
   DOMAIN=example.com
   HELLO_CORE_SUBDOMAIN=hello-core
   HELLO_CORE_GREETING='Hello from PeerMesh!'
   EOF
   ```

2. Run the module helpers from within `modules/hello-core/`:

   ```bash
   cd modules/hello-core
   ./hooks/install.sh
   ./hooks/start.sh
   ./hooks/health.sh
   ```

   `docker compose up -d` or `./hooks/stop.sh`/`uninstall.sh` can also be used interchangeably.

3. Access the module via Traefik at `https://${HELLO_CORE_SUBDOMAIN}.${DOMAIN}/`.

## Configuration Reference

| Variable | Description | Default |
| --- | --- | --- |
| `DOMAIN` | The root domain routed by Traefik. | required |
| `HELLO_CORE_SUBDOMAIN` | Subdomain prefix for this module. | `hello-core` |
| `HELLO_CORE_GREETING` | Text shown on the static page. | `Hello from PeerMesh!` |

Traefik routes are defined in `docker-compose.yml` with:

```text
traefik.http.routers.hello-core.rule=Host(`${HELLO_CORE_SUBDOMAIN:-hello-core}.${DOMAIN}`)
traefik.http.services.hello-core.loadbalancer.server.port=80
```

## Health & Dashboard

- `./hooks/health.sh [text|json]` reports container status, HTTP reachability, and nginx process health.
- The embedded dashboard widget (for future UI integration) lives in `dashboard/HelloStatusWidget.html`.
  It fetches `/api/modules/hello-core/health` or falls back to `window.helloCoreHealthData`.

## Static Content

Edit `html/index.html` to customize the public-facing greeting. The file is mounted read-only into
`/usr/share/nginx/html/`, so any changes require restarting the module:

```bash
cd modules/hello-core
./hooks/start.sh
```

## Testing

Run `./tests/smoke-test.sh` while the module is running:

```bash
cd modules/hello-core
./tests/smoke-test.sh
```

The script checks container health, HTTP response, HTML content, and the hook output.

## Troubleshooting

- Traefik returns 404: verify `DOMAIN`/`HELLO_CORE_SUBDOMAIN` and restart Traefik.
- `docker compose` fails because `pmdl_proxy-external` is missing: start the foundation stack or rerun
  `./launch_core.sh up` with the required profiles.
- `html/index.html` changes not reflected: restart the module so nginx reloads the updated files.

## Contributing

Follow the same conventions used across other modules:

- Keep the module manifest aligned with `foundation/schemas/module.schema.json`.
- Reuse the lifecycle scripts in `hooks/` when adding new services.
- Add tests under `tests/` if you expand the module surface.
