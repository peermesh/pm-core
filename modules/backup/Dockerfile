FROM restic/restic@sha256:63e86f6726e2afcd49c882d2fc67ae483a38a1ffcb50cbf5f474bd11f5129217

# Pre-install dependencies so the container works on internal networks
# without internet access. This replaces the runtime `apk add` in the
# entrypoint that fails when backup-internal is internal: true.
RUN apk add --no-cache docker-cli postgresql16-client gzip bash curl jq
