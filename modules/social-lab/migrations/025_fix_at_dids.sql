-- ============================================================
-- Social Lab Module: Fix AT Protocol DIDs for Production Domain
-- Migration: 025_fix_at_dids
-- Date: 2026-03-23
-- ============================================================
-- Migration 007 baked 'social.dockerlab.peermesh.org' into AT
-- Protocol DIDs. For peers.social and any other deployment,
-- these must be domain-variable.
--
-- This migration is safe to run on any deployment — it derives
-- the correct domain from each profile's source_pod_uri, which
-- was set at profile creation time using the live BASE_URL env var.
-- ============================================================

BEGIN;

-- Fix AT Protocol DIDs to use the current domain.
-- Derives the hostname from source_pod_uri so this works on any
-- deployment without needing a SQL-level env var.
UPDATE social_profiles.profile_index
SET at_did = 'did:web:' ||
    regexp_replace(source_pod_uri, '^https?://([^/]+)/.*$', '\1') ||
    ':ap:actor:' || username,
    updated_at = NOW()
WHERE at_did IS NOT NULL
  AND at_did LIKE '%dockerlab%';

-- Fix ActivityPub actor URIs that were baked with the wrong domain.
-- Reconstructs the /ap/actor/{username} path from source_pod_uri.
UPDATE social_profiles.profile_index
SET ap_actor_uri = regexp_replace(
    source_pod_uri, '/pod/.*$', '/ap/actor/' || username
),
    updated_at = NOW()
WHERE ap_actor_uri IS NOT NULL
  AND ap_actor_uri LIKE '%dockerlab%';

-- Record this migration
INSERT INTO social_pipeline.schema_migrations (version, description)
VALUES ('025', 'Fix AT Protocol DIDs and AP actor URIs to be domain-variable')
ON CONFLICT (version) DO NOTHING;

COMMIT;
