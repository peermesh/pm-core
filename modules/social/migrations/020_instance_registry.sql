-- ============================================================
-- Social Module: Instance Registry for Ecosystem SSO
-- Migration: 020_instance_registry
-- Date: 2026-03-23
-- ============================================================
-- Adds:
--   1. social_federation.instances table for tracking known
--      PeerMesh instances in the meta-network.
--   2. Self-registration mechanism: on first startup the
--      instance registers itself in this table.
--
-- Source blueprints:
--   ARCH-010 (Ecosystem Identity Federation)
--   FLOW-004 (Ecosystem SSO)
--   CEO-MANDATORY-VISION-ADDENDUM-SSO (Sections 1, 3)
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Instance Registry
-- ============================================================
-- Tracks all known PeerMesh instances in the meta-network.
-- Each instance has a domain, public key, and trust level.
-- Trust levels:
--   'self'    — this instance
--   'trusted' — manually verified peer
--   'peer'    — discovered via directory or AP interaction
--   'blocked' — operator-blocked instance

CREATE TABLE social_federation.instances (
    id              TEXT        PRIMARY KEY,
    domain          TEXT        NOT NULL UNIQUE,
    name            TEXT,
    nodeinfo_url    TEXT,
    public_key      TEXT,
    trust_level     TEXT        NOT NULL DEFAULT 'peer',
    software_name   TEXT,
    software_version TEXT,
    registered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata        JSONB
);

COMMENT ON TABLE social_federation.instances IS
    'Registry of known PeerMesh instances in the meta-network (ARCH-010). Each row represents a discovered or registered instance. Trust is established via public key exchange and NodeInfo metadata.';
COMMENT ON COLUMN social_federation.instances.id IS
    'Instance ID (UUID)';
COMMENT ON COLUMN social_federation.instances.domain IS
    'Fully qualified domain name of the instance (unique)';
COMMENT ON COLUMN social_federation.instances.name IS
    'Human-readable instance name (e.g. "peers.social")';
COMMENT ON COLUMN social_federation.instances.nodeinfo_url IS
    'URL to the instance NodeInfo endpoint (/.well-known/nodeinfo)';
COMMENT ON COLUMN social_federation.instances.public_key IS
    'Ed25519 public key in SPKI base64url format for SSO token verification';
COMMENT ON COLUMN social_federation.instances.trust_level IS
    'Trust classification: self, trusted, peer, blocked';
COMMENT ON COLUMN social_federation.instances.software_name IS
    'Software identifier from NodeInfo (e.g. peermesh-social)';
COMMENT ON COLUMN social_federation.instances.software_version IS
    'Software version from NodeInfo';
COMMENT ON COLUMN social_federation.instances.registered_at IS
    'When this instance was first registered';
COMMENT ON COLUMN social_federation.instances.last_seen_at IS
    'When this instance last communicated with us';
COMMENT ON COLUMN social_federation.instances.metadata IS
    'Additional metadata: PeerMesh capabilities, protocols, etc.';


-- ============================================================
-- INDEXES
-- ============================================================

-- Fast lookup by domain
CREATE INDEX IF NOT EXISTS idx_instances_domain
    ON social_federation.instances (domain);

-- Filter by trust level
CREATE INDEX IF NOT EXISTS idx_instances_trust
    ON social_federation.instances (trust_level);

-- Active peers (non-blocked)
CREATE INDEX IF NOT EXISTS idx_instances_active
    ON social_federation.instances (trust_level)
    WHERE trust_level != 'blocked';


-- ============================================================
-- MIGRATION RECORD
-- ============================================================

INSERT INTO social_pipeline.schema_migrations (version, description)
VALUES ('020', 'Instance registry for ecosystem SSO and federation (ARCH-010, FLOW-004)')
ON CONFLICT (version) DO NOTHING;

COMMIT;
