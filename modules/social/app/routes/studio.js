// =============================================================================
// Studio Routes — Creator Dashboard (Phase 2: Compose + Content)
// =============================================================================
// GET  /studio             — Dashboard (with compose box)
// GET  /studio/compose     — Full-page compose view
// GET  /studio/content     — Post management (list, delete)
// GET  /studio/links       — Link Management
// GET  /studio/customize   — Profile Customization
// GET  /studio/settings    — Settings
// GET  /studio/analytics   — Analytics (real data)
// POST /studio/post        — Create post from form submit
// POST /studio/post/delete — Delete a post from form submit
//
// Auth: Session-based authentication via signed cookies (see lib/session.js).
// Design: Server-rendered HTML, inline CSS with design tokens, zero JS.

import { randomUUID } from 'node:crypto';
import { pool } from '../db.js';
import {
  html, json, parseUrl, escapeHtml, readFormBody, lookupProfileByHandle, getBioLinks,
  BASE_URL, INSTANCE_DOMAIN,
} from '../lib/helpers.js';
import { requireAuth } from '../lib/session.js';
import { signedFetch } from '../lib/http-signatures.js';
import { npubToHex, createNostrEvent } from '../lib/nostr-crypto.js';
import { registry } from '../lib/protocol-registry.js';
import {
  REGISTRATION_MODE,
  INVITE_POOL_SIZE,
  getUserInviteCodes,
  getInvitationTree,
  getInviteStats,
  getAllInviteCodes,
  checkPoolLimit,
  isAdmin,
} from '../lib/invites.js';

/**
 * Protocol display names and colors for badges.
 */
const PROTOCOL_DISPLAY = {
  activitypub: { label: 'ActivityPub', color: 'var(--color-accent)' },
  nostr: { label: 'Nostr', color: 'var(--color-violet-500)' },
  atproto: { label: 'AT Protocol', color: 'var(--color-blue-500)' },
  atprotocol: { label: 'AT Protocol', color: 'var(--color-blue-500)' },
  rss: { label: 'RSS', color: 'var(--color-orange-500)' },
  indieweb: { label: 'IndieWeb', color: 'var(--color-cyan-400)' },
  matrix: { label: 'Matrix', color: 'var(--color-green-500)' },
  xmtp: { label: 'XMTP', color: 'var(--color-red-500)' },
  dsnp: { label: 'DSNP', color: 'var(--color-cyan-400)' },
  solid: { label: 'Solid', color: 'var(--color-accent)' },
  holochain: { label: 'Holochain', color: 'var(--color-green-600)' },
  ssb: { label: 'SSB', color: 'var(--color-amber-500)' },
  zot: { label: 'Zot', color: 'var(--color-orange-500)' },
  bonfire: { label: 'Bonfire', color: 'var(--color-rose-500)' },
  hypercore: { label: 'Hypercore', color: 'var(--color-blue-400)' },
  braid: { label: 'Braid', color: 'var(--color-violet-600)' },
  willow: { label: 'Willow', color: 'var(--color-green-500)' },
  ocapn: { label: 'OCapN', color: 'var(--color-amber-400)' },
  keyhive: { label: 'Keyhive', color: 'var(--color-cyan-500)' },
  vc: { label: 'VC', color: 'var(--color-blue-600)' },
};

// =============================================================================
// SVG Icons (simple line icons, consistent density)
// =============================================================================

const ICONS = {
  dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
  links: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>',
  analytics: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
  customize: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>',
  feed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M4 11a9 9 0 019 9"/><path d="M4 4a16 16 0 0116 16"/><circle cx="5" cy="19" r="1"/></svg>',
  externalLink: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
  externalLinkSmall: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>',
  grip: '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  content: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
  compose: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
  groups: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
};

// =============================================================================
// Shared CSS (Design Tokens inlined)
// =============================================================================

