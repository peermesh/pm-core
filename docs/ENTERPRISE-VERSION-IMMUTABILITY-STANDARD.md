# Enterprise Version Immutability Standard

Status: Active  
Applies to: All Core infrastructure/runtime artifacts

## Purpose

Prevent silent drift and unreviewed upgrades by making every dependency reference explicit, auditable, and reproducible.

## Mandatory Rules

1. External container images MUST be pinned to immutable digests (`image@sha256:...`).
2. `latest` tags are forbidden in release workflows.
3. Locally built images MUST use explicit non-`latest` tags (for example `0.1.0`, `2026.02.22-1`).
4. OpenTofu providers MUST be constrained in `required_providers` and locked in `.terraform.lock.hcl`.
5. Any repo-level dependency linkage (submodule, imported source, reference checkout) MUST be pinned to an exact commit for release evidence.

## Built-In Enforcement

1. `./scripts/security/validate-image-policy.sh`
   - defaults to fail on `latest`
   - defaults to require digest for external images
   - supports legacy opt-out with `--allow-latest` and `--allow-external-tags`
2. `./scripts/security/validate-supply-chain.sh`
   - defaults to fail on `latest`
   - defaults to require digest for external images
   - supports legacy opt-out with `--allow-latest` and `--allow-external-tags`
3. `./scripts/deploy.sh --validate`
   - defaults to strict supply-chain gate (`SUPPLY_CHAIN_STRICT=true`)
   - defaults to fail on `latest` (`SUPPLY_CHAIN_FAIL_ON_LATEST=true`)

## Standard Update Workflow

1. Open a tracked work order for version refresh.
2. Update image digests intentionally (never bulk-update blindly).
3. Run:
   - `./scripts/security/validate-image-policy.sh --strict`
   - `./scripts/security/validate-supply-chain.sh --severity-threshold HIGH --strict`
4. Capture evidence bundle and changelog note with old/new references.
5. Promote only after gate pass and explicit approval.

## Digest Refresh Method

Use registry-resolved manifests to compute immutable references:

```bash
docker buildx imagetools inspect <image:tag> --format '{{json .Manifest.Digest}}'
```

Then update compose to:

```yaml
image: repo/name@sha256:<digest>
```

## Exception Policy

Exceptions are temporary and must include:

1. reason,
2. scope,
3. expiration date,
4. compensating controls.

No standing exception for `latest` tags is allowed in production.
