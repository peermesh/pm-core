# OpenBao No-TPM Fallback Strategy

## Purpose

Define a fail-closed operational strategy for environments where TPM/vTPM is unavailable or not trusted for OpenBao unseal workflows.

## Fallback Tiers

1. Tier A (Preferred when TPM absent): Manual Shamir unseal with operator quorum.
2. Tier B (Policy-allowed external dependency): Cloud KMS auto-unseal via OpenBao `seal` stanza.
3. Tier C (Last resort): Software-only sealed envelope with explicit reduced-trust posture.

## Required Runtime Posture Labels

Every deployment must expose one of:
- `TPM_BACKED`
- `KMS_BACKED`
- `MANUAL_SHAMIR`
- `REDUCED_TRUST_SOFTWARE_ONLY`

## Operational Guardrails

1. Fail closed when configured trust mechanism is unavailable.
2. Never silently downgrade from TPM/KMS to weaker mode.
3. Require explicit operator acknowledgement for reduced-trust mode.
4. Log posture changes as auditable security events.

## Manual Shamir Baseline

1. Initialize OpenBao with threshold >1 where staffing allows.
2. Store shares in independent custody channels.
3. Maintain documented startup/unseal runbook.
4. Test unseal drill at a fixed cadence.

## Cloud KMS Baseline

1. Use dedicated project/tenant-scoped key.
2. Restrict key management permissions.
3. Track key rotation and deletion guardrails.
4. Verify recovery-key procedures before production use.

## Reduced-Trust Mode Constraints

1. Allowed only for lab/bootstrap environments.
2. Must include conspicuous warning in status and docs.
3. Cannot be declared production-ready.
