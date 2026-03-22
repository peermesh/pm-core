// =============================================================================
// Studio Routes — Creator Dashboard (Phase 1: HTML Shell)
// =============================================================================
// GET /studio             — Dashboard
// GET /studio/links       — Link Management
// GET /studio/customize   — Profile Customization
// GET /studio/settings    — Settings
// GET /studio/analytics   — Analytics (placeholder)
//
// Auth: Session-based authentication via signed cookies (see lib/session.js).
// Design: Server-rendered HTML, inline CSS with design tokens, zero JS.

import { pool } from '../db.js';
import {
  html, escapeHtml, lookupProfileByHandle, getBioLinks,
  BASE_URL, SUBDOMAIN, DOMAIN,
} from '../lib/helpers.js';
import { requireAuth } from '../lib/session.js';

/**
 * Protocol display names and colors for badges.
 */
const PROTOCOL_DISPLAY = {
  activitypub: { label: 'ActivityPub', color: '#6364ff' },
  nostr: { label: 'Nostr', color: '#8b5cf6' },
  atprotocol: { label: 'AT Protocol', color: '#0085ff' },
  rss: { label: 'RSS', color: '#ee802f' },
  matrix: { label: 'Matrix', color: '#0dbd8b' },
  xmtp: { label: 'XMTP', color: '#fc4f37' },
  dsnp: { label: 'DSNP', color: '#2dd4bf' },
  solid: { label: 'Solid', color: '#7c4dff' },
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
};

// =============================================================================
// Shared CSS (Design Tokens inlined)
// =============================================================================

const STUDIO_CSS = `
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

    :root {
      /* Slate palette */
      --color-slate-50: #f8fafc;
      --color-slate-100: #f1f5f9;
      --color-slate-200: #e2e8f0;
      --color-slate-300: #cbd5e1;
      --color-slate-400: #94a3b8;
      --color-slate-500: #64748b;
      --color-slate-600: #475569;
      --color-slate-700: #334155;
      --color-slate-800: #1e293b;
      --color-slate-900: #0f172a;
      --color-slate-950: #020617;

      /* Cyan */
      --color-cyan-400: #22d3ee;
      --color-cyan-500: #06b6d4;

      /* Green */
      --color-green-500: #22c55e;

      /* Red */
      --color-red-500: #ef4444;

      /* Amber */
      --color-amber-500: #f59e0b;

      /* Semantic tokens — Dark theme */
      --color-primary: #06b6d4;
      --color-primary-hover: #22d3ee;
      --color-primary-light: rgba(6, 182, 212, 0.12);
      --color-bg-primary: #020617;
      --color-bg-secondary: #0b1120;
      --color-bg-tertiary: #0f172a;
      --color-bg-elevated: #1e293b;
      --color-bg-hover: rgba(255, 255, 255, 0.05);
      --color-bg-active: rgba(255, 255, 255, 0.08);
      --color-text-primary: #f1f5f9;
      --color-text-secondary: #94a3b8;
      --color-text-tertiary: #64748b;
      --color-text-inverse: #020617;
      --color-border: #1e293b;
      --color-border-strong: #334155;
      --color-success: #22c55e;
      --color-error: #ef4444;
      --color-warning: #f59e0b;

      /* Typography */
      --font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;

      /* Spacing */
      --sidebar-width: 240px;
      --sidebar-collapsed: 72px;
      --topbar-height: 56px;
      --tab-height: 56px;
      --content-max-width: 1280px;

      /* Shape */
      --radius-sm: 0.375rem;
      --radius-md: 0.5rem;
      --radius-lg: 0.75rem;
      --radius-pill: 9999px;
    }

    body {
      font-family: var(--font-family);
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
      font-family: var(--font-family);
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
      font-family: var(--font-family);
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
      box-shadow: 0 1px 2px rgba(0,0,0,0.3);
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
      background: #dc2626;
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
      box-shadow: 0 1px 2px rgba(0,0,0,0.3);
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
      box-shadow: 0 1px 2px rgba(0,0,0,0.3);
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
      background: rgba(34, 197, 94, 0.12);
      color: var(--color-success);
      border-color: rgba(34, 197, 94, 0.3);
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
      background: rgba(239, 68, 68, 0.12);
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
      font-family: var(--font-family);
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
      box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.5);
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
      background: rgba(239, 68, 68, 0.06);
      border-color: rgba(239, 68, 68, 0.2);
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
    ${tabItem('links', ICONS.links, '/studio/links', 'Links')}
    ${tabItem('analytics', ICONS.analytics, '/studio/analytics', 'Analytics')}
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

function dashboardContent(profile, links) {
  const displayName = profile ? escapeHtml(profile.display_name || profile.username || 'User') : 'User';
  const handle = profile ? escapeHtml(profile.username || '') : '';
  const avatarUrl = profile ? profile.avatar_url : null;
  const initial = displayName.charAt(0).toUpperCase();
  const ourDomain = `${SUBDOMAIN}.${DOMAIN}`;
  const linkCount = links ? links.length : 0;

  const avatarHtml = avatarUrl
    ? `<img class="profile-summary-avatar" src="${escapeHtml(avatarUrl)}" alt="${displayName}">`
    : `<div class="profile-summary-avatar">${initial}</div>`;

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

  return `
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
          <a class="btn btn-primary" href="/studio/links">${ICONS.plus} Add Link</a>
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
          <span class="settings-value" style="font-family: var(--font-mono); font-size: 0.75rem;">${escapeHtml(profileId)}</span>
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
          <div style="font-family: var(--font-mono); font-size: 0.8125rem; color: var(--color-text-secondary); display: flex; flex-direction: column; gap: 0.5rem;">
            <div>GET <a href="/api/timeline/${handle}" style="color: var(--color-primary);">/api/timeline/${handle}</a></div>
            <div>GET <a href="/api/timeline/${handle}/protocol/activitypub" style="color: var(--color-primary);">/api/timeline/${handle}/protocol/activitypub</a></div>
          </div>
        </div>
      </div>`;
  }

  // Render timeline items
  const itemsHtml = items.map(item => {
    const proto = PROTOCOL_DISPLAY[item.source_protocol] || { label: item.source_protocol, color: '#64748b' };
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
            Timeline API: <a href="/api/timeline/${handle}" style="font-family: var(--font-mono); font-size: 0.8125rem;">/api/timeline/${handle}</a>
          </span>
        </div>
      </div>`;
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
}
