# ==============================================================
# Custom Webhook Image for Deployment
# ==============================================================
# Extends almir/webhook with tools needed for deployments:
# - git: for fetching latest code
# - docker-cli: for docker compose commands
# ==============================================================

FROM almir/webhook:latest

# Switch to root to install packages
USER root

# Install git and docker-cli (docker-compose is included in docker-cli-compose)
RUN apk add --no-cache \
    bash \
    git \
    docker-cli \
    docker-cli-compose

# Stay as root for deployment operations (needs docker socket access)
# Note: Security is handled via docker socket proxy and volume permissions
