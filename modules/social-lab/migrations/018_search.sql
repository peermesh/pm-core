-- ============================================================
-- Social Lab Module: Full-Text Search & Discovery
-- Migration: 018_search
-- Date: 2026-03-22
-- Blueprint: F-028 (Federated Search & Discovery)
-- ============================================================
-- Adds PostgreSQL full-text search indexes on profiles and posts,
-- a search_log table for analytics, and a hashtag_index table
-- for trending topic computation.
-- ============================================================

BEGIN;

-- ============================================================
-- Enable required extensions
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- already enabled in 015, safe to repeat
CREATE EXTENSION IF NOT EXISTS unaccent;  -- for accent-insensitive search

-- ============================================================
-- 1. Full-text search on profiles
-- ============================================================
-- Add a tsvector column to profile_index for combined
-- display_name + username + bio full-text search.

ALTER TABLE social_profiles.profile_index
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Populate existing rows
UPDATE social_profiles.profile_index
SET search_vector = to_tsvector('english',
  COALESCE(display_name, '') || ' ' ||
  COALESCE(username, '') || ' ' ||
  COALESCE(bio, '')
);

-- GIN index for fast full-text queries
CREATE INDEX IF NOT EXISTS idx_profile_search_vector
  ON social_profiles.profile_index USING gin(search_vector);

-- Trigram index on display_name for fuzzy / prefix autocomplete
CREATE INDEX IF NOT EXISTS idx_profile_display_name_trgm
  ON social_profiles.profile_index USING gin(display_name gin_trgm_ops);

-- Trigram index on username for fuzzy / prefix autocomplete
CREATE INDEX IF NOT EXISTS idx_profile_username_trgm
  ON social_profiles.profile_index USING gin(username gin_trgm_ops);

