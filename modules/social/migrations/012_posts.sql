-- ============================================================
-- Social Module: Posts and Distribution Tables
-- Migration: 012_posts
-- Date: 2026-03-22
-- ============================================================
-- Adds posts table to social_profiles for user-created content,
-- and post_distribution table to social_federation for tracking
-- cross-protocol distribution status.
-- ============================================================

BEGIN;

-- Posts: user-created content entries
CREATE TABLE IF NOT EXISTS social_profiles.posts (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    webid TEXT NOT NULL REFERENCES social_profiles.profile_index(webid) ON DELETE CASCADE,
    content_text TEXT NOT NULL,
    content_html TEXT,
    media_urls TEXT[] DEFAULT '{}',
    visibility TEXT NOT NULL DEFAULT 'public',
    in_reply_to TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_posts_webid ON social_profiles.posts(webid);
CREATE INDEX IF NOT EXISTS idx_posts_created ON social_profiles.posts(created_at DESC);

COMMENT ON TABLE social_profiles.posts IS
  'User-created content entries. Each post can be distributed across multiple federation protocols.';
COMMENT ON COLUMN social_profiles.posts.content_text IS 'Plain text content of the post';
COMMENT ON COLUMN social_profiles.posts.content_html IS 'Optional HTML-formatted content';
COMMENT ON COLUMN social_profiles.posts.media_urls IS 'Array of media attachment URLs';
COMMENT ON COLUMN social_profiles.posts.visibility IS 'Post visibility: public, unlisted, followers, direct';
COMMENT ON COLUMN social_profiles.posts.in_reply_to IS 'URI of the post this is replying to (cross-protocol)';

-- Track which protocols a post was distributed to
CREATE TABLE IF NOT EXISTS social_federation.post_distribution (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    post_id TEXT NOT NULL,
    protocol TEXT NOT NULL,
    remote_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    distributed_at TIMESTAMPTZ,
    error TEXT,
    UNIQUE(post_id, protocol)
);

CREATE INDEX IF NOT EXISTS idx_post_dist_post ON social_federation.post_distribution(post_id);
CREATE INDEX IF NOT EXISTS idx_post_dist_status ON social_federation.post_distribution(status);

COMMENT ON TABLE social_federation.post_distribution IS
  'Tracks cross-protocol distribution status for each post. One row per post-protocol combination.';
COMMENT ON COLUMN social_federation.post_distribution.post_id IS 'References social_profiles.posts(id)';
COMMENT ON COLUMN social_federation.post_distribution.protocol IS 'Protocol name: activitypub, nostr, rss, indieweb, atproto';
COMMENT ON COLUMN social_federation.post_distribution.remote_id IS 'Protocol-specific remote identifier (e.g., AP note URI, Nostr event ID)';
COMMENT ON COLUMN social_federation.post_distribution.status IS 'Distribution status: pending, sent, failed, deleted';
COMMENT ON COLUMN social_federation.post_distribution.distributed_at IS 'Timestamp when successfully distributed';
COMMENT ON COLUMN social_federation.post_distribution.error IS 'Error message if distribution failed';

-- Record this migration
INSERT INTO social_pipeline.schema_migrations (version, description)
VALUES ('012', 'Add posts and post_distribution tables for content posting with cross-protocol distribution')
ON CONFLICT (version) DO NOTHING;

COMMIT;
