-- ============================================================
-- Social Module: Timeline Aggregation
-- Migration: 013_timeline
-- Date: 2026-03-22
-- ============================================================
-- Unified timeline table for incoming content from all protocols.
-- Aggregates posts from followed accounts across ActivityPub,
-- Nostr, AT Protocol, and other federated sources into a single
-- chronological feed per user.
-- ============================================================

BEGIN;

-- Incoming content from all protocols, unified
CREATE TABLE IF NOT EXISTS social_profiles.timeline (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    owner_webid TEXT NOT NULL,
    source_protocol TEXT NOT NULL,
    source_actor_uri TEXT NOT NULL,
    source_post_id TEXT,
    content_text TEXT,
    content_html TEXT,
    media_urls TEXT[] DEFAULT '{}',
    author_name TEXT,
    author_handle TEXT,
    author_avatar_url TEXT,
    in_reply_to TEXT,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ,
    raw_data JSONB
);

-- Primary query: user's timeline sorted by recency
CREATE INDEX IF NOT EXISTS idx_timeline_owner
    ON social_profiles.timeline(owner_webid, received_at DESC);

-- Lookup by source protocol/actor (for dedup, deletion, updates)
CREATE INDEX IF NOT EXISTS idx_timeline_source
    ON social_profiles.timeline(source_protocol, source_actor_uri);

-- Lookup by source_post_id for Delete/Update operations
CREATE INDEX IF NOT EXISTS idx_timeline_source_post_id
    ON social_profiles.timeline(source_post_id)
    WHERE source_post_id IS NOT NULL;

-- Record this migration
INSERT INTO social_pipeline.schema_migrations (version, description)
VALUES ('013', 'Add timeline table for unified cross-protocol feed aggregation')
ON CONFLICT (version) DO NOTHING;

COMMIT;
