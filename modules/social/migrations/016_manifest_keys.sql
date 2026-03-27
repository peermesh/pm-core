-- ============================================================
-- Social Module: Universal Manifest + Per-User Ed25519 Keys
-- Migration: 016_manifest_keys
-- Date: 2026-03-22
-- ============================================================
-- Adds:
--   1. Per-user Ed25519 signing keypair storage in social_keys
--      (key_type: 'ed25519-identity' entries alongside existing
--       RSA/secp256k1 keys)
--   2. Manifest table for storing generated Universal Manifests
--      (JSON-LD identity documents with Ed25519 signatures)
--
-- Source blueprints:
--   F-030 (Universal Manifest -- Portable Identity Document)
--   ARCH-003 (Omni-Account Identity)
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Ed25519 Identity Key Support
-- ============================================================
-- Per-user Ed25519 keypairs are stored in the existing
-- social_keys.key_metadata table with:
--   protocol = 'universal-manifest'
--   key_type = 'ed25519-identity'
--   public_key_hash = base64url-encoded SPKI public key
--
-- The private key (PKCS8 PEM) is stored as a separate row with:
--   key_type = 'ed25519-identity-private'
--   public_key_hash = PKCS8 PEM string (Phase 1: server-side)
--
-- Phase 2 will migrate private keys to client-side-only storage.
-- No schema changes needed for social_keys.key_metadata -- the
-- existing schema supports this via protocol/key_type columns.

-- Add public_key_spki column for direct SPKI storage (avoids
-- hash-only lookups when we need the actual public key for
-- manifest embedding and signature verification).
ALTER TABLE social_keys.key_metadata
    ADD COLUMN IF NOT EXISTS public_key_spki TEXT;

COMMENT ON COLUMN social_keys.key_metadata.public_key_spki IS
    'Base64url-encoded SPKI public key. Used for Ed25519 identity keys where the actual public key must be embedded in manifests and verified without external resolution. NULL for legacy key types that only store hashes.';


-- ============================================================
-- 2. Universal Manifest Storage
-- ============================================================
-- Each user has at most one active manifest at a time.
-- Manifests are regenerated on profile update, incrementing
-- the version counter. Old manifests are kept for audit trail.

CREATE TABLE social_keys.user_manifests (
    id              TEXT        PRIMARY KEY,
    user_webid      TEXT        NOT NULL,
    omni_account_id TEXT        NOT NULL,
    manifest_json   JSONB       NOT NULL,
    signed_manifest TEXT        NOT NULL,
    version         INTEGER     NOT NULL DEFAULT 1,
    umid            TEXT        NOT NULL,
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE social_keys.user_manifests IS
    'Universal Manifest storage. Each row is a versioned, signed JSON-LD identity manifest (F-030). Only the latest version per user has is_active=TRUE.';
COMMENT ON COLUMN social_keys.user_manifests.user_webid IS
    'WebID of the manifest subject (matches social_profiles.profile_index.webid)';
COMMENT ON COLUMN social_keys.user_manifests.omni_account_id IS
    'Omni-Account identifier for cross-reference';
COMMENT ON COLUMN social_keys.user_manifests.manifest_json IS
    'The unsigned manifest as JSONB (JSON-LD with @context, @id, @type, facets, consents)';
COMMENT ON COLUMN social_keys.user_manifests.signed_manifest IS
    'The complete signed manifest as a JSON string (manifest_json + signature block)';
COMMENT ON COLUMN social_keys.user_manifests.version IS
    'Monotonically increasing version number. Increments on each regeneration.';
COMMENT ON COLUMN social_keys.user_manifests.umid IS
    'Universal Manifest ID: urn:uuid:<uuidv4>. Immutable for the manifest lifetime.';
COMMENT ON COLUMN social_keys.user_manifests.is_active IS
    'TRUE for the current manifest version. FALSE for historical versions.';


-- ============================================================
-- INDEXES
-- ============================================================

-- Fast lookup by user WebID (active manifest)
CREATE INDEX IF NOT EXISTS idx_manifest_webid_active
    ON social_keys.user_manifests (user_webid)
    WHERE is_active = TRUE;

-- Fast lookup by Omni-Account ID
CREATE INDEX IF NOT EXISTS idx_manifest_omni_account
    ON social_keys.user_manifests (omni_account_id);

-- UMID resolution
CREATE UNIQUE INDEX IF NOT EXISTS idx_manifest_umid
    ON social_keys.user_manifests (umid);

-- Version ordering per user
CREATE INDEX IF NOT EXISTS idx_manifest_user_version
    ON social_keys.user_manifests (user_webid, version DESC);

-- Ed25519 identity key lookup (active keys only)
CREATE INDEX IF NOT EXISTS idx_keys_ed25519_identity
    ON social_keys.key_metadata (omni_account_id, key_type)
    WHERE key_type = 'ed25519-identity' AND is_active = TRUE;


-- ============================================================
-- MIGRATION RECORD
-- ============================================================

INSERT INTO social_pipeline.schema_migrations (version, description)
VALUES ('016', 'Universal Manifest table + Ed25519 identity key support (F-030)')
ON CONFLICT (version) DO NOTHING;

COMMIT;
