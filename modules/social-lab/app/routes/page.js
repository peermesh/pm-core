// =============================================================================
// Profile Page Route — GET /@:handle
// =============================================================================
// Public profile page with content negotiation.
// If Accept header contains application/activity+json, redirect to AP actor.
// Otherwise, serve the HTML profile page.

import { pool } from '../db.js';
import {
  html, escapeHtml, lookupProfileByHandle, getBioLinks,
  BASE_URL, VERSION, INSTANCE_DOMAIN,
} from '../lib/helpers.js';

/**
 * Fetch recent posts for a profile (up to 20, newest first).
 * Returns empty array if posts table doesn't exist yet.
 */
async function getRecentPosts(webid) {
  try {
    const result = await pool.query(
      `SELECT p.id, p.content_text, p.content_html, p.media_urls, p.created_at,
              p.group_id, g.name AS group_name
       FROM social_profiles.posts p
       LEFT JOIN social_profiles.groups g ON g.id = p.group_id
       WHERE p.webid = $1
       ORDER BY p.created_at DESC
       LIMIT 20`,
      [webid]
    );
    return result.rows;
  } catch {
    return [];
  }
}

/**
 * Fetch distribution badges for a set of post IDs.
 * Returns a map: postId -> [{ protocol, status }]
 */
async function getPostDistributions(postIds) {
  if (postIds.length === 0) return {};
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
  } catch {
    return {};
  }
}

/**
 * Render an SVG icon for a link based on its identifier.
 */
function linkIcon(identifier) {
  const icons = {
    github: '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>',
    mastodon: '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M23.268 5.313c-.35-2.578-2.617-4.61-5.304-5.004C17.51.242 15.792 0 11.813 0h-.03c-3.98 0-4.835.242-5.288.309C3.882.692 1.496 2.518.917 5.127.64 6.412.61 7.837.661 9.143c.074 1.874.088 3.745.26 5.611.118 1.24.325 2.47.62 3.68.55 2.237 2.777 4.098 4.96 4.857 2.336.792 4.849.923 7.256.38.265-.061.527-.132.786-.213.585-.184 1.27-.39 1.774-.753a.057.057 0 00.023-.043v-1.809a.052.052 0 00-.02-.041.053.053 0 00-.046-.01 20.282 20.282 0 01-4.709.547c-2.73 0-3.463-1.284-3.674-1.818a5.593 5.593 0 01-.319-1.433.053.053 0 01.066-.054 19.648 19.648 0 004.622.544h.338c1.609-.005 3.23-.072 4.812-.34 .046-.008.09-.017.135-.026 2.435-.464 4.753-1.92 4.989-5.604.008-.145.03-1.52.03-1.67.002-.512.167-3.63-.024-5.545zM19.903 12.07H16.7v4.732c0 1.103-.587 1.66-1.607 1.66-1.193 0-1.76-.908-1.76-2.247V12.07h-3.158v4.145c0 1.338-.567 2.247-1.76 2.247-1.02 0-1.607-.557-1.607-1.66V12.07H3.608c0 1.545.003 3.09.28 4.573.277 1.486 1.246 2.39 3.112 2.39 1.483 0 2.523-.632 3-1.896l.066-.144.065.144c.477 1.264 1.517 1.896 3 1.896 1.867 0 2.836-.904 3.113-2.39.276-1.483.28-3.028.28-4.573h.38z"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>',
    twitter: '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
    linkedin: '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>',
    email: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 4l-10 8L2 4"/></svg>',
  };
  return icons[identifier] || icons.globe;
}

/**
 * Generate the public profile page HTML.
 */
/**
 * Format a date as a relative time string (e.g., "2 hours ago").
 */
