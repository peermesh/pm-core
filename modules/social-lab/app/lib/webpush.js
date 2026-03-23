// =============================================================================
// WebPush Module — VAPID Key Management & Push Notification Delivery
// =============================================================================
// Implements WebPush (RFC 8030) with VAPID (RFC 8292) for push delivery.
// Payload encryption per RFC 8291 is handled by the web-push library.
//
// VAPID keys are generated once per instance and stored as Docker secrets
// or persisted to /data for development.
//
// Blueprint: F-029 (Push Notification Unification)

import webpush from 'web-push';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

// =============================================================================
// VAPID Key Management
// =============================================================================

let _vapidKeys = null;

/**
 * Load or generate VAPID key pair.
 * Priority:
 *   1. Docker secret files (/run/secrets/vapid_public_key, /run/secrets/vapid_private_key)
 *   2. Environment variables (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
 *   3. Persisted key files in /data/vapid/
 *   4. Auto-generate and persist to /data/vapid/
 *
 * @returns {{ publicKey: string, privateKey: string }}
 */
function loadVapidKeys() {
  if (_vapidKeys) return _vapidKeys;

  // 1. Docker secrets
  const pubSecretPath = '/run/secrets/vapid_public_key';
  const privSecretPath = '/run/secrets/vapid_private_key';
  try {
    const publicKey = readFileSync(pubSecretPath, 'utf8').trim();
    const privateKey = readFileSync(privSecretPath, 'utf8').trim();
    if (publicKey && privateKey) {
      _vapidKeys = { publicKey, privateKey };
      console.log('[webpush] Using VAPID keys from Docker secrets');
      return _vapidKeys;
    }
  } catch {
    // Not available — try next source
  }

  // 2. Environment variables
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    _vapidKeys = {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY,
    };
    console.log('[webpush] Using VAPID keys from environment variables');
    return _vapidKeys;
  }

  // 3. Persisted key files
  const vapidDir = '/data/vapid';
  const pubPath = `${vapidDir}/public.key`;
  const privPath = `${vapidDir}/private.key`;
  try {
    const publicKey = readFileSync(pubPath, 'utf8').trim();
    const privateKey = readFileSync(privPath, 'utf8').trim();
    if (publicKey && privateKey) {
      _vapidKeys = { publicKey, privateKey };
      console.log('[webpush] Using persisted VAPID keys from /data/vapid');
      return _vapidKeys;
    }
  } catch {
    // Not found — generate
  }

  // 4. Auto-generate and persist
  console.log('[webpush] Generating new VAPID key pair...');
  _vapidKeys = webpush.generateVAPIDKeys();
  try {
    if (!existsSync(vapidDir)) {
      mkdirSync(vapidDir, { recursive: true });
    }
    writeFileSync(pubPath, _vapidKeys.publicKey, { mode: 0o644 });
    writeFileSync(privPath, _vapidKeys.privateKey, { mode: 0o600 });
    console.log('[webpush] Generated and persisted new VAPID key pair to /data/vapid');
  } catch (err) {
    console.warn('[webpush] Could not persist VAPID keys:', err.message);
    console.log('[webpush] Using ephemeral VAPID keys (will regenerate on restart)');
  }

  return _vapidKeys;
}

/**
 * Get the VAPID public key (for client-side PushManager.subscribe()).
 * @returns {string} Base64url-encoded VAPID public key
 */
function getVapidPublicKey() {
  return loadVapidKeys().publicKey;
}

/**
 * Generate a fresh VAPID key pair (utility, not normally called at runtime).
 * @returns {{ publicKey: string, privateKey: string }}
 */
function generateVAPIDKeys() {
  return webpush.generateVAPIDKeys();
}

// =============================================================================
// WebPush Configuration
// =============================================================================

/**
 * Initialize the web-push library with VAPID details.
 * Must be called before sending any notifications.
 */
function initializeWebPush() {
  const keys = loadVapidKeys();
  const contactEmail = process.env.VAPID_CONTACT_EMAIL || 'mailto:admin@peermesh.org';

  webpush.setVapidDetails(contactEmail, keys.publicKey, keys.privateKey);
  console.log('[webpush] Initialized with VAPID public key:', keys.publicKey.slice(0, 20) + '...');
}

// =============================================================================
// Push Notification Delivery
// =============================================================================

/**
 * Priority-to-TTL mapping per F-029 Mechanic 6.
 * urgent: 24 hours, normal: 4 hours, low: 0 (fire-and-forget)
 */
