#!/bin/sh
# ==============================================================
# rss2bsky Entrypoint Script
# ==============================================================
# Sets up cron job and starts crond
# ==============================================================

set -e

# Default cron schedule: every 15 minutes
CRON_SCHEDULE="${RSS2BSKY_CRON:-*/15 * * * *}"

echo "=== rss2bsky Container Starting ==="
echo "Feed URL: ${R2B_FEED_URL}"
echo "Bluesky Handle: ${R2B_HANDLE}"
echo "Cron Schedule: ${CRON_SCHEDULE}"
echo "Start Date Filter: ${R2B_START_POST_DATE:-none}"
echo "=================================="

# Create cron job with environment variables
# Export all R2B_* variables to the cron environment
cat > /etc/crontabs/root << EOF
# rss2bsky cron job - syncs RSS feed to Bluesky
${CRON_SCHEDULE} /app/sync.sh >> /proc/1/fd/1 2>&1
EOF

# Run initial sync on startup
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Running initial sync..."
/app/sync.sh

# Start cron in foreground
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting cron daemon..."
exec crond -f -l 2
