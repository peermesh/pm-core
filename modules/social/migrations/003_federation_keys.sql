-- ============================================================
-- Social Module: Federation Key Storage
-- Migration: 003_federation_keys
-- Date: 2026-03-21
-- ============================================================
-- Adds private_key_pem column to social_federation.ap_actors
-- so the Actor's RSA keypair can be stored alongside the actor
-- record. For Phase 3 VPS deployment, direct DB storage is
-- acceptable. Future phases will migrate to KMS/Pod storage.
-- ============================================================

BEGIN;

-- Add private key storage to ap_actors table
ALTER TABLE social_federation.ap_actors
    ADD COLUMN IF NOT EXISTS private_key_pem TEXT;

COMMENT ON COLUMN social_federation.ap_actors.private_key_pem IS
    'RSA private key in PEM format. Phase 3: stored in DB. Future: migrate to KMS/Pod per deployment mode.';

-- Add unique constraint on webid to simplify lookup
-- (webid should already be unique per actor, but enforce it)
CREATE UNIQUE INDEX IF NOT EXISTS idx_federation_webid_unique
    ON social_federation.ap_actors (webid);

-- Record this migration
INSERT INTO social_pipeline.schema_migrations (version, description)
VALUES ('003', 'Add private_key_pem to ap_actors for Phase 3 federation')
ON CONFLICT (version) DO NOTHING;

COMMIT;
