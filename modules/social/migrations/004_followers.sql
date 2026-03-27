-- ============================================================
-- Social Module: Federation Followers Table
-- Migration: 004_followers
-- Date: 2026-03-22
-- ============================================================
-- Adds a followers table to social_graph for tracking remote
-- ActivityPub followers (e.g., Mastodon users following our actors).
-- This is required for the Follow/Accept flow to work.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS social_graph.followers (
    id                TEXT PRIMARY KEY,
    actor_uri         TEXT NOT NULL,
    follower_uri      TEXT NOT NULL,
    follower_inbox    TEXT,
    follower_shared_inbox TEXT,
    follow_activity_id TEXT,
    status            TEXT NOT NULL DEFAULT 'accepted',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(actor_uri, follower_uri)
);

CREATE INDEX IF NOT EXISTS idx_followers_actor ON social_graph.followers(actor_uri);
CREATE INDEX IF NOT EXISTS idx_followers_status ON social_graph.followers(status);

COMMENT ON TABLE social_graph.followers IS
  'Remote ActivityPub followers. Stores actors that have sent Follow activities to our local actors.';
COMMENT ON COLUMN social_graph.followers.actor_uri IS 'Our local actor URI being followed';
COMMENT ON COLUMN social_graph.followers.follower_uri IS 'Remote actor URI (e.g., https://mastodon.social/users/someone)';
COMMENT ON COLUMN social_graph.followers.follower_inbox IS 'Remote actor inbox URL for sending Accept/activities';
COMMENT ON COLUMN social_graph.followers.follower_shared_inbox IS 'Remote actor shared inbox URL (preferred for delivery)';
COMMENT ON COLUMN social_graph.followers.follow_activity_id IS 'Original Follow activity ID for Accept referencing';
COMMENT ON COLUMN social_graph.followers.status IS 'Follow status: pending, accepted, rejected';

-- Record this migration
INSERT INTO social_pipeline.schema_migrations (version, description)
VALUES ('004', 'Add followers table to social_graph for AP Follow/Accept flow')
ON CONFLICT (version) DO NOTHING;

COMMIT;
