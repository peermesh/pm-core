-- ============================================================
-- Social Module: Group Posts (Phase 2 Content Flow)
-- Migration: 022_group_posts
-- Date: 2026-03-23
-- WO: WO-009 Phase 2
-- ============================================================
-- Adds group_id column to social_profiles.posts to associate
-- posts with groups. Nullable FK to social_profiles.groups.
-- ============================================================

BEGIN;

-- Add group_id column (nullable FK to groups)
ALTER TABLE social_profiles.posts
  ADD COLUMN IF NOT EXISTS group_id TEXT
  REFERENCES social_profiles.groups(id) ON DELETE SET NULL;

COMMENT ON COLUMN social_profiles.posts.group_id IS
  'Optional group association. When set, post appears in group timeline.';

-- Index for efficient group timeline queries
CREATE INDEX IF NOT EXISTS idx_posts_group_id
  ON social_profiles.posts(group_id)
  WHERE group_id IS NOT NULL;

-- Compound index for group timeline ordered by date
CREATE INDEX IF NOT EXISTS idx_posts_group_created
  ON social_profiles.posts(group_id, created_at DESC)
  WHERE group_id IS NOT NULL;

-- Record this migration
INSERT INTO social_pipeline.schema_migrations (version, description)
VALUES ('022', 'Add group_id to posts table for group content flow (WO-009 Phase 2)')
ON CONFLICT (version) DO NOTHING;

COMMIT;
