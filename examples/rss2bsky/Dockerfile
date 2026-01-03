# ==============================================================
# rss2bsky - Lightweight RSS to Bluesky Bridge
# ==============================================================
# Alpine-based container with Python and cron scheduler
# Minimal footprint: ~20MB during execution, ~2-5MB idle
#
# Build: docker build -t rss2bsky .
# ==============================================================

FROM python:3.12-alpine

# Install crond and required build dependencies
RUN apk add --no-cache \
    dcron \
    && pip install --no-cache-dir rss2bsky

# Create app directory
WORKDIR /app

# Create data directory for state persistence
RUN mkdir -p /app/data

# Copy entrypoint script
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Copy the sync script
COPY sync.sh /app/sync.sh
RUN chmod +x /app/sync.sh

# Volume for persistent state
VOLUME ["/app/data"]

# Run as entrypoint
ENTRYPOINT ["/app/entrypoint.sh"]
