# OpenTofu Deployment Model

This document defines the canonical deployment model for Docker Lab.

## Core Idea

Docker Lab uses a split control model:

1. OpenTofu manages infrastructure through provider APIs (for example, Hetzner and DNS).
2. Docker Lab manages runtime containers on that infrastructure (foundation first, then modules/apps).

This keeps provisioning reproducible while keeping container operations in the existing Docker Lab runtime workflows.

## Terminology

1. VPS host:
   A real server from a vendor such as Hetzner.
2. OpenTofu provider:
   The plugin OpenTofu uses to call a vendor API (for example, `hcloud` for Hetzner).
3. Foundation runtime:
   Docker Lab base services (Traefik, socket-proxy, networks, secrets, deployment controls).
4. Modules:
   Optional OSS systems added on top of the foundation (databases, federation adapter, example apps).

## What OpenTofu Does

1. Creates and updates infrastructure resources via API.
2. Reads infrastructure state and detects drift.
3. Applies planned infrastructure changes with evidence-driven gates.

## What OpenTofu Does Not Do

1. It is not a long-running monitor.
2. It does not replace Docker Compose runtime operations.
3. It does not run application lifecycle tasks for modules unless explicitly modeled.
4. It does not autoscale by itself; scaling happens only through declared config changes and apply runs.

## What Docker Lab Runtime Does

1. Deploys and operates container stacks on the provisioned host.
2. Enforces deployment promotion gates and evidence outputs.
3. Runs security, supply-chain, observability, and scalability validation scripts.

## Recommended Deployment Path (API-driven, Hetzner-first)

1. Provision infra with OpenTofu:
   - host/firewall/network/DNS prerequisites
   - provider credentials managed via `infra/opentofu/scripts/pilot-credentials.sh` in a private local env file (never committed)
2. Validate OpenTofu readiness and apply:
   - run readiness gate
   - review plan
   - run apply
3. Deploy Docker Lab foundation runtime on the provisioned host:
   - bootstrap host
   - run Docker Lab deploy flow
4. Add module profiles and OSS apps as needed.
5. Operate continuously:
   - OpenTofu for infra changes
   - Docker Lab deploy/validation for runtime changes

## Alternative Paths

1. Manual VPS provisioning + Docker Lab runtime:
   - fastest start, less IaC control
2. Hybrid:
   - OpenTofu for networking/DNS/firewall, manual host lifecycle

The project preference is the API-driven model above.

## Project-Specific Current Status

1. OpenTofu readiness and safety gates are implemented.
2. Active work orders target provider-backed apply and recovery closeout:
   - `WO-PMDL-2026-02-20-036`
   - `WO-PMDL-2026-02-20-037`
3. Provider-backed implementation hardening is tracked in:
   - `WO-PMDL-2026-02-20-039`
