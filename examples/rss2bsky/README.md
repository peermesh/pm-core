# rss2bsky - RSS to Bluesky Syndication

Lightweight cron-based RSS to Bluesky cross-posting. Syndicates GoToSocial, Mastodon, or WriteFreely posts to Bluesky automatically.

## Why rss2bsky?

- **~20MB RAM** during execution, ~2-5MB idle
- Specifically designed for GoToSocial RSS feeds
- Works with any ActivityPub RSS feed (Mastodon, WriteFreely)
- Cron-based scheduling (configurable)
- State persistence to avoid duplicate posts

## Prerequisites

1. **RSS Feed Source** - One of:
   - GoToSocial: `https://social.domain/@username.rss`
   - Mastodon: `https://mastodon.instance/@username.rss`
   - WriteFreely: `https://blog.domain/feed/`

2. **Bluesky App Password**:
   - Log into [bsky.app](https://bsky.app)
   - Go to Settings > App Passwords
   - Create a new app password (name it "rss2bsky")
   - Save the generated password securely

## Configuration

Add to your `.env` file:

```bash
# Required: Bluesky credentials
RSS2BSKY_HANDLE=yourhandle.bsky.social
RSS2BSKY_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx

# Required: RSS feed URL
# GoToSocial example:
RSS2BSKY_FEED_URL=https://social.example.com/@admin.rss

# Optional: Only crosspost items after this date (RFC format)
# Useful for first-time setup to avoid flooding Bluesky
RSS2BSKY_START_DATE="Tue, 01 Jan 2025 00:00:00 +0000"

# Optional: Custom cron schedule (default: every 15 minutes)
RSS2BSKY_CRON="*/15 * * * *"
```

## Quick Start

```bash
# Start rss2bsky
docker compose -f docker-compose.yml \
               -f examples/rss2bsky/docker-compose.rss2bsky.yml \
               --profile rss2bsky up -d

# View logs
docker logs -f pmdl_rss2bsky

# Trigger manual sync
docker exec pmdl_rss2bsky /app/sync.sh
```

## RSS Feed URLs by Platform

| Platform | RSS Feed URL Pattern |
|----------|---------------------|
| GoToSocial | `https://social.domain/@username.rss` |
| Mastodon | `https://mastodon.instance/@username.rss` |
| WriteFreely | `https://blog.domain/feed/` |
| WriteFreely (single blog) | `https://blog.domain/username/feed/` |

## Resource Requirements

| State | RAM Usage |
|-------|-----------|
| Idle (crond) | 2-5MB |
| Active (syncing) | ~20MB |
| Peak (large feed) | ~30MB |

## How It Works

1. **On startup**: Runs initial sync immediately
2. **Every 15 minutes** (configurable): Checks RSS feed for new items
3. **For each new item**: Posts to Bluesky with link back to original
4. **State tracking**: Remembers posted items to avoid duplicates

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `RSS2BSKY_HANDLE` | Yes | Your Bluesky handle (e.g., `user.bsky.social`) |
| `RSS2BSKY_APP_PASSWORD` | Yes | Bluesky app password (NOT your account password) |
| `RSS2BSKY_FEED_URL` | Yes | Full URL to RSS feed |
| `RSS2BSKY_START_DATE` | No | Only post items after this date (RFC format) |
| `RSS2BSKY_CRON` | No | Cron schedule (default: `*/15 * * * *`) |
| `TZ` | No | Timezone (default: UTC) |

## Cron Schedule Examples

```bash
# Every 15 minutes (default)
RSS2BSKY_CRON="*/15 * * * *"

# Every hour
RSS2BSKY_CRON="0 * * * *"

# Every 6 hours
RSS2BSKY_CRON="0 */6 * * *"

# Once daily at midnight
RSS2BSKY_CRON="0 0 * * *"
```

## Troubleshooting

### Check if container is running
```bash
docker ps | grep rss2bsky
```

### View recent logs
```bash
docker logs --tail 50 pmdl_rss2bsky
```

### Test feed URL accessibility
```bash
docker exec pmdl_rss2bsky wget -q -O - "${R2B_FEED_URL}" | head -20
```

### Manual sync test
```bash
docker exec pmdl_rss2bsky /app/sync.sh
```

### Common Issues

1. **"Authentication failed"**: Verify app password is correct and not expired
2. **"Feed not found"**: Check RSS feed URL is publicly accessible
3. **"No new posts"**: Feed items may be older than `RSS2BSKY_START_DATE`

## Security Notes

- Use **app passwords**, never your account password
- App passwords can be revoked anytime from Bluesky settings
- The container only needs outbound HTTPS access

## Architecture

```
+---------------+     +----------------+     +-------------+
| GoToSocial    |     | rss2bsky       |     | Bluesky     |
| (RSS Feed)    | --> | (Alpine+Cron)  | --> | (ATProto)   |
+---------------+     +----------------+     +-------------+
                            |
                      [State File]
                      (tracks posted)
```

## Related Examples

- [GoToSocial](../gotosocial/) - Lightweight ActivityPub server (RSS source)
- [WriteFreely](../writefreely/) - Minimalist blog platform (RSS source)
