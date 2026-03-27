// =============================================================================
// Onboarding Routes — Multi-Step SSO Onboarding Wizard (FLOW-006, Phase 1)
// =============================================================================
// GET  /onboarding            — Step 1: Welcome / Choose Property
// GET  /onboarding/method     — Step 2: Sign In Method
// POST /onboarding/method     — Store chosen method in session (via hidden form)
// GET  /onboarding/profile    — Step 3: Profile Creation
// POST /onboarding/profile    — Create Omni-Account (calls existing signup pipeline)
// GET  /onboarding/protocols  — Step 4: Protocol Connections
// GET  /onboarding/complete   — Step 5: You're Ready
//
// Design: Dark theme, centered 480px max-width, progress bar, property-adaptive
// accent colors, mobile-first. Under 5 minutes to complete (CEO mandate).
// Integration: Step 3 calls existing auth signup pipeline. Invite validation
// uses existing lib/invites.js.

import { randomUUID, createHash } from 'node:crypto';
import { pool } from '../db.js';
import {
  html, json, readFormBody, escapeHtml, parseUrl,
  BASE_URL, INSTANCE_DOMAIN,
} from '../lib/helpers.js';
import {
  getSession, setSessionCookie,
  hashPassword,
  checkCsrf,
} from '../lib/session.js';
import { generateNostrKeypair } from '../lib/nostr-crypto.js';
import { provisionEd25519Identity } from '../lib/identity-keys.js';
import { generateAndStoreManifest } from '../lib/manifest.js';
import {
  REGISTRATION_MODE,
  validateInviteCode,
  useInviteCode,
  getUserInviteCodes,
  createInviteCodes,
} from '../lib/invites.js';

// =============================================================================
// Property Definitions
// =============================================================================

const PROPERTIES = {
  'peers.social': {
    id: 'peers.social',
    name: 'peers.social',
    tagline: 'The Creator Network',
    description: 'The social platform for creators. Share your work, build your audience, own your identity.',
    accent: '#8B5CF6',
    accentHover: '#A78BFA',
    accentLight: 'rgba(139, 92, 246, 0.12)',
    gradient: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 50%, #06B6D4 100%)',
    icon: 'M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 3a3 3 0 110 6 3 3 0 010-6zm0 14.5a8.46 8.46 0 01-5.68-2.18C7.06 15.36 9.34 14 12 14s4.94 1.36 5.68 3.32A8.46 8.46 0 0112 19.5z',
    bioPlaceholder: 'Tell the world about your creative work...',
    categories: ['Music', 'Visual Art', 'Film/Video', 'Writing', 'Photography', 'Design', 'Podcasting', 'Gaming', 'Dance', 'Theater', 'Comedy', 'Education'],
  },
  'distributedcreatives.org': {
    id: 'distributedcreatives.org',
    name: 'Distributed Creatives',
    tagline: 'Create Together, Anywhere',
    description: 'Tools for distributed creative work. Collaborate across borders, own your output.',
    accent: '#14B8A6',
    accentHover: '#2DD4BF',
    accentLight: 'rgba(20, 184, 166, 0.12)',
    gradient: 'linear-gradient(135deg, #06B6D4 0%, #14B8A6 50%, #22C55E 100%)',
    icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z',
    bioPlaceholder: 'What do you create and how do you collaborate?',
    categories: ['Music', 'Visual Art', 'Film/Video', 'Writing', 'Photography', 'Design', '3D/VR', 'Animation', 'UX/UI', 'Architecture', 'Podcasting', 'Gaming'],
  },
  'savethecreators.org': {
    id: 'savethecreators.org',
    name: 'Save the Creators',
    tagline: 'Protect What You Create',
    description: 'Advocate for creator rights. Fight for fair compensation and creative freedom.',
    accent: '#F59E0B',
    accentHover: '#FBBF24',
    accentLight: 'rgba(245, 158, 11, 0.12)',
    gradient: 'linear-gradient(135deg, #F59E0B 0%, #F97316 50%, #EF4444 100%)',
    icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
    bioPlaceholder: 'What creator rights matter most to you?',
    categories: ['Music', 'Visual Art', 'Film/Video', 'Writing', 'Photography', 'Policy', 'Advocacy', 'Legal', 'Research', 'Education', 'Podcasting', 'Design'],
  },
  'everarchive.org': {
    id: 'everarchive.org',
    name: 'EverArchive',
    tagline: 'Your Work Lives Forever',
    description: 'Preserve your creative legacy. Archive your work for future generations.',
    accent: '#D4A017',
    accentHover: '#E5B52A',
    accentLight: 'rgba(212, 160, 23, 0.12)',
    gradient: 'linear-gradient(135deg, #D4A017 0%, #B8860B 50%, #8B6914 100%)',
    icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10',
    bioPlaceholder: 'What legacy do you want to preserve?',
    categories: ['Music', 'Visual Art', 'Film/Video', 'Writing', 'Photography', 'Archival', 'Restoration', 'Documentation', 'Oral History', 'Education', 'Design'],
  },
};

const DEFAULT_PROPERTY = PROPERTIES['peers.social'];

function getProperty(id) {
  return PROPERTIES[id] || DEFAULT_PROPERTY;
}

// =============================================================================
// Shared Onboarding CSS
// =============================================================================

