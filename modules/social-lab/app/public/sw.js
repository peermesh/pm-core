// =============================================================================
// Service Worker — Push Notification Handler
// =============================================================================
// Handles push events from WebPush (RFC 8030) and notification clicks.
// Blueprint: F-029 (Push Notification Unification)
//
// Registration (in client code):
//   if ('serviceWorker' in navigator) {
//     navigator.serviceWorker.register('/sw.js');
//   }

// =============================================================================
// Push Event — Display notification
// =============================================================================

self.addEventListener('push', (event) => {
  if (!event.data) {
    console.warn('[sw] Push event received but no data');
    return;
  }

  let payload;
  try {
    payload = event.data.json();
  } catch (err) {
    console.error('[sw] Failed to parse push payload:', err);
    // Fallback: treat as plain text
    payload = {
      title: 'PeerMesh Social Lab',
      body: event.data.text(),
    };
  }

  const title = payload.title || 'PeerMesh Social Lab';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icons/notification-icon.png',
    badge: payload.badge || '/icons/notification-badge.png',
    tag: payload.tag || undefined,
    data: payload.data || {},
    actions: payload.actions || [],
    // Per F-029 Mechanic 1: tag-based collapsing replaces previous
    // notification with the same tag
    renotify: !!payload.tag,
    // Require interaction for urgent notifications (DM, mention)
    requireInteraction: payload.data?.type === 'dm' || payload.data?.type === 'mention',
    timestamp: payload.timestamp ? new Date(payload.timestamp).getTime() : Date.now(),
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// =============================================================================
// Notification Click — Navigate to URL
// =============================================================================

self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  const data = notification.data || {};
  const action = event.action;

  // Close the notification
  notification.close();

  // Determine target URL
  let targetUrl = '/';

  if (action === 'reply' && data.url) {
    targetUrl = data.url + '?action=reply';
  } else if (action === 'dismiss') {
    // Just close, no navigation
    return;
  } else if (data.url) {
    targetUrl = data.url;
  }

  // Focus existing window or open new one
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Try to find an existing window with the target URL
      for (const client of windowClients) {
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      // Try to find any existing window and navigate it
      for (const client of windowClients) {
        if ('navigate' in client) {
          return client.navigate(targetUrl).then((c) => c.focus());
        }
      }
      // Open a new window
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// =============================================================================
// Notification Close — Mark as dismissed (optional analytics)
// =============================================================================

self.addEventListener('notificationclose', (event) => {
  const data = event.notification.data || {};

  // Mark as dismissed via API if we have a notification ID
  if (data.notificationId) {
    fetch(`/api/notifications/${data.notificationId}/read`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => {
      // Best-effort — don't block on failure
    });
  }
});

// =============================================================================
// Service Worker Lifecycle
// =============================================================================

self.addEventListener('install', (event) => {
  console.log('[sw] Service Worker installed');
  // Activate immediately (don't wait for old SW to be released)
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[sw] Service Worker activated');
  // Claim all existing clients immediately
  event.waitUntil(clients.claim());
});
