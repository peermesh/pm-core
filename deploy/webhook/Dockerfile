# ==============================================================
# Custom Webhook Image for Deployment
# ==============================================================
# Extends almir/webhook with tools needed for deployments:
# - git: for fetching latest code
# - docker-cli: for docker compose commands
# ==============================================================

FROM almir/webhook@sha256:0758d1cf6186044ad1209e3e7202fc22c3e9ac232a140cea0e6a33fce2a45292

# Switch to root to install packages
USER root

# Install git and docker-cli (docker-compose is included in docker-cli-compose)
RUN apk add --no-cache \
    bash \
    git \
    docker-cli \
    docker-cli-compose

# Create non-root user for webhook operations
# Docker socket access is proxied via docker-socket-proxy, so root is not needed
RUN addgroup -g 1000 webhook && \
    adduser -u 1000 -G webhook -h /home/webhook -D webhook

USER webhook
