// =============================================================================
// Feed Routes — RSS, Atom, JSON Feed, Feed Index
// =============================================================================
// GET /@:handle/feed.xml   — RSS 2.0
// GET /@:handle/feed.atom  — Atom 1.0
// GET /@:handle/feed.json  — JSON Feed 1.1
// GET /api/feeds/:handle   — Feed index

import { pool } from '../db.js';
import { json, xml, escapeXml, toRfc2822, toRfc3339, lookupProfileByHandle, getBioLinks, BASE_URL, VERSION } from '../lib/helpers.js';

/**
 * Fetch recent posts for a profile's webid.
 * Returns up to 50 posts sorted newest first.
 */
async function getPosts(webid) {
  try {
    const result = await pool.query(
      `SELECT id, content_text, content_html, media_urls, created_at, updated_at
       FROM social_profiles.posts
       WHERE webid = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [webid]
    );
    return result.rows;
  } catch {
    // Table may not exist yet if migration hasn't run
    return [];
  }
}

/**
 * Generate RSS 2.0 XML feed for a profile.
 * Posts are primary content; bio links are appended as secondary items.
 */
function generateRss(profile, links, posts) {
  const handle = profile.username;
  const displayName = profile.display_name || handle;
  const bio = profile.bio || `${displayName} on PeerMesh Social Lab`;
  const profileUrl = `${BASE_URL}/@${handle}`;
  const feedUrl = `${BASE_URL}/@${handle}/feed.xml`;
  const now = toRfc2822(new Date());

  let itemsXml = '';

  // Posts as primary feed items
  if (posts.length > 0) {
    itemsXml += posts.map(post => {
      const postUrl = `${BASE_URL}/@${handle}/post/${post.id}`;
      const title = post.content_text.length > 80
        ? post.content_text.substring(0, 77) + '...'
        : post.content_text;
      const content = post.content_html || escapeXml(post.content_text);
      return `    <item>
      <title>${escapeXml(title)}</title>
      <link>${escapeXml(postUrl)}</link>
      <guid isPermaLink="true">${escapeXml(postUrl)}</guid>
      <pubDate>${toRfc2822(post.created_at)}</pubDate>
      <description>${escapeXml(content)}</description>
    </item>`;
    }).join('\n');
  }

  // Bio links as secondary items
  if (links.length > 0) {
    if (itemsXml) itemsXml += '\n';
    itemsXml += links.map(link => {
      return `    <item>
      <title>${escapeXml(link.label)}</title>
      <link>${escapeXml(link.url)}</link>
      <guid isPermaLink="false">${escapeXml(link.id)}</guid>
      <description>${escapeXml(link.label)} - ${escapeXml(link.url)}</description>
    </item>`;
    }).join('\n');
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(displayName)}</title>
    <link>${escapeXml(profileUrl)}</link>
    <description>${escapeXml(bio)}</description>
    <language>en</language>
    <lastBuildDate>${now}</lastBuildDate>
    <generator>PeerMesh Social Lab v${VERSION}</generator>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml"/>
${itemsXml}
  </channel>
</rss>`;
}

/**
 * Generate Atom 1.0 XML feed for a profile.
 * Posts are primary content; bio links are appended as secondary entries.
 */
function generateAtom(profile, links, posts) {
  const handle = profile.username;
  const displayName = profile.display_name || handle;
  const bio = profile.bio || `${displayName} on PeerMesh Social Lab`;
  const profileUrl = `${BASE_URL}/@${handle}`;
  const feedUrl = `${BASE_URL}/@${handle}/feed.atom`;
  const feedId = `${BASE_URL}/@${handle}`;
  const now = toRfc3339(new Date());

  let entriesXml = '';

  // Posts as primary entries
  if (posts.length > 0) {
    entriesXml += posts.map(post => {
      const postUrl = `${BASE_URL}/@${handle}/post/${post.id}`;
      const title = post.content_text.length > 80
        ? post.content_text.substring(0, 77) + '...'
        : post.content_text;
      const content = post.content_html || escapeXml(post.content_text);
      return `  <entry>
    <title>${escapeXml(title)}</title>
    <link href="${escapeXml(postUrl)}" rel="alternate"/>
    <id>${escapeXml(postUrl)}</id>
    <published>${toRfc3339(post.created_at)}</published>
    <updated>${toRfc3339(post.updated_at)}</updated>
    <content type="html">${escapeXml(content)}</content>
  </entry>`;
    }).join('\n');
  }

  // Bio links as secondary entries
  if (links.length > 0) {
    if (entriesXml) entriesXml += '\n';
    entriesXml += links.map(link => {
      return `  <entry>
    <title>${escapeXml(link.label)}</title>
    <link href="${escapeXml(link.url)}" rel="alternate"/>
    <id>${escapeXml(link.id)}</id>
    <updated>${now}</updated>
    <summary>${escapeXml(link.label)} - ${escapeXml(link.url)}</summary>
  </entry>`;
    }).join('\n');
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeXml(displayName)}</title>
  <subtitle>${escapeXml(bio)}</subtitle>
  <link href="${escapeXml(feedUrl)}" rel="self" type="application/atom+xml"/>
  <link href="${escapeXml(profileUrl)}" rel="alternate" type="text/html"/>
  <id>${escapeXml(feedId)}</id>
  <updated>${now}</updated>
  <author>
    <name>${escapeXml(displayName)}</name>
    <uri>${escapeXml(profileUrl)}</uri>
  </author>
  <generator uri="https://peermesh.org" version="${VERSION}">PeerMesh Social Lab</generator>
${entriesXml}
</feed>`;
}

/**
 * Generate JSON Feed 1.1 for a profile.
 * Posts are primary content; bio links are appended as secondary items.
 */
function generateJsonFeed(profile, links, posts) {
  const handle = profile.username;
  const displayName = profile.display_name || handle;
  const bio = profile.bio || `${displayName} on PeerMesh Social Lab`;
  const profileUrl = `${BASE_URL}/@${handle}`;
  const feedUrl = `${BASE_URL}/@${handle}/feed.json`;

  const items = [];

  // Posts as primary items
  for (const post of posts) {
    const postUrl = `${BASE_URL}/@${handle}/post/${post.id}`;
    items.push({
      id: post.id,
      url: postUrl,
      content_text: post.content_text,
      content_html: post.content_html || undefined,
      date_published: toRfc3339(post.created_at),
      date_modified: toRfc3339(post.updated_at),
    });
  }

  // Bio links as secondary items
  for (const link of links) {
    items.push({
      id: link.id,
      title: link.label,
      url: link.url,
      content_text: `${link.label} - ${link.url}`,
    });
  }

  return {
    version: 'https://jsonfeed.org/version/1.1',
    title: displayName,
    home_page_url: profileUrl,
    feed_url: feedUrl,
    description: bio,
    authors: [{ name: displayName, url: profileUrl }],
    items,
  };
}

export default function registerRoutes(routes) {
  // GET /@:handle/feed.xml — RSS 2.0 feed
  routes.push({
    method: 'GET',
    pattern: /^\/@([a-zA-Z0-9_.-]+)\/feed\.xml$/,
    handler: async (req, res, matches) => {
      const handle = matches[1];
      const profile = await lookupProfileByHandle(pool, handle);
      if (!profile) {
        return json(res, 404, { error: 'Not Found', message: `No profile found for handle: ${handle}` });
      }
      const links = await getBioLinks(pool, profile.webid);
      const posts = await getPosts(profile.webid);
      const rssXml = generateRss(profile, links, posts);
      xml(res, 200, 'application/rss+xml', rssXml);
    },
  });

  // GET /@:handle/feed.atom — Atom 1.0 feed
  routes.push({
    method: 'GET',
    pattern: /^\/@([a-zA-Z0-9_.-]+)\/feed\.atom$/,
    handler: async (req, res, matches) => {
      const handle = matches[1];
      const profile = await lookupProfileByHandle(pool, handle);
      if (!profile) {
        return json(res, 404, { error: 'Not Found', message: `No profile found for handle: ${handle}` });
      }
      const links = await getBioLinks(pool, profile.webid);
      const posts = await getPosts(profile.webid);
      const atomXml = generateAtom(profile, links, posts);
      xml(res, 200, 'application/atom+xml', atomXml);
    },
  });

  // GET /@:handle/feed.json — JSON Feed 1.1
  routes.push({
    method: 'GET',
    pattern: /^\/@([a-zA-Z0-9_.-]+)\/feed\.json$/,
    handler: async (req, res, matches) => {
      const handle = matches[1];
      const profile = await lookupProfileByHandle(pool, handle);
      if (!profile) {
        return json(res, 404, { error: 'Not Found', message: `No profile found for handle: ${handle}` });
      }
      const links = await getBioLinks(pool, profile.webid);
      const posts = await getPosts(profile.webid);
      const feed = generateJsonFeed(profile, links, posts);
      const payload = JSON.stringify(feed);
      res.writeHead(200, {
        'Content-Type': 'application/feed+json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
        'Cache-Control': 'max-age=300, public',
      });
      res.end(payload);
    },
  });

  // GET /api/feeds/:handle — Feed index
  routes.push({
    method: 'GET',
    pattern: /^\/api\/feeds\/([a-zA-Z0-9_.-]+)$/,
    handler: async (req, res, matches) => {
      const handle = matches[1];
      const profile = await lookupProfileByHandle(pool, handle);
      if (!profile) {
        return json(res, 404, { error: 'Not Found', message: `No profile found for handle: ${handle}` });
      }

      const displayName = profile.display_name || handle;
      const feedBase = `${BASE_URL}/@${handle}`;

      json(res, 200, {
        handle,
        display_name: displayName,
        feeds: [
          {
            format: 'rss',
            content_type: 'application/rss+xml',
            url: `${feedBase}/feed.xml`,
            title: `${displayName} - RSS`,
          },
          {
            format: 'atom',
            content_type: 'application/atom+xml',
            url: `${feedBase}/feed.atom`,
            title: `${displayName} - Atom`,
          },
          {
            format: 'json',
            content_type: 'application/feed+json',
            url: `${feedBase}/feed.json`,
            title: `${displayName} - JSON Feed`,
          },
        ],
      });
    },
  });
}
