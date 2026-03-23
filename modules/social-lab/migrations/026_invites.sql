-- ============================================================
-- Social Lab Module: Invite System Schema
-- Migration: 026_invites
-- Date: 2026-03-23
-- ============================================================
-- Implements invite-only registration gating, invitation tree
-- tracking, and invite request system per F-031 blueprint.
--
-- Tables:
--   social_profiles.invite_codes      — invite code records
--   social_profiles.invitation_tree   — who-invited-whom tree
--   social_profiles.invite_requests   — pool replenishment requests
--
-- Controlled by REGISTRATION_MODE env var:
--   invite-only | open | waitlist
-- ============================================================

BEGIN;

-- ==========================================================
-- 1. Invite Codes
-- ==========================================================

CREATE TABLE IF NOT EXISTS social_profiles.invite_codes (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    code            VARCHAR(20) UNIQUE NOT NULL,
    created_by_webid TEXT NOT NULL,
    used_by_webid   TEXT,
    status          VARCHAR(16) NOT NULL DEFAULT 'active',
    max_uses        INTEGER NOT NULL DEFAULT 1,
    use_count       INTEGER NOT NULL DEFAULT 0,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    used_at         TIMESTAMPTZ,
    revoked_at      TIMESTAMPTZ,
    metadata        JSONB
);

COMMENT ON TABLE social_profiles.invite_codes IS
  'Invite codes for gated registration. F-031.';
COMMENT ON COLUMN social_profiles.invite_codes.code IS
  'Human-readable code in PREFIX-XXXX-XXXX format';
COMMENT ON COLUMN social_profiles.invite_codes.status IS
  'active | used | exhausted | expired | revoked';
COMMENT ON COLUMN social_profiles.invite_codes.max_uses IS
  '1 for single-use, >1 for multi-use codes';
COMMENT ON COLUMN social_profiles.invite_codes.use_count IS
  'Number of times this code has been redeemed';

-- Indexes for code lookup, creator filtering, status queries
CREATE INDEX IF NOT EXISTS idx_invite_codes_created_by
    ON social_profiles.invite_codes(created_by_webid);
CREATE INDEX IF NOT EXISTS idx_invite_codes_status
    ON social_profiles.invite_codes(status);
CREATE INDEX IF NOT EXISTS idx_invite_codes_expires_at
    ON social_profiles.invite_codes(expires_at);

-- ==========================================================
-- 2. Invitation Tree
-- ==========================================================

CREATE TABLE IF NOT EXISTS social_profiles.invitation_tree (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    inviter_webid   TEXT NOT NULL,
    invitee_webid   TEXT NOT NULL UNIQUE,
    invite_code     VARCHAR(20) NOT NULL REFERENCES social_profiles.invite_codes(code),
    depth           INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE social_profiles.invitation_tree IS
  'Tracks who-invited-whom relationships with pre-computed depth. F-031.';
COMMENT ON COLUMN social_profiles.invitation_tree.depth IS
  'Depth in the invitation tree (root=0, their invitees=1, etc). Computed at insert time: parent.depth + 1.';

-- Indexes for tree traversal and analytics
CREATE INDEX IF NOT EXISTS idx_invitation_tree_inviter
    ON social_profiles.invitation_tree(inviter_webid);
CREATE INDEX IF NOT EXISTS idx_invitation_tree_depth
    ON social_profiles.invitation_tree(depth);
CREATE INDEX IF NOT EXISTS idx_invitation_tree_created_at
    ON social_profiles.invitation_tree(created_at);

-- ==========================================================
-- 3. Invite Requests (pool replenishment)
-- ==========================================================

CREATE TABLE IF NOT EXISTS social_profiles.invite_requests (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    requester_webid TEXT NOT NULL,
    reason          TEXT,
    status          VARCHAR(16) NOT NULL DEFAULT 'pending',
    requested_count INTEGER NOT NULL DEFAULT 5,
    approved_by_webid TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at     TIMESTAMPTZ
);

COMMENT ON TABLE social_profiles.invite_requests IS
  'User requests for additional invite codes (pool replenishment). F-031.';
COMMENT ON COLUMN social_profiles.invite_requests.status IS
  'pending | approved | denied';

CREATE INDEX IF NOT EXISTS idx_invite_requests_requester
    ON social_profiles.invite_requests(requester_webid);
CREATE INDEX IF NOT EXISTS idx_invite_requests_status
    ON social_profiles.invite_requests(status);

-- ==========================================================
-- 4. Generate initial admin invite codes
-- ==========================================================
-- 10 admin codes created by a placeholder admin WebID.
-- These codes are valid for 365 days and allow 1 use each.
-- The admin can use the Studio dashboard to generate more.
--
-- Code format: PEER-ADMN-0001 through PEER-ADMN-0010
-- (These are deterministic seed codes; runtime codes use crypto random.)

INSERT INTO social_profiles.invite_codes (code, created_by_webid, status, max_uses, expires_at, metadata)
VALUES
  ('PEER-ADMN-0001', 'urn:peermesh:admin', 'active', 1, NOW() + INTERVAL '365 days', '{"source": "seed"}'),
  ('PEER-ADMN-0002', 'urn:peermesh:admin', 'active', 1, NOW() + INTERVAL '365 days', '{"source": "seed"}'),
  ('PEER-ADMN-0003', 'urn:peermesh:admin', 'active', 1, NOW() + INTERVAL '365 days', '{"source": "seed"}'),
  ('PEER-ADMN-0004', 'urn:peermesh:admin', 'active', 1, NOW() + INTERVAL '365 days', '{"source": "seed"}'),
  ('PEER-ADMN-0005', 'urn:peermesh:admin', 'active', 1, NOW() + INTERVAL '365 days', '{"source": "seed"}'),
  ('PEER-ADMN-0006', 'urn:peermesh:admin', 'active', 1, NOW() + INTERVAL '365 days', '{"source": "seed"}'),
  ('PEER-ADMN-0007', 'urn:peermesh:admin', 'active', 1, NOW() + INTERVAL '365 days', '{"source": "seed"}'),
  ('PEER-ADMN-0008', 'urn:peermesh:admin', 'active', 1, NOW() + INTERVAL '365 days', '{"source": "seed"}'),
  ('PEER-ADMN-0009', 'urn:peermesh:admin', 'active', 1, NOW() + INTERVAL '365 days', '{"source": "seed"}'),
  ('PEER-ADMN-0010', 'urn:peermesh:admin', 'active', 1, NOW() + INTERVAL '365 days', '{"source": "seed"}')
ON CONFLICT (code) DO NOTHING;

-- Record this migration
INSERT INTO social_pipeline.schema_migrations (version, description)
VALUES ('026', 'Invite system: codes, invitation tree, requests (F-031)')
ON CONFLICT (version) DO NOTHING;

COMMIT;
