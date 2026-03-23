-- ============================================================
-- Social Lab Module: Instance-Level Ed25519 Keypair
-- Migration: 021_instance_keys
-- Date: 2026-03-23
-- ============================================================
-- Adds:
--   Instance-level Ed25519 keypair storage in social_keys.
--   Used for SSO token signing and cross-instance identity
--   verification. Generated on first startup.
--
--   Stored as special rows in social_keys.key_metadata with:
--     omni_account_id = 'instance:<domain>'
--     protocol = 'ecosystem-sso'
--     key_type = 'ed25519-instance' (public key)
--     key_type = 'ed25519-instance-private' (private key)
--
-- Source blueprints:
--   ARCH-010 (Ecosystem Identity Federation)
--   FLOW-004 (Ecosystem SSO)
-- ============================================================

BEGIN;

-- ============================================================
-- No new tables needed. Instance keypairs are stored in the
-- existing social_keys.key_metadata table using the convention:
--
--   omni_account_id = 'instance:<domain>'
--   protocol        = 'ecosystem-sso'
--   key_type        = 'ed25519-instance'       (public)
--   key_type        = 'ed25519-instance-private' (private)
--   public_key_spki = base64url SPKI (public key row)
--   public_key_hash = PKCS8 PEM (private key row, Phase 1)
--
-- Index for fast instance key lookup:
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_keys_instance_sso
    ON social_keys.key_metadata (omni_account_id, key_type)
    WHERE protocol = 'ecosystem-sso' AND is_active = TRUE;


-- ============================================================
-- MIGRATION RECORD
-- ============================================================

INSERT INTO social_pipeline.schema_migrations (version, description)
VALUES ('021', 'Instance-level Ed25519 keypair for ecosystem SSO token signing (ARCH-010)')
ON CONFLICT (version) DO NOTHING;

COMMIT;
