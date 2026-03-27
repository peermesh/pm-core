# Quick Start Tutorial (Public)

## Goal
Bring up Core foundation services on a single VPS and verify dashboard availability.

This tutorial follows the canonical public quick start in [docs/QUICKSTART.md](../QUICKSTART.md). Use that document as the single source of truth for cloning, configuration, and service startup; this lesson highlights a trimmed walkthrough of the same steps.

## Prerequisites
- Docker Engine + Compose plugin.
- Git.
- Linux VPS with open ports 80/443.

## Steps
1. Clone repo:
```bash
git clone https://github.com/peermesh/core.git
cd core
```
2. Configure env and secrets:
```bash
cp .env.example .env
./scripts/generate-secrets.sh
```
3. Set minimum profile set (example):
```bash
export COMPOSE_PROFILES=postgresql,redis
```
4. Validate deployment contract:
```bash
./scripts/deploy.sh --validate
```
5. Start services:
```bash
docker compose up -d
```
6. Verify health:
```bash
docker compose ps
curl -I http://127.0.0.1
```

## Troubleshooting
- If dashboard image is not available in registry flow, build locally:
```bash
docker compose build dashboard
```
- Review service logs:
```bash
docker compose logs --tail=200 traefik dashboard
```
