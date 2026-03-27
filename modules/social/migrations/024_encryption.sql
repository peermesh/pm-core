-- ============================================================
-- Social Module: Encryption Key Management Tables
-- Migration: 024_encryption
-- Date: 2026-03-23
-- ============================================================
-- Adds:
--   1. social_keys.group_keys — Per-group symmetric key storage
--      for the AES-256-GCM Phase 1 encryption provider.
--   2. social_keys.encryption_audit — Audit log for all
--      encryption operations (group create, key rotation, etc.)
--
-- Source blueprints:
--   ARCH-005 (Encryption & Security Architecture)
--   F-019    (MLS Integration — Phase 1 foundation)
--
-- Phase 1 stores symmetric AES-256-GCM keys directly.
-- Phase 2 (MLS) will add MLS-specific columns or a separate
-- table for TreeKEM state. These tables remain for legacy
-- content decryption (ARCH-005 MIG-1: legacy content readable).
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Group Encryption Keys
-- ============================================================
-- Each row stores a copy of the group's symmetric key for one
-- member. Phase 1 uses the same AES-256 key for all members.
-- The encrypted_key column stores the key as base64.
--
-- Phase 1: Key stored directly (server-side, like identity-keys Phase 1).
-- Phase 2: Key derived via MLS TreeKEM; this table retains
--          historical epoch keys for decrypting old content.
--
-- Epoch semantics:
--   - epoch=1 is the initial group key
--   - Each key rotation (member removal) increments the epoch
--   - is_current=TRUE marks the active key for encryption
--   - Historical keys (is_current=FALSE) used for decryption only

CREATE TABLE IF NOT EXISTS social_keys.group_keys (
    id              TEXT        PRIMARY KEY,
    group_id        TEXT        NOT NULL,
    encrypted_key   TEXT        NOT NULL,
    member_webid    TEXT        NOT NULL,
    algorithm       TEXT        NOT NULL DEFAULT 'aes-256-gcm',
    epoch           INTEGER     NOT NULL DEFAULT 1,
    is_current      BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_epoch_positive CHECK (epoch >= 1),
    CONSTRAINT chk_algorithm_valid CHECK (
        algorithm IN ('aes-256-gcm', 'mls-128-dhkemx25519', 'mls-256-pq-hybrid')
    )
);

COMMENT ON TABLE social_keys.group_keys IS
    'Per-group symmetric encryption keys (ARCH-005, F-019). Phase 1: AES-256-GCM. Phase 2: MLS epoch keys.';
COMMENT ON COLUMN social_keys.group_keys.group_id IS
    'Encryption group identifier. Matches the MLS group ID pattern (e.g., pmsl:doc:{docId}, pmsl:acg:{groupId}).';
COMMENT ON COLUMN social_keys.group_keys.encrypted_key IS
    'Base64-encoded symmetric key material. Phase 1: raw AES-256 key. Phase 2: MLS-derived epoch secret.';
COMMENT ON COLUMN social_keys.group_keys.member_webid IS
    'WebID of the group member holding this key copy.';
COMMENT ON COLUMN social_keys.group_keys.algorithm IS
    'Encryption algorithm. Phase 1: aes-256-gcm. Phase 2: mls-128-dhkemx25519 or mls-256-pq-hybrid.';
COMMENT ON COLUMN social_keys.group_keys.epoch IS
    'Key epoch. Incremented on each key rotation (member removal). Used to select correct decryption key.';
COMMENT ON COLUMN social_keys.group_keys.is_current IS
    'TRUE for the active key used for new encryptions. FALSE for historical keys (decryption only).';


-- ============================================================
-- 2. Encryption Audit Log
-- ============================================================
-- Records all encryption lifecycle events for security auditing.
-- Per ARCH-005 SEC-3: verify server never accesses plaintext.
-- This log records operations (not content) and is queryable
-- for compliance and incident investigation.

CREATE TABLE IF NOT EXISTS social_keys.encryption_audit (
    id              TEXT        PRIMARY KEY,
    operation       TEXT        NOT NULL,
    group_id        TEXT        NOT NULL,
    actor           TEXT        NOT NULL,
    details         JSONB       DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_operation_valid CHECK (
        operation IN (
            'group_created',
            'group_deleted',
            'member_added',
            'member_removed',
            'key_rotated',
            'encrypt',
            'decrypt',
            'export_secret'
        )
    )
);

COMMENT ON TABLE social_keys.encryption_audit IS
    'Audit log for encryption operations (ARCH-005). Records lifecycle events, never plaintext content.';
COMMENT ON COLUMN social_keys.encryption_audit.operation IS
    'Operation type: group_created, group_deleted, member_added, member_removed, key_rotated, encrypt, decrypt, export_secret.';
COMMENT ON COLUMN social_keys.encryption_audit.group_id IS
    'The encryption group this operation applies to.';
COMMENT ON COLUMN social_keys.encryption_audit.actor IS
    'WebID of the user who performed the operation (or "system").';
COMMENT ON COLUMN social_keys.encryption_audit.details IS
    'Operation-specific metadata as JSONB (epoch numbers, member counts, algorithm info).';


-- ============================================================
-- INDEXES
-- ============================================================

-- Fast current-key lookup for a group (used on every encrypt/decrypt)
CREATE INDEX IF NOT EXISTS idx_group_keys_current
    ON social_keys.group_keys (group_id, is_current)
    WHERE is_current = TRUE;

-- Key lookup by group + epoch (for decrypting historical content)
CREATE INDEX IF NOT EXISTS idx_group_keys_epoch
    ON social_keys.group_keys (group_id, epoch);

-- Member's key lookup (which groups am I in?)
CREATE INDEX IF NOT EXISTS idx_group_keys_member
    ON social_keys.group_keys (member_webid)
    WHERE is_current = TRUE;

-- Audit log queries by group
CREATE INDEX IF NOT EXISTS idx_encryption_audit_group
    ON social_keys.encryption_audit (group_id, created_at DESC);

-- Audit log queries by actor
CREATE INDEX IF NOT EXISTS idx_encryption_audit_actor
    ON social_keys.encryption_audit (actor, created_at DESC);

-- Audit log queries by operation type
CREATE INDEX IF NOT EXISTS idx_encryption_audit_operation
    ON social_keys.encryption_audit (operation);


-- ============================================================
-- MIGRATION RECORD
-- ============================================================

INSERT INTO social_pipeline.schema_migrations (version, description)
VALUES ('024', 'Encryption key management: group_keys, encryption_audit (ARCH-005, F-019 Phase 1)')
ON CONFLICT (version) DO NOTHING;

COMMIT;