const STUDIO_CSS = `
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

    :root {
      /* Layout aliases (tokens.css provides all color/font/spacing/shape tokens) */
      --sidebar-width: var(--space-sidebar-width);
      --sidebar-collapsed: var(--space-sidebar-width-collapsed);
      --topbar-height: var(--space-topbar-height);
      --tab-height: var(--space-tab-height);
      --content-max-width: var(--space-content-max-width-studio);
    }

    body {
      font-family: var(--font-family-primary);
      background: var(--color-bg-primary);
      color: var(--color-text-primary);
      min-height: 100vh;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }

    a { color: var(--color-primary); text-decoration: none; }
    a:hover { color: var(--color-primary-hover); }

    /* ===== Top Bar ===== */
    .studio-topbar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: var(--topbar-height);
      background: var(--color-bg-secondary);
      border-bottom: 1px solid var(--color-border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 1.5rem;
      z-index: 100;
    }

    .topbar-left {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .topbar-logo {
      font-size: 1rem;
      font-weight: 600;
      color: var(--color-primary);
      text-decoration: none;
    }

    .topbar-logo:hover { color: var(--color-primary-hover); }

    .topbar-divider {
      width: 1px;
      height: 24px;
      background: var(--color-border-strong);
    }

    .topbar-title {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--color-text-primary);
    }

    .topbar-right {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .topbar-search {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      background: var(--color-bg-tertiary);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-pill);
      padding: 0.25rem 0.75rem;
      transition: border-color 0.15s, background 0.15s;
      max-width: 360px;
      flex: 1;
    }
    .topbar-search:focus-within {
      border-color: var(--color-primary);
      background: var(--color-bg-elevated);
    }
    .topbar-search .search-icon {
      color: var(--color-text-tertiary);
      flex-shrink: 0;
    }
    .topbar-search-input {
      background: transparent;
      border: none;
      outline: none;
      color: var(--color-text-primary);
      font-size: 0.8125rem;
      font-family: var(--font-family);
      width: 100%;
      padding: 0.25rem 0;
    }
    .topbar-search-input::placeholder {
      color: var(--color-text-tertiary);
    }
    @media (max-width: 768px) {
      .topbar-search { display: none; }
    }

    .topbar-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.375rem 1rem;
      background: transparent;
      border: 1px solid var(--color-border-strong);
      border-radius: var(--radius-pill);
      color: var(--color-text-primary);
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
      text-decoration: none;
      transition: background 0.15s, border-color 0.15s;
      font-family: var(--font-family-primary);
      min-height: 36px;
    }

    .topbar-btn:hover {
      background: var(--color-bg-hover);
      border-color: var(--color-text-secondary);
      color: var(--color-text-primary);
    }

    .topbar-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: var(--color-primary);
      color: var(--color-text-inverse);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.875rem;
      font-weight: 600;
      border: 2px solid var(--color-border-strong);
    }

    /* ===== Sidebar (Desktop) ===== */
    .studio-sidebar {
      position: fixed;
      top: var(--topbar-height);
      left: 0;
      bottom: 0;
      width: var(--sidebar-width);
      background: var(--color-bg-secondary);
      border-right: 1px solid var(--color-border);
      padding: 1rem 0;
      display: flex;
      flex-direction: column;
      z-index: 100;
      overflow-y: auto;
    }

    .sidebar-nav {
      flex: 1;
      display: flex;
      flex-direction: column;
    }

    .sidebar-item {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      margin: 0 0.5rem;
      border-radius: var(--radius-md);
      color: var(--color-text-secondary);
      text-decoration: none;
      font-size: 0.875rem;
      font-weight: 400;
      transition: background 0.15s, color 0.15s;
      cursor: pointer;
      min-height: 44px;
    }

    .sidebar-item:hover {
      background: var(--color-bg-hover);
      color: var(--color-text-primary);
    }

    .sidebar-item.active {
      background: var(--color-primary-light);
      color: var(--color-text-primary);
      font-weight: 500;
    }

    .sidebar-item.active .sidebar-icon {
      color: var(--color-primary);
    }

    .sidebar-icon {
      display: flex;
      align-items: center;
      flex-shrink: 0;
      color: inherit;
    }

    .sidebar-label {
      flex: 1;
    }

    .sidebar-divider {
      height: 1px;
      background: var(--color-border);
      margin: 0.75rem 1rem;
    }

    .sidebar-footer {
      margin-top: auto;
    }

    /* ===== Content Area ===== */
    .studio-content {
      margin-top: var(--topbar-height);
      margin-left: var(--sidebar-width);
      padding: 1.5rem;
      min-height: calc(100vh - var(--topbar-height));
    }

    .studio-content-inner {
      max-width: var(--content-max-width);
      margin: 0 auto;
    }

    /* ===== Bottom Tab Bar (Mobile) ===== */
    .studio-tabbar {
      display: none;
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: var(--tab-height);
      background: var(--color-bg-secondary);
      border-top: 1px solid var(--color-border);
      justify-content: space-around;
      align-items: center;
      z-index: 100;
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
    }

    .tab-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.25rem;
      padding: 0.5rem;
      color: var(--color-text-tertiary);
      text-decoration: none;
      min-width: 44px;
      min-height: 44px;
      justify-content: center;
      position: relative;
    }

    .tab-item:hover {
      color: var(--color-text-primary);
    }

    .tab-item.active {
      color: var(--color-primary);
    }

    .tab-item.active::after {
      content: "";
      position: absolute;
      bottom: 6px;
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background: var(--color-primary);
    }

    .tab-icon {
      display: flex;
      align-items: center;
    }

    /* ===== Page Header ===== */
    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 1.5rem;
      flex-wrap: wrap;
      gap: 1rem;
    }

    .page-title {
      font-size: 1.5rem;
      font-weight: 600;
      color: var(--color-text-primary);
    }

    .page-actions {
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    /* ===== Buttons ===== */
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      font-family: var(--font-family-primary);
      font-size: 0.875rem;
      font-weight: 500;
      border: none;
      border-radius: var(--radius-pill);
      cursor: pointer;
      transition: background 0.15s, box-shadow 0.15s;
      text-decoration: none;
      min-height: 44px;
      padding: 0.75rem 1.5rem;
    }

    .btn-primary {
      background: var(--color-primary);
      color: var(--color-text-inverse);
    }

    .btn-primary:hover {
      background: var(--color-primary-hover);
      color: var(--color-text-inverse);
      box-shadow: var(--shadow-sm);
    }

    .btn-secondary {
      background: transparent;
      border: 1px solid var(--color-border-strong);
      color: var(--color-text-primary);
    }

    .btn-secondary:hover {
      background: var(--color-bg-hover);
      border-color: var(--color-text-secondary);
      color: var(--color-text-primary);
    }

    .btn-ghost {
      background: transparent;
      color: var(--color-text-primary);
      padding: 0.5rem 1rem;
    }

    .btn-ghost:hover {
      background: var(--color-bg-hover);
      color: var(--color-text-primary);
    }

    .btn-danger {
      background: var(--color-error);
      color: var(--color-text-primary);
    }

    .btn-danger:hover {
      background: var(--color-red-600);
      color: var(--color-text-primary);
    }

    .btn-sm {
      min-height: 32px;
      padding: 0.25rem 1rem;
      font-size: 0.75rem;
    }

    /* ===== Cards ===== */
    .card {
      background: var(--color-bg-secondary);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      padding: 1.5rem;
      transition: box-shadow 0.15s, border-color 0.15s;
    }

    .card:hover {
      box-shadow: var(--shadow-sm);
      border-color: var(--color-border-strong);
    }

    /* Stat Cards */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1rem;
    }

    .stat-card {
      background: var(--color-bg-secondary);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      padding: 1.5rem;
      transition: box-shadow 0.15s, border-color 0.15s;
    }

    .stat-card:hover {
      box-shadow: var(--shadow-sm);
      border-color: var(--color-border-strong);
    }

    .stat-label {
      font-size: 0.875rem;
      color: var(--color-text-secondary);
      margin-bottom: 0.5rem;
    }

    .stat-value {
      font-size: 2.125rem;
      font-weight: 600;
      color: var(--color-text-primary);
      line-height: 1.2;
      letter-spacing: -0.02em;
    }

    .stat-delta {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      font-size: 0.875rem;
      font-weight: 500;
      margin-top: 0.25rem;
    }

    .stat-delta-positive { color: var(--color-success); }
    .stat-delta-neutral { color: var(--color-text-secondary); }

    /* Section */
    .section {
      margin-bottom: 1.5rem;
    }

    .section-title {
      font-size: 1.25rem;
      font-weight: 500;
      color: var(--color-text-primary);
      margin-bottom: 1rem;
    }

    /* ===== Profile Summary Card ===== */
    .profile-summary {
      display: flex;
      align-items: center;
      gap: 1.25rem;
      padding: 1.5rem;
      background: var(--color-bg-secondary);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      margin-bottom: 1.5rem;
    }

    .profile-summary-avatar {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: var(--color-primary);
      color: var(--color-text-inverse);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.5rem;
      font-weight: 600;
      flex-shrink: 0;
      border: 2px solid var(--color-border-strong);
      object-fit: cover;
    }

    .profile-summary-info {
      flex: 1;
      min-width: 0;
    }

    .profile-summary-name {
      font-size: 1.125rem;
      font-weight: 600;
      color: var(--color-text-primary);
    }

    .profile-summary-handle {
      font-size: 0.875rem;
      color: var(--color-text-secondary);
    }

    .profile-summary-badges {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.5rem;
      flex-wrap: wrap;
    }

    /* Protocol Badges */
    .protocol-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.25rem 0.5rem;
      border-radius: var(--radius-sm);
      font-size: 0.6875rem;
      font-weight: 500;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      border: 1px solid var(--color-border);
    }

    .badge-active {
      background: var(--color-success-light);
      color: var(--color-success);
      border-color: var(--color-success);
    }

    .badge-soon {
      background: transparent;
      color: var(--color-text-tertiary);
      border-style: dashed;
    }

    /* Protocol Health Cards */
    .protocol-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 0.75rem;
    }

    .protocol-card {
      background: var(--color-bg-secondary);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      padding: 1rem;
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .protocol-status {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .protocol-status-active { background: var(--color-success); }
    .protocol-status-soon { background: var(--color-text-tertiary); }

    .protocol-name {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--color-text-primary);
    }

    .protocol-label {
      font-size: 0.75rem;
      color: var(--color-text-secondary);
    }

    /* ===== Quick Actions ===== */
    .quick-actions {
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    /* ===== Link List (Studio Links page) ===== */
    .link-list {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .link-item {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 1rem 1.25rem;
      background: var(--color-bg-secondary);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      transition: border-color 0.15s;
    }

    .link-item:hover {
      border-color: var(--color-border-strong);
    }

    .link-drag {
      color: var(--color-text-tertiary);
      cursor: grab;
      display: flex;
      align-items: center;
      flex-shrink: 0;
    }

    .link-icon {
      display: flex;
      align-items: center;
      color: var(--color-text-secondary);
      flex-shrink: 0;
    }

    .link-info {
      flex: 1;
      min-width: 0;
    }

    .link-label {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--color-text-primary);
    }

    .link-url {
      font-size: 0.75rem;
      color: var(--color-text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .link-actions {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-shrink: 0;
    }

    .link-action-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border: none;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--color-text-tertiary);
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }

    .link-action-btn:hover {
      background: var(--color-bg-hover);
      color: var(--color-text-primary);
    }

    .link-action-btn.danger:hover {
      background: var(--color-error-light);
      color: var(--color-error);
    }

    /* Add Link Form */
    .add-link-form {
      background: var(--color-bg-secondary);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      padding: 1.5rem;
      margin-top: 1.5rem;
    }

    .form-title {
      font-size: 1rem;
      font-weight: 500;
      color: var(--color-text-primary);
      margin-bottom: 1rem;
    }

    .form-grid {
      display: grid;
      gap: 1rem;
    }

    .form-field {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .form-label {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--color-text-primary);
    }

    .form-input {
      background: var(--color-bg-tertiary);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      padding: 0.75rem 1rem;
      font-size: 1rem;
      font-family: var(--font-family-primary);
      color: var(--color-text-primary);
      min-height: 44px;
      transition: border-color 0.15s;
      width: 100%;
    }

    .form-input::placeholder {
      color: var(--color-text-tertiary);
    }

    .form-input:hover {
      border-color: var(--color-border-strong);
    }

    .form-input:focus {
      outline: none;
      border-color: var(--color-primary);
      box-shadow: 0 0 0 3px var(--color-focus-ring);
    }

    .form-textarea {
      min-height: 96px;
      resize: vertical;
      line-height: 1.625;
    }

    .form-actions {
      display: flex;
      gap: 0.75rem;
      margin-top: 1rem;
    }

    /* ===== Customize Preview ===== */
    .preview-frame {
      background: var(--color-bg-tertiary);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      padding: 2rem;
      text-align: center;
      margin-bottom: 2rem;
    }

    .preview-label {
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--color-text-tertiary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 1rem;
    }

    .preview-avatar {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      background: var(--color-primary);
      color: var(--color-text-inverse);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 2rem;
      font-weight: 600;
      margin: 0 auto 0.75rem;
      border: 3px solid var(--color-border-strong);
      object-fit: cover;
    }

    .preview-name {
      font-size: 1.125rem;
      font-weight: 600;
      color: var(--color-text-primary);
    }

    .preview-handle {
      font-size: 0.875rem;
      color: var(--color-text-secondary);
      margin-bottom: 0.75rem;
    }

    .preview-link-pill {
      display: inline-block;
      padding: 0.5rem 1.5rem;
      background: var(--color-bg-secondary);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      color: var(--color-text-primary);
      font-size: 0.875rem;
      margin: 0.375rem;
    }

    /* ===== Settings ===== */
    .settings-section {
      background: var(--color-bg-secondary);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      padding: var(--space-6);
      margin-bottom: var(--space-6);
    }
    .settings-section-header {
      display: flex; align-items: center; gap: var(--space-3);
      margin-bottom: var(--space-4); padding-bottom: var(--space-3);
      border-bottom: 1px solid var(--color-border);
    }
    .settings-section-icon {
      display: flex; align-items: center; justify-content: center;
      width: 32px; height: 32px; border-radius: var(--radius-md);
      background: var(--color-primary-light); color: var(--color-primary); flex-shrink: 0;
    }
    .settings-section-title {
      font-size: var(--font-size-h3); font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary); margin: 0;
    }
    .settings-section-desc {
      font-size: var(--font-size-body-sm); color: var(--color-text-tertiary);
      margin-bottom: var(--space-4); line-height: var(--line-height-relaxed);
    }
    .settings-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: var(--space-3) 0; border-bottom: 1px solid var(--color-border); gap: var(--space-4);
    }
    .settings-row:last-child { border-bottom: none; }
    .settings-label {
      font-size: var(--font-size-body-sm); color: var(--color-text-primary);
      font-weight: var(--font-weight-medium);
    }
    .settings-label-group { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; flex: 1; }
    .settings-label-hint { font-size: var(--font-size-caption); color: var(--color-text-tertiary); font-weight: var(--font-weight-regular); }
    .settings-value {
      font-size: var(--font-size-body-sm); color: var(--color-text-secondary);
      display: flex; align-items: center; gap: var(--space-2); flex-shrink: 0;
    }
    .settings-status-dot {
      width: 8px; height: 8px; border-radius: var(--radius-full); display: inline-block; flex-shrink: 0;
    }
    .dot-active { background: var(--color-success); }
    .dot-partial { background: var(--color-warning); }
    .dot-stub { background: var(--color-text-tertiary); }
    .dot-inactive { background: var(--color-text-tertiary); }
    .dot-unavailable { background: var(--color-error); }

    /* Protocol card grid */
    .settings-section .protocol-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--space-3); }
    .settings-section .protocol-card {
      display: flex; align-items: flex-start; gap: var(--space-3); padding: var(--space-4);
      background: var(--color-bg-tertiary); border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      transition: border-color var(--duration-fast), background var(--duration-fast);
    }
    .settings-section .protocol-card:hover { border-color: var(--color-border-strong); background: var(--color-bg-elevated); }
    .protocol-card-icon {
      width: 36px; height: 36px; border-radius: var(--radius-md);
      display: flex; align-items: center; justify-content: center;
      font-size: var(--font-size-body-sm); font-weight: var(--font-weight-bold);
      flex-shrink: 0; color: var(--color-white);
    }
    .protocol-card-body { flex: 1; min-width: 0; }
    .protocol-card-name {
      font-size: var(--font-size-body-sm); font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary); display: flex; align-items: center; gap: var(--space-2);
    }
    .protocol-card-status {
      display: inline-flex; align-items: center; gap: var(--space-1);
      padding: 0.0625rem var(--space-2); border-radius: var(--radius-pill);
      font-size: var(--font-size-overline); font-weight: var(--font-weight-medium);
      text-transform: capitalize;
    }
    .status-active { background: var(--color-success-light); color: var(--color-success); }
    .status-partial { background: var(--color-warning-light); color: var(--color-warning); }
    .status-stub { background: var(--color-bg-hover); color: var(--color-text-tertiary); }
    .status-unavailable { background: var(--color-error-light); color: var(--color-error); }
    .protocol-card-identity {
      font-size: var(--font-size-caption); color: var(--color-text-secondary);
      margin-top: var(--space-1); font-family: var(--font-family-mono); word-break: break-all;
    }
    .protocol-card-desc {
      font-size: var(--font-size-caption); color: var(--color-text-tertiary);
      margin-top: var(--space-1); line-height: var(--line-height-relaxed);
    }

    /* Recovery warning */
    .recovery-warning {
      display: flex; align-items: flex-start; gap: var(--space-3); padding: var(--space-4);
      background: var(--color-warning-light); border: 1px solid rgba(245, 158, 11, 0.30);
      border-radius: var(--radius-md); margin-bottom: var(--space-4);
    }
    .recovery-warning-icon { color: var(--color-warning); flex-shrink: 0; margin-top: 2px; }
    .recovery-warning-text {
      font-size: var(--font-size-body-sm); color: var(--color-text-primary);
      line-height: var(--line-height-relaxed);
    }

    /* Toggle switch */
    .toggle-row { display: flex; align-items: center; justify-content: space-between; padding: var(--space-2) 0; }
    .toggle-label { font-size: var(--font-size-body-sm); color: var(--color-text-primary); }
    .toggle-switch {
      position: relative; width: 40px; height: 22px;
      background: var(--color-bg-tertiary); border: 1px solid var(--color-border-strong);
      border-radius: var(--radius-pill); cursor: pointer;
      transition: background var(--duration-fast), border-color var(--duration-fast); flex-shrink: 0;
    }
    .toggle-switch.is-on { background: var(--color-primary); border-color: var(--color-primary); }
    .toggle-switch::after {
      content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
      background: var(--color-white); border-radius: var(--radius-full);
      transition: transform var(--duration-fast);
    }
    .toggle-switch.is-on::after { transform: translateX(18px); }
    .settings-actions { display: flex; flex-wrap: wrap; gap: var(--space-3); margin-top: var(--space-4); }
    .instance-list { display: flex; flex-direction: column; gap: var(--space-2); }
    .instance-item {
      display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3);
      background: var(--color-bg-tertiary); border-radius: var(--radius-md);
      font-size: var(--font-size-body-sm);
    }
    .instance-item-dot { width: 8px; height: 8px; border-radius: var(--radius-full); background: var(--color-success); flex-shrink: 0; }

    /* Delete confirmation dialog */
    .confirm-overlay {
      display: none; position: fixed; inset: 0; background: var(--color-bg-overlay);
      z-index: 200; align-items: center; justify-content: center;
    }
    .confirm-dialog {
      background: var(--color-bg-secondary); border: 1px solid var(--color-border);
      border-radius: var(--radius-lg); padding: var(--space-8); max-width: 480px; width: 90%;
    }
    .confirm-title { font-size: var(--font-size-h2); font-weight: var(--font-weight-semibold); color: var(--color-error); margin-bottom: var(--space-3); }
    .confirm-text { font-size: var(--font-size-body-sm); color: var(--color-text-secondary); line-height: var(--line-height-relaxed); margin-bottom: var(--space-6); }
    .confirm-actions { display: flex; justify-content: flex-end; gap: var(--space-3); }

    /* Danger zone */
    .danger-zone { background: var(--color-error-light); border-color: var(--color-error); }
    .danger-zone .settings-section-header .settings-section-icon { background: rgba(239, 68, 68, 0.18); color: var(--color-error); }
    .danger-zone .settings-section-title { color: var(--color-error); }

    /* ===== Analytics Placeholder ===== */
    .placeholder-card {
      background: var(--color-bg-secondary);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      padding: 3rem 2rem;
      text-align: center;
    }

    .placeholder-icon {
      color: var(--color-text-tertiary);
      margin-bottom: 1rem;
    }

    .placeholder-title {
      font-size: 1.25rem;
      font-weight: 500;
      color: var(--color-text-primary);
      margin-bottom: 0.5rem;
    }

    .placeholder-desc {
      font-size: 1rem;
      color: var(--color-text-secondary);
      max-width: 360px;
      margin: 0 auto;
    }

    /* ===== Analytics Page ===== */
    .analytics-overview { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
    .analytics-stat-card { background: var(--color-bg-secondary); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1.25rem; transition: box-shadow var(--duration-fast), border-color var(--duration-fast); }
    .analytics-stat-card:hover { box-shadow: var(--shadow-sm); border-color: var(--color-border-strong); }
    .analytics-stat-label { font-size: var(--font-size-body-sm); font-weight: var(--font-weight-medium); color: var(--color-text-secondary); margin-bottom: var(--space-2); }
    .analytics-stat-value { font-size: var(--font-size-display); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); line-height: var(--line-height-tight); letter-spacing: var(--letter-spacing-tight); }
    .analytics-stat-sub { font-size: var(--font-size-caption); color: var(--color-text-tertiary); margin-top: var(--space-1); }
    .analytics-table { width: 100%; border-collapse: collapse; margin-bottom: var(--space-4); }
    .analytics-table th { text-align: left; font-size: var(--font-size-caption); font-weight: var(--font-weight-semibold); color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: var(--letter-spacing-wide); padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--color-border-strong); }
    .analytics-table td { padding: var(--space-3) var(--space-4); font-size: var(--font-size-body-sm); color: var(--color-text-primary); border-bottom: 1px solid var(--color-border); }
    .analytics-table tr:hover td { background: var(--color-bg-hover); }
    .analytics-table .protocol-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: var(--space-2); vertical-align: middle; }
    .analytics-table .rate-bar-bg { display: inline-block; width: 80px; height: 6px; border-radius: var(--radius-pill); background: var(--color-bg-tertiary); vertical-align: middle; margin-right: var(--space-2); position: relative; overflow: hidden; }
    .analytics-table .rate-bar { position: absolute; top: 0; left: 0; height: 100%; border-radius: var(--radius-pill); background: var(--color-success); }
    .analytics-feed-item { display: flex; align-items: flex-start; gap: var(--space-3); padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--color-border); }
    .analytics-feed-item:last-child { border-bottom: none; }
    .analytics-feed-icon { flex-shrink: 0; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: var(--font-size-caption); }
    .analytics-feed-body { flex: 1; min-width: 0; }
    .analytics-feed-text { font-size: var(--font-size-body-sm); color: var(--color-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .analytics-feed-meta { font-size: var(--font-size-caption); color: var(--color-text-tertiary); margin-top: 2px; }
    .analytics-feed-badge { display: inline-block; font-size: var(--font-size-overline); font-weight: var(--font-weight-medium); padding: 2px 8px; border-radius: var(--radius-pill); background: var(--color-protocol-badge-bg); color: var(--color-protocol-badge-text); }
    .analytics-chart { display: flex; align-items: flex-end; gap: var(--space-2); height: 120px; padding: var(--space-4) 0; }
    .analytics-chart-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: var(--space-1); height: 100%; justify-content: flex-end; }
    .analytics-chart-bar { width: 100%; max-width: 48px; background: var(--color-primary); border-radius: var(--radius-sm) var(--radius-sm) 0 0; min-height: 4px; transition: background var(--duration-fast); }
    .analytics-chart-col:hover .analytics-chart-bar { background: var(--color-primary-hover); }
    .analytics-chart-label { font-size: var(--font-size-overline); color: var(--color-text-tertiary); text-align: center; }
    .analytics-chart-count { font-size: var(--font-size-caption); color: var(--color-text-secondary); font-weight: var(--font-weight-medium); }
    .analytics-group-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; }
    .analytics-group-card { background: var(--color-bg-secondary); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1.25rem; }
    .analytics-group-name { font-size: var(--font-size-body-sm); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); margin-bottom: var(--space-2); }
    .analytics-group-meta { display: flex; gap: var(--space-6); font-size: var(--font-size-caption); color: var(--color-text-secondary); }
    .analytics-group-meta span { display: flex; align-items: center; gap: var(--space-1); }
    .analytics-feed { background: var(--color-bg-secondary); border: 1px solid var(--color-border); border-radius: var(--radius-lg); overflow: hidden; }
    .analytics-feed-empty { padding: var(--space-8); text-align: center; color: var(--color-text-tertiary); font-size: var(--font-size-body-sm); }
    .analytics-two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
    @media (max-width: 900px) { .analytics-two-col { grid-template-columns: 1fr; } }

    /* ===== Compose Box ===== */
    .compose-box {
      background: var(--color-bg-secondary);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }

    .compose-box:focus-within {
      border-color: var(--color-primary);
      box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.15);
    }

    .compose-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1rem;
    }

    .compose-avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: var(--color-primary);
      color: var(--color-text-inverse);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1rem;
      font-weight: 600;
      flex-shrink: 0;
      border: 2px solid var(--color-border-strong);
      object-fit: cover;
    }

    .compose-prompt {
      font-size: 0.875rem;
      color: var(--color-text-secondary);
    }

    .compose-textarea {
      width: 100%;
      min-height: 96px;
      background: var(--color-bg-tertiary);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      padding: 0.75rem 1rem;
      font-size: 1rem;
      font-family: var(--font-family-primary);
      color: var(--color-text-primary);
      resize: vertical;
      line-height: 1.625;
      transition: border-color 0.15s;
    }

    .compose-textarea::placeholder {
      color: var(--color-text-tertiary);
    }

    .compose-textarea:hover {
      border-color: var(--color-border-strong);
    }

    .compose-textarea:focus {
      outline: none;
      border-color: var(--color-primary);
      box-shadow: 0 0 0 3px var(--color-focus-ring);
    }

    .compose-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 0.75rem;
      flex-wrap: wrap;
      gap: 0.75rem;
    }

    .compose-meta {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .char-count {
      font-size: 0.75rem;
      color: var(--color-text-tertiary);
      font-family: var(--font-family-mono);
    }

    .char-count.warn {
      color: var(--color-warning);
    }

    .char-count.over {
      color: var(--color-error);
    }

    .compose-actions {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .compose-icon-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border: none;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--color-text-tertiary);
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }

    .compose-icon-btn:hover {
      background: var(--color-bg-hover);
      color: var(--color-primary);
    }

    /* ===== Protocol Checkboxes ===== */
    .protocol-checks {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      margin-top: 0.75rem;
    }

    .protocol-check {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.375rem 0.75rem;
      background: var(--color-bg-tertiary);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-pill);
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
      font-size: 0.8125rem;
      color: var(--color-text-secondary);
    }

    .protocol-check:hover {
      border-color: var(--color-border-strong);
    }

    .protocol-check input[type="checkbox"] {
      accent-color: var(--color-primary);
      width: 14px;
      height: 14px;
    }

    .protocol-check input[type="checkbox"]:checked + span {
      color: var(--color-text-primary);
    }

    .protocol-check.protocol-disabled {
      opacity: 0.45;
      cursor: not-allowed;
      border-style: dashed;
    }

    .protocol-check.protocol-disabled input[type="checkbox"] {
      pointer-events: none;
    }

    .protocol-check .protocol-icon {
      display: inline-flex;
      align-items: center;
      width: 14px;
      height: 14px;
      flex-shrink: 0;
    }

    .protocol-check .protocol-soon-tag {
      font-size: 0.625rem;
      text-transform: uppercase;
      letter-spacing: var(--letter-spacing-wide);
      color: var(--color-text-tertiary);
      margin-left: 0.25rem;
    }

    /* ===== Success Banner ===== */
    .success-banner {
      background: var(--color-success-light);
      border: 1px solid rgba(34, 197, 94, 0.3);
      border-radius: var(--radius-lg);
      padding: 1rem 1.25rem;
      margin-bottom: 1.5rem;
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
    }

    .success-banner-icon {
      color: var(--color-success);
      flex-shrink: 0;
      margin-top: 0.125rem;
    }

    .success-banner-text {
      flex: 1;
    }

    .success-banner-title {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--color-success);
      margin-bottom: 0.25rem;
    }

    .success-banner-detail {
      font-size: 0.8125rem;
      color: var(--color-text-secondary);
    }

    .dist-badges {
      display: flex;
      gap: 0.375rem;
      flex-wrap: wrap;
      margin-top: 0.5rem;
    }

    .dist-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.125rem 0.5rem;
      border-radius: var(--radius-pill);
      font-size: 0.6875rem;
      font-weight: 500;
      letter-spacing: var(--letter-spacing-wide);
    }

    .dist-badge .protocol-icon {
      display: inline-flex;
      align-items: center;
      width: 12px;
      height: 12px;
      flex-shrink: 0;
    }

    .dist-badge .protocol-icon svg {
      width: 12px;
      height: 12px;
    }

    .dist-badge-sent {
      background: var(--color-success-light);
      color: var(--color-success);
      border: 1px solid rgba(34, 197, 94, 0.3);
    }

    .dist-badge-pending {
      background: rgba(245, 158, 11, 0.12);
      color: var(--color-warning);
      border: 1px solid rgba(245, 158, 11, 0.3);
    }

    .dist-badge-failed {
      background: var(--color-error-light);
      color: var(--color-error);
      border: 1px solid rgba(239, 68, 68, 0.3);
    }

    .dist-badge-skipped {
      background: transparent;
      color: var(--color-text-tertiary);
      border: 1px dashed var(--color-border);
    }

    /* ===== Post List (Content Page) ===== */
    .post-list {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .post-item {
      display: flex;
      gap: 1rem;
      padding: 1.25rem;
      background: var(--color-bg-secondary);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      transition: border-color 0.15s;
    }

    .post-item:hover {
      border-color: var(--color-border-strong);
    }

    .post-item-body {
      flex: 1;
      min-width: 0;
    }

    .post-item-content {
      font-size: 0.9375rem;
      color: var(--color-text-primary);
      line-height: 1.6;
      word-break: break-word;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .post-item-meta {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-top: 0.5rem;
      flex-wrap: wrap;
    }

    .post-item-time {
      font-size: 0.75rem;
      color: var(--color-text-tertiary);
    }

    .post-item-actions {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
      flex-shrink: 0;
    }

    /* ===== Post Preview (Compose Page) ===== */
    .post-preview {
      background: var(--color-bg-tertiary);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      padding: 1.5rem;
      margin-top: 1.5rem;
    }

    .post-preview-label {
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--color-text-tertiary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 1rem;
    }

    .post-preview-card {
      background: var(--color-bg-secondary);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      padding: 1rem;
    }

    .post-preview-content {
      font-size: 0.9375rem;
      color: var(--color-text-secondary);
      font-style: italic;
      line-height: 1.6;
    }

    /* ===== Pagination ===== */
    .pagination {
      display: flex;
      justify-content: center;
      gap: 0.5rem;
      margin-top: 1.5rem;
    }

    /* ===== Empty State ===== */
    .empty-state {
      text-align: center;
      padding: 4rem 1.5rem;
    }

    .empty-state-icon {
      color: var(--color-text-tertiary);
      margin-bottom: 1rem;
    }

    .empty-state-title {
      font-size: 1.25rem;
      font-weight: 500;
      color: var(--color-text-primary);
      margin-bottom: 0.5rem;
    }

    .empty-state-desc {
      font-size: 1rem;
      color: var(--color-text-secondary);
      max-width: 360px;
      margin: 0 auto 1rem;
    }

    /* ===== Responsive ===== */

    /* Tablet: collapsed sidebar */
    @media (max-width: 1023px) and (min-width: 768px) {
      .studio-sidebar { width: var(--sidebar-collapsed); }
      .sidebar-label { display: none; }
      .sidebar-item { justify-content: center; padding: 0.75rem; }
      .studio-content { margin-left: var(--sidebar-collapsed); }
    }

    /* Mobile: no sidebar, bottom tab bar */
    @media (max-width: 767px) {
      .studio-sidebar { display: none; }
      .studio-tabbar { display: flex; }
      .studio-content {
        margin-left: 0;
        padding: 1rem;
        padding-bottom: calc(var(--tab-height) + 1rem);
      }
      .stats-grid { grid-template-columns: 1fr; }
      .stat-value { font-size: 1.5rem; }
      .page-header { padding-bottom: 1rem; }
      .page-title { font-size: 1.25rem; }
      .profile-summary { flex-direction: column; text-align: center; }
      .profile-summary-badges { justify-content: center; }
      .form-grid { grid-template-columns: 1fr; }
      .link-item { flex-wrap: wrap; }
      .link-info { min-width: 100%; order: 1; }
      .link-drag { order: -1; }
      .link-actions { order: 2; margin-left: auto; }
      .quick-actions { flex-direction: column; }
      .quick-actions .btn { width: 100%; justify-content: center; }
    }

    /* Wide desktop: 4-column stats */
    @media (min-width: 1024px) {
      .stats-grid { grid-template-columns: repeat(4, 1fr); }
      .form-grid-2col { grid-template-columns: repeat(2, 1fr); }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { transition: none !important; }
    }
`;

