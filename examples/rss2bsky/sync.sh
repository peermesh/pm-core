#!/bin/sh
# ==============================================================
# rss2bsky Sync Script
# ==============================================================
# Runs the rss2bsky command with environment variables
# Called by cron every 15 minutes (configurable)
# ==============================================================

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting RSS to Bluesky sync..."

# Change to data directory for state persistence
cd /app/data

# Run rss2bsky with environment variables
# R2B_* variables are passed through from Docker environment
if rss2bsky; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Sync completed successfully"
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Sync failed with exit code $?"
fi
