// =============================================================================
// Studio Routes — Creator Dashboard (Phase 2: Compose + Content)
// =============================================================================
// GET  /studio             — Dashboard (with compose box)
// GET  /studio/compose     — Full-page compose view
// GET  /studio/content     — Post management (list, delete)
// GET  /studio/links       — Link Management
// GET  /studio/customize   — Profile Customization
// GET  /studio/settings    — Settings
// GET  /studio/analytics   — Analytics (placeholder)
// POST /studio/post        — Create post from form submit
// POST /studio/post/delete — Delete a post from form submit
//
// Auth: Session-based authentication via signed cookies (see lib/session.js).
// Design: Server-rendered HTML, inline CSS with design tokens, zero JS.

import { randomUUID } from 'node:crypto';
import { pool } from '../db.js';
import {
  html, json, parseUrl, escapeHtml, readFormBody, lookupProfileByHandle, getBioLinks,
  BASE_URL, SUBDOMAIN, DOMAIN,
} from '../lib/helpers.js';
import { requireAuth } from '../lib/session.js';
import { signedFetch } from '../lib/http-signatures.js';
import { npubToHex, createNostrEvent } from '../lib/nostr-crypto.js';

/**
 * Protocol display names and colors for badges.
 */
const PROTOCOL_DISPLAY = {
  activitypub: { label: 'ActivityPub', color: 'var(--color-accent)' },
  nostr: { label: 'Nostr', color: 'var(--color-violet-500)' },
  atprotocol: { label: 'AT Protocol', color: 'var(--color-blue-500)' },
  rss: { label: 'RSS', color: 'var(--color-orange-500)' },
  matrix: { label: 'Matrix', color: 'var(--color-green-500)' },
  xmtp: { label: 'XMTP', color: 'var(--color-red-500)' },
  dsnp: { label: 'DSNP', color: 'var(--color-cyan-400)' },
  solid: { label: 'Solid', color: 'var(--color-accent)' },
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
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }

    .settings-section-title {
      font-size: 1rem;
      font-weight: 600;
      color: var(--color-text-primary);
      margin-bottom: 1rem;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid var(--color-border);
    }

    .settings-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem 0;
      border-bottom: 1px solid var(--color-border);
    }

    .settings-row:last-child {
      border-bottom: none;
    }

    .settings-label {
      font-size: 0.875rem;
      color: var(--color-text-primary);
    }

    .settings-value {
      font-size: 0.875rem;
      color: var(--color-text-secondary);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .settings-status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: inline-block;
    }

    .dot-active { background: var(--color-success); }
    .dot-inactive { background: var(--color-text-tertiary); }

    .danger-zone {
      background: var(--color-error-light);
      border-color: var(--color-error);
    }

    .danger-zone .settings-section-title {
      color: var(--color-error);
    }

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

    .analytics-cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 1rem;
      margin-top: 1.5rem;
    }

    .analytics-card-placeholder {
      background: var(--color-bg-secondary);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      padding: 1.5rem;
      text-align: center;
    }

    .analytics-card-title {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--color-text-secondary);
      margin-bottom: 0.5rem;
    }

    .analytics-card-value {
      font-size: 0.75rem;
      color: var(--color-text-tertiary);
    }

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
  const ourDomain = `${SUBDOMAIN}.${DOMAIN}`;

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
  <title>${escapeHtml(title)} - Studio - PeerMesh Social Lab</title>
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
  const ourDomain = `${SUBDOMAIN}.${DOMAIN}`;
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
  const ourDomain = `${SUBDOMAIN}.${DOMAIN}`;

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

function settingsContent(profile) {
  const handle = profile ? escapeHtml(profile.username || '') : '';
  const profileId = profile ? profile.id : '';
  const ourDomain = `${SUBDOMAIN}.${DOMAIN}`;

  return `
      <div class="page-header">
        <h1 class="page-title">Settings</h1>
      </div>

      <!-- Protocol Connections -->
      <div class="settings-section">
        <div class="settings-section-title">Protocol Connections</div>
        <div class="settings-row">
          <span class="settings-label">ActivityPub</span>
          <span class="settings-value">
            <span class="settings-status-dot dot-active"></span>
            Active &mdash; @${handle}@${ourDomain}
          </span>
        </div>
        <div class="settings-row">
          <span class="settings-label">Nostr</span>
          <span class="settings-value">
            <span class="settings-status-dot dot-active"></span>
            Active
          </span>
        </div>
        <div class="settings-row">
          <span class="settings-label">IndieWeb / Webmention</span>
          <span class="settings-value">
            <span class="settings-status-dot dot-active"></span>
            Active
          </span>
        </div>
        <div class="settings-row">
          <span class="settings-label">RSS / Atom / JSON Feed</span>
          <span class="settings-value">
            <span class="settings-status-dot dot-active"></span>
            Active
          </span>
        </div>
        <div class="settings-row">
          <span class="settings-label">AT Protocol</span>
          <span class="settings-value">
            <span class="settings-status-dot dot-active"></span>
            Active
          </span>
        </div>
        <div class="settings-row">
          <span class="settings-label">Solid Protocol</span>
          <span class="settings-value">
            <span class="settings-status-dot dot-inactive"></span>
            Coming soon
          </span>
        </div>
        <div class="settings-row">
          <span class="settings-label">Holochain</span>
          <span class="settings-value">
            <span class="settings-status-dot dot-inactive"></span>
            Coming soon
          </span>
        </div>
      </div>

      <!-- Account -->
      <div class="settings-section">
        <div class="settings-section-title">Account</div>
        <div class="settings-row">
          <span class="settings-label">Handle</span>
          <span class="settings-value">@${handle}</span>
        </div>
        <div class="settings-row">
          <span class="settings-label">Profile URL</span>
          <span class="settings-value">${BASE_URL}/@${handle}</span>
        </div>
        <div class="settings-row">
          <span class="settings-label">Profile ID</span>
          <span class="settings-value" style="font-family: var(--font-family-mono); font-size: 0.75rem;">${escapeHtml(profileId)}</span>
        </div>
        <div class="settings-row">
          <span class="settings-label">Export Data</span>
          <span class="settings-value">
            <button class="btn btn-secondary btn-sm">Export Profile Bundle</button>
          </span>
        </div>
      </div>

      <!-- Danger Zone -->
      <div class="settings-section danger-zone">
        <div class="settings-section-title">Danger Zone</div>
        <div class="settings-row">
          <span class="settings-label">Delete Account</span>
          <span class="settings-value">
            <button class="btn btn-danger btn-sm">Delete Account</button>
          </span>
        </div>
      </div>`;
}

