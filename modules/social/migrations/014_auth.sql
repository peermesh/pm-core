-- ============================================================
-- Social Module: Authentication Schema
-- Migration: 014_auth
-- Date: 2026-03-22
-- ============================================================
-- Adds basic username/password authentication for Studio access.
-- Phase 1: session-based auth with signed cookies.
-- Phase 2 (future): Solid-OIDC integration.
-- ============================================================

BEGIN;

-- Auth credentials table — links to profile_index
CREATE TABLE IF NOT EXISTS social_profiles.auth (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    profile_id TEXT NOT NULL UNIQUE REFERENCES social_profiles.profile_index(id) ON DELETE CASCADE,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
);

COMMENT ON TABLE social_profiles.auth IS
  'Basic authentication credentials for Studio access. Phase 1: username/password with scrypt hashing. Password format: salt:hash.';
COMMENT ON COLUMN social_profiles.auth.profile_id IS 'FK to profile_index.id — one auth record per profile';
COMMENT ON COLUMN social_profiles.auth.username IS 'Login username (unique, used for authentication)';
COMMENT ON COLUMN social_profiles.auth.password_hash IS 'scrypt hash in format salt:derivedKey (hex encoded)';
COMMENT ON COLUMN social_profiles.auth.last_login_at IS 'Timestamp of most recent successful login';

CREATE INDEX idx_auth_username ON social_profiles.auth(username);

-- Record this migration
INSERT INTO social_pipeline.schema_migrations (version, description)
VALUES ('014', 'Auth table for Studio session-based authentication');

COMMIT;
