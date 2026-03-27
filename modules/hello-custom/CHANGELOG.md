# Changelog

All notable changes to the Hello Custom Module will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-02-26

- Initial release of the Hello Custom Module example
- nginx-based static greeting page ("Hello from PeerMesh")
- Complete `module.json` manifest with all sections annotated
- `docker-compose.yml` extending `_service-lite` foundation base pattern
- Pinned nginx image digest for supply-chain security
- Traefik routing labels for HTTPS access at `hello-custom.${DOMAIN}`
- Docker health check via `wget --spider`
- Security hardening: `no-new-privileges`, `cap_drop: ALL`
- Five lifecycle hooks: `install.sh`, `start.sh`, `stop.sh`, `uninstall.sh`, `health.sh`
- Health check hook with JSON and text output modes
- Dashboard status widget (`HelloCustomStatusWidget.html`)
- Smoke test suite (`tests/smoke-test.sh`)
- `.env.example` with all configurable values
- `secrets-required.txt` documenting the secrets pattern
- Comprehensive README with quick start, customization guide, and troubleshooting
- `CONTRIBUTING.md` with contribution guidelines
- MIT License

### Compatibility

- Tested with Core v7.39.0
- Requires Core foundation stack (Traefik, socket-proxy)
- Uses `_service-lite` resource profile (256MB memory, 0.5 CPU)
