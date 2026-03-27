-- ============================================================
-- Social Module: Development Seed Data
-- Migration: 002_seed_test_data
-- Date: 2026-03-21
-- ============================================================
-- Inserts a test profile so health check can verify DB connectivity
-- and schema correctness. This migration should ONLY be applied in
-- development/test environments, never in production.
--
-- To apply:
--   psql -d social_lab -f migrations/002_seed_test_data.sql
-- ============================================================

BEGIN;

-- Test profile: Alice Example (matches DATA-001 Section 3 card example)
INSERT INTO social_profiles.profile_index (
    id,
    webid,
    omni_account_id,
    display_name,
    username,
    bio,
    avatar_url,
    banner_url,
    homepage_url,
    deployment_mode,
    profile_version,
    ap_actor_uri,
    at_did,
    source_pod_uri
) VALUES (
    'test-profile-001',
    'https://alice.solidcommunity.net/profile/card#me',
    'omni-test-001',
    'Alice Example',
    'alice',
    'Test profile for development. Bio text here.',
    'https://alice.solidcommunity.net/media/avatar',
    'https://alice.solidcommunity.net/media/banner',
    'https://alice.example.com',
    'vps',
    '0.1.0',
    'https://peers.social/ap/actor/alice',
    'did:plc:testexample123',
    'https://alice.solidcommunity.net/'
)
ON CONFLICT (id) DO NOTHING;

-- Test bio links for Alice
INSERT INTO social_profiles.bio_links (id, webid, label, url, identifier, sort_order, source_pod_uri)
VALUES
    ('test-link-001', 'https://alice.solidcommunity.net/profile/card#me', 'GitHub', 'https://github.com/alice', 'github', 0, 'https://alice.solidcommunity.net/'),
    ('test-link-002', 'https://alice.solidcommunity.net/profile/card#me', 'Personal Blog', 'https://blog.alice.example.com', 'blog', 1, 'https://alice.solidcommunity.net/')
ON CONFLICT (id) DO NOTHING;

-- Test follow relationship
INSERT INTO social_graph.social_graph (
    follower_webid,
    following_webid,
    relationship,
    source_pod_uri
) VALUES (
    'https://alice.solidcommunity.net/profile/card#me',
    'https://bob.solidcommunity.net/profile/card#me',
    'follow',
    'https://alice.solidcommunity.net/'
)
ON CONFLICT (follower_webid, following_webid, relationship) DO NOTHING;

-- Record this seed migration
INSERT INTO social_pipeline.schema_migrations (version, description)
VALUES ('002', 'Development seed data: test profile (Alice Example)')
ON CONFLICT (version) DO NOTHING;

COMMIT;