// =============================================================================
// Layout Shell
// =============================================================================

function studioShell({ title, activePage, profile, contentHtml, sessionUsername }) {
  const displayName = profile ? escapeHtml(profile.display_name || profile.username || 'User') : 'Studio';
  const handle = profile ? escapeHtml(profile.username || '') : '';
  const avatarUrl = profile ? profile.avatar_url : null;
  const initial = displayName.charAt(0).toUpperCase();
  const authUsername = sessionUsername ? escapeHtml(sessionUsername) : '';
  const ourDomain = INSTANCE_DOMAIN;

  const avatarHtml = avatarUrl
    ? `<img class="topbar-avatar" src="${escapeHtml(avatarUrl)}" alt="${displayName}" style="object-fit:cover">`
    : `<div class="topbar-avatar">${initial}</div>`;

  const profileSummaryAvatar = avatarUrl
    ? `<img class="profile-summary-avatar" src="${escapeHtml(avatarUrl)}" alt="${displayName}">`
    : `<div class="profile-summary-avatar">${initial}</div>`;

  function navItem(page, label, icon, href) {
    const isActive = activePage === page;
    return `<a class="sidebar-item${isActive ? ' active' : ''}" href="${href}"${isActive ? ' aria-current="page"' : ''}>
      <span class="sidebar-icon">${icon}</span>
      <span class="sidebar-label">${label}</span>
    </a>`;
  }

  function tabItem(page, icon, href, label) {
    const isActive = activePage === page;
    return `<a class="tab-item${isActive ? ' active' : ''}" href="${href}" aria-label="${label}"${isActive ? ' aria-current="page"' : ''}>
      <span class="tab-icon">${icon}</span>
    </a>`;
  }

  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - Studio - PeerMesh Social</title>
  <meta name="robots" content="noindex, nofollow">
  <link rel="stylesheet" href="/static/tokens.css">
  <style>${STUDIO_CSS}</style>
</head>
<body>
  <!-- Top Bar -->
  <header class="studio-topbar">
    <div class="topbar-left">
      <a href="/studio" class="topbar-logo">Studio</a>
      <div class="topbar-divider"></div>
      <span class="topbar-title">${escapeHtml(title)}</span>
    </div>
    <form class="topbar-search" action="/studio/search" method="GET">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" class="search-icon"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="text" name="q" placeholder="Search profiles, posts, groups..." autocomplete="off" class="topbar-search-input">
    </form>
    <div class="topbar-right">
      ${handle ? `<a class="topbar-btn" href="/@${handle}" target="_blank" rel="noopener noreferrer">
        ${ICONS.externalLinkSmall} View Page
      </a>` : ''}
      ${authUsername ? `<span style="font-size: 0.8125rem; color: var(--color-text-secondary); margin-right: 0.25rem;">${authUsername}</span>` : ''}
      ${avatarHtml}
      <a class="topbar-btn" href="/logout" style="font-size: 0.8125rem; padding: 0.25rem 0.75rem; min-height: 32px;">Logout</a>
    </div>
  </header>

  <!-- Sidebar (Desktop/Tablet) -->
  <nav class="studio-sidebar" aria-label="Studio navigation">
    <div class="sidebar-nav">
      ${navItem('dashboard', 'Dashboard', ICONS.dashboard, '/studio')}
      ${navItem('feed', 'Feed', ICONS.feed, '/studio/feed')}
      ${navItem('search', 'Search', ICONS.search, '/studio/search')}
      ${navItem('content', 'Content', ICONS.content, '/studio/content')}
      ${navItem('groups', 'Groups', ICONS.groups, '/studio/groups')}
      ${navItem('links', 'Links', ICONS.links, '/studio/links')}
      ${navItem('analytics', 'Analytics', ICONS.analytics, '/studio/analytics')}
      ${navItem('customize', 'Customize', ICONS.customize, '/studio/customize')}
      ${navItem('settings', 'Settings', ICONS.settings, '/studio/settings')}
      <div class="sidebar-divider"></div>
      <div class="sidebar-footer">
        ${handle ? `<a class="sidebar-item" href="/@${handle}" target="_blank" rel="noopener noreferrer">
          <span class="sidebar-icon">${ICONS.externalLink}</span>
          <span class="sidebar-label">View Page</span>
        </a>` : ''}
        <a class="sidebar-item" href="/logout">
          <span class="sidebar-icon">${ICONS.settings}</span>
          <span class="sidebar-label">Logout</span>
        </a>
      </div>
    </div>
  </nav>

  <!-- Bottom Tab Bar (Mobile) -->
  <nav class="studio-tabbar" aria-label="Studio navigation">
    ${tabItem('dashboard', ICONS.dashboard, '/studio', 'Dashboard')}
    ${tabItem('feed', ICONS.feed, '/studio/feed', 'Feed')}
    ${tabItem('content', ICONS.content, '/studio/content', 'Content')}
    ${tabItem('groups', ICONS.groups, '/studio/groups', 'Groups')}
    ${tabItem('links', ICONS.links, '/studio/links', 'Links')}
    ${tabItem('customize', ICONS.customize, '/studio/customize', 'Customize')}
    ${tabItem('settings', ICONS.settings, '/studio/settings', 'Settings')}
  </nav>

  <!-- Content Area -->
  <main class="studio-content">
    <div class="studio-content-inner">
      ${contentHtml}
    </div>
  </main>
</body>
</html>`;
}

// =============================================================================
// Page: Dashboard
// =============================================================================

function dashboardContent(profile, links, { successMessage, distributions } = {}) {
  const displayName = profile ? escapeHtml(profile.display_name || profile.username || 'User') : 'User';
  const handle = profile ? escapeHtml(profile.username || '') : '';
  const avatarUrl = profile ? profile.avatar_url : null;
  const initial = displayName.charAt(0).toUpperCase();
  const ourDomain = INSTANCE_DOMAIN;
  const linkCount = links ? links.length : 0;

  const avatarHtml = avatarUrl
    ? `<img class="profile-summary-avatar" src="${escapeHtml(avatarUrl)}" alt="${displayName}">`
    : `<div class="profile-summary-avatar">${initial}</div>`;

  const composeAvatarHtml = avatarUrl
    ? `<img class="compose-avatar" src="${escapeHtml(avatarUrl)}" alt="${displayName}">`
    : `<div class="compose-avatar">${initial}</div>`;

  // Protocol badges
  const protocols = [];
  protocols.push({ name: 'AP', active: true });
  if (profile && profile.nostr_npub) protocols.push({ name: 'Nostr', active: true });
  else protocols.push({ name: 'Nostr', active: true });
  protocols.push({ name: 'IndieWeb', active: true });
  protocols.push({ name: 'RSS', active: true });
  if (profile && profile.at_did) protocols.push({ name: 'AT', active: true });
  else protocols.push({ name: 'AT', active: true });

  const badgesHtml = protocols.map(p =>
    `<span class="protocol-badge badge-active">${ICONS.check} ${escapeHtml(p.name)}</span>`
  ).join('\n              ');

  // Success banner after post creation
  let successBannerHtml = '';
  if (successMessage) {
    let distBadgesHtml = '';
    if (distributions && distributions.length > 0) {
      distBadgesHtml = '<div class="dist-badges">' + distributions.map(d => {
        const cls = d.status === 'sent' ? 'dist-badge-sent'
          : d.status === 'pending' ? 'dist-badge-pending'
          : d.status === 'skipped' ? 'dist-badge-skipped'
          : 'dist-badge-failed';
        return `<span class="dist-badge ${cls}">${escapeHtml(d.protocol)} : ${escapeHtml(d.status)}</span>`;
      }).join('') + '</div>';
    }
    successBannerHtml = `
      <div class="success-banner">
        <span class="success-banner-icon">${ICONS.check}</span>
        <div class="success-banner-text">
          <div class="success-banner-title">${escapeHtml(successMessage)}</div>
          <div class="success-banner-detail">Your post has been published and distributed to active protocols.</div>
          ${distBadgesHtml}
        </div>
      </div>`;
  }

  return `
      ${successBannerHtml}

      <!-- Compose Box -->
      <div class="compose-box">
        <div class="compose-header">
          ${composeAvatarHtml}
          <span class="compose-prompt">What's on your mind?</span>
        </div>
        <form action="/studio/post" method="POST">
          <textarea class="compose-textarea" name="content" placeholder="Write something..." maxlength="500" required
            oninput="this.form.querySelector('.char-count').textContent = this.value.length + ' / 500'; var c = this.form.querySelector('.char-count'); c.className = 'char-count' + (this.value.length > 450 ? (this.value.length >= 500 ? ' over' : ' warn') : '');"></textarea>
          <div class="compose-footer">
            <div class="compose-meta">
              <span class="char-count">0 / 500</span>
              <a href="/studio/compose" style="font-size: 0.8125rem; color: var(--color-text-tertiary);">Full editor</a>
            </div>
            <div class="compose-actions">
              <button class="btn btn-primary" type="submit">${ICONS.compose} Post</button>
            </div>
          </div>
        </form>
      </div>

      <!-- Profile Summary Card -->
      <div class="profile-summary">
        ${avatarHtml}
        <div class="profile-summary-info">
          <div class="profile-summary-name">${displayName}</div>
          ${handle ? `<div class="profile-summary-handle">@${handle}@${ourDomain}</div>` : ''}
          <div class="profile-summary-badges">
            ${badgesHtml}
          </div>
        </div>
      </div>

      <!-- Page Header -->
      <div class="page-header">
        <h1 class="page-title">Dashboard</h1>
      </div>

      <!-- Quick Stats -->
      <div class="section">
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">Total Followers</div>
            <div class="stat-value">--</div>
            <div class="stat-delta stat-delta-neutral">across all protocols</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Total Links</div>
            <div class="stat-value">${linkCount}</div>
            <div class="stat-delta stat-delta-neutral">bio links</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Profile Views</div>
            <div class="stat-value">--</div>
            <div class="stat-delta stat-delta-neutral">coming soon</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Active Protocols</div>
            <div class="stat-value">${protocols.filter(p => p.active).length}</div>
            <div class="stat-delta stat-delta-positive">${ICONS.check} all healthy</div>
          </div>
        </div>
      </div>

      <!-- Protocol Health -->
      <div class="section">
        <h2 class="section-title">Protocol Health</h2>
        <div class="protocol-grid">
          <div class="protocol-card">
            <span class="protocol-status protocol-status-active"></span>
            <div>
              <div class="protocol-name">ActivityPub</div>
              <div class="protocol-label">Active</div>
            </div>
          </div>
          <div class="protocol-card">
            <span class="protocol-status protocol-status-active"></span>
            <div>
              <div class="protocol-name">Nostr</div>
              <div class="protocol-label">Active</div>
            </div>
          </div>
          <div class="protocol-card">
            <span class="protocol-status protocol-status-active"></span>
            <div>
              <div class="protocol-name">IndieWeb</div>
              <div class="protocol-label">Active</div>
            </div>
          </div>
          <div class="protocol-card">
            <span class="protocol-status protocol-status-active"></span>
            <div>
              <div class="protocol-name">RSS</div>
              <div class="protocol-label">Active</div>
            </div>
          </div>
          <div class="protocol-card">
            <span class="protocol-status protocol-status-active"></span>
            <div>
              <div class="protocol-name">AT Protocol</div>
              <div class="protocol-label">Active</div>
            </div>
          </div>
          <div class="protocol-card">
            <span class="protocol-status protocol-status-soon"></span>
            <div>
              <div class="protocol-name">Solid</div>
              <div class="protocol-label">Coming soon</div>
            </div>
          </div>
          <div class="protocol-card">
            <span class="protocol-status protocol-status-soon"></span>
            <div>
              <div class="protocol-name">Holochain</div>
              <div class="protocol-label">Coming soon</div>
            </div>
          </div>
          <div class="protocol-card">
            <span class="protocol-status protocol-status-soon"></span>
            <div>
              <div class="protocol-name">SSB</div>
              <div class="protocol-label">Coming soon</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Quick Actions -->
      <div class="section">
        <h2 class="section-title">Quick Actions</h2>
        <div class="quick-actions">
          <a class="btn btn-primary" href="/studio/compose">${ICONS.compose} Compose Post</a>
          <a class="btn btn-secondary" href="/studio/links">${ICONS.plus} Add Link</a>
          <a class="btn btn-secondary" href="/studio/customize">${ICONS.edit} Edit Profile</a>
          ${handle ? `<a class="btn btn-secondary" href="/@${handle}" target="_blank" rel="noopener noreferrer">${ICONS.externalLinkSmall} View Page</a>` : ''}
        </div>
      </div>`;
}

// =============================================================================
// Page: Links
// =============================================================================

function linksContent(profile, links) {
  const profileId = profile ? profile.id : '';
  const handle = profile ? escapeHtml(profile.username || '') : '';

  let linksListHtml = '';
  if (links && links.length > 0) {
    linksListHtml = links.map(link => `
          <div class="link-item">
            <span class="link-drag" title="Drag to reorder">${ICONS.grip}</span>
            <span class="link-icon">${ICONS.globe}</span>
            <div class="link-info">
              <div class="link-label">${escapeHtml(link.label)}</div>
              <div class="link-url">${escapeHtml(link.url)}</div>
            </div>
            <div class="link-actions">
              <button class="link-action-btn" title="Edit" aria-label="Edit link">${ICONS.edit}</button>
              <button class="link-action-btn danger" title="Delete" aria-label="Delete link">${ICONS.trash}</button>
            </div>
          </div>`).join('\n');
  } else {
    linksListHtml = `
          <div class="empty-state">
            <div class="empty-state-icon">${ICONS.links}</div>
            <div class="empty-state-title">No links yet</div>
            <div class="empty-state-desc">Add your first bio link and share it with the world.</div>
          </div>`;
  }

  return `
      <div class="page-header">
        <h1 class="page-title">Links</h1>
        <div class="page-actions">
          ${handle ? `<a class="btn btn-secondary" href="/@${handle}" target="_blank" rel="noopener noreferrer">${ICONS.externalLinkSmall} Preview</a>` : ''}
        </div>
      </div>

      <!-- Link List -->
      <div class="link-list">
        ${linksListHtml}
      </div>

      <!-- Add Link Form -->
      <div class="add-link-form">
        <div class="form-title">${ICONS.plus} Add New Link</div>
        <form action="/api/links" method="POST">
          <input type="hidden" name="profileId" value="${escapeHtml(profileId)}">
          <div class="form-grid form-grid-2col">
            <div class="form-field">
              <label class="form-label" for="link-label">Label</label>
              <input class="form-input" type="text" id="link-label" name="label" placeholder="e.g., GitHub" required>
            </div>
            <div class="form-field">
              <label class="form-label" for="link-url">URL</label>
              <input class="form-input" type="url" id="link-url" name="url" placeholder="https://github.com/..." required>
            </div>
            <div class="form-field">
              <label class="form-label" for="link-icon">Icon Key</label>
              <input class="form-input" type="text" id="link-icon" name="identifier" placeholder="e.g., github, twitter, globe">
            </div>
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" type="submit">${ICONS.plus} Add Link</button>
          </div>
        </form>
      </div>`;
}

// =============================================================================
// Page: Customize
// =============================================================================

function customizeContent(profile, links) {
  const displayName = profile ? escapeHtml(profile.display_name || profile.username || '') : '';
  const handle = profile ? escapeHtml(profile.username || '') : '';
  const bio = profile ? escapeHtml(profile.bio || '') : '';
  const avatarUrl = profile ? profile.avatar_url : null;
  const initial = displayName.charAt(0).toUpperCase();
  const profileId = profile ? profile.id : '';
  const ourDomain = INSTANCE_DOMAIN;

  const previewAvatar = avatarUrl
    ? `<img class="preview-avatar" src="${escapeHtml(avatarUrl)}" alt="${displayName}">`
    : `<div class="preview-avatar">${initial}</div>`;

  // Preview link pills
  const previewLinks = (links && links.length > 0)
    ? links.slice(0, 3).map(l => `<div class="preview-link-pill">${escapeHtml(l.label)}</div>`).join('\n            ')
    : '<div class="preview-link-pill">Your links appear here</div>';

  return `
      <div class="page-header">
        <h1 class="page-title">Customize</h1>
      </div>

      <!-- Profile Preview -->
      <div class="preview-frame">
        <div class="preview-label">Profile Preview</div>
        ${previewAvatar}
        <div class="preview-name">${displayName || 'Your Name'}</div>
        <div class="preview-handle">@${handle || 'handle'}@${ourDomain}</div>
        <div style="margin-top: 1rem;">
          ${previewLinks}
        </div>
      </div>

      <!-- Edit Fields -->
      <div class="section">
        <h2 class="section-title">Profile</h2>
        <div class="form-grid form-grid-2col">
          <div class="form-field">
            <label class="form-label" for="edit-name">Display Name</label>
            <input class="form-input" type="text" id="edit-name" name="displayName" value="${displayName}" placeholder="Your display name">
          </div>
          <div class="form-field">
            <label class="form-label" for="edit-handle">Handle</label>
            <input class="form-input" type="text" id="edit-handle" name="handle" value="${handle}" placeholder="your-handle">
          </div>
          <div class="form-field" style="grid-column: 1 / -1;">
            <label class="form-label" for="edit-bio">Bio</label>
            <textarea class="form-input form-textarea" id="edit-bio" name="bio" placeholder="Tell the world about yourself...">${bio}</textarea>
          </div>
        </div>
      </div>

      <!-- Avatar / Banner Upload -->
      <div class="section">
        <h2 class="section-title">Media</h2>
        <div class="form-grid form-grid-2col">
          <div class="form-field">
            <label class="form-label">Avatar</label>
            <a class="btn btn-secondary" href="#" aria-label="Upload avatar">${ICONS.upload} Change Avatar</a>
            <span style="font-size: 0.75rem; color: var(--color-text-tertiary); margin-top: 0.25rem;">
              Links to PUT /api/profile/${escapeHtml(profileId)}/avatar
            </span>
          </div>
          <div class="form-field">
            <label class="form-label">Banner</label>
            <a class="btn btn-secondary" href="#" aria-label="Upload banner">${ICONS.upload} Change Banner</a>
            <span style="font-size: 0.75rem; color: var(--color-text-tertiary); margin-top: 0.25rem;">
              Banner upload endpoint
            </span>
          </div>
        </div>
      </div>

      <div class="form-actions">
        <button class="btn btn-primary">Save Changes</button>
      </div>`;
}

// =============================================================================
// Page: Settings
// =============================================================================

// ---------------------------------------------------------------------------
// Protocol display metadata — icon abbreviations and brand colors
// ---------------------------------------------------------------------------
const PROTOCOL_ICON_MAP = {
  activitypub:  { abbr: 'AP', bg: 'var(--color-accent)' },
  nostr:        { abbr: 'N',  bg: 'var(--color-violet-500)' },
  rss:          { abbr: 'RS', bg: 'var(--color-orange-500)' },
  indieweb:     { abbr: 'IW', bg: 'var(--color-green-500)' },
  atprotocol:   { abbr: 'AT', bg: 'var(--color-blue-500)' },
  holochain:    { abbr: 'HC', bg: 'var(--color-cyan-400)' },
  ssb:          { abbr: 'SB', bg: 'var(--color-green-600)' },
  zot:          { abbr: 'ZT', bg: 'var(--color-amber-500)' },
  bonfire:      { abbr: 'BF', bg: 'var(--color-orange-400)' },
  hypercore:    { abbr: 'HY', bg: 'var(--color-violet-600)' },
  braid:        { abbr: 'BR', bg: 'var(--color-blue-400)' },
  willow:       { abbr: 'WL', bg: 'var(--color-green-500)' },
  matrix:       { abbr: 'MX', bg: 'var(--color-green-600)' },
  xmtp:         { abbr: 'XM', bg: 'var(--color-red-500)' },
  ocapn:        { abbr: 'OC', bg: 'var(--color-cyan-500)' },
  keyhive:      { abbr: 'KH', bg: 'var(--color-amber-400)' },
  vc:           { abbr: 'VC', bg: 'var(--color-blue-600)' },
};

/**
 * Render a single protocol card.
 * @param {Object} adapter  — adapter.toJSON() result
 * @param {string|null} identityText — user-facing identity string (or null)
 */
function protocolCardHtml(adapter, identityText) {
  const icon = PROTOCOL_ICON_MAP[adapter.name] || { abbr: adapter.name.slice(0, 2).toUpperCase(), bg: 'var(--color-text-tertiary)' };
  const statusLabel = adapter.status === 'stub' ? 'Coming Soon' : adapter.status;
  const statusClass = `status-${adapter.status}`;

  // Truncate description to first sentence for stub/unavailable
  let descSnippet = '';
  if (adapter.status !== 'active') {
    const first = (adapter.description || '').split('.')[0];
    descSnippet = first ? `<div class="protocol-card-desc">${escapeHtml(first)}.</div>` : '';
  }

  const identityHtml = identityText
    ? `<div class="protocol-card-identity">${escapeHtml(identityText)}</div>`
    : '';

  return `
        <div class="protocol-card">
          <div class="protocol-card-icon" style="background: ${icon.bg};">${icon.abbr}</div>
          <div class="protocol-card-body">
            <div class="protocol-card-name">
              ${escapeHtml(adapter.name)}
              <span class="protocol-card-status ${statusClass}">${escapeHtml(statusLabel)}</span>
            </div>
            ${identityHtml}
            ${descSnippet}
          </div>
        </div>`;
}

/**
 * Build the identity display string for a given protocol + profile.
 */
function identityForProtocol(adapterName, profile) {
  if (!profile) return null;
  const handle = profile.username || '';
  const domain = INSTANCE_DOMAIN;
  switch (adapterName) {
    case 'activitypub': return `@${handle}@${domain}`;
    case 'nostr':       return profile.nostr_npub || null;
    case 'atprotocol':  return profile.at_did || `did:web:${domain}:ap:actor:${handle}`;
    case 'rss':         return `${BASE_URL}/rss/${handle}`;
    case 'indieweb':    return `${BASE_URL}/@${handle}`;
    case 'matrix':      return `@${handle}:${domain}`;
    default:            return null;
  }
}

// SVG icons used only in settings sections
const SETTINGS_ICONS = {
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>',
};

function settingsContent(profile, backupStatus) {
  const handle = profile ? escapeHtml(profile.username || '') : '';
  const profileId = profile ? profile.id : '';
  const ourDomain = INSTANCE_DOMAIN;

  // ---- 1. Protocol Connections (from registry) ----
  const adapters = registry.listAdapters();
  const protocolCardsHtml = adapters.map(a => {
    const identity = identityForProtocol(a.name, profile);
    return protocolCardHtml(a, identity);
  }).join('');
  const counts = registry.getStatusCounts();

  // ---- 2. Recovery / Backup status (runtime probe: social_keys.recovery_backups) ----
  const bs = backupStatus && typeof backupStatus === 'object'
    ? backupStatus
    : { state: 'unknown', lastBackupDate: null };
  const backupState = bs.state === 'protected' || bs.state === 'unprotected' ? bs.state : 'unknown';
  const lastBackupDate = typeof bs.lastBackupDate === 'string' ? bs.lastBackupDate : null;
  const backupHint = backupState === 'protected'
    ? (lastBackupDate
      ? `Last backup: ${escapeHtml(lastBackupDate)}`
      : 'Passphrase backup on record')
    : backupState === 'unprotected'
      ? 'No passphrase backup on record'
      : 'Backup status could not be verified';
  const backupDotClass = backupState === 'protected'
    ? 'dot-active'
    : backupState === 'unknown'
      ? 'dot-partial'
      : 'dot-unavailable';
  const backupStatusLabel = backupState === 'protected'
    ? 'Protected'
    : backupState === 'unknown'
      ? 'Unknown'
      : 'Unprotected';

  // ---- 3. Notification preferences (placeholder defaults) ----
  const pushEnabled = false;
  const notifDefaults = {
    follows: true, mentions: true, replies: true, boosts: true, group_posts: true,
  };
  const protoNotifDefaults = {};
  adapters.filter(a => a.status === 'active' || a.status === 'partial').forEach(a => {
    protoNotifDefaults[a.name] = true;
  });

  return `
      <div class="page-header">
        <h1 class="page-title">Settings</h1>
      </div>

      <!-- ============================================================ -->
      <!-- 1. Protocol Connections                                      -->
      <!-- ============================================================ -->
      <div class="settings-section">
        <div class="settings-section-header">
          <div class="settings-section-icon">${SETTINGS_ICONS.globe}</div>
          <div class="settings-section-title">Protocol Connections</div>
        </div>
        <div class="settings-section-desc">
          ${counts.active + counts.partial} active protocol${counts.active + counts.partial !== 1 ? 's' : ''}, ${counts.stub} coming soon, ${counts.total} total registered.
          Your identity is provisioned on each active protocol automatically.
        </div>
        <div class="protocol-grid">
          ${protocolCardsHtml}
        </div>
      </div>

      <!-- ============================================================ -->
      <!-- 2. Security & Recovery                                       -->
      <!-- ============================================================ -->
      <div class="settings-section">
        <div class="settings-section-header">
          <div class="settings-section-icon">${SETTINGS_ICONS.shield}</div>
          <div class="settings-section-title">Security &amp; Recovery</div>
        </div>
        ${backupState === 'unprotected' ? `
        <div class="recovery-warning">
          <div class="recovery-warning-icon">${SETTINGS_ICONS.warning}</div>
          <div class="recovery-warning-text">
            <strong>Your keys are not backed up.</strong> If you lose access to this device, you may lose your identity permanently. Create a backup now.
          </div>
        </div>` : ''}
        ${backupState === 'unknown' ? `
        <div class="recovery-warning">
          <div class="recovery-warning-icon">${SETTINGS_ICONS.warning}</div>
          <div class="recovery-warning-text">
            <strong>Backup status unknown.</strong> The server could not confirm whether a passphrase backup exists (for example if recovery tables are not migrated yet). If you have not created a backup, use the actions below.
          </div>
        </div>` : ''}
        <div class="settings-row">
          <div class="settings-label-group">
            <span class="settings-label">Backup Status</span>
            <span class="settings-label-hint">${backupHint}</span>
          </div>
          <span class="settings-value">
            <span class="settings-status-dot ${backupDotClass}"></span>
            ${backupStatusLabel}
          </span>
        </div>
        <div class="settings-actions">
          <a href="/api/recovery/passphrase" class="btn btn-secondary btn-sm">Create Passphrase Backup</a>
          <a href="/api/recovery/social" class="btn btn-secondary btn-sm">Set Up Social Recovery</a>
          <a href="/api/identity/export" class="btn btn-secondary btn-sm">${SETTINGS_ICONS.download} Export Identity Package</a>
        </div>
      </div>

      <!-- ============================================================ -->
      <!-- 3. Notification Preferences                                  -->
      <!-- ============================================================ -->
      <div class="settings-section">
        <div class="settings-section-header">
          <div class="settings-section-icon">${SETTINGS_ICONS.bell}</div>
          <div class="settings-section-title">Notifications</div>
        </div>
        <div class="settings-section-desc">
          Control which events trigger notifications and which protocols forward them.
        </div>

        <div class="settings-row">
          <div class="settings-label-group">
            <span class="settings-label">Push Notifications</span>
            <span class="settings-label-hint">Receive browser push notifications for activity</span>
          </div>
          <span class="settings-value">
            ${pushEnabled
              ? '<span class="toggle-switch is-on" data-field="push"></span>'
              : '<a href="/api/notifications/subscribe" class="btn btn-secondary btn-sm">Enable Push</a>'}
          </span>
        </div>

        <div style="margin-top: var(--space-4);">
          <div style="font-size: var(--font-size-body-sm); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); margin-bottom: var(--space-2);">Event Types</div>
          ${Object.entries(notifDefaults).map(([key, on]) => `
          <div class="toggle-row">
            <span class="toggle-label">${escapeHtml(key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))}</span>
            <span class="toggle-switch${on ? ' is-on' : ''}" data-field="notif-${escapeHtml(key)}"></span>
          </div>`).join('')}
        </div>

        <div style="margin-top: var(--space-4);">
          <div style="font-size: var(--font-size-body-sm); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); margin-bottom: var(--space-2);">Per-Protocol</div>
          ${Object.entries(protoNotifDefaults).map(([name, on]) => {
            const icon = PROTOCOL_ICON_MAP[name] || { abbr: name.slice(0, 2).toUpperCase(), bg: 'var(--color-text-tertiary)' };
            return `
          <div class="toggle-row">
            <span class="toggle-label" style="display: flex; align-items: center; gap: var(--space-2);">
              <span style="display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: var(--radius-sm); background: ${icon.bg}; color: var(--color-white); font-size: 0.5625rem; font-weight: 700;">${icon.abbr}</span>
              ${escapeHtml(name)} notifications
            </span>
            <span class="toggle-switch${on ? ' is-on' : ''}" data-field="proto-notif-${escapeHtml(name)}"></span>
          </div>`;
          }).join('')}
        </div>
      </div>

      <!-- ============================================================ -->
      <!-- 4. Account                                                   -->
      <!-- ============================================================ -->
      <div class="settings-section">
        <div class="settings-section-header">
          <div class="settings-section-icon">${SETTINGS_ICONS.user}</div>
          <div class="settings-section-title">Account</div>
        </div>
        <div class="settings-row">
          <span class="settings-label">Handle</span>
          <span class="settings-value">@${handle}</span>
        </div>
        <div class="settings-row">
          <span class="settings-label">Profile URL</span>
          <span class="settings-value"><a href="${BASE_URL}/@${handle}" style="color: var(--color-primary);">${BASE_URL}/@${handle}</a></span>
        </div>
        <div class="settings-row">
          <span class="settings-label">Profile ID</span>
          <span class="settings-value" style="font-family: var(--font-family-mono); font-size: var(--font-size-caption);">${escapeHtml(profileId)}</span>
        </div>

        <div class="settings-row">
          <div class="settings-label-group">
            <span class="settings-label">Export Data</span>
            <span class="settings-label-hint">Download all profile data, posts, and media as JSON</span>
          </div>
          <span class="settings-value">
            <a href="/api/export/${handle}" class="btn btn-secondary btn-sm">${SETTINGS_ICONS.download} Export Profile Bundle</a>
          </span>
        </div>

        <div class="settings-row">
          <div class="settings-label-group">
            <span class="settings-label">Connected Instances</span>
            <span class="settings-label-hint">PeerMesh instances that have federated with your identity via SSO</span>
          </div>
        </div>
        <div class="instance-list" style="margin-top: var(--space-2);">
          <div class="instance-item">
            <span class="instance-item-dot"></span>
            <span>${escapeHtml(ourDomain)}</span>
            <span style="margin-left: auto; font-size: var(--font-size-caption); color: var(--color-text-tertiary);">This instance</span>
          </div>
        </div>
      </div>

      <!-- ============================================================ -->
      <!-- 5. Your Invites (F-031)                                      -->
      <!-- ============================================================ -->
      <div class="settings-section" id="invites-section">
        <div class="settings-section-header">
          <div class="settings-section-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
          </div>
          <div class="settings-section-title">Your Invites</div>
        </div>
        <div class="settings-section-desc">
          Share invite codes with friends to join PeerMesh. Registration mode: <strong>${escapeHtml(REGISTRATION_MODE)}</strong>.
        </div>
        <div id="invites-content" style="margin-top: var(--space-3);">
          <div style="font-size: var(--font-size-caption); color: var(--color-text-tertiary);">Loading invite codes...</div>
        </div>
        <div class="settings-actions">
          <a href="/api/invites" class="btn btn-secondary btn-sm" target="_blank" rel="noopener">View Invite Codes (API)</a>
        </div>
      </div>

      <!-- Script to load invite codes inline (progressive enhancement) -->
      <script>
        (function() {
          var container = document.getElementById('invites-content');
          fetch('/api/invites', { credentials: 'same-origin' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
              if (!data.codes || data.codes.length === 0) {
                container.innerHTML = '<div style="font-size: 0.875rem; color: var(--color-text-secondary);">No invite codes yet. Generate some below.</div>'
                  + '<div style="margin-top: 0.75rem;"><form method="POST" action="/api/invites/generate" style="display:inline;">'
                  + '<button type="submit" class="btn btn-secondary btn-sm" style="display:inline-flex;align-items:center;gap:0.25rem;padding:0.5rem 1rem;font-size:0.8125rem;border:1px solid var(--color-border);border-radius:9999px;background:transparent;color:var(--color-text-primary);cursor:pointer;">Generate Invite Codes</button>'
                  + '</form></div>';
                return;
              }
              var domain = location.origin;
              var rows = data.codes.map(function(c) {
                var statusColor = c.status === 'active' ? 'var(--color-success, #22c55e)' : c.status === 'revoked' ? 'var(--color-error)' : 'var(--color-text-tertiary)';
                var inviteUrl = domain + '/invite/' + c.code;
                return '<div style="display:flex;align-items:center;gap:0.75rem;padding:0.625rem 0;border-bottom:1px solid var(--color-border);">'
                  + '<span style="font-family:var(--font-family-mono);font-size:0.8125rem;font-weight:600;color:var(--color-text-primary);min-width:140px;">' + c.code + '</span>'
                  + '<span style="font-size:0.75rem;color:' + statusColor + ';text-transform:uppercase;font-weight:600;min-width:64px;">' + c.status + '</span>'
                  + '<button onclick="navigator.clipboard.writeText(\'' + inviteUrl + '\').then(function(){this.textContent=\'Copied!\';var b=this;setTimeout(function(){b.textContent=\'Copy Link\'},1500)}.bind(this))" style="font-size:0.75rem;padding:0.25rem 0.5rem;background:var(--color-bg-tertiary);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-primary);cursor:pointer;">Copy Link</button>'
                  + '</div>';
              }).join('');
              var poolHtml = data.pool ? '<div style="font-size:0.75rem;color:var(--color-text-tertiary);margin-bottom:0.5rem;">Pool: ' + (data.pool.remaining === null ? 'Unlimited' : data.pool.remaining + ' remaining of ' + data.pool.poolSize) + '</div>' : '';
              container.innerHTML = poolHtml + rows;
            })
            .catch(function() {
              container.innerHTML = '<div style="font-size:0.875rem;color:var(--color-text-tertiary);">Could not load invite codes.</div>';
            });
        })();
      </script>

      <!-- ============================================================ -->
      <!-- 6. Danger Zone                                               -->
      <!-- ============================================================ -->
      <div class="settings-section danger-zone">
        <div class="settings-section-header">
          <div class="settings-section-icon">${SETTINGS_ICONS.trash}</div>
          <div class="settings-section-title">Danger Zone</div>
        </div>
        <div class="settings-section-desc" style="color: var(--color-text-secondary);">
          Actions here are destructive and cannot be undone. Deleting your account will revoke your ActivityPub actor, Nostr keypair, AT Protocol DID, and all associated data across every federated protocol.
        </div>
        <div class="settings-row">
          <div class="settings-label-group">
            <span class="settings-label">Delete Account</span>
            <span class="settings-label-hint">Permanently remove your identity and all content from this instance and federated networks</span>
          </div>
          <span class="settings-value">
            <button class="btn btn-danger btn-sm" onclick="document.getElementById('delete-confirm').style.display='flex'">Delete Account</button>
          </span>
        </div>
      </div>

      <!-- Delete account confirmation dialog -->
      <div class="confirm-overlay" id="delete-confirm">
        <div class="confirm-dialog">
          <div class="confirm-title">Delete your account?</div>
          <div class="confirm-text">
            This will permanently delete your profile, all posts, media, and protocol identities. Your ActivityPub actor will be tombstoned, Nostr keypair revoked, and AT Protocol DID deactivated. This cannot be undone.
          </div>
          <div class="confirm-actions">
            <button class="btn btn-secondary btn-sm" onclick="document.getElementById('delete-confirm').style.display='none'">Cancel</button>
            <form method="POST" action="/api/account/delete" style="display: inline;">
              <button type="submit" class="btn btn-danger btn-sm">Yes, delete my account</button>
            </form>
          </div>
        </div>
      </div>`;
}

// =============================================================================
// Analytics Data Loader
// =============================================================================

/**
 * Load all analytics data for a profile. Runs queries in parallel for efficiency.
 * Returns { overview, protocolBreakdown, recentPosts, recentFollowers,
 *           recentWebmentions, postsPerDay, groupAnalytics }.
 */
async function loadAnalyticsData(profile) {
  if (!profile || !profile.webid) return null;

  const actorUri = `${BASE_URL}/ap/actor/${profile.username}`;
  const webid = profile.webid;

  // Run all queries in parallel
  const [
    followersResult,
    followingResult,
    postsResult,
    groupsResult,
    protocolFollowersResult,
    protocolDistResult,
    recentPostsResult,
    recentFollowersResult,
    recentWebmentionsResult,
    postsPerDayResult,
    groupAnalyticsResult,
  ] = await Promise.all([
    // Total followers (accepted only)
    pool.query(
      `SELECT COUNT(*) AS count FROM social_graph.followers
       WHERE actor_uri = $1 AND status = 'accepted'`,
      [actorUri]
    ),
    // Total following (accepted only)
    pool.query(
      `SELECT COUNT(*) AS count FROM social_graph.following
       WHERE actor_uri = $1 AND status = 'accepted'`,
      [actorUri]
    ),
    // Total posts
    pool.query(
      `SELECT COUNT(*) AS count FROM social_profiles.posts WHERE webid = $1`,
      [webid]
    ),
    // Total group memberships
    pool.query(
      `SELECT COUNT(*) AS count FROM social_profiles.group_memberships WHERE user_webid = $1`,
      [webid]
    ),
    // Followers per protocol (followers table currently tracks AP followers;
    // for future protocols, group by a protocol column or source heuristic)
    pool.query(
      `SELECT 'activitypub' AS protocol, COUNT(*) AS count
       FROM social_graph.followers
       WHERE actor_uri = $1 AND status = 'accepted'`,
      [actorUri]
    ),
    // Distribution stats per protocol
    pool.query(
      `SELECT pd.protocol,
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE pd.status = 'sent') AS delivered,
              COUNT(*) FILTER (WHERE pd.status = 'failed') AS failed
       FROM social_federation.post_distribution pd
       JOIN social_profiles.posts p ON p.id = pd.post_id
       WHERE p.webid = $1
       GROUP BY pd.protocol
       ORDER BY total DESC`,
      [webid]
    ),
    // Last 10 posts with distribution status
    pool.query(
      `SELECT p.id, p.content_text, p.created_at, p.group_id,
              COALESCE(
                json_agg(json_build_object(
                  'protocol', pd.protocol,
                  'status', pd.status
                )) FILTER (WHERE pd.protocol IS NOT NULL),
                '[]'::json
              ) AS distributions
       FROM social_profiles.posts p
       LEFT JOIN social_federation.post_distribution pd ON pd.post_id = p.id
       WHERE p.webid = $1
       GROUP BY p.id, p.content_text, p.created_at, p.group_id
       ORDER BY p.created_at DESC
       LIMIT 10`,
      [webid]
    ),
    // Last 10 followers gained
    pool.query(
      `SELECT follower_uri, created_at
       FROM social_graph.followers
       WHERE actor_uri = $1 AND status = 'accepted'
       ORDER BY created_at DESC
       LIMIT 10`,
      [actorUri]
    ),
    // Last 10 webmentions received
    pool.query(
      `SELECT source_url, target_url, author_name, content_snippet, status, created_at
       FROM social_federation.webmentions
       WHERE target_handle = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [profile.username]
    ),
    // Posts per day for last 7 days
    pool.query(
      `SELECT d::date AS day, COALESCE(c.count, 0) AS count
       FROM generate_series(
         CURRENT_DATE - INTERVAL '6 days',
         CURRENT_DATE,
         '1 day'
       ) d
       LEFT JOIN (
         SELECT DATE(created_at) AS day, COUNT(*) AS count
         FROM social_profiles.posts
         WHERE webid = $1
           AND created_at >= CURRENT_DATE - INTERVAL '6 days'
         GROUP BY DATE(created_at)
       ) c ON c.day = d::date
       ORDER BY d ASC`,
      [webid]
    ),
    // Group analytics: groups owned/moderated + member counts + post counts
    pool.query(
      `SELECT g.id, g.name, g.type, gm.role,
              (SELECT COUNT(*) FROM social_profiles.group_memberships m2 WHERE m2.group_id = g.id) AS member_count,
              (SELECT COUNT(*) FROM social_profiles.posts p2 WHERE p2.group_id = g.id) AS post_count
       FROM social_profiles.group_memberships gm
       JOIN social_profiles.groups g ON g.id = gm.group_id
       WHERE gm.user_webid = $1
       ORDER BY gm.role ASC, g.name ASC
       LIMIT 20`,
      [webid]
    ),
  ]);

  return {
    overview: {
      followers: parseInt(followersResult.rows[0]?.count || '0', 10),
      following: parseInt(followingResult.rows[0]?.count || '0', 10),
      posts: parseInt(postsResult.rows[0]?.count || '0', 10),
      groups: parseInt(groupsResult.rows[0]?.count || '0', 10),
    },
    protocolBreakdown: {
      followers: protocolFollowersResult.rows,
      distribution: protocolDistResult.rows,
    },
    recentPosts: recentPostsResult.rows,
    recentFollowers: recentFollowersResult.rows,
    recentWebmentions: recentWebmentionsResult.rows,
    postsPerDay: postsPerDayResult.rows,
    groupAnalytics: groupAnalyticsResult.rows,
  };
}

