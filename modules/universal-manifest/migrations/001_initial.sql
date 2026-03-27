-- =============================================================================
-- Universal Manifest Module - Initial Migration
-- =============================================================================
-- Creates the `um` schema and all tables for manifest storage,
-- facet registry, facet write audit, and signing keys.
--
-- Idempotent: safe to re-run without error.
-- =============================================================================

-- Create the um schema
CREATE SCHEMA IF NOT EXISTS um;

-- =============================================================================
-- um.manifests — Manifest storage
-- =============================================================================
CREATE TABLE IF NOT EXISTS um.manifests (
    id             SERIAL PRIMARY KEY,
    umid           TEXT NOT NULL,
    subject        TEXT NOT NULL,
    handle         TEXT,
    manifest_json  JSONB NOT NULL,
    signed_manifest TEXT NOT NULL,
    manifest_version TEXT NOT NULL DEFAULT '0.2',
    version        INTEGER NOT NULL DEFAULT 1,
    status         TEXT NOT NULL DEFAULT 'active',
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    issued_at      TIMESTAMPTZ NOT NULL,
    expires_at     TIMESTAMPTZ NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for um.manifests
CREATE UNIQUE INDEX IF NOT EXISTS idx_um_manifests_umid_version
    ON um.manifests (umid, version);
CREATE INDEX IF NOT EXISTS idx_um_manifests_subject_active
    ON um.manifests (subject, is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_um_manifests_handle_active
    ON um.manifests (handle, is_active) WHERE is_active = TRUE AND handle IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_um_manifests_status
    ON um.manifests (status);

-- =============================================================================
-- um.facet_registry — Authorized facet writers
-- =============================================================================
CREATE TABLE IF NOT EXISTS um.facet_registry (
    id                SERIAL PRIMARY KEY,
    facet_name        TEXT UNIQUE NOT NULL,
    authorized_module TEXT NOT NULL,
    description       TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- um.facet_writes — Audit log of facet write operations
-- =============================================================================
CREATE TABLE IF NOT EXISTS um.facet_writes (
    id            SERIAL PRIMARY KEY,
    umid          TEXT NOT NULL,
    facet_name    TEXT NOT NULL,
    writer_module TEXT NOT NULL,
    written_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_um_facet_writes_umid_facet
    ON um.facet_writes (umid, facet_name);
CREATE INDEX IF NOT EXISTS idx_um_facet_writes_writer
    ON um.facet_writes (writer_module);

-- =============================================================================
-- um.signing_keys — Ed25519 signing keypairs
-- =============================================================================
CREATE TABLE IF NOT EXISTS um.signing_keys (
    id                       SERIAL PRIMARY KEY,
    subject                  TEXT NOT NULL,
    public_key_spki_b64      TEXT NOT NULL,
    private_key_pem_encrypted TEXT NOT NULL,
    key_ref                  TEXT NOT NULL,
    algorithm                TEXT NOT NULL DEFAULT 'Ed25519',
    is_active                BOOLEAN NOT NULL DEFAULT TRUE,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    rotated_at               TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_um_signing_keys_key_ref
    ON um.signing_keys (key_ref);
CREATE INDEX IF NOT EXISTS idx_um_signing_keys_subject_active
    ON um.signing_keys (subject, is_active) WHERE is_active = TRUE;

-- =============================================================================
-- Seed: Well-known facet registrations
-- =============================================================================
-- These are the default facet-to-module mappings per the UM architecture.
-- ON CONFLICT DO NOTHING ensures idempotency.

INSERT INTO um.facet_registry (facet_name, authorized_module, description) VALUES
    ('publicProfile',       'social',      'Display name, bio, avatar, handle'),
    ('socialIdentity',      'social',      'Protocol identities (AP, Nostr, AT, etc.)'),
    ('socialGraph',         'social',      'Follower/following counts, group memberships'),
    ('protocolStatus',      'social',      'Active/stub/unavailable protocol status'),
    ('credentials',         'did-wallet',      'Verifiable credentials'),
    ('verifiableCredentials', 'did-wallet',    'W3C Verifiable Credentials'),
    ('spatialAnchors',      'spatial-fabric',  'Spatial anchor locations'),
    ('placeMembership',     'spatial-fabric',  'Spatial place memberships'),
    ('crossWorldProfile',   'spatial-fabric',  'Cross-world identity projection')
ON CONFLICT (facet_name) DO NOTHING;

-- =============================================================================
-- Schema migration tracking (optional, for hook-based migration runner)
-- =============================================================================
CREATE TABLE IF NOT EXISTS um.schema_migrations (
    version    TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO um.schema_migrations (version) VALUES ('001')
ON CONFLICT (version) DO NOTHING;