function onboardingCss(property) {
  return `
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: var(--font-family-primary);
      background: var(--color-bg-primary);
      color: var(--color-text-primary);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      line-height: var(--line-height-normal);
      -webkit-font-smoothing: antialiased;
    }

    /* Property accent override */
    :root {
      --ob-accent: ${property.accent};
      --ob-accent-hover: ${property.accentHover};
      --ob-accent-light: ${property.accentLight};
      --ob-gradient: ${property.gradient};
    }

    /* Progress bar */
    .progress-bar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 4px;
      background: var(--color-bg-tertiary);
      z-index: 100;
    }
    .progress-fill {
      height: 100%;
      background: var(--ob-accent);
      transition: width var(--duration-normal) var(--easing-default);
      border-radius: 0 var(--radius-pill) var(--radius-pill) 0;
    }

    /* Step indicators */
    .step-indicators {
      display: flex;
      gap: var(--space-2);
      justify-content: center;
      margin-bottom: var(--space-8);
      padding-top: calc(4px + var(--space-6));
    }
    .step-dot {
      width: 32px;
      height: 4px;
      border-radius: var(--radius-pill);
      background: var(--color-border-strong);
      transition: background var(--duration-fast) var(--easing-default);
    }
    .step-dot.active {
      background: var(--ob-accent);
    }
    .step-dot.completed {
      background: var(--color-success);
    }

    /* Main container */
    .ob-container {
      width: 100%;
      max-width: 480px;
      padding: var(--space-4) var(--space-6);
      flex: 1;
      display: flex;
      flex-direction: column;
    }

    .ob-content {
      flex: 1;
    }

    /* Back button */
    .ob-back {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      color: var(--color-text-secondary);
      text-decoration: none;
      font-size: var(--font-size-body-sm);
      margin-bottom: var(--space-6);
      padding: var(--space-2) 0;
      transition: color var(--duration-fast);
    }
    .ob-back:hover { color: var(--color-text-primary); }
    .ob-back svg { width: 16px; height: 16px; }

    /* Headings */
    .ob-heading {
      font-size: var(--font-size-h1);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      margin-bottom: var(--space-2);
      line-height: var(--line-height-tight);
    }
    .ob-subheading {
      font-size: var(--font-size-body);
      color: var(--color-text-secondary);
      margin-bottom: var(--space-8);
      line-height: var(--line-height-relaxed);
    }

    /* Property cards */
    .property-grid {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      margin-bottom: var(--space-8);
    }
    .property-card {
      display: flex;
      align-items: center;
      gap: var(--space-4);
      background: var(--color-bg-secondary);
      border: var(--border-width-default) solid var(--color-border);
      border-radius: var(--radius-lg);
      padding: var(--space-4) var(--space-5);
      cursor: pointer;
      text-decoration: none;
      color: inherit;
      transition: border-color var(--duration-fast), box-shadow var(--duration-fast), transform var(--duration-fast);
    }
    .property-card:hover {
      border-color: var(--color-border-strong);
      box-shadow: var(--shadow-sm);
      transform: translateY(-2px);
    }
    .property-card.selected {
      border-color: var(--ob-accent);
      box-shadow: 0 0 0 1px var(--ob-accent);
    }
    .property-icon {
      width: 48px;
      height: 48px;
      border-radius: var(--radius-md);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .property-icon svg { width: 24px; height: 24px; }
    .property-info { flex: 1; min-width: 0; }
    .property-name {
      font-size: var(--font-size-body);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      margin-bottom: var(--space-1);
    }
    .property-tagline {
      font-size: var(--font-size-body-sm);
      color: var(--color-text-secondary);
    }
    .property-chevron {
      color: var(--color-text-tertiary);
      flex-shrink: 0;
    }

    /* Method cards */
    .method-grid {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      margin-bottom: var(--space-6);
    }
    .method-card {
      display: flex;
      align-items: center;
      gap: var(--space-4);
      background: var(--color-bg-secondary);
      border: var(--border-width-default) solid var(--color-border);
      border-radius: var(--radius-lg);
      padding: var(--space-4) var(--space-5);
      cursor: pointer;
      transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
    }
    .method-card:hover {
      border-color: var(--color-border-strong);
      box-shadow: var(--shadow-sm);
    }
    .method-card.disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .method-card.disabled:hover {
      border-color: var(--color-border);
      box-shadow: none;
    }
    .method-icon {
      width: 40px;
      height: 40px;
      border-radius: var(--radius-md);
      background: var(--color-bg-tertiary);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .method-icon svg { width: 20px; height: 20px; color: var(--color-text-secondary); }
    .method-info { flex: 1; min-width: 0; }
    .method-name {
      font-size: var(--font-size-body);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-primary);
      margin-bottom: 2px;
    }
    .method-desc {
      font-size: var(--font-size-body-sm);
      color: var(--color-text-secondary);
    }
    .method-badge {
      font-size: var(--font-size-overline);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-tertiary);
      border: var(--border-width-default) dashed var(--color-border);
      border-radius: var(--radius-sm);
      padding: 2px 8px;
      text-transform: uppercase;
      letter-spacing: var(--letter-spacing-wide);
    }

    /* Form fields (reuse auth pattern) */
    .form-field {
      margin-bottom: var(--space-5);
    }
    .form-label {
      display: block;
      font-size: var(--font-size-body-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-primary);
      margin-bottom: var(--space-2);
    }
    .form-input {
      width: 100%;
      background: var(--color-bg-tertiary);
      border: var(--border-width-default) solid var(--color-border);
      border-radius: var(--radius-sm);
      padding: var(--space-3) var(--space-4);
      font-size: var(--font-size-body);
      font-family: var(--font-family-primary);
      color: var(--color-text-primary);
      min-height: 44px;
      transition: border-color var(--duration-fast);
    }
    .form-input::placeholder { color: var(--color-text-tertiary); }
    .form-input:hover { border-color: var(--color-border-strong); }
    .form-input:focus {
      outline: none;
      border-color: var(--ob-accent);
      box-shadow: 0 0 0 3px var(--ob-accent-light);
    }
    .form-textarea {
      min-height: 96px;
      resize: vertical;
      line-height: var(--line-height-relaxed);
    }
    .form-hint {
      font-size: var(--font-size-caption);
      color: var(--color-text-tertiary);
      margin-top: var(--space-1);
    }

    /* Category tags */
    .category-grid {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      margin-top: var(--space-2);
    }
    .category-tag {
      display: inline-flex;
      align-items: center;
      padding: var(--space-1) var(--space-3);
      background: var(--color-bg-tertiary);
      border: var(--border-width-default) solid var(--color-border);
      border-radius: var(--radius-pill);
      font-size: var(--font-size-body-sm);
      color: var(--color-text-secondary);
      cursor: pointer;
      transition: all var(--duration-fast);
      user-select: none;
    }
    .category-tag:hover {
      border-color: var(--color-border-strong);
      color: var(--color-text-primary);
    }
    .category-tag input[type="checkbox"] {
      position: absolute;
      opacity: 0;
      width: 0;
      height: 0;
    }
    .category-tag:has(input:checked) {
      background: var(--ob-accent-light);
      border-color: var(--ob-accent);
      color: var(--color-text-primary);
    }

    /* Primary button */
    .btn-primary {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-2);
      font-family: var(--font-family-primary);
      font-size: var(--font-size-body);
      font-weight: var(--font-weight-semibold);
      border: none;
      border-radius: var(--radius-pill);
      cursor: pointer;
      transition: background var(--duration-fast), box-shadow var(--duration-fast), transform var(--duration-instant);
      min-height: 48px;
      padding: var(--space-3) var(--space-6);
      background: var(--ob-accent);
      color: var(--color-text-inverse);
      margin-top: var(--space-4);
      text-decoration: none;
      text-align: center;
    }
    .btn-primary:hover {
      background: var(--ob-accent-hover);
      box-shadow: var(--shadow-sm);
    }
    .btn-primary:active { transform: scale(0.98); }

    /* Secondary button */
    .btn-secondary {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-2);
      font-family: var(--font-family-primary);
      font-size: var(--font-size-body);
      font-weight: var(--font-weight-medium);
      border: var(--border-width-default) solid var(--color-border-strong);
      border-radius: var(--radius-pill);
      cursor: pointer;
      transition: background var(--duration-fast), border-color var(--duration-fast);
      min-height: 48px;
      padding: var(--space-3) var(--space-6);
      background: transparent;
      color: var(--color-text-primary);
      text-decoration: none;
      text-align: center;
    }
    .btn-secondary:hover {
      background: var(--color-bg-hover);
      border-color: var(--color-text-secondary);
    }

    /* Error message */
    .error-message {
      background: var(--color-error-light);
      border: var(--border-width-default) solid var(--color-error);
      border-radius: var(--radius-sm);
      padding: var(--space-3) var(--space-4);
      margin-bottom: var(--space-5);
      font-size: var(--font-size-body-sm);
      color: var(--color-error);
    }

    /* Protocol list */
    .protocol-list {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      margin-bottom: var(--space-8);
    }
    .protocol-item {
      display: flex;
      align-items: center;
      gap: var(--space-4);
      background: var(--color-bg-secondary);
      border: var(--border-width-default) solid var(--color-border);
      border-radius: var(--radius-lg);
      padding: var(--space-4) var(--space-5);
    }
    .protocol-status {
      width: 32px;
      height: 32px;
      border-radius: var(--radius-full);
      background: var(--color-success-light);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .protocol-status svg { width: 16px; height: 16px; color: var(--color-success); }
    .protocol-info { flex: 1; min-width: 0; }
    .protocol-name {
      font-size: var(--font-size-body);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-primary);
      margin-bottom: 2px;
    }
    .protocol-desc {
      font-size: var(--font-size-body-sm);
      color: var(--color-text-secondary);
    }

    /* Complete page */
    .success-icon {
      width: 80px;
      height: 80px;
      border-radius: var(--radius-full);
      background: var(--ob-accent-light);
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto var(--space-6);
      animation: pop-in 0.5s var(--easing-spring);
    }
    .success-icon svg { width: 40px; height: 40px; color: var(--ob-accent); }

    @keyframes pop-in {
      0% { transform: scale(0); opacity: 0; }
      70% { transform: scale(1.1); }
      100% { transform: scale(1); opacity: 1; }
    }

    .profile-url {
      background: var(--color-bg-tertiary);
      border: var(--border-width-default) solid var(--color-border);
      border-radius: var(--radius-md);
      padding: var(--space-4);
      text-align: center;
      font-family: var(--font-family-mono);
      font-size: var(--font-size-body-sm);
      color: var(--ob-accent);
      word-break: break-all;
      margin-bottom: var(--space-6);
    }

    .btn-group {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }

    /* Invite codes section */
    .invite-section {
      background: var(--color-bg-secondary);
      border: var(--border-width-default) solid var(--color-border);
      border-radius: var(--radius-lg);
      padding: var(--space-5);
      margin-bottom: var(--space-6);
    }
    .invite-section h3 {
      font-size: var(--font-size-body);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      margin-bottom: var(--space-3);
    }
    .invite-code {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: var(--color-bg-tertiary);
      border: var(--border-width-default) solid var(--color-border);
      border-radius: var(--radius-sm);
      padding: var(--space-2) var(--space-3);
      margin-bottom: var(--space-2);
      font-family: var(--font-family-mono);
      font-size: var(--font-size-body-sm);
      color: var(--color-text-primary);
    }
    .invite-code button {
      background: none;
      border: none;
      color: var(--color-text-secondary);
      cursor: pointer;
      padding: var(--space-1);
      font-size: var(--font-size-caption);
      font-family: var(--font-family-primary);
    }
    .invite-code button:hover { color: var(--ob-accent); }

    /* Confetti animation */
    .confetti-container {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 99;
      overflow: hidden;
    }
    .confetti {
      position: absolute;
      width: 8px;
      height: 8px;
      top: -10px;
      animation: confetti-fall 3s ease-out forwards;
    }
    .confetti:nth-child(odd) { border-radius: var(--radius-full); }
    .confetti:nth-child(even) { border-radius: 2px; transform: rotate(45deg); }

    @keyframes confetti-fall {
      0% { transform: translateY(0) rotate(0deg); opacity: 1; }
      100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
    }

    /* Responsive */
    @media (max-width: 480px) {
      .ob-container { padding: var(--space-3) var(--space-4); }
      .property-card { padding: var(--space-3) var(--space-4); }
      .method-card { padding: var(--space-3) var(--space-4); }
    }
  `;
}

