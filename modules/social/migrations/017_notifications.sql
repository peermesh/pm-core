-- ============================================================
-- Social Module: Push Notification System
-- Migration: 017_notifications
-- Date: 2026-03-22
-- Blueprint: F-029 (Push Notification Unification)
-- ============================================================
-- Creates notification subscriptions, notification log, and
-- notification preferences tables. Supports WebPush (RFC 8030)
-- and UnifiedPush delivery channels.
-- ============================================================

BEGIN;

-- ============================================================
-- Notification subscriptions (WebPush + UnifiedPush endpoints)
-- Per F-029 Mechanic 1: Push subscription stored per user.
-- ============================================================
CREATE TABLE IF NOT EXISTS social_profiles.notification_subscriptions (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_webid TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    p256dh_key TEXT NOT NULL,
    auth_key TEXT NOT NULL,
    transport TEXT NOT NULL DEFAULT 'webpush'
        CHECK (transport IN ('webpush', 'unifiedpush')),
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    UNIQUE(user_webid, endpoint)
);

COMMENT ON TABLE social_profiles.notification_subscriptions IS
  'Push notification subscriptions per F-029. Stores WebPush (RFC 8030) and UnifiedPush endpoints with encryption keys.';
COMMENT ON COLUMN social_profiles.notification_subscriptions.user_webid IS 'WebID of the subscribing user';
COMMENT ON COLUMN social_profiles.notification_subscriptions.endpoint IS 'Push service endpoint URL (WebPush or UnifiedPush distributor)';
COMMENT ON COLUMN social_profiles.notification_subscriptions.p256dh_key IS 'P-256 Diffie-Hellman public key for RFC 8291 payload encryption';
COMMENT ON COLUMN social_profiles.notification_subscriptions.auth_key IS 'Authentication secret for RFC 8291 payload encryption';
COMMENT ON COLUMN social_profiles.notification_subscriptions.transport IS 'Delivery transport: webpush or unifiedpush';
COMMENT ON COLUMN social_profiles.notification_subscriptions.user_agent IS 'User-Agent string identifying the subscribing device/browser';

CREATE INDEX IF NOT EXISTS idx_notif_subs_user ON social_profiles.notification_subscriptions(user_webid);
CREATE INDEX IF NOT EXISTS idx_notif_subs_transport ON social_profiles.notification_subscriptions(transport);

-- ============================================================
-- Notification log (all notifications sent to users)
-- Per F-029 Mechanic 3: Recent notifications cached in local DB.
-- ============================================================
CREATE TABLE IF NOT EXISTS social_profiles.notification_log (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_webid TEXT NOT NULL,
    type TEXT NOT NULL
        CHECK (type IN ('follow', 'like', 'repost', 'reply', 'mention', 'dm', 'moderation', 'zap')),
    title TEXT NOT NULL,
    body TEXT,
    icon TEXT,
    data JSONB DEFAULT '{}',
    priority TEXT NOT NULL DEFAULT 'normal'
        CHECK (priority IN ('urgent', 'normal', 'low')),
    protocol_origin TEXT
        CHECK (protocol_origin IN ('ap', 'at', 'nostr', 'matrix', 'indieweb') OR protocol_origin IS NULL),
    canonical_id TEXT,
    tag TEXT,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read_at TIMESTAMPTZ,
    dismissed_at TIMESTAMPTZ
);

COMMENT ON TABLE social_profiles.notification_log IS
  'Notification history per F-029. Stores all notifications sent to users with read/dismissed state.';
COMMENT ON COLUMN social_profiles.notification_log.type IS 'Canonical notification type per F-029 Mechanic 3: follow, like, repost, reply, mention, dm, moderation, zap';
COMMENT ON COLUMN social_profiles.notification_log.data IS 'Flexible JSONB payload: url, actions, protocol-specific metadata';
COMMENT ON COLUMN social_profiles.notification_log.priority IS 'Delivery priority per F-029 Mechanic 6: urgent (DM/mention), normal (like/follow), low (zap)';
COMMENT ON COLUMN social_profiles.notification_log.protocol_origin IS 'Source protocol: ap, at, nostr, matrix, indieweb';
COMMENT ON COLUMN social_profiles.notification_log.canonical_id IS 'Cross-protocol canonical event ID for deduplication (pmsl:eventXYZ)';
COMMENT ON COLUMN social_profiles.notification_log.tag IS 'Notification tag for collapsing related notifications (e.g. pmsl:thread456)';

CREATE INDEX IF NOT EXISTS idx_notif_log_user ON social_profiles.notification_log(user_webid);
CREATE INDEX IF NOT EXISTS idx_notif_log_user_unread ON social_profiles.notification_log(user_webid) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notif_log_sent ON social_profiles.notification_log(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_log_type ON social_profiles.notification_log(type);
CREATE INDEX IF NOT EXISTS idx_notif_log_canonical ON social_profiles.notification_log(canonical_id) WHERE canonical_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notif_log_tag ON social_profiles.notification_log(tag) WHERE tag IS NOT NULL;

-- ============================================================
-- Notification preferences (per-type, per-protocol controls)
-- Per F-029 Mechanic 5: Fine-grained notification control.
-- ============================================================
CREATE TABLE IF NOT EXISTS social_profiles.notification_preferences (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_webid TEXT NOT NULL,
    notification_type TEXT NOT NULL
        CHECK (notification_type IN ('follow', 'like', 'repost', 'reply', 'mention', 'dm', 'moderation', 'zap', '*')),
    protocol_source TEXT
        CHECK (protocol_source IN ('ap', 'at', 'nostr', 'matrix', 'indieweb', '*') OR protocol_source IS NULL),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    delivery TEXT NOT NULL DEFAULT 'push'
        CHECK (delivery IN ('push', 'in-app', 'email', 'none')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_webid, notification_type, protocol_source)
);

COMMENT ON TABLE social_profiles.notification_preferences IS
  'Per-type, per-protocol notification preferences per F-029 Mechanic 5. Stored locally and synced to Solid Pod.';
COMMENT ON COLUMN social_profiles.notification_preferences.notification_type IS 'Notification type or * for global default';
COMMENT ON COLUMN social_profiles.notification_preferences.protocol_source IS 'Protocol filter or * for all protocols. NULL treated as *.';
COMMENT ON COLUMN social_profiles.notification_preferences.delivery IS 'Delivery method: push, in-app, email, none';

CREATE INDEX IF NOT EXISTS idx_notif_prefs_user ON social_profiles.notification_preferences(user_webid);
CREATE INDEX IF NOT EXISTS idx_notif_prefs_type ON social_profiles.notification_preferences(notification_type);

-- Auto-update updated_at on modification
CREATE OR REPLACE FUNCTION social_profiles.update_notif_prefs_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notif_prefs_update_timestamp ON social_profiles.notification_preferences;
CREATE TRIGGER notif_prefs_update_timestamp
    BEFORE UPDATE ON social_profiles.notification_preferences
    FOR EACH ROW
    EXECUTE FUNCTION social_profiles.update_notif_prefs_timestamp();

-- ============================================================
-- Record this migration
-- ============================================================
INSERT INTO social_pipeline.schema_migrations (version, description)
VALUES ('017', 'Push Notification System: subscriptions, log, and preferences tables per F-029')
ON CONFLICT (version) DO NOTHING;

COMMIT;