-- Trigger: auto-update search_vector on INSERT or UPDATE
CREATE OR REPLACE FUNCTION social_profiles.update_profile_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    COALESCE(NEW.display_name, '') || ' ' ||
    COALESCE(NEW.username, '') || ' ' ||
    COALESCE(NEW.bio, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS profile_search_vector_update ON social_profiles.profile_index;
CREATE TRIGGER profile_search_vector_update
  BEFORE INSERT OR UPDATE OF display_name, username, bio
  ON social_profiles.profile_index
  FOR EACH ROW
  EXECUTE FUNCTION social_profiles.update_profile_search_vector();

-- ============================================================
-- 2. Full-text search on posts
-- ============================================================
-- Add a tsvector column to posts for content full-text search.

ALTER TABLE social_profiles.posts
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Add a hashtags array column extracted from content
ALTER TABLE social_profiles.posts
  ADD COLUMN IF NOT EXISTS hashtags TEXT[] DEFAULT '{}';

-- Populate existing rows
UPDATE social_profiles.posts
SET search_vector = to_tsvector('english', COALESCE(content_text, ''));

-- GIN index for fast full-text queries
CREATE INDEX IF NOT EXISTS idx_posts_search_vector
  ON social_profiles.posts USING gin(search_vector);

-- GIN index on hashtags array for tag-based lookups
CREATE INDEX IF NOT EXISTS idx_posts_hashtags
  ON social_profiles.posts USING gin(hashtags);

-- Trigger: auto-update search_vector on INSERT or UPDATE
CREATE OR REPLACE FUNCTION social_profiles.update_post_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', COALESCE(NEW.content_text, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS post_search_vector_update ON social_profiles.posts;
CREATE TRIGGER post_search_vector_update
  BEFORE INSERT OR UPDATE OF content_text
  ON social_profiles.posts
  FOR EACH ROW
  EXECUTE FUNCTION social_profiles.update_post_search_vector();

-- ============================================================
-- 3. Search log table
-- ============================================================
-- Tracks search queries for analytics, trending computation,
-- and search quality improvement.

CREATE TABLE IF NOT EXISTS social_pipeline.search_log (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  query TEXT NOT NULL,
  search_type TEXT NOT NULL DEFAULT 'all'
    CHECK (search_type IN ('profiles', 'posts', 'groups', 'all', 'suggestions')),
  results_count INTEGER NOT NULL DEFAULT 0,
  user_webid TEXT,
  searched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_search_log_query
  ON social_pipeline.search_log(query);
CREATE INDEX IF NOT EXISTS idx_search_log_searched_at
  ON social_pipeline.search_log(searched_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_log_user
  ON social_pipeline.search_log(user_webid)
  WHERE user_webid IS NOT NULL;

COMMENT ON TABLE social_pipeline.search_log IS
  'Search query log for analytics, trending topic computation, and search quality improvement. Per F-028.';
COMMENT ON COLUMN social_pipeline.search_log.query IS 'The raw search query string';
COMMENT ON COLUMN social_pipeline.search_log.search_type IS 'Type of search: profiles, posts, groups, all, suggestions';
COMMENT ON COLUMN social_pipeline.search_log.results_count IS 'Number of results returned for this query';
COMMENT ON COLUMN social_pipeline.search_log.user_webid IS 'WebID of the user who searched (NULL for anonymous)';
COMMENT ON COLUMN social_pipeline.search_log.searched_at IS 'Timestamp of the search query';

-- ============================================================
-- 4. Hashtag index table (for trending topics)
-- ============================================================
-- Aggregated hashtag counts updated incrementally as posts
-- are created. Supports trending computation via time-decayed scoring.

CREATE TABLE IF NOT EXISTS social_profiles.hashtag_index (
  tag TEXT PRIMARY KEY,
  count_24h INTEGER NOT NULL DEFAULT 0,
  count_7d INTEGER NOT NULL DEFAULT 0,
  count_total INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hashtag_count_total
  ON social_profiles.hashtag_index(count_total DESC);
CREATE INDEX IF NOT EXISTS idx_hashtag_last_used
  ON social_profiles.hashtag_index(last_used_at DESC);

COMMENT ON TABLE social_profiles.hashtag_index IS
  'Aggregated hashtag counts for trending topic computation. Per F-028 Mechanic 3.';
COMMENT ON COLUMN social_profiles.hashtag_index.tag IS 'Normalized tag (lowercase, no # prefix, NFC unicode)';
COMMENT ON COLUMN social_profiles.hashtag_index.count_24h IS 'Number of uses in the last 24 hours (refreshed periodically)';
COMMENT ON COLUMN social_profiles.hashtag_index.count_7d IS 'Number of uses in the last 7 days (refreshed periodically)';
COMMENT ON COLUMN social_profiles.hashtag_index.count_total IS 'Total number of uses across all time';

-- ============================================================
-- 5. Full-text search on groups (name + description)
-- ============================================================

ALTER TABLE social_profiles.groups
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

UPDATE social_profiles.groups
SET search_vector = to_tsvector('english',
  COALESCE(name, '') || ' ' ||
  COALESCE(description, '')
);

CREATE INDEX IF NOT EXISTS idx_groups_search_vector
  ON social_profiles.groups USING gin(search_vector);

CREATE OR REPLACE FUNCTION social_profiles.update_group_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    COALESCE(NEW.name, '') || ' ' ||
    COALESCE(NEW.description, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS group_search_vector_update ON social_profiles.groups;
CREATE TRIGGER group_search_vector_update
  BEFORE INSERT OR UPDATE OF name, description
  ON social_profiles.groups
  FOR EACH ROW
  EXECUTE FUNCTION social_profiles.update_group_search_vector();

-- ============================================================
-- Record this migration
-- ============================================================
INSERT INTO social_pipeline.schema_migrations (version, description)
VALUES ('018', 'Full-text search indexes on profiles, posts, groups; search_log table; hashtag_index table. Per F-028.')
ON CONFLICT (version) DO NOTHING;

COMMIT;