// =============================================================================
// Helper: HTML Shell
// =============================================================================

function pageShell({ title, property, step, totalSteps, body }) {
  const pct = Math.round((step / totalSteps) * 100);
  const css = onboardingCss(property);

  // Step indicator dots
  let dots = '';
  for (let i = 1; i <= totalSteps; i++) {
    const cls = i < step ? 'step-dot completed' : (i === step ? 'step-dot active' : 'step-dot');
    dots += `<div class="${cls}"></div>`;
  }

  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - ${escapeHtml(property.name)}</title>
  <meta name="robots" content="noindex, nofollow">
  <link rel="stylesheet" href="/static/tokens.css">
  <style>${css}</style>
</head>
<body>
  <div class="progress-bar"><div class="progress-fill" style="width: ${pct}%"></div></div>
  <div class="ob-container">
    <div class="step-indicators">${dots}</div>
    <div class="ob-content">
      ${body}
    </div>
  </div>
</body>
</html>`;
}

// =============================================================================
// Helper: Back link
// =============================================================================

function backLink(href) {
  return `<a class="ob-back" href="${escapeHtml(href)}">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
    Back
  </a>`;
}

// =============================================================================
// Helper: Checkmark SVG
// =============================================================================

const CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';

// =============================================================================
// Step 1: Welcome / Choose Property
// =============================================================================

function step1Html(property, fromParam) {
  // If arriving from a specific property, show that property as selected
  const showSelector = !fromParam;

  let cardsHtml = '';
  for (const [id, prop] of Object.entries(PROPERTIES)) {
    const selected = prop.id === property.id ? ' selected' : '';
    cardsHtml += `
      <a class="property-card${selected}" href="/onboarding/method?property=${encodeURIComponent(id)}">
        <div class="property-icon" style="background: ${prop.accentLight};">
          <svg viewBox="0 0 24 24" fill="none" stroke="${prop.accent}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${prop.icon}"/></svg>
        </div>
        <div class="property-info">
          <div class="property-name">${escapeHtml(prop.name)}</div>
          <div class="property-tagline">${escapeHtml(prop.tagline)}</div>
        </div>
        <div class="property-chevron">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
        </div>
      </a>`;
  }

  if (showSelector) {
    return pageShell({
      title: 'Welcome',
      property,
      step: 1,
      totalSteps: 5,
      body: `
        <h1 class="ob-heading">Welcome to the PeerMesh Network</h1>
        <p class="ob-subheading">One account across all PeerMesh-powered properties. Choose your starting point.</p>
        <div class="property-grid">
          ${cardsHtml}
        </div>
      `,
    });
  }

  // Direct property entry
  return pageShell({
    title: 'Welcome',
    property,
    step: 1,
    totalSteps: 5,
    body: `
      <div style="text-align: center; margin-bottom: var(--space-8);">
        <div class="property-icon" style="background: ${property.accentLight}; width: 64px; height: 64px; margin: 0 auto var(--space-4);">
          <svg viewBox="0 0 24 24" fill="none" stroke="${property.accent}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:32px;height:32px;"><path d="${property.icon}"/></svg>
        </div>
        <h1 class="ob-heading">${escapeHtml(property.name)}</h1>
        <p class="ob-subheading" style="margin-bottom: var(--space-2);">${escapeHtml(property.tagline)}</p>
        <p style="font-size: var(--font-size-body-sm); color: var(--color-text-tertiary);">${escapeHtml(property.description)}</p>
      </div>
      <a class="btn-primary" href="/onboarding/method?property=${encodeURIComponent(property.id)}">Get Started</a>
      <p style="text-align: center; margin-top: var(--space-6); font-size: var(--font-size-body-sm); color: var(--color-text-tertiary);">
        Already have an account? <a href="/login" style="color: var(--ob-accent); text-decoration: none;">Log in</a>
      </p>
    `,
  });
}

// =============================================================================
// Step 2: Sign In Method
// =============================================================================

function step2Html(property, error = '') {
  const errorBlock = error ? `<div class="error-message">${escapeHtml(error)}</div>` : '';
  const isInviteOnly = REGISTRATION_MODE === 'invite-only';

  // Invite code field (shown when invite-only mode is active)
  const inviteFieldHtml = isInviteOnly ? `
    <div class="form-field" style="margin-bottom: var(--space-6);">
      <label class="form-label" for="invite-code">Invite Code</label>
      <input class="form-input" type="text" id="invite-code" name="inviteCode"
             placeholder="PEER-XXXX-XXXX" required autocomplete="off"
             style="text-transform: uppercase; letter-spacing: 0.1em; text-align: center;">
      <div class="form-hint">An invite code is required to create an account</div>
    </div>
  ` : '';

  return pageShell({
    title: 'Choose Sign-In Method',
    property,
    step: 2,
    totalSteps: 5,
    body: `
      ${backLink(`/onboarding?from=${encodeURIComponent(property.id)}`)}
      <h1 class="ob-heading">How would you like to sign up?</h1>
      <p class="ob-subheading">Choose how to create your account on ${escapeHtml(property.name)}.</p>
      ${errorBlock}

      <form method="POST" action="/onboarding/method">
        <input type="hidden" name="property" value="${escapeHtml(property.id)}">
        ${inviteFieldHtml}

        <div class="method-grid">
          <label class="method-card" for="method-email">
            <div class="method-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-8.97 5.7a1.94 1.94 0 01-2.06 0L2 7"/></svg>
            </div>
            <div class="method-info">
              <div class="method-name">Email + Password</div>
              <div class="method-desc">Classic account creation</div>
            </div>
            <input type="radio" name="method" value="email" id="method-email" checked style="width: 18px; height: 18px; accent-color: var(--ob-accent);">
          </label>

          <label class="method-card disabled">
            <div class="method-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 11c0 1.657-1.343 3-3 3s-3-1.343-3-3 1.343-3 3-3 3 1.343 3 3z"/><path d="M2 18.5A5.5 5.5 0 017.5 13h.586a3.978 3.978 0 002.828 0H17.5a5.5 5.5 0 015.5 5.5"/><path d="M15 7a3 3 0 110 6"/></svg>
            </div>
            <div class="method-info">
              <div class="method-name">Passkey (WebAuthn)</div>
              <div class="method-desc">Use your device biometrics</div>
            </div>
            <span class="method-badge">Coming Soon</span>
          </label>

          <label class="method-card disabled">
            <div class="method-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
            </div>
            <div class="method-info">
              <div class="method-name">Existing WebID</div>
              <div class="method-desc">Already have a PeerMesh account</div>
            </div>
            <span class="method-badge">Coming Soon</span>
          </label>
        </div>

        <button class="btn-primary" type="submit">Continue</button>
      </form>
    `,
  });
}

// =============================================================================
// Step 3: Profile Creation
// =============================================================================

function step3Html(property, error = '', prefill = {}) {
  const errorBlock = error ? `<div class="error-message">${escapeHtml(error)}</div>` : '';
  const isInviteOnly = REGISTRATION_MODE === 'invite-only';

  // Category tags
  const categoriesHtml = property.categories.map(cat => {
    const checked = (prefill.categories || []).includes(cat) ? 'checked' : '';
    return `<label class="category-tag"><input type="checkbox" name="categories" value="${escapeHtml(cat)}" ${checked}>${escapeHtml(cat)}</label>`;
  }).join('\n');

  return pageShell({
    title: 'Create Your Profile',
    property,
    step: 3,
    totalSteps: 5,
    body: `
      ${backLink(`/onboarding/method?property=${encodeURIComponent(property.id)}`)}
      <h1 class="ob-heading">Create your profile</h1>
      <p class="ob-subheading">This is how you appear across the PeerMesh network.</p>
      ${errorBlock}

      <form method="POST" action="/onboarding/profile">
        <input type="hidden" name="property" value="${escapeHtml(property.id)}">
        <input type="hidden" name="method" value="${escapeHtml(prefill.method || 'email')}">
        ${prefill.inviteCode ? `<input type="hidden" name="inviteCode" value="${escapeHtml(prefill.inviteCode)}">` : ''}

        <div class="form-field">
          <label class="form-label" for="display-name">Display Name</label>
          <input class="form-input" type="text" id="display-name" name="displayName"
                 placeholder="Your Name" required autofocus
                 value="${escapeHtml(prefill.displayName || '')}">
        </div>

        <div class="form-field">
          <label class="form-label" for="handle">Handle</label>
          <input class="form-input" type="text" id="handle" name="handle"
                 placeholder="your-handle" required pattern="[a-zA-Z0-9_.-]+"
                 title="Letters, numbers, underscores, dots, and hyphens only"
                 value="${escapeHtml(prefill.handle || '')}">
          <div class="form-hint">This becomes your @handle across all protocols</div>
        </div>

        <div class="form-field">
          <label class="form-label" for="email">Email</label>
          <input class="form-input" type="email" id="email" name="email"
                 placeholder="you@example.com" required autocomplete="email"
                 value="${escapeHtml(prefill.email || '')}">
        </div>

        <div class="form-field">
          <label class="form-label" for="password">Password</label>
          <input class="form-input" type="password" id="password" name="password"
                 placeholder="Minimum 8 characters" required minlength="8"
                 autocomplete="new-password">
          <div class="form-hint">At least 8 characters</div>
        </div>

        <div class="form-field">
          <label class="form-label" for="bio">Bio <span style="color: var(--color-text-tertiary); font-weight: var(--font-weight-regular);">(optional)</span></label>
          <textarea class="form-input form-textarea" id="bio" name="bio"
                    placeholder="${escapeHtml(property.bioPlaceholder)}"
                    maxlength="500">${escapeHtml(prefill.bio || '')}</textarea>
          <div class="form-hint">Up to 500 characters</div>
        </div>

        <div class="form-field">
          <label class="form-label">Creative Categories <span style="color: var(--color-text-tertiary); font-weight: var(--font-weight-regular);">(optional)</span></label>
          <div class="category-grid">
            ${categoriesHtml}
          </div>
        </div>

        <button class="btn-primary" type="submit">Create Account</button>
      </form>
    `,
  });
}

// =============================================================================
// Step 4: Protocol Connections
// =============================================================================

function step4Html(property, profile) {
  const protocols = [
    {
      name: 'Fediverse (ActivityPub)',
      desc: `Your posts are visible on Mastodon, PeerTube, Pixelfed, and other Fediverse platforms.`,
      active: !!profile.ap_actor_uri,
    },
    {
      name: 'Bluesky (AT Protocol)',
      desc: `Your profile is discoverable on Bluesky and AT Protocol clients.`,
      active: !!profile.at_did,
    },
    {
      name: 'Nostr',
      desc: `Your posts are visible on Nostr relays and clients.`,
      active: !!profile.nostr_npub,
    },
    {
      name: 'RSS / Atom',
      desc: `Anyone can subscribe to your posts via a feed reader.`,
      active: true,
    },
    {
      name: 'IndieWeb',
      desc: `Your posts support Webmentions and microformats.`,
      active: true,
    },
  ];

  const protocolsHtml = protocols.map(p => `
    <div class="protocol-item">
      <div class="protocol-status">
        ${p.active ? CHECK_SVG : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg>'}
      </div>
      <div class="protocol-info">
        <div class="protocol-name">${escapeHtml(p.name)}</div>
        <div class="protocol-desc">${escapeHtml(p.desc)}</div>
      </div>
    </div>
  `).join('');

  return pageShell({
    title: 'Protocol Connections',
    property,
    step: 4,
    totalSteps: 5,
    body: `
      ${backLink(`/onboarding/profile?property=${encodeURIComponent(property.id)}`)}
      <h1 class="ob-heading">You're connected everywhere</h1>
      <p class="ob-subheading">Your profile is now visible across multiple protocols. All connections are active by default for maximum reach.</p>

      <div class="protocol-list">
        ${protocolsHtml}
      </div>

      <p style="text-align: center; font-size: var(--font-size-body-sm); color: var(--color-text-tertiary); margin-bottom: var(--space-4);">
        You can adjust protocol connections later in Studio Settings.
      </p>

      <a class="btn-primary" href="/onboarding/complete?property=${encodeURIComponent(property.id)}">Continue</a>
    `,
  });
}

// =============================================================================
// Step 5: You're Ready
// =============================================================================

function step5Html(property, profile, inviteCodes = []) {
  const handle = profile.username || profile.handle || '';
  const profileUrl = `${BASE_URL}/@${handle}`;

  // Invite codes section
  let inviteHtml = '';
  if (inviteCodes.length > 0) {
    const codesHtml = inviteCodes.map(c => `
      <div class="invite-code">
        <span>${escapeHtml(c.code)}</span>
        <button type="button" onclick="navigator.clipboard.writeText('${escapeHtml(c.code)}').then(()=>this.textContent='Copied!')">Copy</button>
      </div>
    `).join('');

    inviteHtml = `
      <div class="invite-section">
        <h3>Your Invite Codes</h3>
        <p style="font-size: var(--font-size-body-sm); color: var(--color-text-secondary); margin-bottom: var(--space-3);">Share these with friends to invite them to ${escapeHtml(property.name)}.</p>
        ${codesHtml}
      </div>
    `;
  }

  // Confetti pieces (CSS-only animation)
  const confettiColors = [property.accent, property.accentHover, '#22C55E', '#3B82F6', '#F59E0B', '#EF4444'];
  let confettiHtml = '<div class="confetti-container">';
  for (let i = 0; i < 30; i++) {
    const color = confettiColors[i % confettiColors.length];
    const left = Math.floor(Math.random() * 100);
    const delay = (Math.random() * 2).toFixed(2);
    const size = 6 + Math.floor(Math.random() * 6);
    confettiHtml += `<div class="confetti" style="left:${left}%;animation-delay:${delay}s;width:${size}px;height:${size}px;background:${color};"></div>`;
  }
  confettiHtml += '</div>';

  return pageShell({
    title: "You're Ready!",
    property,
    step: 5,
    totalSteps: 5,
    body: `
      ${confettiHtml}

      <div style="text-align: center;">
        <div class="success-icon">
          ${CHECK_SVG}
        </div>
        <h1 class="ob-heading">You're all set!</h1>
        <p class="ob-subheading">Welcome to ${escapeHtml(property.name)}, <strong>${escapeHtml(profile.display_name || handle)}</strong>. Your Omni-Account is live across the entire PeerMesh network.</p>
      </div>

      <div class="profile-url">${escapeHtml(profileUrl)}</div>

      ${inviteHtml}

      <div class="btn-group">
        <a class="btn-primary" href="/studio">Go to Studio</a>
        <a class="btn-secondary" href="/@${escapeHtml(handle)}" style="width: 100%;">View Your Profile</a>
      </div>
    `,
  });
}

// =============================================================================
// Route Registration
// =============================================================================

export default function registerOnboardingRoutes(routes) {
  // ─── Step 1: GET /onboarding ───
  routes.push({
    method: 'GET',
    pattern: '/onboarding',
    handler: async (req, res) => {
      const { searchParams } = parseUrl(req);
      const from = searchParams.get('from') || '';
      const property = from ? getProperty(from) : DEFAULT_PROPERTY;

      html(res, 200, step1Html(property, from));
    },
  });

  // ─── Step 2: GET /onboarding/method ───
  routes.push({
    method: 'GET',
    pattern: '/onboarding/method',
    handler: async (req, res) => {
      const { searchParams } = parseUrl(req);
      const propertyId = searchParams.get('property') || 'peers.social';
      const property = getProperty(propertyId);

      html(res, 200, step2Html(property));
    },
  });

  // ─── Step 2: POST /onboarding/method (store method, go to step 3) ───
  routes.push({
    method: 'POST',
    pattern: '/onboarding/method',
    handler: async (req, res) => {
      if (!checkCsrf(req)) {
        const property = DEFAULT_PROPERTY;
        return html(res, 403, step2Html(property, 'Invalid request origin.'));
      }

      const body = await readFormBody(req);
      const propertyId = body.property || 'peers.social';
      const property = getProperty(propertyId);
      const method = body.method || 'email';
      const inviteCode = (body.inviteCode || '').trim();

      // Validate invite code if provided (invite-only mode)
      if (REGISTRATION_MODE === 'invite-only' && !inviteCode) {
        return html(res, 400, step2Html(property, 'An invite code is required to create an account.'));
      }

      if (inviteCode) {
        const validation = await validateInviteCode(inviteCode);
        if (!validation.valid) {
          return html(res, 400, step2Html(property, validation.error));
        }
      }

      // For now, only email method is supported
      if (method !== 'email') {
        return html(res, 400, step2Html(property, 'Only email signup is currently available.'));
      }

      // Redirect to step 3 with params
      const params = new URLSearchParams({
        property: propertyId,
        method,
      });
      if (inviteCode) params.set('invite', inviteCode);

      res.writeHead(302, { Location: `/onboarding/profile?${params.toString()}` });
      res.end();
    },
  });

  // ─── Step 3: GET /onboarding/profile ───
  routes.push({
    method: 'GET',
    pattern: '/onboarding/profile',
    handler: async (req, res) => {
      const { searchParams } = parseUrl(req);
      const propertyId = searchParams.get('property') || 'peers.social';
      const property = getProperty(propertyId);
      const method = searchParams.get('method') || 'email';
      const inviteCode = searchParams.get('invite') || '';

      html(res, 200, step3Html(property, '', {
        method,
        inviteCode,
      }));
    },
  });

  // ─── Step 3: POST /onboarding/profile (create account) ───
  routes.push({
    method: 'POST',
    pattern: '/onboarding/profile',
    handler: async (req, res) => {
      if (!checkCsrf(req)) {
        return html(res, 403, step3Html(DEFAULT_PROPERTY, 'Invalid request origin.'));
      }

      const body = await readFormBody(req);
      const propertyId = body.property || 'peers.social';
      const property = getProperty(propertyId);
      const displayName = (body.displayName || '').trim();
      const handle = (body.handle || '').trim().toLowerCase();
      const email = (body.email || '').trim();
      const password = body.password || '';
      const bio = (body.bio || '').trim();
      const inviteCode = (body.inviteCode || '').trim();
      const categories = Array.isArray(body.categories) ? body.categories : (body.categories ? [body.categories] : []);

      const prefill = { displayName, handle, email, bio, method: body.method, inviteCode, categories };

      // ── Invite Code Validation ──
      if (REGISTRATION_MODE === 'invite-only') {
        if (!inviteCode) {
          return html(res, 400, step3Html(property, 'An invite code is required to create an account.', prefill));
        }
        const validation = await validateInviteCode(inviteCode);
        if (!validation.valid) {
          return html(res, 400, step3Html(property, validation.error, prefill));
        }
      } else if (REGISTRATION_MODE === 'open' && inviteCode) {
        const validation = await validateInviteCode(inviteCode);
        if (!validation.valid) {
          return html(res, 400, step3Html(property, validation.error, prefill));
        }
      }

      // ── Field Validation ──
      if (!displayName) {
        return html(res, 400, step3Html(property, 'Display name is required.', prefill));
      }
      if (!handle) {
        return html(res, 400, step3Html(property, 'Handle is required.', prefill));
      }
      if (!/^[a-zA-Z0-9_.-]+$/.test(handle)) {
        return html(res, 400, step3Html(property, 'Handle can only contain letters, numbers, underscores, dots, and hyphens.', prefill));
      }
      if (!email) {
        return html(res, 400, step3Html(property, 'Email is required.', prefill));
      }
      if (password.length < 8) {
        return html(res, 400, step3Html(property, 'Password must be at least 8 characters.', prefill));
      }

      // ── Check handle/username uniqueness ──
      const existingProfile = await pool.query(
        'SELECT id FROM social_profiles.profile_index WHERE username = $1',
        [handle]
      );
      if (existingProfile.rowCount > 0) {
        return html(res, 409, step3Html(property, 'That handle is already taken. Choose another.', prefill));
      }

      // Use handle as auth username too (simplify for onboarding)
      const existingAuth = await pool.query(
        'SELECT id FROM social_profiles.auth WHERE username = $1',
        [handle]
      );
      if (existingAuth.rowCount > 0) {
        return html(res, 409, step3Html(property, 'That handle is already taken. Choose another.', prefill));
      }

      // ── Omni-Account Creation Pipeline (mirrors auth.js POST /signup) ──
      const profileId = randomUUID();
      const webid = `${BASE_URL}/profile/${profileId}#me`;
      const omniAccountId = `urn:peermesh:omni:${profileId}`;
      const sourcePodUri = `${BASE_URL}/pod/${profileId}/`;
      const ourDomain = INSTANCE_DOMAIN;

      // Generate Nostr keypair
      let nostrNpub = null;
      let nostrKeypair = null;
      try {
        nostrKeypair = generateNostrKeypair();
        nostrNpub = nostrKeypair.npub;
      } catch (err) {
        console.error(`[onboarding] Nostr keypair generation failed:`, err.message);
      }

      // Generate AT Protocol DID
      const atDid = `did:web:${ourDomain}:ap:actor:${handle}`;

      // Generate DSNP User ID stub
      let dsnpUserId = null;
      try {
        const dsnpHash = createHash('sha256').update(omniAccountId).digest('hex');
        dsnpUserId = String(parseInt(dsnpHash.slice(0, 8), 16)).padStart(8, '0');
      } catch (err) {
        console.error(`[onboarding] DSNP ID generation failed:`, err.message);
      }

      // Generate Zot channel hash stub
      let zotChannelHash = null;
      try {
        zotChannelHash = createHash('sha256').update(`zot:${omniAccountId}`).digest('hex');
      } catch (err) {
        console.error(`[onboarding] Zot hash generation failed:`, err.message);
      }

      // Hash password
      const passwordHash = await hashPassword(password);

      try {
        // Create profile with bio and categories from onboarding
        await pool.query(
          `INSERT INTO social_profiles.profile_index
             (id, webid, omni_account_id, display_name, username, bio, avatar_url, source_pod_uri, nostr_npub, at_did, dsnp_user_id, zot_channel_hash)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [profileId, webid, omniAccountId, displayName, handle, bio || null, null, sourcePodUri, nostrNpub, atDid, dsnpUserId, zotChannelHash]
        );

        // Create auth record (use handle as username for streamlined onboarding)
        await pool.query(
          `INSERT INTO social_profiles.auth (profile_id, username, password_hash)
           VALUES ($1, $2, $3)`,
          [profileId, handle, passwordHash]
        );

        // Store Nostr key metadata
        if (nostrKeypair) {
          const pubkeyHash = createHash('sha256').update(nostrKeypair.pubkeyHex).digest('hex');
          try {
            await pool.query(
              `INSERT INTO social_keys.key_metadata
                 (id, omni_account_id, protocol, key_type, public_key_hash, key_purpose, is_active)
               VALUES ($1, $2, 'nostr', 'secp256k1', $3, 'signing', TRUE)`,
              [randomUUID(), omniAccountId, pubkeyHash]
            );
            await pool.query(
              `INSERT INTO social_keys.key_metadata
                 (id, omni_account_id, protocol, key_type, public_key_hash, key_purpose, is_active)
               VALUES ($1, $2, 'nostr', 'secp256k1-nsec', $3, 'signing-private', TRUE)`,
              [randomUUID(), omniAccountId, nostrKeypair.privkeyHex]
            );
          } catch (err) {
            console.error(`[onboarding] Nostr key storage failed:`, err.message);
          }
        }

        // Generate AP actor keys (RSA 2048)
        try {
          const { generateKeyPairSync } = await import('node:crypto');
          const { publicKey, privateKey } = generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
          });

          const actorUri = `${BASE_URL}/ap/actor/${handle}`;
          const keyId = `${actorUri}#main-key`;
          const apActorId = randomUUID();

          await pool.query(
            `INSERT INTO social_federation.ap_actors
               (id, webid, actor_uri, inbox_uri, outbox_uri, public_key_pem, private_key_pem, key_id, protocol, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'activitypub', 'active')`,
            [apActorId, webid, actorUri, `${actorUri}/inbox`, `${BASE_URL}/ap/outbox/${handle}`,
             publicKey, privateKey, keyId]
          );

          await pool.query(
            'UPDATE social_profiles.profile_index SET ap_actor_uri = $1 WHERE id = $2',
            [actorUri, profileId]
          );
        } catch (err) {
          console.error(`[onboarding] AP actor generation failed:`, err.message);
        }

        // Generate Ed25519 identity keypair + manifest
        try {
          const ed25519Result = await provisionEd25519Identity(omniAccountId);
          const freshProfile = await pool.query(
            `SELECT id, webid, omni_account_id, display_name, username, bio,
                    avatar_url, banner_url, homepage_url, source_pod_uri,
                    nostr_npub, at_did, ap_actor_uri, dsnp_user_id,
                    zot_channel_hash, matrix_id
             FROM social_profiles.profile_index WHERE id = $1`,
            [profileId]
          );
          if (freshProfile.rowCount > 0) {
            await generateAndStoreManifest(freshProfile.rows[0], {
              publicKeySpkiB64: ed25519Result.publicKeySpkiB64,
              privateKeyPem: ed25519Result.privateKeyPem,
            });
          }
        } catch (err) {
          console.error(`[onboarding] Ed25519/Manifest generation failed:`, err.message);
        }

        console.log(`[onboarding] Account created: @${handle} (profile: ${profileId}, property: ${propertyId})`);

        // ── Invite Code Redemption ──
        if (inviteCode) {
          try {
            const redeemResult = await useInviteCode(inviteCode, webid);
            if (redeemResult.success) {
              console.log(`[onboarding] Invite code ${inviteCode} redeemed for @${handle}`);
            } else {
              console.warn(`[onboarding] Invite code redemption issue: ${redeemResult.error}`);
            }
          } catch (err) {
            console.error(`[onboarding] Invite code redemption failed:`, err.message);
          }
        }

        // ── Generate invite codes for the new user ──
        try {
          await createInviteCodes(webid, 5);
          console.log(`[onboarding] Generated 5 invite codes for @${handle}`);
        } catch (err) {
          console.error(`[onboarding] Invite code generation failed:`, err.message);
        }

        // ── Set session and redirect to Step 4 ──
        const cookie = setSessionCookie({ profileId, username: handle });
        res.writeHead(302, {
          Location: `/onboarding/protocols?property=${encodeURIComponent(propertyId)}`,
          'Set-Cookie': cookie,
        });
        res.end();
      } catch (err) {
        console.error(`[onboarding] Account creation failed:`, err.message);
        if (err.code === '23505') {
          return html(res, 409, step3Html(property, 'That handle or email is already taken.', prefill));
        }
        return html(res, 500, step3Html(property, 'Account creation failed. Please try again.', prefill));
      }
    },
  });

  // ─── Step 4: GET /onboarding/protocols ───
  routes.push({
    method: 'GET',
    pattern: '/onboarding/protocols',
    handler: async (req, res) => {
      const session = getSession(req);
      if (!session) {
        res.writeHead(302, { Location: '/onboarding' });
        res.end();
        return;
      }

      const { searchParams } = parseUrl(req);
      const propertyId = searchParams.get('property') || 'peers.social';
      const property = getProperty(propertyId);

      // Fetch profile for protocol status
      const profileResult = await pool.query(
        `SELECT id, webid, display_name, username, bio, ap_actor_uri, at_did, nostr_npub
         FROM social_profiles.profile_index WHERE id = $1`,
        [session.profileId]
      );

      if (profileResult.rowCount === 0) {
        res.writeHead(302, { Location: '/onboarding' });
        res.end();
        return;
      }

      html(res, 200, step4Html(property, profileResult.rows[0]));
    },
  });

  // ─── Step 5: GET /onboarding/complete ───
  routes.push({
    method: 'GET',
    pattern: '/onboarding/complete',
    handler: async (req, res) => {
      const session = getSession(req);
      if (!session) {
        res.writeHead(302, { Location: '/onboarding' });
        res.end();
        return;
      }

      const { searchParams } = parseUrl(req);
      const propertyId = searchParams.get('property') || 'peers.social';
      const property = getProperty(propertyId);

      // Fetch profile
      const profileResult = await pool.query(
        `SELECT id, webid, display_name, username
         FROM social_profiles.profile_index WHERE id = $1`,
        [session.profileId]
      );

      if (profileResult.rowCount === 0) {
        res.writeHead(302, { Location: '/onboarding' });
        res.end();
        return;
      }

      const profile = profileResult.rows[0];

      // Fetch user's invite codes
      let inviteCodes = [];
      try {
        inviteCodes = await getUserInviteCodes(profile.webid);
        // Show only active codes
        inviteCodes = inviteCodes.filter(c => c.status === 'active');
      } catch (err) {
        console.error(`[onboarding] Invite code fetch failed:`, err.message);
      }

      html(res, 200, step5Html(property, profile, inviteCodes));
    },
  });
}
