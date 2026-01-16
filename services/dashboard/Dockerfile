# Stage 1: Build the Go binary
FROM golang:1.21-alpine AS builder

# Install git for go mod download (some dependencies may need it)
RUN apk add --no-cache git

# Set working directory
WORKDIR /build

# Copy go mod files first for better caching
COPY go.mod ./
# go.sum will be created on first build
# COPY go.sum ./

# Download dependencies (cached unless go.mod changes)
RUN go mod download 2>/dev/null || true

# Copy source code
COPY . .

# Build the binary
# CGO_ENABLED=0 for static binary
# -ldflags="-w -s" strips debug info for smaller binary
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o dashboard .

# Stage 2: Create minimal runtime image
FROM alpine:3.19

# Install ca-certificates for HTTPS requests
RUN apk add --no-cache ca-certificates tzdata

# Create non-root user
RUN addgroup -g 1000 appgroup && \
    adduser -u 1000 -G appgroup -h /app -D appuser

# Set working directory
WORKDIR /app

# Copy binary from builder
COPY --from=builder /build/dashboard .

# Copy static files
COPY --from=builder /build/static ./static

# Change ownership to non-root user
RUN chown -R appuser:appgroup /app

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Run the binary
CMD ["./dashboard"]
