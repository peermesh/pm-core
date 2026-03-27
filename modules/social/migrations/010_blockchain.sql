-- ============================================================
-- Social Module: Blockchain Protocol Surface (Lens + Farcaster)
-- Migration: 010_blockchain
-- Date: 2026-03-22
-- ============================================================
-- Adds protocol identity columns for F-017 (Lens) and F-018 (Farcaster):
--   1. lens_profile_id  — Lens Profile ID (ERC-721 NFT on Polygon)
--   2. farcaster_fid    — Farcaster ID (FID on Optimism, opt-in only)
--
-- Lens integration is an optional protocol adapter within the
-- Omni-Account framework. Wallet provisioning is transparent or
-- deferred per F-017 blueprint.
--
-- Farcaster integration is explicitly low-priority and user-
-- initiated only. All Farcaster code paths are behind feature
-- flags per F-018 blueprint. Protocol viability is uncertain.
-- ============================================================

BEGIN;

-- 1. Add lens_profile_id column to profile_index (F-017)
ALTER TABLE social_profiles.profile_index
    ADD COLUMN IF NOT EXISTS lens_profile_id TEXT;

COMMENT ON COLUMN social_profiles.profile_index.lens_profile_id IS
    'Lens Protocol Profile ID (hex, ERC-721 NFT on Polygon). Optional protocol adapter within Omni-Account. See F-017.';

-- Index for Lens Profile ID lookups
CREATE INDEX IF NOT EXISTS idx_profile_lens_profile_id
    ON social_profiles.profile_index (lens_profile_id)
    WHERE lens_profile_id IS NOT NULL;

-- 2. Add farcaster_fid column to profile_index (F-018)
--    Nullable: opt-in only, never auto-provisioned.
ALTER TABLE social_profiles.profile_index
    ADD COLUMN IF NOT EXISTS farcaster_fid TEXT;

COMMENT ON COLUMN social_profiles.profile_index.farcaster_fid IS
    'Farcaster ID (FID on Optimism). User-initiated opt-in only. Behind feature flag. Protocol viability uncertain. See F-018.';

-- Index for Farcaster FID lookups
CREATE INDEX IF NOT EXISTS idx_profile_farcaster_fid
    ON social_profiles.profile_index (farcaster_fid)
    WHERE farcaster_fid IS NOT NULL;

-- Record this migration
INSERT INTO social_pipeline.schema_migrations (version, description)
VALUES ('010', 'Add lens_profile_id and farcaster_fid to profile_index for F-017/F-018')
ON CONFLICT (version) DO NOTHING;

COMMIT;