// =============================================================================
// Page: Analytics (Placeholder)
// =============================================================================

function analyticsContent(profile) {
  return `
      <div class="page-header">
        <h1 class="page-title">Analytics</h1>
      </div>

      <div class="placeholder-card">
        <div class="placeholder-icon">${ICONS.analytics}</div>
        <div class="placeholder-title">Analytics coming soon</div>
        <div class="placeholder-desc">Analytics will appear once your page gets its first visitor. Track profile views, link clicks, and follower growth.</div>
      </div>

      <div class="analytics-cards">
        <div class="analytics-card-placeholder">
          <div class="analytics-card-title">Profile Views</div>
          <div class="analytics-card-value">${ICONS.clock} Coming soon</div>
        </div>
        <div class="analytics-card-placeholder">
          <div class="analytics-card-title">Link Clicks</div>
          <div class="analytics-card-value">${ICONS.clock} Coming soon</div>
        </div>
        <div class="analytics-card-placeholder">
          <div class="analytics-card-title">Follower Growth</div>
          <div class="analytics-card-value">${ICONS.clock} Coming soon</div>
        </div>
        <div class="analytics-card-placeholder">
          <div class="analytics-card-title">Protocol Reach</div>
          <div class="analytics-card-value">${ICONS.clock} Coming soon</div>
        </div>
        <div class="analytics-card-placeholder">
          <div class="analytics-card-title">Top Links</div>
          <div class="analytics-card-value">${ICONS.clock} Coming soon</div>
        </div>
        <div class="analytics-card-placeholder">
          <div class="analytics-card-title">Referral Sources</div>
          <div class="analytics-card-value">${ICONS.clock} Coming soon</div>
        </div>
      </div>`;
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
// Page: Compose (Full Page)
// =============================================================================

function composeContent(profile, { successMessage, distributions } = {}) {
  const displayName = profile ? escapeHtml(profile.display_name || profile.username || 'User') : 'User';
  const handle = profile ? escapeHtml(profile.username || '') : '';
  const avatarUrl = profile ? profile.avatar_url : null;
  const initial = displayName.charAt(0).toUpperCase();
  const ourDomain = `${SUBDOMAIN}.${DOMAIN}`;

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

          <!-- Protocol Distribution Checkboxes -->
          <div style="margin-top: 1rem;">
            <div style="font-size: 0.8125rem; font-weight: 500; color: var(--color-text-secondary); margin-bottom: 0.5rem;">Distribute to:</div>
            <div class="protocol-checks">
              <label class="protocol-check">
                <input type="checkbox" name="proto_ap" value="1" checked>
                <span>ActivityPub</span>
              </label>
              <label class="protocol-check">
                <input type="checkbox" name="proto_nostr" value="1" checked>
                <span>Nostr</span>
              </label>
              <label class="protocol-check">
                <input type="checkbox" name="proto_rss" value="1" checked>
                <span>RSS</span>
              </label>
              <label class="protocol-check">
                <input type="checkbox" name="proto_indieweb" value="1" checked>
                <span>IndieWeb</span>
              </label>
              <label class="protocol-check">
                <input type="checkbox" name="proto_atproto" value="1" checked>
                <span>AT Protocol</span>
              </label>
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

      // Distribution badges
      const dists = distributions[post.id] || [];
      const distBadgesHtml = dists.map(d => {
        const cls = d.status === 'sent' ? 'dist-badge-sent'
          : d.status === 'pending' ? 'dist-badge-pending'
          : d.status === 'skipped' ? 'dist-badge-skipped'
          : 'dist-badge-failed';
        return `<span class="dist-badge ${cls}">${escapeHtml(d.protocol)}</span>`;
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
 */
async function studioDistributePost(post, profile) {
  const distributions = [];

  const protocols = [
    { name: 'activitypub', fn: () => studioDistributeAP(post, profile) },
    { name: 'nostr', fn: () => studioDistributeNostr(post, profile) },
    { name: 'rss', fn: () => ({ status: 'sent', remoteId: 'auto-included-in-feed' }) },
    { name: 'indieweb', fn: () => ({ status: 'sent', remoteId: 'auto-included-in-h-feed' }) },
    { name: 'atproto', fn: () => profile.at_did
        ? { status: 'pending', error: 'AT Protocol PDS not yet implemented' }
        : { status: 'skipped', error: 'No AT DID configured' } },
  ];

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
        <div class="empty-state-title">Search Social Lab</div>
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

  // GET /studio/analytics — Analytics (placeholder)
  routes.push({
    method: 'GET',
    pattern: '/studio/analytics',
    handler: async (req, res) => {
      const session = authGate(req, res);
      if (!session) return;
      const profile = await loadProfileFromSession(session);
      const content = analyticsContent(profile);
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
      const content = settingsContent(profile);
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

      // Distribute to protocols
      const distributions = await studioDistributePost(post, profile);

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