// =============================================================================
// Page: Analytics (Real Data)
// =============================================================================

function analyticsContent(profile, data) {
  if (!data) {
    return `
      <div class="page-header">
        <h1 class="page-title">Analytics</h1>
      </div>
      <div class="placeholder-card">
        <div class="placeholder-icon">${ICONS.analytics}</div>
        <div class="placeholder-title">No analytics data</div>
        <div class="placeholder-desc">Analytics will appear once you have a profile set up.</div>
      </div>`;
  }

  const { overview, protocolBreakdown, recentPosts, recentFollowers,
          recentWebmentions, postsPerDay, groupAnalytics } = data;

  // --- Section 1: Overview Cards ---
  const overviewHtml = `
      <div class="analytics-overview">
        <div class="analytics-stat-card">
          <div class="analytics-stat-label">Followers</div>
          <div class="analytics-stat-value">${overview.followers}</div>
          <div class="analytics-stat-sub">Accepted follows</div>
        </div>
        <div class="analytics-stat-card">
          <div class="analytics-stat-label">Following</div>
          <div class="analytics-stat-value">${overview.following}</div>
          <div class="analytics-stat-sub">Outbound follows</div>
        </div>
        <div class="analytics-stat-card">
          <div class="analytics-stat-label">Posts</div>
          <div class="analytics-stat-value">${overview.posts}</div>
          <div class="analytics-stat-sub">Total published</div>
        </div>
        <div class="analytics-stat-card">
          <div class="analytics-stat-label">Groups</div>
          <div class="analytics-stat-value">${overview.groups}</div>
          <div class="analytics-stat-sub">Memberships</div>
        </div>
        <div class="analytics-stat-card">
          <div class="analytics-stat-label">Profile Views</div>
          <div class="analytics-stat-value">&mdash;</div>
          <div class="analytics-stat-sub">Tracking coming soon</div>
        </div>
      </div>`;

  // --- Section 2: Protocol Breakdown ---
  // Merge followers + distribution into protocol rows
  const protocolMap = {};
  for (const row of protocolBreakdown.followers) {
    const p = row.protocol;
    if (!protocolMap[p]) protocolMap[p] = { followers: 0, total: 0, delivered: 0, failed: 0 };
    protocolMap[p].followers = parseInt(row.count, 10);
  }
  for (const row of protocolBreakdown.distribution) {
    const p = row.protocol;
    if (!protocolMap[p]) protocolMap[p] = { followers: 0, total: 0, delivered: 0, failed: 0 };
    protocolMap[p].total = parseInt(row.total, 10);
    protocolMap[p].delivered = parseInt(row.delivered, 10);
    protocolMap[p].failed = parseInt(row.failed, 10);
  }

  const protocolKeys = Object.keys(protocolMap);
  let protocolHtml = '';
  if (protocolKeys.length > 0) {
    const rows = protocolKeys.map(key => {
      const info = PROTOCOL_DISPLAY[key] || { label: key, color: 'var(--color-text-secondary)' };
      const d = protocolMap[key];
      const rate = d.total > 0 ? Math.round((d.delivered / d.total) * 100) : 0;
      return `
            <tr>
              <td><span class="protocol-dot" style="background:${info.color}"></span>${escapeHtml(info.label)}</td>
              <td>${d.followers}</td>
              <td>${d.total}</td>
              <td>
                <span class="rate-bar-bg"><span class="rate-bar" style="width:${rate}%"></span></span>
                ${rate}%
              </td>
            </tr>`;
    }).join('');

    protocolHtml = `
      <div class="section">
        <h2 class="section-title">Protocol Breakdown</h2>
        <div class="analytics-feed">
          <table class="analytics-table">
            <thead><tr><th>Protocol</th><th>Followers</th><th>Posts Distributed</th><th>Success Rate</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  } else {
    protocolHtml = `
      <div class="section">
        <h2 class="section-title">Protocol Breakdown</h2>
        <div class="analytics-feed">
          <div class="analytics-feed-empty">No protocol activity yet. Compose a post to start distributing.</div>
        </div>
      </div>`;
  }

  // --- Section 3: Posts Per Day Chart (CSS-only bar chart, last 7 days) ---
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const maxPosts = Math.max(1, ...postsPerDay.map(r => parseInt(r.count, 10)));

  const chartBars = postsPerDay.map(row => {
    const count = parseInt(row.count, 10);
    const pct = Math.round((count / maxPosts) * 100);
    const d = new Date(row.day);
    const label = dayNames[d.getUTCDay()];
    return `
          <div class="analytics-chart-col">
            <div class="analytics-chart-count">${count}</div>
            <div class="analytics-chart-bar" style="height:${Math.max(4, pct)}%"></div>
            <div class="analytics-chart-label">${label}</div>
          </div>`;
  }).join('');

  const chartHtml = `
      <div class="section">
        <h2 class="section-title">Posts &mdash; Last 7 Days</h2>
        <div class="analytics-feed" style="padding: 0 1rem;">
          <div class="analytics-chart">
            ${chartBars}
          </div>
        </div>
      </div>`;

  // --- Section 4: Recent Activity (two columns) ---
  // Recent Posts
  let recentPostsHtml = '';
  if (recentPosts.length > 0) {
    recentPostsHtml = recentPosts.map(post => {
      const snippet = escapeHtml((post.content_text || '').slice(0, 80)) + (post.content_text.length > 80 ? '...' : '');
      const timeStr = new Date(post.created_at).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      });
      const dists = (Array.isArray(post.distributions) ? post.distributions : [])
        .map(d => {
          const color = d.status === 'sent' ? 'var(--color-success)' : d.status === 'failed' ? 'var(--color-error)' : 'var(--color-text-tertiary)';
          return `<span class="analytics-feed-badge" style="color:${color}">${escapeHtml(d.protocol)}</span>`;
        }).join(' ');
      return `
            <div class="analytics-feed-item">
              <div class="analytics-feed-icon" style="background:var(--color-primary-light);color:var(--color-primary);">${ICONS.content}</div>
              <div class="analytics-feed-body">
                <div class="analytics-feed-text">${snippet}</div>
                <div class="analytics-feed-meta">${timeStr} ${dists}</div>
              </div>
            </div>`;
    }).join('');
  } else {
    recentPostsHtml = '<div class="analytics-feed-empty">No posts yet</div>';
  }

  // Recent Followers
  let recentFollowersHtml = '';
  if (recentFollowers.length > 0) {
    recentFollowersHtml = recentFollowers.map(f => {
      const uri = escapeHtml(f.follower_uri);
      // Extract display name from URI (last segment)
      const parts = f.follower_uri.split('/');
      const name = parts[parts.length - 1] || uri;
      const timeStr = new Date(f.created_at).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      });
      return `
            <div class="analytics-feed-item">
              <div class="analytics-feed-icon" style="background:var(--color-success-light);color:var(--color-success);">${ICONS.groups}</div>
              <div class="analytics-feed-body">
                <div class="analytics-feed-text">${escapeHtml(name)}</div>
                <div class="analytics-feed-meta">${timeStr} <span class="analytics-feed-badge">ActivityPub</span></div>
              </div>
            </div>`;
    }).join('');
  } else {
    recentFollowersHtml = '<div class="analytics-feed-empty">No followers yet</div>';
  }

  const recentActivityHtml = `
      <div class="section">
        <h2 class="section-title">Recent Activity</h2>
        <div class="analytics-two-col">
          <div>
            <h3 style="font-size:var(--font-size-body-sm);font-weight:var(--font-weight-semibold);color:var(--color-text-secondary);margin-bottom:var(--space-3);">Recent Posts</h3>
            <div class="analytics-feed">${recentPostsHtml}</div>
          </div>
          <div>
            <h3 style="font-size:var(--font-size-body-sm);font-weight:var(--font-weight-semibold);color:var(--color-text-secondary);margin-bottom:var(--space-3);">Recent Followers</h3>
            <div class="analytics-feed">${recentFollowersHtml}</div>
          </div>
        </div>
      </div>`;

  // --- Section 5: Recent Webmentions ---
  let webmentionsHtml = '';
  if (recentWebmentions.length > 0) {
    const wmRows = recentWebmentions.map(wm => {
      const source = escapeHtml(wm.source_url);
      const author = wm.author_name ? escapeHtml(wm.author_name) : source;
      const snippet = wm.content_snippet ? escapeHtml(wm.content_snippet.slice(0, 100)) : '';
      const timeStr = new Date(wm.created_at).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      });
      const statusColor = wm.status === 'verified' ? 'var(--color-success)' : 'var(--color-text-tertiary)';
      return `
            <div class="analytics-feed-item">
              <div class="analytics-feed-icon" style="background:var(--color-secondary-light);color:var(--color-secondary);">${ICONS.globe}</div>
              <div class="analytics-feed-body">
                <div class="analytics-feed-text">${author}${snippet ? ': ' + snippet : ''}</div>
                <div class="analytics-feed-meta">${timeStr} <span class="analytics-feed-badge" style="color:${statusColor}">${escapeHtml(wm.status)}</span></div>
              </div>
            </div>`;
    }).join('');

    webmentionsHtml = `
      <div class="section">
        <h2 class="section-title">Recent Webmentions</h2>
        <div class="analytics-feed">${wmRows}</div>
      </div>`;
  }

  // --- Section 6: Group Analytics ---
  let groupsHtml = '';
  if (groupAnalytics.length > 0) {
    const groupCards = groupAnalytics.map(g => {
      const roleBadge = (g.role === 'owner' || g.role === 'admin' || g.role === 'moderator')
        ? `<span class="analytics-feed-badge" style="color:var(--color-primary);">${escapeHtml(g.role)}</span>`
        : '';
      return `
          <div class="analytics-group-card">
            <div class="analytics-group-name">${escapeHtml(g.name)} ${roleBadge}</div>
            <div class="analytics-group-meta">
              <span>${ICONS.groups} ${g.member_count} members</span>
              <span>${ICONS.content} ${g.post_count} posts</span>
              <span style="text-transform:capitalize;">${escapeHtml(g.type)}</span>
            </div>
          </div>`;
    }).join('');

    groupsHtml = `
      <div class="section">
        <h2 class="section-title">Group Analytics</h2>
        <div class="analytics-group-grid">${groupCards}</div>
      </div>`;
  }

  return `
      <div class="page-header">
        <h1 class="page-title">Analytics</h1>
      </div>

      ${overviewHtml}
      ${protocolHtml}
      ${chartHtml}
      ${recentActivityHtml}
      ${webmentionsHtml}
      ${groupsHtml}`;
}

// =============================================================================
// Page: Feed (Timeline)
// =============================================================================

async function loadTimelineItems(webid) {
  try {
    const result = await pool.query(
      `SELECT id, source_protocol, source_actor_uri, source_post_id,
              content_text, content_html, media_urls,
              author_name, author_handle, author_avatar_url,
              in_reply_to, received_at, published_at
       FROM social_profiles.timeline
       WHERE owner_webid = $1
       ORDER BY received_at DESC
       LIMIT 50`,
      [webid]
    );
    return result.rows;
  } catch (err) {
    console.error('[studio/feed] Error loading timeline:', err.message);
    return [];
  }
}

function feedContent(profile, items) {
  const handle = profile ? escapeHtml(profile.username || '') : '';

  if (!items || items.length === 0) {
    return `
      <div class="page-header">
        <h1 class="page-title">Feed</h1>
      </div>

      <div class="placeholder-card">
        <div class="placeholder-icon">${ICONS.feed}</div>
        <div class="placeholder-title">Your feed is empty</div>
        <div class="placeholder-desc">When accounts you follow on ActivityPub, Nostr, or other protocols post content, it will appear here in a unified timeline.</div>
      </div>

      <div class="section" style="margin-top: 1.5rem;">
        <h2 class="section-title">How it works</h2>
        <div class="card" style="padding: 1.5rem;">
          <div style="display: flex; flex-direction: column; gap: 1rem; font-size: 0.875rem; color: var(--color-text-secondary);">
            <div style="display: flex; gap: 0.75rem; align-items: flex-start;">
              <span style="color: var(--color-primary); font-weight: 600; flex-shrink: 0;">1.</span>
              <span>Remote users follow your ActivityPub actor <strong style="color: var(--color-text-primary);">@${handle}</strong></span>
            </div>
            <div style="display: flex; gap: 0.75rem; align-items: flex-start;">
              <span style="color: var(--color-primary); font-weight: 600; flex-shrink: 0;">2.</span>
              <span>When they post, their server sends the content to your inbox</span>
            </div>
            <div style="display: flex; gap: 0.75rem; align-items: flex-start;">
              <span style="color: var(--color-primary); font-weight: 600; flex-shrink: 0;">3.</span>
              <span>Posts from all protocols appear here in one merged timeline</span>
            </div>
          </div>
        </div>
      </div>

      <div class="section" style="margin-top: 1.5rem;">
        <h2 class="section-title">Timeline API</h2>
        <div class="card" style="padding: 1.5rem;">
          <div style="font-family: var(--font-family-mono); font-size: 0.8125rem; color: var(--color-text-secondary); display: flex; flex-direction: column; gap: 0.5rem;">
            <div>GET <a href="/api/timeline/${handle}" style="color: var(--color-primary);">/api/timeline/${handle}</a></div>
            <div>GET <a href="/api/timeline/${handle}/protocol/activitypub" style="color: var(--color-primary);">/api/timeline/${handle}/protocol/activitypub</a></div>
          </div>
        </div>
      </div>`;
  }

  // Render timeline items
  const itemsHtml = items.map(item => {
    const proto = PROTOCOL_DISPLAY[item.source_protocol] || { label: item.source_protocol, color: 'var(--color-text-tertiary)' };
    const authorName = escapeHtml(item.author_name || 'Unknown');
    const authorHandle = escapeHtml(item.author_handle || item.source_actor_uri || '');
    const avatarInitial = authorName.charAt(0).toUpperCase();
    const receivedAt = item.received_at ? new Date(item.received_at).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    }) : '';
    const publishedAt = item.published_at ? new Date(item.published_at).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    }) : '';

    // Content: prefer HTML, fall back to text
    let contentDisplay = '';
    if (item.content_html) {
      // We trust the stored HTML since it came from a verified AP source
      contentDisplay = `<div class="feed-item-content">${item.content_html}</div>`;
    } else if (item.content_text) {
      contentDisplay = `<div class="feed-item-content">${escapeHtml(item.content_text)}</div>`;
    }

    // Media attachments
    let mediaHtml = '';
    if (item.media_urls && item.media_urls.length > 0) {
      const images = item.media_urls.map(url =>
        `<img src="${escapeHtml(url)}" alt="Attached media" style="max-width: 100%; border-radius: var(--radius-md); margin-top: 0.75rem; max-height: 300px; object-fit: cover;">`
      ).join('');
      mediaHtml = `<div class="feed-item-media">${images}</div>`;
    }

    const avatarHtml = item.author_avatar_url
      ? `<img src="${escapeHtml(item.author_avatar_url)}" alt="${authorName}" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover; border: 2px solid var(--color-border-strong);">`
      : `<div style="width: 40px; height: 40px; border-radius: 50%; background: var(--color-primary); color: var(--color-text-inverse); display: flex; align-items: center; justify-content: center; font-size: 0.875rem; font-weight: 600; border: 2px solid var(--color-border-strong); flex-shrink: 0;">${avatarInitial}</div>`;

    return `
          <div class="card" style="padding: 1.25rem; margin-bottom: 0.75rem;">
            <div style="display: flex; gap: 0.75rem;">
              <div style="flex-shrink: 0;">${avatarHtml}</div>
              <div style="flex: 1; min-width: 0;">
                <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                  <span style="font-weight: 600; font-size: 0.875rem; color: var(--color-text-primary);">${authorName}</span>
                  <span style="font-size: 0.75rem; color: var(--color-text-tertiary);">@${authorHandle}</span>
                  <span style="display: inline-flex; align-items: center; padding: 0.125rem 0.5rem; border-radius: var(--radius-pill); font-size: 0.6875rem; font-weight: 500; background: ${proto.color}22; color: ${proto.color}; border: 1px solid ${proto.color}44;">${proto.label}</span>
                </div>
                <div style="font-size: 0.75rem; color: var(--color-text-tertiary); margin-top: 0.125rem;">
                  ${publishedAt || receivedAt}
                </div>
                ${contentDisplay}
                ${mediaHtml}
                ${item.in_reply_to ? `<div style="font-size: 0.75rem; color: var(--color-text-tertiary); margin-top: 0.5rem;">In reply to: ${escapeHtml(item.in_reply_to)}</div>` : ''}
              </div>
            </div>
          </div>`;
  }).join('');

  return `
      <div class="page-header">
        <h1 class="page-title">Feed</h1>
        <div class="page-actions">
          <span style="font-size: 0.875rem; color: var(--color-text-secondary);">${items.length} items</span>
        </div>
      </div>

      <style>
        .feed-item-content { font-size: 0.9375rem; color: var(--color-text-primary); margin-top: 0.5rem; line-height: 1.6; word-break: break-word; }
        .feed-item-content a { color: var(--color-primary); }
        .feed-item-content p { margin-bottom: 0.5rem; }
      </style>

      ${itemsHtml}

      <div class="section" style="margin-top: 1rem;">
        <div class="card" style="padding: 1rem; text-align: center;">
          <span style="font-size: 0.875rem; color: var(--color-text-tertiary);">
            Timeline API: <a href="/api/timeline/${handle}" style="font-family: var(--font-family-mono); font-size: 0.8125rem;">/api/timeline/${handle}</a>
          </span>
        </div>
      </div>`;
}

