-- ============================================================
-- Social Lab Module: Data Sync Protocol Surface (Hypercore + Braid)
-- Migration: 011_datasync
-- Date: 2026-03-22
-- ============================================================
-- Adds protocol identity column for F-013 (Hypercore/Pear Integration):
--   1. hypercore_feed_key — Hypercore feed public key (ed25519, hex-encoded)
--
-- Hypercore is an optional P2P data layer that complements the Solid Pod.
-- The feed key is generated during the Omni-Account provisioning pipeline
-- (Step 5, parallel with ActivityPub Actor, AT Protocol DID, Nostr keypair).
--
-- Braid (F-014) does not require schema changes -- it operates as HTTP
-- middleware extending existing endpoints with Version/Subscribe headers.
-- ============================================================

BEGIN;

-- 1. Add hypercore_feed_key column to profile_index (F-013)
--    Stores the hex-encoded ed25519 public key of the user's Hypercore feed.
--    Nullable: Hypercore is an optional protocol adapter, not all profiles
--    will have a feed initialized.
ALTER TABLE social_profiles.profile_index
    ADD COLUMN IF NOT EXISTS hypercore_feed_key TEXT;

COMMENT ON COLUMN social_profiles.profile_index.hypercore_feed_key IS
    'Hypercore feed public key (ed25519, hex-encoded). Optional P2P data layer complement to Solid Pod. See F-013.';

-- Index for Hypercore feed key lookups (peer discovery, cross-linking)
CREATE INDEX IF NOT EXISTS idx_profile_hypercore_feed_key
    ON social_profiles.profile_index (hypercore_feed_key)
    WHERE hypercore_feed_key IS NOT NULL;

-- Record this migration
INSERT INTO social_pipeline.schema_migrations (version, description)
VALUES ('011', 'Add hypercore_feed_key to profile_index for F-013 Hypercore/Pear integration')
ON CONFLICT (version) DO NOTHING;

COMMIT;
