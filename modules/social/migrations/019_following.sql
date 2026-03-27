-- ============================================================
-- Social Module: Outbound Following Table
-- Migration: 019_following
-- Date: 2026-03-22
-- ============================================================
-- Adds a following table to social_graph for tracking outbound
-- follow relationships (our local actors following remote actors).
-- The existing followers table tracks INBOUND follows only.
-- Without this table, incoming content from followed remote
-- accounts is silently dropped.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS social_graph.following (
    id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    actor_uri           TEXT NOT NULL,
    following_uri       TEXT NOT NULL,
    following_inbox     TEXT,
    following_shared_inbox TEXT,
    follow_activity_id  TEXT,
    status              TEXT NOT NULL DEFAULT 'pending',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_at         TIMESTAMPTZ,
    UNIQUE(actor_uri, following_uri)
);

CREATE INDEX IF NOT EXISTS idx_following_actor ON social_graph.following(actor_uri);
CREATE INDEX IF NOT EXISTS idx_following_following ON social_graph.following(following_uri);
CREATE INDEX IF NOT EXISTS idx_following_status ON social_graph.following(status);

COMMENT ON TABLE social_graph.following IS
  'Outbound follow relationships. Our local actors following remote actors.';
COMMENT ON COLUMN social_graph.following.actor_uri IS 'Our local actor URI who is doing the following';
COMMENT ON COLUMN social_graph.following.following_uri IS 'Remote actor URI being followed (e.g., https://mastodon.social/users/Gargron)';
COMMENT ON COLUMN social_graph.following.following_inbox IS 'Remote actor inbox URL';
COMMENT ON COLUMN social_graph.following.following_shared_inbox IS 'Remote actor shared inbox URL';
COMMENT ON COLUMN social_graph.following.follow_activity_id IS 'Outbound Follow activity ID for Accept matching';
COMMENT ON COLUMN social_graph.following.status IS 'Follow status: pending, accepted, rejected';

-- Record this migration
INSERT INTO social_pipeline.schema_migrations (version, description)
VALUES ('019', 'Add following table to social_graph for outbound follow state persistence')
ON CONFLICT (version) DO NOTHING;

COMMIT;
