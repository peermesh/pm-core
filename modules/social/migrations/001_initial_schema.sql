-- ============================================================
-- Social Module: Initial Schema Migration
-- Migration: 001_initial_schema
-- Version: 0.1.0
-- Date: 2026-03-21
-- ============================================================
-- Source blueprints:
--   DATA-001 (Profile Schema / Solid Pod Structure)
--   DATA-002 (Local Profile Database/Index)
--   ARCH-009 (Module Data Composition Architecture)
--
-- Schema layout per ARCH-009 per-module schema isolation:
--   SHARED (read-only grants to other modules):
--     social_profiles  -- cached profile index, bio links, enrichment
--     social_graph     -- follow/connection relationships
--   PRIVATE (Social internal only):
--     social_federation -- federation actor state (AP/AT Protocol)
--     social_keys       -- cryptographic key storage metadata
--     social_pipeline   -- omni-account pipeline, sync state, migrations
-- ============================================================

BEGIN;

-- ============================================================
-- SCHEMA CREATION
-- ============================================================

CREATE SCHEMA IF NOT EXISTS social_profiles;
COMMENT ON SCHEMA social_profiles IS
  'SHARED surface: cached profile data from Solid Pods. Read-only to other modules.';

CREATE SCHEMA IF NOT EXISTS social_graph;
COMMENT ON SCHEMA social_graph IS
  'SHARED surface: cached social relationships (follows, connections). Read-only to other modules.';

CREATE SCHEMA IF NOT EXISTS social_federation;
COMMENT ON SCHEMA social_federation IS
  'PRIVATE surface: federation protocol state (ActivityPub actors, AT Protocol sync). Social internal only.';

CREATE SCHEMA IF NOT EXISTS social_keys;
COMMENT ON SCHEMA social_keys IS
  'PRIVATE surface: cryptographic key storage metadata. Actual key material lives in the app key store, not in SQL. Social internal only.';

CREATE SCHEMA IF NOT EXISTS social_pipeline;
COMMENT ON SCHEMA social_pipeline IS
  'PRIVATE surface: Omni-Account pipeline execution, Pod sync state, schema migration tracking. Social internal only.';


-- ============================================================
-- SHARED SURFACE: social_profiles
-- ============================================================

