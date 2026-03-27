-- ============================================================
-- Social Module: Matrix + XMTP Identity Bridge
-- Migration: 009_matrix_xmtp
-- Date: 2026-03-22
-- ============================================================
-- Adds Matrix and XMTP identity bridge columns to profile_index:
--   1. matrix_id column (e.g., @alice:peers.social)
--   2. xmtp_address column (Ethereum address, e.g., 0x1234...abcd)
--
-- These are IDENTITY BRIDGES ONLY -- NOT chat implementations.
-- Per CEO-MANDATORY-VISION Section 4: chat is NOT part of
-- Social. Matrix and XMTP messaging is handled by external
-- clients or separate modules.
--
-- Source blueprints: F-015 (Matrix), F-016 (XMTP)
-- ============================================================

BEGIN;

-- 1. Add matrix_id column to profile_index
ALTER TABLE social_profiles.profile_index
    ADD COLUMN IF NOT EXISTS matrix_id TEXT;

COMMENT ON COLUMN social_profiles.profile_index.matrix_id IS
    'Matrix user ID (@user:domain). Identity bridge only -- no messaging in Social. See F-015.';

-- Index for Matrix ID lookups (identity bridge resolution)
CREATE INDEX IF NOT EXISTS idx_profile_matrix_id
    ON social_profiles.profile_index (matrix_id)
    WHERE matrix_id IS NOT NULL;

-- 2. Add xmtp_address column to profile_index
ALTER TABLE social_profiles.profile_index
    ADD COLUMN IF NOT EXISTS xmtp_address TEXT;

COMMENT ON COLUMN social_profiles.profile_index.xmtp_address IS
    'XMTP-capable Ethereum address (0x...). Identity bridge only -- no messaging in Social. See F-016.';

-- Index for XMTP address lookups (identity bridge resolution)
CREATE INDEX IF NOT EXISTS idx_profile_xmtp_address
    ON social_profiles.profile_index (xmtp_address)
    WHERE xmtp_address IS NOT NULL;

-- Record this migration
INSERT INTO social_pipeline.schema_migrations (version, description)
VALUES ('009', 'Add matrix_id and xmtp_address to profile_index for F-015/F-016 identity bridges')
ON CONFLICT (version) DO NOTHING;

COMMIT;
