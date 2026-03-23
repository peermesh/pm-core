-- ============================================================
-- Social Lab Module: Account Recovery Tables
-- Migration: 023_recovery
-- Date: 2026-03-23
-- ============================================================
-- Adds:
--   1. social_keys.recovery_shares — Shamir SSS shares for
--      social recovery of the Omni-Account Recovery Package
--   2. social_keys.recovery_attempts — Audit log for recovery
--      initiation and completion events
--
-- Source blueprints:
--   F-027 (Account Recovery Architecture)
--   ARCH-005 (Encryption & Security Architecture)
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Recovery Shares (Shamir's Secret Sharing)
-- ============================================================
-- Each row stores one encrypted share of a user's Recovery
-- Encryption Key (REK). The REK encrypts the Omni-Account
-- Recovery Package (ORP).
--
-- Shares are wrapped with the trustee's public key before
-- storage. The share_data column holds the wrapped (encrypted)
-- share — never plaintext polynomial evaluation output.
--
-- Blueprint mandates: minimum threshold of 2, maximum 10
-- trustees, shares expire after 365 days by default.

CREATE TABLE social_keys.recovery_shares (
    id              TEXT        PRIMARY KEY,
    user_webid      TEXT        NOT NULL,
    share_index     INTEGER     NOT NULL,
    encrypted_share TEXT        NOT NULL,
    trustee_webid   TEXT        NOT NULL,
    threshold       INTEGER     NOT NULL DEFAULT 3,
    total_shares    INTEGER     NOT NULL DEFAULT 5,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '365 days'),

    CONSTRAINT chk_share_index_positive CHECK (share_index >= 1),
    CONSTRAINT chk_threshold_min CHECK (threshold >= 2),
    CONSTRAINT chk_total_gte_threshold CHECK (total_shares >= threshold),
    CONSTRAINT chk_total_max CHECK (total_shares <= 10),
    CONSTRAINT uq_user_share_index UNIQUE (user_webid, share_index)
);

COMMENT ON TABLE social_keys.recovery_shares IS
    'Shamir SSS shares for Omni-Account social recovery (F-027). Each share is encrypted with the trustee''s public key.';
COMMENT ON COLUMN social_keys.recovery_shares.user_webid IS
    'WebID of the account owner whose ORP is being split into shares.';
COMMENT ON COLUMN social_keys.recovery_shares.share_index IS
    'The x-coordinate (1-based index) of this Shamir share. Required for polynomial reconstruction.';
COMMENT ON COLUMN social_keys.recovery_shares.encrypted_share IS
    'The share value, encrypted (wrapped) with the trustee''s public key. Base64-encoded ciphertext.';
COMMENT ON COLUMN social_keys.recovery_shares.trustee_webid IS
    'WebID of the trusted contact holding this share.';
COMMENT ON COLUMN social_keys.recovery_shares.threshold IS
    'K value: minimum number of shares required for reconstruction.';
COMMENT ON COLUMN social_keys.recovery_shares.total_shares IS
    'N value: total number of shares generated.';
COMMENT ON COLUMN social_keys.recovery_shares.expires_at IS
    'Share expiration timestamp. Default 365 days. User notified before expiry.';


-- ============================================================
-- 2. Recovery Attempts (Audit Log)
-- ============================================================
-- Records every recovery initiation and its outcome.
-- Required by AR-SEC-4 (recovery audit log).
-- Used for rate limiting (AR-SEC-1: 3 per hour, 24h cooldown).

CREATE TABLE social_keys.recovery_attempts (
    id              TEXT        PRIMARY KEY,
    user_webid      TEXT        NOT NULL,
    method          TEXT        NOT NULL,
    status          TEXT        NOT NULL DEFAULT 'initiated',
    shares_received INTEGER     NOT NULL DEFAULT 0,
    shares_required INTEGER,
    ip_address      TEXT,
    initiated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,

    CONSTRAINT chk_method_valid CHECK (method IN ('passphrase', 'social', 'export')),
    CONSTRAINT chk_status_valid CHECK (status IN ('initiated', 'in_progress', 'completed', 'failed', 'rate_limited'))
);

COMMENT ON TABLE social_keys.recovery_attempts IS
    'Audit log for account recovery attempts (F-027 AR-SEC-4). Used for rate limiting and security monitoring.';
COMMENT ON COLUMN social_keys.recovery_attempts.method IS
    'Recovery method: passphrase (encrypted backup), social (Shamir shares), export (recovery package).';
COMMENT ON COLUMN social_keys.recovery_attempts.status IS
    'Current status of the recovery attempt.';
COMMENT ON COLUMN social_keys.recovery_attempts.shares_received IS
    'Number of valid shares submitted so far (social recovery only).';
COMMENT ON COLUMN social_keys.recovery_attempts.shares_required IS
    'Threshold K required for reconstruction (social recovery only).';


-- ============================================================
-- 3. Passphrase Backup Storage
-- ============================================================
-- Stores the passphrase-encrypted ORP blob. Only one active
-- backup per user. Encrypted with PBKDF2-derived AES-256-GCM key.

CREATE TABLE social_keys.recovery_backups (
    id              TEXT        PRIMARY KEY,
    user_webid      TEXT        NOT NULL,
    encrypted_blob  TEXT        NOT NULL,
    salt            TEXT        NOT NULL,
    iv              TEXT        NOT NULL,
    auth_tag        TEXT        NOT NULL,
    key_derivation  TEXT        NOT NULL DEFAULT 'pbkdf2-sha256-600000',
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_user_active_backup UNIQUE (user_webid)
);

COMMENT ON TABLE social_keys.recovery_backups IS
    'Passphrase-encrypted Omni-Account Recovery Package backups (F-027). Encrypted with PBKDF2 + AES-256-GCM.';
COMMENT ON COLUMN social_keys.recovery_backups.encrypted_blob IS
    'The AES-256-GCM encrypted ORP as base64.';
COMMENT ON COLUMN social_keys.recovery_backups.salt IS
    'PBKDF2 salt as hex (32 bytes).';
COMMENT ON COLUMN social_keys.recovery_backups.iv IS
    'AES-GCM initialization vector as hex (12 bytes).';
COMMENT ON COLUMN social_keys.recovery_backups.auth_tag IS
    'AES-GCM authentication tag as hex (16 bytes).';
COMMENT ON COLUMN social_keys.recovery_backups.key_derivation IS
    'Key derivation algorithm and iteration count.';


-- ============================================================
-- INDEXES
-- ============================================================

-- Fast share lookup by user (active, non-expired shares)
CREATE INDEX IF NOT EXISTS idx_recovery_shares_user
    ON social_keys.recovery_shares (user_webid, created_at DESC);

-- Trustee lookup (which shares am I holding for others?)
CREATE INDEX IF NOT EXISTS idx_recovery_shares_trustee
    ON social_keys.recovery_shares (trustee_webid);

-- Recovery attempt lookup by user (for rate limiting)
CREATE INDEX IF NOT EXISTS idx_recovery_attempts_user
    ON social_keys.recovery_attempts (user_webid, initiated_at DESC);

-- Active backup lookup
CREATE INDEX IF NOT EXISTS idx_recovery_backups_user
    ON social_keys.recovery_backups (user_webid)
    WHERE is_active = TRUE;


-- ============================================================
-- MIGRATION RECORD
-- ============================================================

INSERT INTO social_pipeline.schema_migrations (version, description)
VALUES ('023', 'Account recovery tables: shares, attempts, backups (F-027)')
ON CONFLICT (version) DO NOTHING;

COMMIT;
