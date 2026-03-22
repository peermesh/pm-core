// =============================================================================
// Shared Helpers
// =============================================================================
// Common utilities used across route modules.

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';

// Domain for constructing URIs
const SUBDOMAIN = process.env.SOCIAL_LAB_SUBDOMAIN || 'social';
const DOMAIN = process.env.DOMAIN || 'dockerlab.peermesh.org';
const BASE_URL = `https://${SUBDOMAIN}.${DOMAIN}`;
const VERSION = '0.6.0';
const MODULE = 'social-lab';
const startTime = Date.now();

/**
 * Send a JSON response.
 */
function json(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * Send an HTML response.
 */
function html(res, statusCode, body) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * Send a JSON response with a specific Content-Type header.
 */
function jsonWithType(res, statusCode, contentType, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}

/**
 * Send an XML response with proper content-type.
 */
function xml(res, statusCode, contentType, body) {
  const payload = Buffer.from(body, 'utf8');
  res.writeHead(statusCode, {
    'Content-Type': `${contentType}; charset=utf-8`,
    'Content-Length': payload.byteLength,
    'Cache-Control': 'max-age=300, public',
  });
  res.end(payload);
}

/**
 * Parse the URL pathname. Returns { pathname, searchParams }.
 */
function parseUrl(req) {
  return new URL(req.url, 'http://localhost');
}

/**
 * Read the entire request body as a string, then parse as JSON.
 * Returns { parsed, raw } where raw is the original string (needed for signature verification).
 * Returns { parsed: null, raw: '' } if the body is empty.
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({ parsed: null, raw: '' });
      try {
        resolve({ parsed: JSON.parse(raw), raw });
      } catch (err) {
        reject(new Error('Invalid JSON in request body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Read the entire request body as a URL-encoded form string.
 * Returns an object with parsed key-value pairs.
 */
function readFormBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      const params = new URLSearchParams(raw);
      const result = {};
      for (const [key, value] of params) {
        result[key] = value;
      }
      resolve(result);
    });
    req.on('error', reject);
  });
}

/**
 * Extract the last path segment as the :id parameter.
 * e.g. /api/profile/abc-123 => "abc-123"
 */
function extractId(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  return parts[parts.length - 1] || null;
}

/**
 * Escape HTML special characters to prevent XSS.
 */
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Escape special XML characters for safe inclusion in XML documents.
 */
function escapeXml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generate RFC 2822 formatted date string (for RSS 2.0 pubDate).
 */
function toRfc2822(date) {
  return new Date(date).toUTCString();
}

/**
 * Generate RFC 3339 / ISO 8601 formatted date string (for Atom 1.0).
 */
function toRfc3339(date) {
  return new Date(date).toISOString();
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 */
function ensureDir(dirPath) {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Look up a profile by handle (username).
 * Returns the profile row or null.
 */
async function lookupProfileByHandle(pool, handle) {
  // ORDER BY created_at ASC LIMIT 1 ensures the canonical (oldest) profile is
  // returned when duplicate usernames exist (e.g. leftover seed data rows).
  const result = await pool.query(
    `SELECT id, webid, omni_account_id, display_name, username, bio,
            avatar_url, banner_url, homepage_url, source_pod_uri, nostr_npub, at_did,
            matrix_id, xmtp_address, dsnp_user_id, zot_channel_hash,
            lens_profile_id, farcaster_fid, hypercore_feed_key,
            ap_actor_uri, updated_at
     FROM social_profiles.profile_index
     WHERE username = $1
     ORDER BY created_at ASC
     LIMIT 1`,
    [handle]
  );
  return result.rowCount > 0 ? result.rows[0] : null;
}

/**
 * Look up bio links for a profile by webid.
 * Returns an array of link objects sorted by sort_order.
 */
async function getBioLinks(pool, webid) {
  const result = await pool.query(
    `SELECT id, label, url, identifier, sort_order
     FROM social_profiles.bio_links
     WHERE webid = $1
     ORDER BY sort_order ASC`,
    [webid]
  );
  return result.rows;
}

export {
  SUBDOMAIN,
  DOMAIN,
  BASE_URL,
  VERSION,
  MODULE,
  startTime,
  json,
  html,
  jsonWithType,
  xml,
  parseUrl,
  readJsonBody,
  readFormBody,
  extractId,
  escapeHtml,
  escapeXml,
  toRfc2822,
  toRfc3339,
  ensureDir,
  lookupProfileByHandle,
  getBioLinks,
};
