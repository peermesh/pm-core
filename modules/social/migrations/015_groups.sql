-- ============================================================
-- Social Module: Universal Group System (Phase 1)
-- Migration: 015_groups
-- Date: 2026-03-22
-- Blueprint: ARCH-011 (Universal Group System)
-- ============================================================
-- Creates the groups table, group_memberships table, and
-- group_taxonomy_tags table. Seeds the ecosystem root group
-- and auto-registers this instance as a platform group.
-- ============================================================

BEGIN;

-- ============================================================
-- Enable pg_trgm extension for GIN trigram indexes on path
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- Universal group object: one table for all organizational levels
-- Per ARCH-011 Section 1: No subclasses, no type-specific tables.
-- ============================================================
CREATE TABLE IF NOT EXISTS social_profiles.groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'user'
        CHECK (type IN ('ecosystem', 'platform', 'category', 'topic', 'user', 'custom')),
    parent_id TEXT REFERENCES social_profiles.groups(id) ON DELETE SET NULL,
    path TEXT NOT NULL,
    description TEXT,
    avatar_url TEXT,
    banner_url TEXT,
    visibility TEXT NOT NULL DEFAULT 'public'
        CHECK (visibility IN ('public', 'private', 'unlisted')),
    membership_policy TEXT NOT NULL DEFAULT 'open'
        CHECK (membership_policy IN ('open', 'request', 'invite')),
    taxonomy_type TEXT
        CHECK (taxonomy_type IN ('geography', 'interest', 'watershed', 'county', 'custom') OR taxonomy_type IS NULL),
    metadata JSONB DEFAULT '{}',
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE social_profiles.groups IS
  'Universal group object per ARCH-011. One table for ecosystem, platform, category, topic, user, and custom group types.';
COMMENT ON COLUMN social_profiles.groups.type IS 'Group type: ecosystem, platform, category, topic, user, custom';
COMMENT ON COLUMN social_profiles.groups.parent_id IS 'Parent group ID for recursive hierarchy. NULL = top-level (ecosystem root only).';
COMMENT ON COLUMN social_profiles.groups.path IS 'Materialized path for hierarchy queries: /ecosystem/platform-slug/category/topic';
COMMENT ON COLUMN social_profiles.groups.visibility IS 'Group visibility: public, private, unlisted';
COMMENT ON COLUMN social_profiles.groups.membership_policy IS 'Join policy: open (instant), request (approval needed), invite (invitation only)';
COMMENT ON COLUMN social_profiles.groups.taxonomy_type IS 'Platform-defined taxonomy category: geography, interest, watershed, county, custom';
COMMENT ON COLUMN social_profiles.groups.metadata IS 'Flexible JSONB store for platform config, permissions, branding, taxonomies';
COMMENT ON COLUMN social_profiles.groups.created_by IS 'WebID of the creating user (NULL for system-created groups)';

-- Indexes for hierarchy queries (per ARCH-011 Section 2)
CREATE INDEX IF NOT EXISTS idx_groups_parent_id ON social_profiles.groups(parent_id);
CREATE INDEX IF NOT EXISTS idx_groups_path_trgm ON social_profiles.groups USING gin(path gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_groups_path_prefix ON social_profiles.groups(path text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_groups_type ON social_profiles.groups(type);
CREATE INDEX IF NOT EXISTS idx_groups_taxonomy ON social_profiles.groups(taxonomy_type) WHERE taxonomy_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_groups_visibility ON social_profiles.groups(visibility);
CREATE INDEX IF NOT EXISTS idx_groups_created_by ON social_profiles.groups(created_by) WHERE created_by IS NOT NULL;

-- ============================================================
-- Group memberships
-- Per ARCH-011 Section 4: Membership record with roles.
-- ============================================================
CREATE TABLE IF NOT EXISTS social_profiles.group_memberships (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES social_profiles.groups(id) ON DELETE CASCADE,
    user_webid TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member'
        CHECK (role IN ('member', 'moderator', 'admin', 'owner')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(group_id, user_webid)
);

COMMENT ON TABLE social_profiles.group_memberships IS
  'Group membership records per ARCH-011 Section 4. Roles: member, moderator, admin, owner.';

CREATE INDEX IF NOT EXISTS idx_memberships_group ON social_profiles.group_memberships(group_id);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON social_profiles.group_memberships(user_webid);
CREATE INDEX IF NOT EXISTS idx_memberships_role ON social_profiles.group_memberships(role);

-- ============================================================
-- Cross-taxonomy tagging
-- Per ARCH-011 Section 3: A group can belong to multiple taxonomy facets.
-- ============================================================
CREATE TABLE IF NOT EXISTS social_profiles.group_taxonomy_tags (
    group_id TEXT NOT NULL REFERENCES social_profiles.groups(id) ON DELETE CASCADE,
    taxonomy_type TEXT NOT NULL,
    taxonomy_value TEXT NOT NULL,
    PRIMARY KEY (group_id, taxonomy_type)
);

COMMENT ON TABLE social_profiles.group_taxonomy_tags IS
  'Cross-taxonomy tagging per ARCH-011 Section 3. Allows a group to span multiple taxonomy facets.';

CREATE INDEX IF NOT EXISTS idx_taxonomy_tags_type ON social_profiles.group_taxonomy_tags(taxonomy_type);
CREATE INDEX IF NOT EXISTS idx_taxonomy_tags_value ON social_profiles.group_taxonomy_tags(taxonomy_value);

-- ============================================================
-- Triggers
-- ============================================================

-- Auto-update updated_at on modification
CREATE OR REPLACE FUNCTION social_profiles.update_group_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS groups_update_timestamp ON social_profiles.groups;
CREATE TRIGGER groups_update_timestamp
    BEFORE UPDATE ON social_profiles.groups
    FOR EACH ROW
    EXECUTE FUNCTION social_profiles.update_group_timestamp();

-- Cascade path updates when a group is re-parented
CREATE OR REPLACE FUNCTION social_profiles.cascade_group_path_update()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.path IS DISTINCT FROM NEW.path THEN
        UPDATE social_profiles.groups
        SET path = REPLACE(path, OLD.path, NEW.path)
        WHERE path LIKE OLD.path || '/%';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS groups_cascade_path ON social_profiles.groups;
CREATE TRIGGER groups_cascade_path
    AFTER UPDATE OF path ON social_profiles.groups
    FOR EACH ROW
    EXECUTE FUNCTION social_profiles.cascade_group_path_update();

-- ============================================================
-- Seed data: Ecosystem root group
-- Per ARCH-011 Section 7: Ecosystem group auto-created on first boot.
-- ============================================================
INSERT INTO social_profiles.groups (id, name, type, parent_id, path, description, visibility, membership_policy, created_at)
VALUES (
    'ecosystem-root',
    'PeerMesh Ecosystem',
    'ecosystem',
    NULL,
    '/ecosystem',
    'The PeerMesh meta-network root',
    'public',
    'open',
    NOW()
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Record this migration
-- ============================================================
INSERT INTO social_pipeline.schema_migrations (version, description)
VALUES ('015', 'Universal Group System Phase 1: groups, group_memberships, group_taxonomy_tags tables with ecosystem seed')
ON CONFLICT (version) DO NOTHING;

COMMIT;
