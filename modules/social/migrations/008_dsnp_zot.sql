-- ============================================================
-- Social Module: DSNP + Zot Protocol Surface
-- Migration: 008_dsnp_zot
-- Date: 2026-03-22
-- ============================================================
-- Adds protocol identity columns for F-011 (DSNP) and F-012 (Zot):
--   1. dsnp_user_id  — DSNP User ID on Frequency blockchain
--   2. zot_channel_hash — Zot channel hash for discovery
--
-- Both protocols are stub integrations at this stage.
-- DSNP User IDs will be provisioned on Frequency in a later phase.
-- Zot channel hashes will be generated during channel creation.
-- ============================================================

BEGIN;

-- 1. Add dsnp_user_id column to profile_index (F-011)
ALTER TABLE social_profiles.profile_index
    ADD COLUMN IF NOT EXISTS dsnp_user_id TEXT;

COMMENT ON COLUMN social_profiles.profile_index.dsnp_user_id IS
    'DSNP User ID (numeric, from Frequency blockchain MSA). Provisioned during Omni-Account creation. See F-011.';

-- Index for DSNP User ID lookups
CREATE INDEX IF NOT EXISTS idx_profile_dsnp_user_id
    ON social_profiles.profile_index (dsnp_user_id)
    WHERE dsnp_user_id IS NOT NULL;

-- 2. Add zot_channel_hash column to profile_index (F-012)
ALTER TABLE social_profiles.profile_index
    ADD COLUMN IF NOT EXISTS zot_channel_hash TEXT;

COMMENT ON COLUMN social_profiles.profile_index.zot_channel_hash IS
    'Zot channel hash for cross-server identity discovery. Generated during channel provisioning. See F-012.';

-- Index for Zot channel hash lookups
CREATE INDEX IF NOT EXISTS idx_profile_zot_channel_hash
    ON social_profiles.profile_index (zot_channel_hash)
    WHERE zot_channel_hash IS NOT NULL;

-- Record this migration
INSERT INTO social_pipeline.schema_migrations (version, description)
VALUES ('008', 'Add dsnp_user_id and zot_channel_hash to profile_index for F-011/F-012')
ON CONFLICT (version) DO NOTHING;

COMMIT;
