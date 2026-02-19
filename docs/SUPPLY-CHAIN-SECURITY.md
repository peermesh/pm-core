# Supply-Chain Security Baseline

This document defines the minimum supply-chain controls enforced by Docker Lab release workflows.

## Scope

Baseline gates cover three controls:

1. Image policy validation (tag/digest contract)
2. SBOM generation (CycloneDX)
3. Vulnerability threshold gate (severity-based)

## Commands

### 1) Image policy gate

```bash
./scripts/security/validate-image-policy.sh
```

Strict mode example:

```bash
./scripts/security/validate-image-policy.sh --fail-on-latest --strict
```

### 2) SBOM generation

```bash
./scripts/security/generate-sbom.sh
```

Explicit output path:

```bash
./scripts/security/generate-sbom.sh --output-dir /tmp/pmdl-sbom
```

### 3) Full supply-chain gate

```bash
./scripts/security/validate-supply-chain.sh --severity-threshold CRITICAL
```

Stricter example:

```bash
./scripts/security/validate-supply-chain.sh --severity-threshold HIGH --fail-on-latest --strict
```

## Artifact Paths

### Default standalone paths

- Supply-chain run bundle: `reports/supply-chain/<timestamp>/`
- Image policy report: `reports/supply-chain/<timestamp>/image-policy.tsv`
- SBOM index: `reports/supply-chain/<timestamp>/sbom/SBOM-INDEX.tsv`
- Vulnerability gate report: `reports/supply-chain/<timestamp>/vulnerability-gate.tsv`
- Supply-chain summary: `reports/supply-chain/<timestamp>/supply-chain-summary.env`

### Deploy evidence paths (canonical release workflow)

When running `./scripts/deploy.sh`, supply-chain artifacts are captured inside the deploy evidence bundle:

- `preflight-supply-chain.log`
- `supply-chain/supply-chain-summary.env`
- `supply-chain/image-policy.tsv`
- `supply-chain/sbom/SBOM-INDEX.tsv`
- `supply-chain/vulnerability-gate.tsv`

## Policy Contract

- Every image must declare an explicit tag or digest.
- `latest` tags are warnings by default.
- `latest` can be enforced as failure with `--fail-on-latest`.
- Vulnerability threshold gate defaults to `CRITICAL` and is configurable to `LOW|MEDIUM|HIGH|CRITICAL`.

## Deploy-Time Controls

`./scripts/deploy.sh --validate` now runs the supply-chain gate in preflight.

Optional environment controls:

- `SUPPLY_CHAIN_SEVERITY_THRESHOLD` (default: `CRITICAL`)
- `SUPPLY_CHAIN_STRICT` (`true|false`, default: `false`)
- `SUPPLY_CHAIN_FAIL_ON_LATEST` (`true|false`, default: `false`)
- `SUPPLY_CHAIN_PULL_MISSING` (`true|false`, default: `false`)

## Exit Semantics

Supply-chain commands return:

- `0` when no critical failures occur
- `1` on gate failure
- `2` when warnings exist and `--strict` is enabled

This allows release workflows to fail fast while still supporting progressive hardening.