// =============================================================================
// Protocol Checkbox Builder (registry-driven)
// =============================================================================

/**
 * Protocol icons — small SVG icons for each known protocol.
 * Used in compose checkboxes and distribution badges.
 */
const PROTOCOL_ICONS = {
  activitypub: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/><line x1="12" y1="8" x2="5" y2="16"/><line x1="12" y1="8" x2="19" y2="16"/></svg>',
  nostr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
  rss: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M4 11a9 9 0 019 9"/><path d="M4 4a16 16 0 0116 16"/><circle cx="5" cy="19" r="1"/></svg>',
  indieweb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>',
  atproto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
  holochain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="3" r="1.5"/><circle cx="21" cy="12" r="1.5"/><circle cx="12" cy="21" r="1.5"/><circle cx="3" cy="12" r="1.5"/></svg>',
  ssb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/></svg>',
  zot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  bonfire: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 22c-4-3-8-7-8-12a8 8 0 0116 0c0 5-4 9-8 12z"/></svg>',
  hypercore: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polygon points="12 2 22 22 2 22"/></svg>',
  braid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M4 4c4 4 4 12 8 16"/><path d="M12 4c0 4-4 12-4 16"/><path d="M20 4c-4 4-4 12-8 16"/></svg>',
  willow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 2v20"/><path d="M4 8c4 0 6 4 8 4s4-4 8-4"/><path d="M4 14c4 0 6 4 8 4s4-4 8-4"/></svg>',
  matrix: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6v6H9z"/></svg>',
  xmtp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>',
  ocapn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>',
  keyhive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>',
  vc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
};

