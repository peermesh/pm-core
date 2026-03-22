-- ============================================================
-- Social Lab Module: AT Protocol Surface
-- Migration: 007_at_protocol
-- Date: 2026-03-22
-- ============================================================
-- Adds AT Protocol DID (did:web) support:
--   1. Populate at_did column for existing profiles
--   2. Add index on at_did for DID resolution lookups
--
-- The at_did column already exists in the schema from 001.
-- This migration populates it for existing profiles that lack
-- a DID value, using the did:web:{domain}:ap:actor:{handle}
-- format per F-005 blueprint.
-- ============================================================

BEGIN;

-- 1. Backfill at_did for existing profiles that have a username but no DID
UPDATE social_profiles.profile_index
SET at_did = 'did:web:social.dockerlab.peermesh.org:ap:actor:' || username,
    updated_at = NOW()
WHERE username IS NOT NULL
  AND (at_did IS NULL OR at_did = '');

-- 2. Index for DID resolution lookups
CREATE INDEX IF NOT EXISTS idx_profile_at_did
    ON social_profiles.profile_index (at_did)
    WHERE at_did IS NOT NULL;

-- Record this migration
INSERT INTO social_pipeline.schema_migrations (version, description)
VALUES ('007', 'AT Protocol DID backfill and index for F-005')
ON CONFLICT (version) DO NOTHING;

COMMIT;
