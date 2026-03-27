-- ============================================================
-- Social Module: Nostr Protocol Identity
-- Migration: 005_nostr_keys
-- Date: 2026-03-22
-- ============================================================
-- Adds Nostr (secp256k1) identity support:
--   1. nostr_npub column on social_profiles.profile_index
--   2. Nostr key entries tracked in social_keys.key_metadata
--
-- The npub (bech32-encoded public key) is the user's Nostr
-- identity. The nsec (private key) is stored server-side in
-- Phase 1 for the Omni-Account pipeline. Phase 2 will migrate
-- nsec to client-side-only storage per F-007 blueprint.
-- ============================================================

BEGIN;

-- 1. Add nostr_npub column to profile_index
ALTER TABLE social_profiles.profile_index
    ADD COLUMN IF NOT EXISTS nostr_npub TEXT;

COMMENT ON COLUMN social_profiles.profile_index.nostr_npub IS
    'Nostr public key in NIP-19 bech32 encoding (npub1...). Provisioned during Omni-Account creation. See F-007.';

-- Index for NIP-05 lookups (username -> nostr_npub)
CREATE INDEX IF NOT EXISTS idx_profile_nostr_npub
    ON social_profiles.profile_index (nostr_npub)
    WHERE nostr_npub IS NOT NULL;

-- 2. Backfill existing profiles: handled by application code on next profile access.
--    No data migration needed since no profiles have Nostr keys yet.

-- Record this migration
INSERT INTO social_pipeline.schema_migrations (version, description)
VALUES ('005', 'Add nostr_npub to profile_index, Nostr key support for F-007')
ON CONFLICT (version) DO NOTHING;

COMMIT;