-- Profile index: cached public card data (DATA-001 Section 3, DATA-002 Section 2)
-- Every field traces to a DATA-001 RDF predicate or ARCH-009 surface requirement.
-- The Solid Pod remains the source of truth; this table is a read-optimized cache.
CREATE TABLE social_profiles.profile_index (
    id                TEXT        PRIMARY KEY,
    webid             TEXT        NOT NULL UNIQUE,
    omni_account_id   TEXT        NOT NULL UNIQUE,
    display_name      TEXT,
    username          TEXT,
    bio               TEXT,
    avatar_url        TEXT,
    banner_url        TEXT,
    homepage_url      TEXT,
    deployment_mode   TEXT        NOT NULL DEFAULT 'vps',
    profile_version   TEXT        NOT NULL DEFAULT '0.1.0',
    ap_actor_uri      TEXT,
    at_did            TEXT,
    proxy_actor_uri   TEXT,
    source_pod_uri    TEXT        NOT NULL,
    last_synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE social_profiles.profile_index IS
  'Cached public card data from Solid Pods. Source of truth is the Pod (DATA-001). Provenance tracked via source_pod_uri and last_synced_at.';
COMMENT ON COLUMN social_profiles.profile_index.webid IS 'Canonical WebID URI (foaf:Person subject)';
COMMENT ON COLUMN social_profiles.profile_index.omni_account_id IS 'Omni-Account identifier linking all protocol identities (pmsl:omniAccountId)';
COMMENT ON COLUMN social_profiles.profile_index.display_name IS 'foaf:name / vcard:fn';
COMMENT ON COLUMN social_profiles.profile_index.username IS 'as:preferredUsername';
COMMENT ON COLUMN social_profiles.profile_index.bio IS 'as:summary';
COMMENT ON COLUMN social_profiles.profile_index.avatar_url IS 'foaf:img / as:icon';
COMMENT ON COLUMN social_profiles.profile_index.banner_url IS 'as:image';
COMMENT ON COLUMN social_profiles.profile_index.homepage_url IS 'foaf:homepage';
COMMENT ON COLUMN social_profiles.profile_index.deployment_mode IS 'pmsl:deploymentMode (vps, platform, edge, byop)';
COMMENT ON COLUMN social_profiles.profile_index.profile_version IS 'pmsl:profileVersion (semver)';
COMMENT ON COLUMN social_profiles.profile_index.ap_actor_uri IS 'pmsl:activityPubActor URI';
COMMENT ON COLUMN social_profiles.profile_index.at_did IS 'pmsl:atProtocolDID';
COMMENT ON COLUMN social_profiles.profile_index.proxy_actor_uri IS 'pmsl:proxyActorUri (BYOP deployment only)';
COMMENT ON COLUMN social_profiles.profile_index.source_pod_uri IS 'Pod root URI for provenance tracking (DATA-002 mandate)';
COMMENT ON COLUMN social_profiles.profile_index.last_synced_at IS 'When this row was last synced from the Pod';


-- Bio link entries: cached from extended profile (DATA-001 Section 4)
CREATE TABLE social_profiles.bio_links (
    id              TEXT        PRIMARY KEY,
    webid           TEXT        NOT NULL REFERENCES social_profiles.profile_index(webid) ON DELETE CASCADE,
    label           TEXT        NOT NULL,
    url             TEXT        NOT NULL,
    identifier      TEXT,
    sort_order      INTEGER     NOT NULL DEFAULT 0,
    source_pod_uri  TEXT        NOT NULL,
    last_synced_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE social_profiles.bio_links IS
  'Link-in-bio entries cached from extended profile (pmsl:linkedBioLinks). Ordered by sort_order.';
COMMENT ON COLUMN social_profiles.bio_links.label IS 'schema:name of the link';
COMMENT ON COLUMN social_profiles.bio_links.url IS 'schema:url target';
COMMENT ON COLUMN social_profiles.bio_links.identifier IS 'schema:identifier (e.g. "github", "blog")';


-- Platform enrichment: platform-specific data NOT sourced from Pod (DATA-002 Section 2)
CREATE TABLE social_profiles.platform_enrichment (
    webid           TEXT        NOT NULL REFERENCES social_profiles.profile_index(webid) ON DELETE CASCADE,
    platform_id     TEXT        NOT NULL,
    key             TEXT        NOT NULL,
    value           TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (webid, platform_id, key)
);

COMMENT ON TABLE social_profiles.platform_enrichment IS
  'Platform-specific enrichment data (reputation scores, tags, recommendations). NOT from Pod. Survives ACL revocation as orphaned rows.';
COMMENT ON COLUMN social_profiles.platform_enrichment.platform_id IS 'Which platform added this enrichment';
COMMENT ON COLUMN social_profiles.platform_enrichment.key IS 'Enrichment key (e.g. "reputation_score", "featured")';
COMMENT ON COLUMN social_profiles.platform_enrichment.value IS 'JSON-encoded value';


-- ============================================================
-- SHARED SURFACE: social_graph
-- ============================================================

-- Social graph: cached follow/connection relationships (DATA-002 Section 2)
CREATE TABLE social_graph.social_graph (
    follower_webid  TEXT        NOT NULL,
    following_webid TEXT        NOT NULL,
    relationship    TEXT        NOT NULL DEFAULT 'follow',
    ap_activity_id  TEXT,
    source_pod_uri  TEXT        NOT NULL,
    last_synced_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (follower_webid, following_webid, relationship)
);

COMMENT ON TABLE social_graph.social_graph IS
  'Cached social relationships from Pods. Supports follow, block (if ACL-granted). Protocol source tracked via ap_activity_id.';
COMMENT ON COLUMN social_graph.social_graph.follower_webid IS 'WebID of the actor performing the follow';
COMMENT ON COLUMN social_graph.social_graph.following_webid IS 'WebID of the actor being followed';
COMMENT ON COLUMN social_graph.social_graph.relationship IS 'Relationship type: follow, block';
COMMENT ON COLUMN social_graph.social_graph.ap_activity_id IS 'ActivityPub Follow activity URI (if federated)';
COMMENT ON COLUMN social_graph.social_graph.source_pod_uri IS 'Pod that sourced this relationship';


-- ============================================================
-- PRIVATE SURFACE: social_federation
-- ============================================================

-- ActivityPub actor records (Phase 3 placeholder)
CREATE TABLE social_federation.ap_actors (
    id              TEXT        PRIMARY KEY,
    webid           TEXT        NOT NULL,
    actor_uri       TEXT        NOT NULL UNIQUE,
    inbox_uri       TEXT        NOT NULL,
    outbox_uri      TEXT        NOT NULL,
    public_key_pem  TEXT,
    key_id          TEXT,
    protocol        TEXT        NOT NULL DEFAULT 'activitypub',
    last_synced_at  TIMESTAMPTZ,
    status          TEXT        NOT NULL DEFAULT 'active',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE social_federation.ap_actors IS
  'Federation actor state. Tracks ActivityPub actors and their endpoints. Phase 3 feature, schema established now for namespace validation.';
COMMENT ON COLUMN social_federation.ap_actors.actor_uri IS 'ActivityPub Actor document URI';
COMMENT ON COLUMN social_federation.ap_actors.protocol IS 'Federation protocol: activitypub, atproto';
COMMENT ON COLUMN social_federation.ap_actors.status IS 'Actor status: active, suspended, deleted';
COMMENT ON COLUMN social_federation.ap_actors.public_key_pem IS 'Public key for HTTP Signature verification (PEM format)';
COMMENT ON COLUMN social_federation.ap_actors.key_id IS 'Key ID URI for HTTP Signatures';


-- ============================================================
-- PRIVATE SURFACE: social_keys
-- ============================================================

-- Cryptographic key metadata (actual key material is in the app key store)
CREATE TABLE social_keys.key_metadata (
    id              TEXT        PRIMARY KEY,
    omni_account_id TEXT        NOT NULL,
    protocol        TEXT        NOT NULL,
    key_type        TEXT        NOT NULL,
    public_key_hash TEXT        NOT NULL,
    key_purpose     TEXT        NOT NULL DEFAULT 'signing',
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    rotated_at      TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ
);

COMMENT ON TABLE social_keys.key_metadata IS
  'Key storage metadata only. Actual key material lives in the app key store, NOT in SQL. Tracks which keys exist, their purpose, and rotation history.';
COMMENT ON COLUMN social_keys.key_metadata.omni_account_id IS 'Omni-Account that owns this key';
COMMENT ON COLUMN social_keys.key_metadata.protocol IS 'Protocol this key serves: activitypub, atproto, ssb, holochain';
COMMENT ON COLUMN social_keys.key_metadata.key_type IS 'Key algorithm: ed25519, rsa2048, p256';
COMMENT ON COLUMN social_keys.key_metadata.public_key_hash IS 'SHA-256 hash of the public key (for lookup without exposing material)';
COMMENT ON COLUMN social_keys.key_metadata.key_purpose IS 'Purpose: signing, encryption (per module.json security.encryption.keyPurposes)';
COMMENT ON COLUMN social_keys.key_metadata.is_active IS 'Whether this key is currently active (false after rotation)';


-- ============================================================
-- PRIVATE SURFACE: social_pipeline
-- ============================================================

-- Omni-Account pipeline execution records
CREATE TABLE social_pipeline.pipeline_executions (
    id              TEXT        PRIMARY KEY,
    omni_account_id TEXT        NOT NULL,
    pipeline_type   TEXT        NOT NULL DEFAULT 'account_creation',
    status          TEXT        NOT NULL DEFAULT 'pending',
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    error_log       TEXT,
    metadata        JSONB
);

COMMENT ON TABLE social_pipeline.pipeline_executions IS
  'Omni-Account generation pipeline execution records. Tracks account creation, protocol bridging, and migration operations.';
COMMENT ON COLUMN social_pipeline.pipeline_executions.pipeline_type IS 'Pipeline type: account_creation, protocol_bridge, data_migration';
COMMENT ON COLUMN social_pipeline.pipeline_executions.status IS 'Execution status: pending, running, completed, failed';
COMMENT ON COLUMN social_pipeline.pipeline_executions.error_log IS 'Error details if status=failed';
COMMENT ON COLUMN social_pipeline.pipeline_executions.metadata IS 'Additional pipeline context (JSONB for flexibility)';


-- Sync state: per-document sync tracking (DATA-002 Section 3)
CREATE TABLE social_pipeline.sync_state (
    webid           TEXT        NOT NULL,
    document_path   TEXT        NOT NULL,
    etag            TEXT,
    last_modified   TIMESTAMPTZ,
    last_sync_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sync_status     TEXT        NOT NULL DEFAULT 'ok',
    error_message   TEXT,
    PRIMARY KEY (webid, document_path)
);

COMMENT ON TABLE social_pipeline.sync_state IS
  'Per-document sync state for Pod-to-index synchronization. Tracks ETags and Last-Modified headers for conditional fetch (DATA-002 Section 3).';
COMMENT ON COLUMN social_pipeline.sync_state.document_path IS 'Relative path in Pod (e.g. "profile/card", "social/following")';
COMMENT ON COLUMN social_pipeline.sync_state.etag IS 'HTTP ETag for conditional fetch (If-None-Match)';
COMMENT ON COLUMN social_pipeline.sync_state.sync_status IS 'Status: ok, error, revoked, pending';


-- Schema migration tracking
CREATE TABLE social_pipeline.schema_migrations (
    version         TEXT        PRIMARY KEY,
    applied_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    description     TEXT
);

COMMENT ON TABLE social_pipeline.schema_migrations IS
  'Tracks applied database migrations. Simple versioned migration log.';


-- Record this migration
INSERT INTO social_pipeline.schema_migrations (version, description)
VALUES ('001', 'Initial schema: social_profiles, social_graph, social_federation, social_keys, social_pipeline');


-- ============================================================
-- INDEXES
-- ============================================================
-- Per DATA-002 Section 6 query patterns plus additional
-- indexes for federation and pipeline lookups.

-- social_profiles indexes
CREATE INDEX idx_profile_username
    ON social_profiles.profile_index (username);
CREATE INDEX idx_profile_display_name
    ON social_profiles.profile_index (display_name);
CREATE INDEX idx_profile_last_synced
    ON social_profiles.profile_index (last_synced_at);
CREATE INDEX idx_profile_omni_account
    ON social_profiles.profile_index (omni_account_id);
CREATE INDEX idx_bio_links_webid
    ON social_profiles.bio_links (webid);
CREATE INDEX idx_bio_links_sort
    ON social_profiles.bio_links (webid, sort_order);
CREATE INDEX idx_enrichment_webid
    ON social_profiles.platform_enrichment (webid);

-- social_graph indexes
CREATE INDEX idx_social_follower
    ON social_graph.social_graph (follower_webid);
CREATE INDEX idx_social_following
    ON social_graph.social_graph (following_webid);

-- social_federation indexes
CREATE INDEX idx_federation_webid
    ON social_federation.ap_actors (webid);
CREATE INDEX idx_federation_status
    ON social_federation.ap_actors (status);

-- social_keys indexes
CREATE INDEX idx_keys_omni_account
    ON social_keys.key_metadata (omni_account_id);
CREATE INDEX idx_keys_protocol
    ON social_keys.key_metadata (protocol, key_type);
CREATE INDEX idx_keys_active
    ON social_keys.key_metadata (omni_account_id, is_active)
    WHERE is_active = TRUE;

-- social_pipeline indexes
CREATE INDEX idx_pipeline_omni_account
    ON social_pipeline.pipeline_executions (omni_account_id);
CREATE INDEX idx_pipeline_status
    ON social_pipeline.pipeline_executions (status);
CREATE INDEX idx_sync_stale
    ON social_pipeline.sync_state (last_sync_at, sync_status);


-- ============================================================
-- READER ROLE AND GRANTS
-- ============================================================
-- Read-only access on shared schemas for cross-module consumption.
-- Per ARCH-009: social_profiles and social_graph are SHARED surfaces.
-- Other modules connect via a reader role; they cannot INSERT/UPDATE/DELETE.

DO $$
BEGIN
    -- Create the reader role if it does not already exist
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'social_lab_reader') THEN
        CREATE ROLE social_lab_reader NOLOGIN;
    END IF;
END
$$;

-- Grant USAGE on shared schemas (required to see objects within them)
GRANT USAGE ON SCHEMA social_profiles TO social_lab_reader;
GRANT USAGE ON SCHEMA social_graph TO social_lab_reader;

-- Grant SELECT on all existing tables in shared schemas
GRANT SELECT ON ALL TABLES IN SCHEMA social_profiles TO social_lab_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA social_graph TO social_lab_reader;

-- Grant SELECT on future tables created in shared schemas
ALTER DEFAULT PRIVILEGES IN SCHEMA social_profiles
    GRANT SELECT ON TABLES TO social_lab_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA social_graph
    GRANT SELECT ON TABLES TO social_lab_reader;

-- Explicitly deny access to private schemas (defense in depth)
-- No GRANT statements for social_federation, social_keys, social_pipeline
-- means the reader role has zero access to those schemas.

COMMIT;