const PRIORITY_TTL = {
  urgent: 86400,   // 24 hours
  normal: 14400,   // 4 hours
  low: 0,          // fire-and-forget
};

/**
 * Priority-to-urgency header mapping (RFC 8030 Section 5.3).
 */
const PRIORITY_URGENCY = {
  urgent: 'high',
  normal: 'normal',
  low: 'low',
};

/**
 * Send a push notification to a subscription endpoint.
 *
 * Payload is encrypted per RFC 8291 by the web-push library using the
 * subscription's p256dh and auth keys. The push service cannot read
 * the notification content.
 *
 * @param {Object} subscription - Push subscription object
 * @param {string} subscription.endpoint - Push service endpoint URL
 * @param {Object} subscription.keys - Subscription keys
 * @param {string} subscription.keys.p256dh - P-256 DH public key
 * @param {string} subscription.keys.auth - Authentication secret
 * @param {Object} payload - Notification payload
 * @param {string} payload.title - Notification title
 * @param {string} payload.body - Notification body text
 * @param {string} [payload.icon] - Notification icon URL
 * @param {string} [payload.badge] - Notification badge URL
 * @param {Object} [payload.data] - Arbitrary data passed to the Service Worker
 * @param {string} [payload.data.url] - URL to navigate to on click
 * @param {string} [payload.data.type] - Canonical notification type
 * @param {string} [payload.data.protocol] - Source protocol
 * @param {string} [payload.tag] - Tag for notification collapsing
 * @param {Array} [payload.actions] - Notification action buttons
 * @param {string} [priority='normal'] - Priority level: urgent, normal, low
 * @returns {Promise<Object>} web-push send result
 * @throws {Error} If the push service returns an error (e.g. 410 Gone)
 */
async function sendPushNotification(subscription, payload, priority = 'normal') {
  const ttl = PRIORITY_TTL[priority] ?? PRIORITY_TTL.normal;
  const urgency = PRIORITY_URGENCY[priority] ?? PRIORITY_URGENCY.normal;

  // Enforce max payload size (4096 bytes per F-029 Mechanic 1)
  const payloadStr = JSON.stringify(payload);
  if (Buffer.byteLength(payloadStr, 'utf8') > 4096) {
    console.warn('[webpush] Payload exceeds 4096 bytes, truncating body');
    // Truncate body to fit within limit
    const truncated = { ...payload, body: (payload.body || '').slice(0, 200) + '...' };
    return webpush.sendNotification(subscription, JSON.stringify(truncated), {
      TTL: ttl,
      urgency,
    });
  }

  return webpush.sendNotification(subscription, payloadStr, {
    TTL: ttl,
    urgency,
  });
}

/**
 * Send a push notification to multiple subscriptions (multi-device delivery).
 * Per F-029 Mechanic 6: All active subscriptions receive the notification.
 *
 * Returns results for each subscription. Subscriptions that return HTTP 410
 * (Gone) should be removed from the database.
 *
 * @param {Array<Object>} subscriptions - Array of push subscription objects
 * @param {Object} payload - Notification payload (same as sendPushNotification)
 * @param {string} [priority='normal'] - Priority level
 * @returns {Promise<Array<{ subscription: Object, success: boolean, error?: Object }>>}
 */
async function sendToMultipleSubscriptions(subscriptions, payload, priority = 'normal') {
  const results = await Promise.allSettled(
    subscriptions.map(sub => sendPushNotification(sub, payload, priority))
  );

  return results.map((result, i) => {
    if (result.status === 'fulfilled') {
      return { subscription: subscriptions[i], success: true };
    }
    return {
      subscription: subscriptions[i],
      success: false,
      error: result.reason,
      // HTTP 410 means subscription is expired/invalid — should be removed
      gone: result.reason?.statusCode === 410,
    };
  });
}

/**
 * Classify notification priority per F-029 Mechanic 6.
 * - urgent: DM, mention, moderation
 * - normal: follow, like, repost, reply
 * - low: zap
 *
 * @param {string} type - Canonical notification type
 * @returns {string} Priority level: urgent, normal, low
 */
function classifyPriority(type) {
  switch (type) {
    case 'dm':
    case 'mention':
    case 'moderation':
      return 'urgent';
    case 'zap':
      return 'low';
    default:
      return 'normal';
  }
}

export {
  loadVapidKeys,
  getVapidPublicKey,
  generateVAPIDKeys,
  initializeWebPush,
  sendPushNotification,
  sendToMultipleSubscriptions,
  classifyPriority,
  PRIORITY_TTL,
};
