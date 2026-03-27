-- ============================================================
-- Social Module: Webmentions Table
-- Migration: 006_webmentions
-- Date: 2026-03-22
-- ============================================================
-- Adds a webmentions table to social_federation for storing
-- incoming Webmention notifications per W3C Webmention spec.
-- Part of F-008 IndieWeb Stack implementation (Phase 1).
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS social_federation.webmentions (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    target_url      TEXT NOT NULL,
    source_url      TEXT NOT NULL,
    target_handle   TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    verified_at     TIMESTAMPTZ,
    content_snippet TEXT,
    author_name     TEXT,
    author_url      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(source_url, target_url)
);

CREATE INDEX IF NOT EXISTS idx_webmentions_handle
    ON social_federation.webmentions(target_handle);

CREATE INDEX IF NOT EXISTS idx_webmentions_status
    ON social_federation.webmentions(status);

CREATE INDEX IF NOT EXISTS idx_webmentions_target
    ON social_federation.webmentions(target_url);

COMMENT ON TABLE social_federation.webmentions IS
  'Incoming Webmention notifications per W3C Webmention spec. Part of F-008 IndieWeb Stack.';
COMMENT ON COLUMN social_federation.webmentions.target_url IS 'The URL on our domain that was mentioned';
COMMENT ON COLUMN social_federation.webmentions.source_url IS 'The URL of the page containing the mention';
COMMENT ON COLUMN social_federation.webmentions.target_handle IS 'Handle of the profile that owns the target URL';
COMMENT ON COLUMN social_federation.webmentions.status IS 'Processing status: pending, verified, rejected';
COMMENT ON COLUMN social_federation.webmentions.verified_at IS 'When the source was fetched and verified';
COMMENT ON COLUMN social_federation.webmentions.content_snippet IS 'Excerpt from the source page mentioning the target';
COMMENT ON COLUMN social_federation.webmentions.author_name IS 'Author name parsed from source microformats2 h-card';
COMMENT ON COLUMN social_federation.webmentions.author_url IS 'Author URL parsed from source microformats2 h-card';

-- Record this migration
INSERT INTO social_pipeline.schema_migrations (version, description)
VALUES ('006', 'Add webmentions table to social_federation for F-008 IndieWeb Stack')
ON CONFLICT (version) DO NOTHING;

COMMIT;