/**
 * Build protocol checkboxes from the protocol registry.
 * Active/partial adapters get enabled, checked checkboxes.
 * Stub/unavailable adapters get disabled checkboxes with "coming soon" tag.
 * @returns {string} HTML string of checkbox labels
 */
function buildProtocolCheckboxes() {
  const allAdapters = registry.listAdapters();
  // Known distributable protocols — the ones the studio post handler can distribute to
  const distributableNames = ['activitypub', 'nostr', 'rss', 'indieweb', 'atproto'];

  let html = '';

  for (const adapter of allAdapters) {
    const isDistributable = distributableNames.includes(adapter.name);
    const isActive = adapter.status === 'active' || adapter.status === 'partial';
    const icon = PROTOCOL_ICONS[adapter.name] || '';
    const displayLabel = PROTOCOL_DISPLAY[adapter.name]?.label || adapter.name;

    if (isDistributable && isActive) {
      // Active distributable protocol — enabled checkbox, checked by default
      html += `
              <label class="protocol-check">
                <input type="checkbox" name="protocols" value="${escapeHtml(adapter.name)}" checked>
                ${icon ? `<span class="protocol-icon">${icon}</span>` : ''}
                <span>${escapeHtml(displayLabel)}</span>
              </label>`;
    } else if (isDistributable && !isActive) {
      // Stub/unavailable distributable protocol — disabled with "coming soon"
      html += `
              <label class="protocol-check protocol-disabled" title="${escapeHtml(adapter.description || adapter.name + ' — coming soon')}">
                <input type="checkbox" name="protocols" value="${escapeHtml(adapter.name)}" disabled>
                ${icon ? `<span class="protocol-icon">${icon}</span>` : ''}
                <span>${escapeHtml(displayLabel)}</span>
                <span class="protocol-soon-tag">soon</span>
              </label>`;
    } else if (!isDistributable && isActive) {
      // Active non-distributable protocol (e.g., Matrix, XMTP) — show as coming-soon for post distribution
      html += `
              <label class="protocol-check protocol-disabled" title="${escapeHtml(displayLabel)} — post distribution coming soon">
                <input type="checkbox" name="protocols" value="${escapeHtml(adapter.name)}" disabled>
                ${icon ? `<span class="protocol-icon">${icon}</span>` : ''}
                <span>${escapeHtml(displayLabel)}</span>
                <span class="protocol-soon-tag">soon</span>
              </label>`;
    }
    // Skip stub + non-distributable — too noisy to show all stubs
  }

  return html;
}

// =============================================================================
// Page: Compose (Full Page)
// =============================================================================

function composeContent(profile, { successMessage, distributions } = {}) {
  const displayName = profile ? escapeHtml(profile.display_name || profile.username || 'User') : 'User';
  const handle = profile ? escapeHtml(profile.username || '') : '';
  const avatarUrl = profile ? profile.avatar_url : null;
  const initial = displayName.charAt(0).toUpperCase();
  const ourDomain = INSTANCE_DOMAIN;

  const composeAvatarHtml = avatarUrl
    ? `<img class="compose-avatar" src="${escapeHtml(avatarUrl)}" alt="${displayName}">`
    : `<div class="compose-avatar">${initial}</div>`;

  // Success banner
  let successBannerHtml = '';
  if (successMessage) {
    let distBadgesHtml = '';
    if (distributions && distributions.length > 0) {
      distBadgesHtml = '<div class="dist-badges">' + distributions.map(d => {
        const cls = d.status === 'sent' ? 'dist-badge-sent'
          : d.status === 'pending' ? 'dist-badge-pending'
          : d.status === 'skipped' ? 'dist-badge-skipped'
          : 'dist-badge-failed';
        return `<span class="dist-badge ${cls}">${escapeHtml(d.protocol)} : ${escapeHtml(d.status)}</span>`;
      }).join('') + '</div>';
    }
    successBannerHtml = `
      <div class="success-banner">
        <span class="success-banner-icon">${ICONS.check}</span>
        <div class="success-banner-text">
          <div class="success-banner-title">${escapeHtml(successMessage)}</div>
          <div class="success-banner-detail">Your post has been published and distributed to active protocols.</div>
          ${distBadgesHtml}
        </div>
      </div>`;
  }

  return `
      <div class="page-header">
        <h1 class="page-title">Compose Post</h1>
        <div class="page-actions">
          <a class="btn btn-secondary" href="/studio/content">${ICONS.content} View Content</a>
        </div>
      </div>

      ${successBannerHtml}

      <!-- Full Compose Form -->
      <div class="compose-box" style="margin-bottom: 0;">
        <div class="compose-header">
          ${composeAvatarHtml}
          <div>
            <div style="font-size: 0.875rem; font-weight: 500; color: var(--color-text-primary);">${displayName}</div>
            <div style="font-size: 0.75rem; color: var(--color-text-tertiary);">@${handle}@${ourDomain}</div>
          </div>
        </div>
        <form action="/studio/post" method="POST">
          <input type="hidden" name="redirect" value="compose">
          <textarea class="compose-textarea" name="content" placeholder="What's on your mind? Write your post here..." maxlength="500" required style="min-height: 160px;"
            oninput="this.form.querySelector('.char-count').textContent = this.value.length + ' / 500'; var c = this.form.querySelector('.char-count'); c.className = 'char-count' + (this.value.length > 450 ? (this.value.length >= 500 ? ' over' : ' warn') : ''); this.form.querySelector('.post-preview-content').textContent = this.value || 'Your post will appear here...';"></textarea>

          <!-- Protocol Distribution Checkboxes (registry-driven) -->
          <div style="margin-top: 1rem;">
            <div style="font-size: 0.8125rem; font-weight: 500; color: var(--color-text-secondary); margin-bottom: 0.5rem;">Distribute to:</div>
            <div class="protocol-checks">
              ${buildProtocolCheckboxes()}
            </div>
          </div>

          <div class="compose-footer" style="margin-top: 1rem;">
            <div class="compose-meta">
              <span class="char-count">0 / 500</span>
              <button type="button" class="compose-icon-btn" title="Attach media (coming soon)" disabled style="opacity: 0.5;">
                ${ICONS.image}
              </button>
            </div>
            <div class="compose-actions">
              <a class="btn btn-ghost" href="/studio">Cancel</a>
              <button class="btn btn-primary" type="submit">${ICONS.compose} Post</button>
            </div>
          </div>
        </form>
      </div>

      <!-- Post Preview -->
      <div class="post-preview">
        <div class="post-preview-label">Preview</div>
        <div class="post-preview-card">
          <div style="display: flex; gap: 0.75rem;">
            ${composeAvatarHtml}
            <div style="flex: 1;">
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <span style="font-weight: 600; font-size: 0.875rem; color: var(--color-text-primary);">${displayName}</span>
                <span style="font-size: 0.75rem; color: var(--color-text-tertiary);">@${handle} &middot; just now</span>
              </div>
              <div class="post-preview-content" style="margin-top: 0.375rem;">Your post will appear here...</div>
            </div>
          </div>
        </div>
      </div>`;
}

// =============================================================================
// Page: Content (Post Management)
// =============================================================================

async function loadUserPosts(webid, limit = 20, before = null) {
  let query = `SELECT id, content_text, content_html, media_urls, visibility, created_at, updated_at
               FROM social_profiles.posts
               WHERE webid = $1`;
  const params = [webid];

  if (before) {
    query += ` AND created_at < $2`;
    params.push(before);
  }

  query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
  params.push(limit + 1); // Fetch one extra to know if there are more
  try {
    const result = await pool.query(query, params);
    return result.rows;
  } catch (err) {
    console.error('[studio/content] Error loading posts:', err.message);
    return [];
  }
}

async function loadPostDistributions(postIds) {
  if (!postIds || postIds.length === 0) return {};
  try {
    const result = await pool.query(
      `SELECT post_id, protocol, status
       FROM social_federation.post_distribution
       WHERE post_id = ANY($1)
       ORDER BY protocol`,
      [postIds]
    );
    const map = {};
    for (const row of result.rows) {
      if (!map[row.post_id]) map[row.post_id] = [];
      map[row.post_id].push({ protocol: row.protocol, status: row.status });
    }
    return map;
  } catch (err) {
    console.error('[studio/content] Error loading distributions:', err.message);
    return {};
  }
}

function contentPageContent(profile, posts, distributions, { before, hasMore, deletedMessage } = {}) {
  const handle = profile ? escapeHtml(profile.username || '') : '';
  const PAGE_SIZE = 20;

  let bannerHtml = '';
  if (deletedMessage) {
    bannerHtml = `
      <div class="success-banner">
        <span class="success-banner-icon">${ICONS.check}</span>
        <div class="success-banner-text">
          <div class="success-banner-title">${escapeHtml(deletedMessage)}</div>
        </div>
      </div>`;
  }

  let postsHtml = '';
  if (posts && posts.length > 0) {
    postsHtml = posts.map(post => {
      const content = post.content_html || escapeHtml(post.content_text);
      const createdAt = new Date(post.created_at);
      const timeStr = createdAt.toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit',
      });

      // Distribution badges — color-coded: green (delivered/sent), amber (pending), red (failed), dashed (skipped)
      const dists = distributions[post.id] || [];
      const distBadgesHtml = dists.map(d => {
        const cls = d.status === 'sent' ? 'dist-badge-sent'
          : d.status === 'pending' ? 'dist-badge-pending'
          : d.status === 'skipped' ? 'dist-badge-skipped'
          : 'dist-badge-failed';
        const statusIcon = d.status === 'sent' ? ICONS.check
          : d.status === 'pending' ? ICONS.clock
          : '';
        const displayLabel = PROTOCOL_DISPLAY[d.protocol]?.label || d.protocol;
        const icon = PROTOCOL_ICONS[d.protocol] || '';
        return `<span class="dist-badge ${cls}" title="${escapeHtml(d.protocol)}: ${escapeHtml(d.status)}">${icon ? `<span class="protocol-icon">${icon}</span>` : ''}${escapeHtml(displayLabel)} ${statusIcon}</span>`;
      }).join('');

      return `
          <div class="post-item">
            <div class="post-item-body">
              <div class="post-item-content">${content}</div>
              <div class="post-item-meta">
                <span class="post-item-time">${ICONS.clock} ${escapeHtml(timeStr)}</span>
                <div class="dist-badges">${distBadgesHtml}</div>
              </div>
            </div>
            <div class="post-item-actions">
              <a class="link-action-btn" href="/@${handle}/post/${escapeHtml(post.id)}" target="_blank" rel="noopener noreferrer" title="View post">${ICONS.externalLinkSmall}</a>
              <form action="/studio/post/delete" method="POST" style="display:inline;" onsubmit="return confirm('Delete this post? This will also send delete notifications to federated servers.');">
                <input type="hidden" name="postId" value="${escapeHtml(post.id)}">
                <button class="link-action-btn danger" type="submit" title="Delete post">${ICONS.trash}</button>
              </form>
            </div>
          </div>`;
    }).join('');
  } else {
    postsHtml = `
          <div class="empty-state">
            <div class="empty-state-icon">${ICONS.content}</div>
            <div class="empty-state-title">No posts yet</div>
            <div class="empty-state-desc">Compose your first post to share it across all your connected protocols.</div>
            <a class="btn btn-primary" href="/studio/compose" style="margin-top: 1rem;">${ICONS.compose} Compose Post</a>
          </div>`;
  }

  // Pagination
  let paginationHtml = '';
  if (hasMore) {
    const lastPost = posts[posts.length - 1];
    const nextBefore = new Date(lastPost.created_at).toISOString();
    paginationHtml = `
      <div class="pagination">
        <a class="btn btn-secondary btn-sm" href="/studio/content?before=${encodeURIComponent(nextBefore)}">Older posts</a>
      </div>`;
  }

  return `
      <div class="page-header">
        <h1 class="page-title">Content</h1>
        <div class="page-actions">
          <a class="btn btn-primary" href="/studio/compose">${ICONS.compose} Compose Post</a>
        </div>
      </div>

      ${bannerHtml}

      <div class="post-list">
        ${postsHtml}
      </div>

      ${paginationHtml}`;
}

// =============================================================================
// Post Creation + Distribution (Studio Form Handler)
// =============================================================================

/**
 * Distribute a post via ActivityPub: Create(Note) to all followers' inboxes.
 */
async function studioDistributeAP(post, profile) {
  const handle = profile.username;
  const actorUri = `${BASE_URL}/ap/actor/${handle}`;
  const noteId = `${BASE_URL}/ap/note/${post.id}`;

  const actorResult = await pool.query(
    `SELECT id, actor_uri, public_key_pem, private_key_pem, key_id
     FROM social_federation.ap_actors
     WHERE webid = $1 AND status = 'active'`,
    [profile.webid]
  );

  if (actorResult.rowCount === 0 || !actorResult.rows[0].private_key_pem) {
    return { status: 'failed', error: 'No active AP actor keys found' };
  }

  const keys = actorResult.rows[0];

  const noteObject = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: noteId,
    type: 'Note',
    attributedTo: actorUri,
    content: escapeHtml(post.content_text),
    published: new Date(post.created_at).toISOString(),
    to: ['https://www.w3.org/ns/activitystreams#Public'],
    cc: [`${actorUri}/followers`],
    url: `${BASE_URL}/@${handle}/post/${post.id}`,
  };

  const createActivity = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `${noteId}/activity`,
    type: 'Create',
    actor: actorUri,
    published: new Date(post.created_at).toISOString(),
    to: ['https://www.w3.org/ns/activitystreams#Public'],
    cc: [`${actorUri}/followers`],
    object: noteObject,
  };

  const followersResult = await pool.query(
    `SELECT DISTINCT COALESCE(follower_shared_inbox, follower_inbox) AS inbox
     FROM social_graph.followers
     WHERE actor_uri = $1 AND status = 'accepted'`,
    [actorUri]
  );

  let deliveryCount = 0;
  let lastError = null;

  for (const row of followersResult.rows) {
    if (!row.inbox) continue;
    try {
      const result = await signedFetch(row.inbox, createActivity, keys.private_key_pem, keys.key_id);
      if (result.status >= 200 && result.status < 300) deliveryCount++;
      else lastError = `HTTP ${result.status} from ${row.inbox}`;
    } catch (err) {
      lastError = err.message;
    }
  }

  console.log(`[studio] AP distribution: ${deliveryCount}/${followersResult.rowCount} inboxes for post ${post.id}`);
  return { status: 'sent', remoteId: noteId, error: lastError || undefined };
}