function formatTimeAgo(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function profilePageHtml(profile, links, posts, distributions, userGroups = []) {
  const displayName = escapeHtml(profile.display_name || profile.username);
  const handle = escapeHtml(profile.username);
  const bio = escapeHtml(profile.bio || '');
  const avatarUrl = profile.avatar_url;
  const bannerUrl = profile.banner_url;
  const ourDomain = INSTANCE_DOMAIN;

  const profileUrl = `${BASE_URL}/@${handle}`;

  // Build banner section
  const bannerHtml = bannerUrl
    ? `<div class="profile-banner-image" style="background-image: url('${escapeHtml(bannerUrl)}')"></div>`
    : '';

  // Build avatar section
  const avatarHtml = avatarUrl
    ? `<img class="avatar u-photo" src="${escapeHtml(avatarUrl)}" alt="${displayName}" width="120" height="120">`
    : `<div class="avatar avatar-placeholder">${displayName.charAt(0).toUpperCase()}</div>`;

  // Build links section
  let linksHtml = '';
  let hFeedHtml = '';
  if (links.length > 0) {
    linksHtml = links.map(link => {
      const icon = linkIcon(link.identifier);
      return `<a class="bio-link u-url" href="${escapeHtml(link.url)}" target="_blank" rel="me noopener noreferrer">
        <span class="bio-link-icon">${icon}</span>
        <span class="bio-link-label">${escapeHtml(link.label)}</span>
      </a>`;
    }).join('\n          ');

    const hEntries = links.map(link => {
      return `        <div class="h-entry h-cite">
          <a class="u-url p-name" href="${escapeHtml(link.url)}" rel="me">${escapeHtml(link.label)}</a>
          <span class="p-author h-card" style="display:none">
            <a class="u-url p-name" href="${escapeHtml(profileUrl)}">${displayName}</a>
          </span>
        </div>`;
    }).join('\n');

    hFeedHtml = `
    <div class="h-feed">
      <h2 class="p-name" style="display:none">Links by ${displayName}</h2>
${hEntries}
    </div>`;
  }

  // Build posts section
  let postsHtml = '';
  if (posts && posts.length > 0) {
    const postCards = posts.map(post => {
      const postUrl = `${BASE_URL}/@${handle}/post/${post.id}`;
      const content = post.content_html || escapeHtml(post.content_text);
      const timeAgo = formatTimeAgo(new Date(post.created_at));
      const isoDate = new Date(post.created_at).toISOString();

      // Distribution badges
      const dists = distributions[post.id] || [];
      let badgesHtml = '';
      if (dists.length > 0) {
        const badges = dists.map(d => {
          const statusClass = d.status === 'sent' ? 'dist-badge-sent'
            : d.status === 'pending' ? 'dist-badge-pending'
            : d.status === 'failed' ? 'dist-badge-failed' : '';
          return `<span class="dist-badge ${statusClass}">${escapeHtml(d.protocol)}</span>`;
        }).join('');
        badgesHtml = `<span class="post-dist-badges">${badges}</span>`;
      }

      // Group context badge
      const groupBadge = post.group_name
        ? `<span class="dist-badge" style="background:var(--color-accent)22;color:var(--color-accent);border-color:var(--color-accent)44;">in ${escapeHtml(post.group_name)}</span>`
        : '';

      return `      <article class="post-card h-entry">
        <div class="post-content e-content">${content}</div>
        <div class="post-meta">
          <span class="post-time"><a href="${escapeHtml(postUrl)}" class="u-url"><time class="dt-published" datetime="${isoDate}">${timeAgo}</time></a></span>
          ${groupBadge}
          ${badgesHtml}
        </div>
      </article>`;
    }).join('\n');

    postsHtml = `
    <section class="profile-posts" aria-label="Posts">
      <h2 class="posts-heading">Posts</h2>
${postCards}
    </section>`;
  }

  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${displayName} - PeerMesh Social Lab</title>
  <meta name="description" content="${bio || displayName + ' on PeerMesh Social Lab'}">
  <link rel="alternate" type="application/activity+json" href="${BASE_URL}/ap/actor/${handle}">
  <link rel="alternate" type="application/rss+xml" title="RSS" href="${BASE_URL}/@${handle}/feed.xml">
  <link rel="alternate" type="application/atom+xml" title="Atom" href="${BASE_URL}/@${handle}/feed.atom">
  <link rel="alternate" type="application/feed+json" title="JSON Feed" href="${BASE_URL}/@${handle}/feed.json">
  <link rel="webmention" href="${BASE_URL}/webmention">
  <link rel="indieauth-metadata" href="${BASE_URL}/.well-known/oauth-authorization-server">
  <link rel="stylesheet" href="/static/tokens.css">
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

    :root {
      --profile-bg-color: var(--color-bg-primary);
      --profile-surface-color: var(--color-bg-secondary);
      --profile-border-color: var(--color-border);
      --profile-text-color: var(--color-text-primary);
      --profile-text-muted: var(--color-text-secondary);
      --profile-accent-color: var(--color-primary);
      --profile-accent-hover: var(--color-primary-hover);
      --profile-link-bg: var(--color-bg-secondary);
      --profile-link-text: var(--color-text-primary);
      --profile-link-radius: var(--radius-lg);
      --profile-font-family: var(--font-family-primary);
      --profile-avatar-size: 120px;
      --profile-avatar-radius: var(--radius-full);
    }

    body {
      font-family: var(--profile-font-family);
      background: var(--profile-bg-color);
      color: var(--profile-text-color);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    main {
      width: 100%;
      max-width: 680px;
      padding: 2rem 1.5rem;
      flex: 1;
    }

    /* Banner Image */
    .profile-banner-image {
      width: 100%;
      height: 200px;
      background-size: cover;
      background-position: center;
      border-radius: var(--radius-lg);
      margin-bottom: -60px;
    }
    /* Banner Section */
    .profile-banner {
      text-align: center;
      padding: 2rem 0 1.5rem;
    }

    .has-banner .profile-banner {
      padding-top: 0;
    }

    .avatar {
      width: var(--profile-avatar-size);
      height: var(--profile-avatar-size);
      border-radius: var(--profile-avatar-radius);
      object-fit: cover;
      border: 3px solid var(--profile-border-color);
      margin: 0 auto 1.25rem;
      display: block;
    }

    .avatar-placeholder {
      background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-accent) 100%);
      color: var(--color-text-inverse);
      font-size: 3rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
    }

    .display-name {
      font-size: clamp(1.5rem, 4vw, 2rem);
      font-weight: 700;
      color: var(--profile-text-color);
      margin-bottom: 0.25rem;
    }

    .handle {
      font-size: 0.95rem;
      color: var(--profile-accent-color);
      margin-bottom: 0.75rem;
    }

    .bio {
      font-size: 1rem;
      color: var(--profile-text-muted);
      max-width: 480px;
      margin: 0 auto;
      line-height: 1.6;
    }

    /* Links Section */
    .profile-links {
      padding: 1.5rem 0;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .bio-link {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.875rem 1.25rem;
      background: var(--profile-link-bg);
      border: 1px solid var(--profile-border-color);
      border-radius: var(--profile-link-radius);
      color: var(--profile-link-text);
      text-decoration: none;
      font-size: 0.95rem;
      font-weight: 500;
      transition: border-color 0.2s ease, background 0.2s ease, transform 0.15s ease;
      min-height: 52px;
    }

    .bio-link:hover, .bio-link:focus {
      border-color: var(--profile-accent-color);
      background: var(--color-primary-light);
      transform: translateY(-1px);
      outline: none;
    }

    .bio-link:active {
      transform: translateY(0);
    }

    .bio-link-icon {
      display: flex;
      align-items: center;
      color: var(--profile-accent-color);
      flex-shrink: 0;
    }

    .bio-link-label {
      flex: 1;
    }

    .bio-link-arrow {
      color: var(--profile-text-muted);
    }

    /* Plugin Slot */
    #pms-plugin-slot {
      display: none;
    }

    #pms-plugin-slot:not(:empty) {
      display: block;
      padding: 1rem 0;
    }

    /* Protocol Badges */
    .profile-protocols {
      padding: 1.5rem 0;
      border-top: 1px solid var(--profile-border-color);
      display: flex;
      justify-content: center;
      gap: 1rem;
      flex-wrap: wrap;
    }

    .protocol-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.375rem 0.75rem;
      background: var(--profile-surface-color);
      border: 1px solid var(--profile-border-color);
      border-radius: var(--radius-pill);
      color: var(--profile-text-muted);
      font-size: 0.8rem;
      text-decoration: none;
      transition: border-color 0.2s ease, color 0.2s ease;
    }

    .protocol-badge:hover {
      border-color: var(--profile-accent-color);
      color: var(--profile-accent-color);
    }

    .protocol-badge svg {
      width: 16px;
      height: 16px;
    }

    .protocol-badge-active {
      color: var(--color-success);
      border-color: var(--color-success);
    }

    .protocol-badge-active:hover {
      color: var(--color-success);
      border-color: var(--color-success);
    }

    /* Federation Footer */
    .federation-footer {
      text-align: center;
      padding: 1.5rem 0 2rem;
      color: var(--profile-text-muted);
      font-size: 0.8rem;
      line-height: 1.6;
    }

    .federation-footer a {
      color: var(--profile-accent-color);
      text-decoration: none;
    }

    .federation-footer a:hover {
      text-decoration: underline;
    }

    .powered-by {
      margin-top: 0.75rem;
      color: var(--color-text-tertiary);
      font-size: 0.75rem;
    }

    /* Posts Section */
    .profile-posts {
      padding: 1.5rem 0;
      border-top: 1px solid var(--profile-border-color);
    }

    .posts-heading {
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--profile-text-color);
      margin-bottom: 1rem;
    }

    .post-card {
      background: var(--profile-surface-color);
      border: 1px solid var(--profile-border-color);
      border-radius: var(--radius-lg);
      padding: var(--space-4) var(--space-5);
      margin-bottom: 0.75rem;
    }

    .post-content {
      font-size: 0.95rem;
      line-height: 1.6;
      color: var(--profile-text-color);
      white-space: pre-wrap;
      word-break: break-word;
    }

    .post-meta {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-top: 0.75rem;
      flex-wrap: wrap;
    }

    .post-time {
      font-size: 0.8rem;
      color: var(--profile-text-muted);
    }

    .post-time a {
      color: var(--profile-text-muted);
      text-decoration: none;
    }

    .post-time a:hover {
      color: var(--profile-accent-color);
      text-decoration: underline;
    }

    .post-dist-badges {
      display: flex;
      gap: 0.4rem;
      flex-wrap: wrap;
    }

    .dist-badge {
      display: inline-block;
      padding: 0.15rem 0.45rem;
      border-radius: var(--radius-pill);
      font-size: 0.7rem;
      font-weight: 500;
      border: 1px solid var(--profile-border-color);
      color: var(--profile-text-muted);
    }

    .dist-badge-sent {
      color: var(--color-success);
      border-color: var(--color-success-light);
    }

    .dist-badge-pending {
      color: var(--color-warning);
      border-color: var(--color-warning-light);
    }

    .dist-badge-failed {
      color: var(--color-error);
      border-color: var(--color-error-light);
    }

    /* Responsive */
    @media (max-width: 480px) {
      main { padding: 1.5rem 1rem; }
      .profile-banner { padding: 1rem 0 1rem; }
      :root { --profile-avatar-size: 96px; }
      .bio-link { padding: 0.75rem 1rem; }
      .post-card { padding: 0.875rem 1rem; }
    }

    @media (min-width: 1024px) {
      main { padding: 3rem 2rem; }
      .profile-banner { padding: 2.5rem 0 2rem; }
    }

    @media (prefers-reduced-motion: reduce) {
      .bio-link { transition: none; }
      .protocol-badge { transition: none; }
    }
  </style>