async function studioDistributeNostr(post, profile) {
  if (!profile.nostr_npub) return { status: 'skipped', error: 'No Nostr identity' };
  const pubkeyHex = npubToHex(profile.nostr_npub);
  if (!pubkeyHex) return { status: 'failed', error: 'Failed to decode Nostr npub' };

  const keyResult = await pool.query(
    `SELECT public_key_hash FROM social_keys.key_metadata
     WHERE omni_account_id = $1 AND protocol = 'nostr' AND key_type = 'secp256k1-nsec' AND is_active = TRUE
     LIMIT 1`,
    [profile.omni_account_id]
  );

  if (keyResult.rowCount === 0) {
    return { status: 'pending', error: 'Client-side signing required' };
  }

  try {
    const event = createNostrEvent(1, post.content_text, [], keyResult.rows[0].public_key_hash, pubkeyHex);
    return { status: 'sent', remoteId: event.id };
  } catch (err) {
    return { status: 'failed', error: err.message };
  }
}

/**
 * Run cross-protocol distribution for a post created from the Studio form.
 * @param {object} post — The post record from DB
 * @param {object} profile — The user's profile
 * @param {string[]|null} selectedProtocols — Array of protocol names to distribute to, or null for all
 */
async function studioDistributePost(post, profile, selectedProtocols = null) {
  const distributions = [];

  const allProtocols = [
    { name: 'activitypub', fn: () => studioDistributeAP(post, profile) },
    { name: 'nostr', fn: () => studioDistributeNostr(post, profile) },
    { name: 'rss', fn: () => ({ status: 'sent', remoteId: 'auto-included-in-feed' }) },
    { name: 'indieweb', fn: () => ({ status: 'sent', remoteId: 'auto-included-in-h-feed' }) },
    { name: 'atproto', fn: () => profile.at_did
        ? { status: 'pending', error: 'AT Protocol PDS not yet implemented' }
        : { status: 'skipped', error: 'No AT DID configured' } },
  ];

  // Filter to only selected protocols if provided
  const protocols = selectedProtocols
    ? allProtocols.filter(p => selectedProtocols.includes(p.name))
    : allProtocols;

  for (const proto of protocols) {
    try {
      const result = await proto.fn();
      const distId = randomUUID();
      const distributedAt = result.status === 'sent' ? new Date() : null;

      await pool.query(
        `INSERT INTO social_federation.post_distribution
           (id, post_id, protocol, remote_id, status, distributed_at, error)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (post_id, protocol) DO UPDATE SET
           remote_id = EXCLUDED.remote_id,
           status = EXCLUDED.status,
           distributed_at = EXCLUDED.distributed_at,
           error = EXCLUDED.error`,
        [distId, post.id, proto.name, result.remoteId || null, result.status, distributedAt, result.error || null]
      );

      distributions.push({ protocol: proto.name, status: result.status, error: result.error || null });
    } catch (err) {
      console.error(`[studio] Distribution error for ${proto.name}:`, err.message);
      distributions.push({ protocol: proto.name, status: 'failed', error: err.message });
    }
  }

  // Log which protocols were selected vs skipped
  if (selectedProtocols) {
    const skipped = allProtocols.filter(p => !selectedProtocols.includes(p.name)).map(p => p.name);
    if (skipped.length > 0) {
      console.log(`[studio] Post ${post.id}: skipped protocols (user deselected): ${skipped.join(', ')}`);
    }
  }

  return distributions;
}

/**
 * Send AP Delete/Tombstone to all followers.
 */
async function studioSendApDelete(postId, profile) {
  const handle = profile.username;
  const actorUri = `${BASE_URL}/ap/actor/${handle}`;
  const noteId = `${BASE_URL}/ap/note/${postId}`;

  const actorResult = await pool.query(
    `SELECT private_key_pem, key_id
     FROM social_federation.ap_actors
     WHERE webid = $1 AND status = 'active'`,
    [profile.webid]
  );

  if (actorResult.rowCount === 0 || !actorResult.rows[0].private_key_pem) return;
  const keys = actorResult.rows[0];

  const deleteActivity = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `${noteId}#delete`,
    type: 'Delete',
    actor: actorUri,
    to: ['https://www.w3.org/ns/activitystreams#Public'],
    object: { id: noteId, type: 'Tombstone', formerType: 'Note', deleted: new Date().toISOString() },
  };

  const followersResult = await pool.query(
    `SELECT DISTINCT COALESCE(follower_shared_inbox, follower_inbox) AS inbox
     FROM social_graph.followers
     WHERE actor_uri = $1 AND status = 'accepted'`,
    [actorUri]
  );

  for (const row of followersResult.rows) {
    if (!row.inbox) continue;
    try { await signedFetch(row.inbox, deleteActivity, keys.private_key_pem, keys.key_id); }
    catch (err) { console.error(`[studio] AP delete delivery failed:`, err.message); }
  }
}

// =============================================================================
// Profile loader — reads from session (auth required)
// =============================================================================

async function loadProfileFromSession(session) {
  if (!session || !session.profileId) return null;

  const result = await pool.query(
    `SELECT id, webid, omni_account_id, display_name, username, bio,
            avatar_url, banner_url, homepage_url, nostr_npub, at_did
     FROM social_profiles.profile_index
     WHERE id = $1`,
    [session.profileId]
  );
  return result.rowCount > 0 ? result.rows[0] : null;
}

async function loadLinks(profile) {
  if (!profile || !profile.webid) return [];
  return getBioLinks(pool, profile.webid);
}

/**
 * Runtime probe for passphrase backup row in social_keys.recovery_backups.
 * On missing schema/table or query errors, returns unknown (does not throw).
 *
 * @param {string|null|undefined} userWebid
 * @returns {Promise<{ state: 'protected'|'unprotected'|'unknown', lastBackupDate: string|null }>}
 */
async function fetchStudioBackupStatus(userWebid) {
  if (!userWebid) {
    return { state: 'unknown', lastBackupDate: null };
  }
  try {
    const result = await pool.query(
      `SELECT created_at
       FROM social_keys.recovery_backups
       WHERE user_webid = $1 AND is_active = TRUE
       LIMIT 1`,
      [userWebid]
    );
    if (result.rowCount > 0) {
      const raw = result.rows[0].created_at;
      const dt = raw instanceof Date ? raw : new Date(raw);
      const lastBackupDate = Number.isNaN(dt.getTime())
        ? null
        : dt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
      return { state: 'protected', lastBackupDate };
    }
    return { state: 'unprotected', lastBackupDate: null };
  } catch (err) {
    console.error('[studio] recovery_backups probe failed:', err.message);
    return { state: 'unknown', lastBackupDate: null };
  }
}

// =============================================================================
// Route Registration
// =============================================================================

/**
 * Auth gate: checks session, redirects to /login if not authenticated.
 * Returns session data or null (after sending redirect).
 */
function authGate(req, res) {
  const session = requireAuth(req);
  if (!session) {
    res.writeHead(302, { Location: '/login' });
    res.end();
    return null;
  }
  return session;
}

// =============================================================================
// Page: Search Results
// =============================================================================

function searchResultsContent(query, results, byType) {
  const q = escapeHtml(query || '');
  const hasResults = results && results.length > 0;
  const profileCount = byType?.profiles?.length || 0;
  const postCount = byType?.posts?.length || 0;
  const groupCount = byType?.groups?.length || 0;

  let resultsHtml = '';
  if (!query) {
    resultsHtml = `
      <div class="empty-state">
        <div class="empty-state-icon">${ICONS.search}</div>
        <div class="empty-state-title">Search Social</div>
        <div class="empty-state-desc">Search across profiles, posts, and groups. Enter a query in the search bar above.</div>
      </div>`;
  } else if (!hasResults) {
    resultsHtml = `
      <div class="empty-state">
        <div class="empty-state-icon">${ICONS.search}</div>
        <div class="empty-state-title">No results found</div>
        <div class="empty-state-desc">No matches for "${q}". Try a different search term.</div>
      </div>`;
  } else {
    // Profile results
    let profilesHtml = '';
    if (profileCount > 0) {
      const items = byType.profiles.map(p => `
        <a href="/@${escapeHtml(p.username)}" class="search-result-item" style="text-decoration:none;color:inherit;">
          <div class="search-result-avatar" style="background:var(--color-primary);color:var(--color-text-inverse);display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:50%;font-size:1rem;flex-shrink:0;">
            ${p.avatar_url ? `<img src="${escapeHtml(p.avatar_url)}" alt="" style="width:40px;height:40px;border-radius:50%;object-fit:cover;">` : escapeHtml((p.display_name || p.username || '?').charAt(0).toUpperCase())}
          </div>
          <div>
            <div style="font-weight:500;">${escapeHtml(p.display_name || p.username)}</div>
            <div style="font-size:0.8125rem;color:var(--color-text-secondary);">@${escapeHtml(p.username)}</div>
            ${p.bio ? `<div style="font-size:0.8125rem;color:var(--color-text-tertiary);margin-top:0.25rem;">${escapeHtml(p.bio).slice(0, 120)}</div>` : ''}
          </div>
        </a>`).join('');
      profilesHtml = `
        <div class="search-section">
          <h3 class="search-section-title">Profiles (${profileCount})</h3>
          ${items}
        </div>`;
    }

    // Post results
    let postsHtml = '';
    if (postCount > 0) {
      const items = byType.posts.map(p => `
        <a href="${escapeHtml(p.url)}" class="search-result-item" style="text-decoration:none;color:inherit;">
          <div>
            <div style="font-size:0.8125rem;color:var(--color-text-secondary);margin-bottom:0.25rem;">
              @${escapeHtml(p.author?.username || 'unknown')} ${p.created_at ? new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
            </div>
            <div style="font-size:0.875rem;">${escapeHtml(p.content || '').slice(0, 200)}</div>
          </div>
        </a>`).join('');
      postsHtml = `
        <div class="search-section">
          <h3 class="search-section-title">Posts (${postCount})</h3>
          ${items}
        </div>`;
    }

    // Group results
    let groupsHtml = '';
    if (groupCount > 0) {
      const items = byType.groups.map(g => `
        <div class="search-result-item">
          <div>
            <div style="font-weight:500;">${escapeHtml(g.name)}</div>
            <div style="font-size:0.8125rem;color:var(--color-text-secondary);">${escapeHtml(g.group_type || 'group')} &middot; ${escapeHtml(g.visibility || 'public')}</div>
            ${g.description ? `<div style="font-size:0.8125rem;color:var(--color-text-tertiary);margin-top:0.25rem;">${escapeHtml(g.description).slice(0, 120)}</div>` : ''}
          </div>
        </div>`).join('');
      groupsHtml = `
        <div class="search-section">
          <h3 class="search-section-title">Groups (${groupCount})</h3>
          ${items}
        </div>`;
    }

    resultsHtml = profilesHtml + postsHtml + groupsHtml;
  }

  return `
    <style>
      .search-section { margin-bottom: 2rem; }
      .search-section-title {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--color-text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 0.75rem;
        padding-bottom: 0.5rem;
        border-bottom: 1px solid var(--color-border);
      }
      .search-result-item {
        display: flex;
        align-items: flex-start;
        gap: 0.75rem;
        padding: 0.75rem 1rem;
        border-radius: var(--radius-md);
        transition: background 0.15s;
      }
      .search-result-item:hover {
        background: var(--color-bg-hover);
      }
      .search-header-form {
        display: flex;
        gap: 0.5rem;
        margin-bottom: 1.5rem;
      }
      .search-header-input {
        flex: 1;
        background: var(--color-bg-tertiary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        color: var(--color-text-primary);
        font-size: 0.875rem;
        font-family: var(--font-family);
        padding: 0.625rem 1rem;
        outline: none;
      }
      .search-header-input:focus {
        border-color: var(--color-primary);
      }
      .search-header-btn {
        padding: 0.625rem 1.25rem;
        background: var(--color-primary);
        color: var(--color-text-inverse);
        border: none;
        border-radius: var(--radius-md);
        font-size: 0.875rem;
        font-weight: 500;
        cursor: pointer;
      }
      .search-header-btn:hover { opacity: 0.9; }
      .search-summary {
        font-size: 0.875rem;
        color: var(--color-text-secondary);
        margin-bottom: 1.5rem;
      }
    </style>
    <form class="search-header-form" action="/studio/search" method="GET">
      <input class="search-header-input" type="text" name="q" value="${q}" placeholder="Search profiles, posts, groups..." autocomplete="off">
      <button class="search-header-btn" type="submit">Search</button>
    </form>
    ${query ? `<div class="search-summary">${results.length} result${results.length !== 1 ? 's' : ''} for "${q}"</div>` : ''}
    ${resultsHtml}`;
}