</head>
<body>
  <main class="profile-page${bannerUrl ? ' has-banner' : ''}">
    ${bannerHtml}
    <!-- h-card: Microformats2 profile markup (F-008-MF-1, F-008-MF-7) -->
    <div class="h-card">
    <section class="profile-banner" aria-label="Profile information">
      ${avatarHtml}
      <h1 class="display-name p-name">${displayName}</h1>
      <p class="handle">@${handle}@${ourDomain}</p>
      ${bio ? `<p class="bio p-note">${bio}</p>` : ''}
      ${userGroups.length > 0 ? `<div class="profile-groups" style="display:flex;flex-wrap:wrap;gap:0.375rem;margin-top:0.75rem;justify-content:center;">
        ${userGroups.map(g => {
          const typeColors = { ecosystem: 'var(--color-violet-500)', platform: 'var(--color-cyan-500)', category: 'var(--color-amber-500)', topic: 'var(--color-green-500)', user: 'var(--color-accent)', custom: 'var(--color-text-tertiary)' };
          const color = typeColors[g.type] || 'var(--color-text-tertiary)';
          return `<span style="display:inline-flex;align-items:center;gap:0.25rem;padding:0.2rem 0.6rem;border-radius:9999px;font-size:0.6875rem;font-weight:500;background:${color}18;color:${color};border:1px solid ${color}33;">${escapeHtml(g.name)}</span>`;
        }).join('')}
      </div>` : ''}
      <a class="u-url u-uid" href="${escapeHtml(profileUrl)}" style="display:none">${escapeHtml(profileUrl)}</a>
    </section>

    ${links.length > 0 ? `<nav class="profile-links" aria-label="Links">
          ${linksHtml}
        </nav>` : ''}
    </div>
    <!-- end h-card -->

    <!-- h-feed: Microformats2 content stream (F-008-MF-3) -->
    ${hFeedHtml}

    ${postsHtml}

    <div id="pms-plugin-slot"></div>

    <footer class="profile-protocols" aria-label="Federation protocols">
      <a class="protocol-badge protocol-badge-active" href="${BASE_URL}/ap/actor/${handle}" title="ActivityPub - Fediverse">
        <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><line x1="8" y1="7" x2="16" y2="7" stroke="currentColor" stroke-width="1.5"/><line x1="7" y1="8" x2="11" y2="16.5" stroke="currentColor" stroke-width="1.5"/><line x1="17" y1="8" x2="13" y2="16.5" stroke="currentColor" stroke-width="1.5"/></svg>
        ActivityPub
      </a>
      <a class="protocol-badge protocol-badge-active" href="${BASE_URL}/webmention" title="Webmention - IndieWeb">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
        Webmention
      </a>
      ${profile.nostr_npub ? `<a class="protocol-badge protocol-badge-active" href="${BASE_URL}/api/nostr/profile/${handle}" title="Nostr - ${escapeHtml(profile.nostr_npub)}">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>
        Nostr
      </a>` : `<span class="protocol-badge" title="Nostr - Coming Soon">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>
        Nostr
      </span>`}
      ${profile.at_did ? `<a class="protocol-badge protocol-badge-active" href="${BASE_URL}/ap/actor/${handle}/did.json" title="AT Protocol - ${escapeHtml(profile.at_did)}">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15h-2v-2h2v2zm4 0h-2v-2h2v2zm-2-4h-2v-6h2v6z"/></svg>
        AT Protocol
      </a>` : `<span class="protocol-badge" title="AT Protocol - Coming Soon">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15h-2v-2h2v2zm4 0h-2v-2h2v2zm-2-4h-2v-6h2v6z"/></svg>
        AT Protocol
      </span>`}
      ${profile.matrix_id ? `<a class="protocol-badge protocol-badge-active" href="matrix:u/${escapeHtml(handle)}:${ourDomain}" title="Matrix - ${escapeHtml(profile.matrix_id)}">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M.632.55v22.9H2.28V24H0V0h2.28v.55zm7.043 7.26v1.157h.033c.309-.443.683-.784 1.117-1.024.433-.245.936-.365 1.5-.365.54 0 1.033.107 1.488.323.45.214.773.553.96 1.016.293-.46.662-.818 1.116-1.068.45-.249.96-.375 1.524-.375.424 0 .82.058 1.185.175.365.117.675.29.924.52.247.226.44.518.577.876.135.353.203.76.203 1.22v5.96H15.66v-5.39c0-.282-.012-.543-.037-.784a1.457 1.457 0 00-.173-.612.89.89 0 00-.396-.396c-.17-.093-.393-.14-.672-.14-.282 0-.513.055-.696.166a1.247 1.247 0 00-.446.43 1.81 1.81 0 00-.232.603 3.2 3.2 0 00-.065.67v5.454H11.31v-5.284c0-.26-.008-.51-.025-.752a1.647 1.647 0 00-.14-.637.925.925 0 00-.367-.42c-.163-.105-.393-.157-.692-.157-.097 0-.224.025-.38.074a1.26 1.26 0 00-.416.238 1.365 1.365 0 00-.334.456c-.092.19-.138.44-.138.748v5.734H7.187V7.81h.488zM23.37.55V24H21.72v-.55H24V.55h-2.28V0h2.28v.55z"/></svg>
        Matrix
      </a>` : `<span class="protocol-badge" title="Matrix - Coming Soon">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M.632.55v22.9H2.28V24H0V0h2.28v.55zm7.043 7.26v1.157h.033c.309-.443.683-.784 1.117-1.024.433-.245.936-.365 1.5-.365.54 0 1.033.107 1.488.323.45.214.773.553.96 1.016.293-.46.662-.818 1.116-1.068.45-.249.96-.375 1.524-.375.424 0 .82.058 1.185.175.365.117.675.29.924.52.247.226.44.518.577.876.135.353.203.76.203 1.22v5.96H15.66v-5.39c0-.282-.012-.543-.037-.784a1.457 1.457 0 00-.173-.612.89.89 0 00-.396-.396c-.17-.093-.393-.14-.672-.14-.282 0-.513.055-.696.166a1.247 1.247 0 00-.446.43 1.81 1.81 0 00-.232.603 3.2 3.2 0 00-.065.67v5.454H11.31v-5.284c0-.26-.008-.51-.025-.752a1.647 1.647 0 00-.14-.637.925.925 0 00-.367-.42c-.163-.105-.393-.157-.692-.157-.097 0-.224.025-.38.074a1.26 1.26 0 00-.416.238 1.365 1.365 0 00-.334.456c-.092.19-.138.44-.138.748v5.734H7.187V7.81h.488zM23.37.55V24H21.72v-.55H24V.55h-2.28V0h2.28v.55z"/></svg>
        Matrix
      </span>`}
      ${profile.xmtp_address ? `<a class="protocol-badge protocol-badge-active" href="#" title="XMTP - ${escapeHtml(profile.xmtp_address)}">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-1 14H5c-.55 0-1-.45-1-1V8l6.94 4.34c.65.41 1.47.41 2.12 0L20 8v9c0 .55-.45 1-1 1zm-7-7.46L4.89 6h14.22L12 10.54z"/></svg>
        XMTP
      </a>` : `<span class="protocol-badge" title="XMTP - Coming Soon">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-1 14H5c-.55 0-1-.45-1-1V8l6.94 4.34c.65.41 1.47.41 2.12 0L20 8v9c0 .55-.45 1-1 1zm-7-7.46L4.89 6h14.22L12 10.54z"/></svg>
        XMTP
      </span>`}
      ${profile.dsnp_user_id ? `<a class="protocol-badge protocol-badge-active" href="${BASE_URL}/api/dsnp/profile/${handle}" title="DSNP - User ID: ${escapeHtml(profile.dsnp_user_id)}">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
        DSNP
      </a>` : `<span class="protocol-badge" title="DSNP - Coming Soon">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
        DSNP
      </span>`}
      ${profile.zot_channel_hash ? `<a class="protocol-badge protocol-badge-active" href="${BASE_URL}/api/zot/channel/${handle}" title="Zot - ${escapeHtml(profile.zot_channel_hash.slice(0, 12))}...">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zM5 15h14v2H5zm0-4h14v2H5zm0-4h14v2H5z"/></svg>
        Zot
      </a>` : `<span class="protocol-badge" title="Zot - Coming Soon">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zM5 15h14v2H5zm0-4h14v2H5zm0-4h14v2H5z"/></svg>
        Zot
      </span>`}
      <span class="protocol-badge" title="Hypercore - Coming Soon (P2P append-only log, ed25519)">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L4 7v10l8 5 8-5V7l-8-5zm0 2.18L18 8v8l-6 3.82L6 16V8l6-3.82z"/><path d="M12 8v8l4-4-4-4z"/></svg>
        Hypercore
      </span>
      <span class="protocol-badge" title="Braid - Coming Soon (IETF draft, HTTP version sync)">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4c0 0 2 4 4 4s4-4 4-4 2 4 4 4 4-4 4-4"/><path d="M4 12c0 0 2 4 4 4s4-4 4-4 2 4 4 4 4-4 4-4"/><path d="M4 20c0 0 2 4 4 4s4-4 4-4 2 4 4 4 4-4 4-4"/></svg>
        Braid
      </span>
      <span class="protocol-badge" title="Solid Protocol - Coming Soon">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
        Solid
      </span>
      <span class="protocol-badge" title="Lens Protocol - Coming Soon (Polygon/Momoka)">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
        Lens
      </span>
      <span class="protocol-badge" title="Farcaster - Coming Soon (protocol status uncertain, opt-in only)">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 3h18v18H3V3zm2 2v14h14V5H5zm3 3h8v2H8V8zm0 4h8v2H8v-2z"/></svg>
        Farcaster
      </span>
    </footer>

    <div class="federation-footer">
      <p>This profile is federated via <a href="https://activitypub.rocks/">ActivityPub</a>, the <a href="https://indieweb.org/">IndieWeb</a>${profile.nostr_npub ? ', <a href="https://nostr.com/">Nostr</a>' : ''}${profile.at_did ? ', the <a href="https://atproto.com/">AT Protocol</a>' : ''}${profile.matrix_id ? ', <a href="https://matrix.org/">Matrix</a>' : ''}${profile.xmtp_address ? ', <a href="https://xmtp.org/">XMTP</a>' : ''}${profile.dsnp_user_id ? ', <a href="https://spec.dsnp.org/">DSNP</a>' : ''}${profile.zot_channel_hash ? ', <a href="https://zotlabs.com/">Zot</a>' : ''}${profile.hypercore_feed_key ? ', <a href="https://hypercore-protocol.org/">Hypercore</a>' : ''}.</p>
      <p>Follow from the Fediverse: <strong>@${handle}@${ourDomain}</strong></p>
      ${profile.nostr_npub ? `<p>Nostr NIP-05: <strong>${handle}@${ourDomain}</strong></p>` : ''}
      ${profile.at_did ? `<p>AT Protocol DID: <strong>${escapeHtml(profile.at_did)}</strong></p>` : ''}
      ${profile.matrix_id ? `<p>Matrix ID: <strong>${escapeHtml(profile.matrix_id)}</strong></p>` : ''}
      ${profile.xmtp_address ? `<p>XMTP Address: <strong>${escapeHtml(profile.xmtp_address)}</strong></p>` : ''}
      ${profile.dsnp_user_id ? `<p>DSNP User ID: <strong>${escapeHtml(profile.dsnp_user_id)}</strong></p>` : ''}
      ${profile.zot_channel_hash ? `<p>Zot Channel: <strong>${handle}@${ourDomain}</strong></p>` : ''}
      ${profile.hypercore_feed_key ? `<p>Hypercore Feed: <strong>${escapeHtml(profile.hypercore_feed_key.slice(0, 16))}...</strong></p>` : ''}
      <p class="powered-by">Powered by PeerMesh Social Lab</p>
    </div>
  </main>