export default function registerRoutes(routes) {
  // GET /studio — Dashboard
  routes.push({
    method: 'GET',
    pattern: '/studio',
    handler: async (req, res) => {
      const session = authGate(req, res);
      if (!session) return;
      const profile = await loadProfileFromSession(session);
      const links = await loadLinks(profile);
      const content = dashboardContent(profile, links);
      html(res, 200, studioShell({
        title: 'Dashboard',
        activePage: 'dashboard',
        profile,
        contentHtml: content,
        sessionUsername: session.username,
      }));
    },
  });

  // GET /studio/search — Search Results Page
  routes.push({
    method: 'GET',
    pattern: '/studio/search',
    handler: async (req, res) => {
      const session = authGate(req, res);
      if (!session) return;
      const profile = await loadProfileFromSession(session);

      const { searchParams } = parseUrl(req);
      const q = (searchParams.get('q') || '').trim();

      let results = [];
      let byType = {};
      if (q) {
        try {
          // Use the search API internally
          const tsq = q
            .toLowerCase()
            .replace(/[^\w\s@.-]/g, '')
            .split(/\s+/)
            .filter(t => t.length > 0)
            .map((t, i, arr) => i === arr.length - 1 ? `${t}:*` : t)
            .join(' & ');

          if (tsq) {
            // Search profiles
            const profileResult = await pool.query(
              `SELECT id, display_name, username, bio, avatar_url,
                      ts_rank(search_vector, to_tsquery('english', $1)) AS rank
               FROM social_profiles.profile_index
               WHERE search_vector @@ to_tsquery('english', $1)
               ORDER BY rank DESC LIMIT 10`,
              [tsq]
            );

            // Search posts
            const postResult = await pool.query(
              `SELECT p.id, p.content_text, p.created_at,
                      pi.username, pi.display_name, pi.avatar_url,
                      ts_rank(p.search_vector, to_tsquery('english', $1)) AS rank
               FROM social_profiles.posts p
               JOIN social_profiles.profile_index pi ON pi.webid = p.webid
               WHERE p.search_vector @@ to_tsquery('english', $1)
                 AND p.visibility = 'public'
               ORDER BY rank DESC LIMIT 10`,
              [tsq]
            );

            // Search groups
            const groupResult = await pool.query(
              `SELECT id, name, type, description, avatar_url, visibility,
                      ts_rank(search_vector, to_tsquery('english', $1)) AS rank
               FROM social_profiles.groups
               WHERE search_vector @@ to_tsquery('english', $1)
                 AND visibility IN ('public', 'unlisted')
               ORDER BY rank DESC LIMIT 10`,
              [tsq]
            );

            byType.profiles = profileResult.rows.map(r => ({
              type: 'profile', id: r.id, display_name: r.display_name,
              username: r.username, bio: r.bio, avatar_url: r.avatar_url,
              url: `/@${r.username}`, rank: parseFloat(r.rank),
            }));
            byType.posts = postResult.rows.map(r => ({
              type: 'post', id: r.id, content: r.content_text,
              created_at: r.created_at,
              author: { username: r.username, display_name: r.display_name, avatar_url: r.avatar_url },
              url: `/@${r.username}/post/${r.id}`, rank: parseFloat(r.rank),
            }));
            byType.groups = groupResult.rows.map(r => ({
              type: 'group', id: r.id, name: r.name, group_type: r.type,
              description: r.description, avatar_url: r.avatar_url,
              visibility: r.visibility, rank: parseFloat(r.rank),
            }));

            results = [
              ...(byType.profiles || []),
              ...(byType.posts || []),
              ...(byType.groups || []),
            ].sort((a, b) => b.rank - a.rank);
          }
        } catch (err) {
          console.error('[studio] Search error:', err.message);
          // Graceful degradation: show empty results
        }
      }

      const content = searchResultsContent(q, results, byType);
      html(res, 200, studioShell({
        title: q ? `Search: ${q}` : 'Search',
        activePage: 'search',
        profile,
        contentHtml: content,
        sessionUsername: session.username,
      }));
    },
  });

  // GET /studio/feed — Timeline Feed
  routes.push({
    method: 'GET',
    pattern: '/studio/feed',
    handler: async (req, res) => {
      const session = authGate(req, res);
      if (!session) return;
      const profile = await loadProfileFromSession(session);
      const items = profile ? await loadTimelineItems(profile.webid) : [];
      const content = feedContent(profile, items);
      html(res, 200, studioShell({
        title: 'Feed',
        activePage: 'feed',
        profile,
        contentHtml: content,
        sessionUsername: session.username,
      }));
    },
  });

  // GET /studio/links — Link Management
  routes.push({
    method: 'GET',
    pattern: '/studio/links',
    handler: async (req, res) => {
      const session = authGate(req, res);
      if (!session) return;
      const profile = await loadProfileFromSession(session);
      const links = await loadLinks(profile);
      const content = linksContent(profile, links);
      html(res, 200, studioShell({
        title: 'Links',
        activePage: 'links',
        profile,
        contentHtml: content,
        sessionUsername: session.username,
      }));
    },
  });

  // GET /studio/analytics — Analytics (real data)
  routes.push({
    method: 'GET',
    pattern: '/studio/analytics',
    handler: async (req, res) => {
      const session = authGate(req, res);
      if (!session) return;
      const profile = await loadProfileFromSession(session);
      let analyticsData = null;
      try {
        analyticsData = await loadAnalyticsData(profile);
      } catch (err) {
        console.error('[studio] analytics data load error:', err.message);
      }
      const content = analyticsContent(profile, analyticsData);
      html(res, 200, studioShell({
        title: 'Analytics',
        activePage: 'analytics',
        profile,
        contentHtml: content,
        sessionUsername: session.username,
      }));
    },
  });

  // GET /studio/customize — Profile Customization
  routes.push({
    method: 'GET',
    pattern: '/studio/customize',
    handler: async (req, res) => {
      const session = authGate(req, res);
      if (!session) return;
      const profile = await loadProfileFromSession(session);
      const links = await loadLinks(profile);
      const content = customizeContent(profile, links);
      html(res, 200, studioShell({
        title: 'Customize',
        activePage: 'customize',
        profile,
        contentHtml: content,
        sessionUsername: session.username,
      }));
    },
  });

  // GET /studio/settings — Settings
  routes.push({
    method: 'GET',
    pattern: '/studio/settings',
    handler: async (req, res) => {
      const session = authGate(req, res);
      if (!session) return;
      const profile = await loadProfileFromSession(session);
      const backupStatus = await fetchStudioBackupStatus(profile?.webid);
      const content = settingsContent(profile, backupStatus);
      html(res, 200, studioShell({
        title: 'Settings',
        activePage: 'settings',
        profile,
        contentHtml: content,
        sessionUsername: session.username,
      }));
    },
  });

  // =========================================================================
  // Admin Invites Dashboard (F-031)
  // =========================================================================

  // GET /studio/admin/invites — Admin invite management page
  routes.push({
    method: 'GET',
    pattern: '/studio/admin/invites',
    handler: async (req, res) => {
      const session = authGate(req, res);
      if (!session) return;
      const profile = await loadProfileFromSession(session);

      // Admin check: first registered user is admin
      const admin = await isAdmin(session.profileId);
      if (!admin) {
        return html(res, 403, studioShell({
          title: 'Access Denied',
          activePage: 'settings',
          profile,
          contentHtml: `<div class="page-header"><h1 class="page-title">Access Denied</h1></div>
            <p style="color: var(--color-text-secondary); margin-top: 1rem;">Only platform administrators can access the invite management dashboard.</p>
            <a href="/studio/settings" class="btn btn-secondary btn-sm" style="margin-top: 1rem; display: inline-block;">Back to Settings</a>`,
          sessionUsername: session.username,
        }));
      }

      // Load data
      const stats = await getInviteStats();
      const { codes, total } = await getAllInviteCodes({ limit: 50 });

      // Build admin content
      const statsHtml = `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:1rem;margin-bottom:2rem;">
          <div style="background:var(--color-bg-secondary);border:1px solid var(--color-border);border-radius:var(--radius-lg);padding:1.25rem;">
            <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-tertiary);margin-bottom:0.25rem;">Total Codes</div>
            <div style="font-size:1.75rem;font-weight:700;color:var(--color-text-primary);">${stats.total_codes}</div>
          </div>
          <div style="background:var(--color-bg-secondary);border:1px solid var(--color-border);border-radius:var(--radius-lg);padding:1.25rem;">
            <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-tertiary);margin-bottom:0.25rem;">Redeemed</div>
            <div style="font-size:1.75rem;font-weight:700;color:var(--color-success,#22c55e);">${stats.redeemed}</div>
          </div>
          <div style="background:var(--color-bg-secondary);border:1px solid var(--color-border);border-radius:var(--radius-lg);padding:1.25rem;">
            <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-tertiary);margin-bottom:0.25rem;">Conversion</div>
            <div style="font-size:1.75rem;font-weight:700;color:var(--color-primary);">${stats.conversion_rate}%</div>
          </div>
          <div style="background:var(--color-bg-secondary);border:1px solid var(--color-border);border-radius:var(--radius-lg);padding:1.25rem;">
            <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-tertiary);margin-bottom:0.25rem;">Max Depth</div>
            <div style="font-size:1.75rem;font-weight:700;color:var(--color-text-primary);">${stats.max_depth}</div>
          </div>
          <div style="background:var(--color-bg-secondary);border:1px solid var(--color-border);border-radius:var(--radius-lg);padding:1.25rem;">
            <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-tertiary);margin-bottom:0.25rem;">Avg Depth</div>
            <div style="font-size:1.75rem;font-weight:700;color:var(--color-text-primary);">${stats.avg_depth}</div>
          </div>
          <div style="background:var(--color-bg-secondary);border:1px solid var(--color-border);border-radius:var(--radius-lg);padding:1.25rem;">
            <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-tertiary);margin-bottom:0.25rem;">Mode</div>
            <div style="font-size:1rem;font-weight:600;color:var(--color-primary);text-transform:uppercase;">${escapeHtml(REGISTRATION_MODE)}</div>
          </div>
        </div>`;

      // Generate codes form
      const generateHtml = `
        <div style="background:var(--color-bg-secondary);border:1px solid var(--color-border);border-radius:var(--radius-lg);padding:1.5rem;margin-bottom:2rem;">
          <h3 style="font-size:1rem;font-weight:600;color:var(--color-text-primary);margin-bottom:1rem;">Generate Invite Codes</h3>
          <form id="admin-generate-form" style="display:flex;gap:0.75rem;flex-wrap:wrap;align-items:flex-end;">
            <div>
              <label style="display:block;font-size:0.75rem;color:var(--color-text-tertiary);margin-bottom:0.25rem;">Count</label>
              <input type="number" name="count" value="5" min="1" max="100" style="width:80px;padding:0.5rem;background:var(--color-bg-tertiary);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text-primary);font-size:0.875rem;">
            </div>
            <div>
              <label style="display:block;font-size:0.75rem;color:var(--color-text-tertiary);margin-bottom:0.25rem;">Max Uses</label>
              <input type="number" name="max_uses" value="1" min="1" max="100" style="width:80px;padding:0.5rem;background:var(--color-bg-tertiary);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text-primary);font-size:0.875rem;">
            </div>
            <div>
              <label style="display:block;font-size:0.75rem;color:var(--color-text-tertiary);margin-bottom:0.25rem;">Expiry (days)</label>
              <input type="number" name="expiry_days" value="30" min="1" max="365" style="width:80px;padding:0.5rem;background:var(--color-bg-tertiary);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text-primary);font-size:0.875rem;">
            </div>
            <button type="submit" style="padding:0.5rem 1.25rem;background:var(--color-primary);color:var(--color-text-inverse);border:none;border-radius:9999px;font-size:0.875rem;font-weight:600;cursor:pointer;">Generate</button>
          </form>
          <div id="admin-generate-result" style="margin-top:0.75rem;font-size:0.8125rem;"></div>
        </div>
        <script>
          document.getElementById('admin-generate-form').addEventListener('submit', function(e) {
            e.preventDefault();
            var form = e.target;
            var body = JSON.stringify({
              count: parseInt(form.count.value),
              max_uses: parseInt(form.max_uses.value),
              expiry_days: parseInt(form.expiry_days.value)
            });
            fetch('/api/invites/generate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'same-origin',
              body: body
            })
            .then(function(r) { return r.json(); })
            .then(function(data) {
              if (data.codes && data.codes.length > 0) {
                var codesStr = data.codes.map(function(c) { return c.code; }).join(', ');
                document.getElementById('admin-generate-result').innerHTML =
                  '<span style="color:var(--color-success,#22c55e);">Generated ' + data.codes.length + ' code(s): ' + codesStr + '</span>';
                setTimeout(function() { location.reload(); }, 2000);
              } else {
                document.getElementById('admin-generate-result').innerHTML =
                  '<span style="color:var(--color-error);">Failed: ' + (data.error || 'Unknown error') + '</span>';
              }
            });
          });
        </script>`;

      // Codes table
      const codesTableHtml = codes.length > 0 ? `
        <div style="background:var(--color-bg-secondary);border:1px solid var(--color-border);border-radius:var(--radius-lg);padding:1.5rem;margin-bottom:2rem;">
          <h3 style="font-size:1rem;font-weight:600;color:var(--color-text-primary);margin-bottom:1rem;">All Invite Codes (${total} total)</h3>
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:0.8125rem;">
              <thead>
                <tr style="border-bottom:2px solid var(--color-border);">
                  <th style="text-align:left;padding:0.5rem;color:var(--color-text-tertiary);font-weight:600;font-size:0.75rem;text-transform:uppercase;">Code</th>
                  <th style="text-align:left;padding:0.5rem;color:var(--color-text-tertiary);font-weight:600;font-size:0.75rem;text-transform:uppercase;">Status</th>
                  <th style="text-align:left;padding:0.5rem;color:var(--color-text-tertiary);font-weight:600;font-size:0.75rem;text-transform:uppercase;">Creator</th>
                  <th style="text-align:left;padding:0.5rem;color:var(--color-text-tertiary);font-weight:600;font-size:0.75rem;text-transform:uppercase;">Uses</th>
                  <th style="text-align:left;padding:0.5rem;color:var(--color-text-tertiary);font-weight:600;font-size:0.75rem;text-transform:uppercase;">Expires</th>
                  <th style="text-align:left;padding:0.5rem;color:var(--color-text-tertiary);font-weight:600;font-size:0.75rem;text-transform:uppercase;">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${codes.map(c => {
                  const statusColor = c.status === 'active' ? 'var(--color-success,#22c55e)' : c.status === 'revoked' ? 'var(--color-error)' : c.status === 'used' || c.status === 'exhausted' ? 'var(--color-text-tertiary)' : 'var(--color-warning,#f59e0b)';
                  const expiresStr = new Date(c.expires_at).toLocaleDateString();
                  const creatorStr = c.creator_username ? '@' + escapeHtml(c.creator_username) : escapeHtml(c.created_by_webid.slice(0, 30));
                  return `<tr style="border-bottom:1px solid var(--color-border);">
                    <td style="padding:0.5rem;font-family:var(--font-family-mono);font-weight:600;color:var(--color-text-primary);">${escapeHtml(c.code)}</td>
                    <td style="padding:0.5rem;"><span style="color:${statusColor};font-weight:600;text-transform:uppercase;font-size:0.6875rem;">${escapeHtml(c.status)}</span></td>
                    <td style="padding:0.5rem;color:var(--color-text-secondary);">${creatorStr}</td>
                    <td style="padding:0.5rem;color:var(--color-text-secondary);">${c.use_count}/${c.max_uses}</td>
                    <td style="padding:0.5rem;color:var(--color-text-secondary);">${expiresStr}</td>
                    <td style="padding:0.5rem;">${c.status === 'active' ? `<button onclick="fetch('/api/invites/revoke/${escapeHtml(c.code)}',{method:'POST',credentials:'same-origin'}).then(function(){location.reload();})" style="font-size:0.6875rem;padding:0.25rem 0.5rem;background:transparent;border:1px solid var(--color-error);border-radius:var(--radius-sm);color:var(--color-error);cursor:pointer;">Revoke</button>` : ''}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>` : '';

      // Top inviters
      const topInvitersHtml = stats.top_inviters && stats.top_inviters.length > 0 ? `
        <div style="background:var(--color-bg-secondary);border:1px solid var(--color-border);border-radius:var(--radius-lg);padding:1.5rem;margin-bottom:2rem;">
          <h3 style="font-size:1rem;font-weight:600;color:var(--color-text-primary);margin-bottom:1rem;">Top Inviters</h3>
          ${stats.top_inviters.map((inv, i) => `
            <div style="display:flex;align-items:center;gap:0.75rem;padding:0.5rem 0;${i < stats.top_inviters.length - 1 ? 'border-bottom:1px solid var(--color-border);' : ''}">
              <span style="font-size:0.875rem;font-weight:700;color:var(--color-primary);min-width:24px;">#${i + 1}</span>
              <span style="font-size:0.875rem;color:var(--color-text-primary);flex:1;">${escapeHtml(inv.display_name || inv.username || 'Unknown')}</span>
              <span style="font-size:0.8125rem;color:var(--color-text-secondary);">${inv.invite_count} invited</span>
            </div>
          `).join('')}
        </div>` : '';

      const content = `
        <div class="page-header">
          <h1 class="page-title">Invite Management</h1>
        </div>
        ${statsHtml}
        ${generateHtml}
        ${codesTableHtml}
        ${topInvitersHtml}
        <div style="margin-top:1rem;">
          <a href="/studio/settings" class="btn btn-secondary btn-sm">Back to Settings</a>
          <a href="/api/invites/stats" class="btn btn-secondary btn-sm" target="_blank" rel="noopener" style="margin-left:0.5rem;">Stats API</a>
        </div>`;

      html(res, 200, studioShell({
        title: 'Invite Management',
        activePage: 'settings',
        profile,
        contentHtml: content,
        sessionUsername: session.username,
      }));
    },
  });

  // =========================================================================
  // Compose + Content Routes (WO-006)
  // =========================================================================

  // GET /studio/compose — Full-page compose view
  routes.push({
    method: 'GET',
    pattern: '/studio/compose',
    handler: async (req, res) => {
      const session = authGate(req, res);
      if (!session) return;
      const profile = await loadProfileFromSession(session);
      const content = composeContent(profile);
      html(res, 200, studioShell({
        title: 'Compose',
        activePage: 'content',
        profile,
        contentHtml: content,
        sessionUsername: session.username,
      }));
    },
  });

  // GET /studio/content — Post management
  routes.push({
    method: 'GET',
    pattern: '/studio/content',
    handler: async (req, res) => {
      const session = authGate(req, res);
      if (!session) return;
      const profile = await loadProfileFromSession(session);

      const { searchParams } = new URL(req.url, 'http://localhost');
      const before = searchParams.get('before') || null;
      const deleted = searchParams.get('deleted');
      const PAGE_SIZE = 20;

      let posts = [];
      let hasMore = false;
      if (profile) {
        const rows = await loadUserPosts(profile.webid, PAGE_SIZE, before);
        hasMore = rows.length > PAGE_SIZE;
        posts = rows.slice(0, PAGE_SIZE);
      }

      const postIds = posts.map(p => p.id);
      const distributions = await loadPostDistributions(postIds);

      const content = contentPageContent(profile, posts, distributions, {
        before,
        hasMore,
        deletedMessage: deleted === '1' ? 'Post deleted successfully.' : null,
      });
      html(res, 200, studioShell({
        title: 'Content',
        activePage: 'content',
        profile,
        contentHtml: content,
        sessionUsername: session.username,
      }));
    },
  });

  // POST /studio/post — Create a post from form submit
  routes.push({
    method: 'POST',
    pattern: '/studio/post',
    handler: async (req, res) => {
      const session = authGate(req, res);
      if (!session) return;

      const body = await readFormBody(req);
      const contentText = (body.content || '').trim();

      if (!contentText) {
        res.writeHead(302, { Location: '/studio' });
        res.end();
        return;
      }

      // Enforce character limit
      const MAX_LEN = 500;
      const trimmed = contentText.slice(0, MAX_LEN);

      // Load profile
      const profileResult = await pool.query(
        `SELECT id, webid, omni_account_id, display_name, username, bio,
                avatar_url, banner_url, homepage_url, nostr_npub, at_did
         FROM social_profiles.profile_index
         WHERE id = $1`,
        [session.profileId]
      );

      if (profileResult.rowCount === 0) {
        res.writeHead(302, { Location: '/studio' });
        res.end();
        return;
      }

      const profile = profileResult.rows[0];

      // Create the post (with optional group_id)
      const postId = randomUUID();
      const groupId = (body.group_id || '').trim() || null;

      const insertResult = await pool.query(
        `INSERT INTO social_profiles.posts (id, webid, content_text, content_html, media_urls, visibility, in_reply_to, group_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, webid, content_text, content_html, media_urls, visibility, in_reply_to, group_id, created_at, updated_at`,
        [postId, profile.webid, trimmed, null, '{}', 'public', null, groupId]
      );

      const post = insertResult.rows[0];
      console.log(`[studio] Created post ${post.id} by @${profile.username}${groupId ? ` in group ${groupId}` : ''}`);

      // Parse selected protocols from form checkboxes
      // readFormBody returns multi-value fields as arrays when using the same name
      let selectedProtocols = body.protocols;
      if (typeof selectedProtocols === 'string') selectedProtocols = [selectedProtocols];
      if (!selectedProtocols || !Array.isArray(selectedProtocols)) selectedProtocols = null;

      // Distribute to selected protocols (null = all)
      const distributions = await studioDistributePost(post, profile, selectedProtocols);

      // Render success page depending on redirect param
      const redirect = body.redirect || 'dashboard';
      const links = await loadLinks(profile);

      if (redirect === 'compose') {
        const content = composeContent(profile, {
          successMessage: 'Post published!',
          distributions,
        });
        html(res, 200, studioShell({
          title: 'Compose',
          activePage: 'content',
          profile,
          contentHtml: content,
          sessionUsername: session.username,
        }));
      } else {
        const content = dashboardContent(profile, links, {
          successMessage: 'Post published!',
          distributions,
        });
        html(res, 200, studioShell({
          title: 'Dashboard',
          activePage: 'dashboard',
          profile,
          contentHtml: content,
          sessionUsername: session.username,
        }));
      }
    },
  });

  // POST /studio/post/delete — Delete a post from form submit
  routes.push({
    method: 'POST',
    pattern: '/studio/post/delete',
    handler: async (req, res) => {
      const session = authGate(req, res);
      if (!session) return;

      const body = await readFormBody(req);
      const postId = (body.postId || '').trim();

      if (!postId) {
        res.writeHead(302, { Location: '/studio/content' });
        res.end();
        return;
      }

      // Load profile
      const profileResult = await pool.query(
        `SELECT id, webid, omni_account_id, display_name, username, bio,
                avatar_url, nostr_npub, at_did
         FROM social_profiles.profile_index
         WHERE id = $1`,
        [session.profileId]
      );

      if (profileResult.rowCount === 0) {
        res.writeHead(302, { Location: '/studio/content' });
        res.end();
        return;
      }

      const profile = profileResult.rows[0];

      // Verify post belongs to this user
      const postResult = await pool.query(
        `SELECT id FROM social_profiles.posts WHERE id = $1 AND webid = $2`,
        [postId, profile.webid]
      );

      if (postResult.rowCount === 0) {
        res.writeHead(302, { Location: '/studio/content' });
        res.end();
        return;
      }

      // Send AP Delete
      try {
        await studioSendApDelete(postId, profile);
      } catch (err) {
        console.error(`[studio] Error sending AP delete for post ${postId}:`, err.message);
      }

      // Update distribution status
      await pool.query(
        `UPDATE social_federation.post_distribution SET status = 'deleted' WHERE post_id = $1`,
        [postId]
      );

      // Delete the post
      await pool.query('DELETE FROM social_profiles.posts WHERE id = $1', [postId]);
      console.log(`[studio] Deleted post ${postId} by @${profile.username}`);

      // Redirect back to content page
      res.writeHead(302, { Location: '/studio/content?deleted=1' });
      res.end();
    },
  });
}