</body>
</html>`;
}

export default function registerRoutes(routes) {
  // GET /@:handle — Public profile page
  routes.push({
    method: 'GET',
    pattern: /^\/@([a-zA-Z0-9_.-]+)$/,
    handler: async (req, res, matches) => {
      const handle = matches[1];

      // Content negotiation: ActivityPub JSON -> redirect to actor endpoint
      const accept = req.headers['accept'] || '';
      if (accept.includes('application/activity+json') || accept.includes('application/ld+json')) {
        res.writeHead(302, { 'Location': `${BASE_URL}/ap/actor/${handle}` });
        return res.end();
      }

      const profile = await lookupProfileByHandle(pool, handle);
      if (!profile) {
        return html(res, 404, `<!DOCTYPE html><html data-theme="dark"><head><title>Not Found</title><link rel="stylesheet" href="/static/tokens.css"></head><body style="background:var(--color-bg-primary);color:var(--color-text-primary);font-family:var(--font-family-primary);display:flex;justify-content:center;align-items:center;min-height:100vh"><div style="text-align:center"><h1>404</h1><p>Profile @${escapeHtml(handle)} not found</p><a href="/" style="color:var(--color-primary)">Back to home</a></div></body></html>`);
      }

      const links = await getBioLinks(pool, profile.webid);
      const posts = await getRecentPosts(profile.webid);
      const postIds = posts.map(p => p.id);
      const distributions = await getPostDistributions(postIds);

      // Load user's group memberships for profile badges
      let userGroups = [];
      try {
        const groupsResult = await pool.query(
          `SELECT g.id, g.name, g.type, g.path, m.role
           FROM social_profiles.group_memberships m
           JOIN social_profiles.groups g ON g.id = m.group_id
           WHERE m.user_webid = $1 AND g.visibility = 'public'
           ORDER BY g.type ASC, g.name ASC
           LIMIT 20`,
          [profile.webid]
        );
        userGroups = groupsResult.rows;
      } catch {
        // groups table may not exist yet
      }

      html(res, 200, profilePageHtml(profile, links, posts, distributions, userGroups));
    },
  });
}
