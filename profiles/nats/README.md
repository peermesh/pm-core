# NATS + JetStream Profile

**Event Bus Substrate for Module Coordination**

## Quick Start

```bash
# 1. Generate authentication token
openssl rand -hex 32 > ../../secrets/nats_auth_token
chmod 600 ../../secrets/nats_auth_token

# 2. Create app-internal network (if not exists)
docker network create pmdl_app-internal --internal

# 3. Start NATS + JetStream
docker compose -f ../../docker-compose.yml -f docker-compose.nats.yml up -d

# 4. Verify health
docker ps --filter name=pmdl_nats
docker logs pmdl_nats --tail 50
```

## What is NATS + JetStream?

NATS is a high-performance messaging system for cloud-native applications. JetStream adds:

- **Persistence**: Messages are stored and can be replayed
- **Streams**: Durable event logs with configurable retention
- **Consumers**: Multiple subscribers with different delivery patterns
- **Request/Reply**: Synchronous RPC-style communication

This profile provides a single-node NATS server with JetStream enabled, suitable for:

- Module-to-module event distribution
- Asynchronous task queues
- Event sourcing and audit logs
- Decoupled microservices communication

## Usage Examples

### Module Integration

**Publishing Events** (Node.js example):

```javascript
const { connect, StringCodec } = require('nats');

// Read auth token from secret file
const token = await fs.readFile('/run/secrets/nats_auth_token', 'utf8');

// Connect to NATS
const nc = await connect({
  servers: 'nats://nats:4222',
  token: token.trim()
});

// Publish event
const sc = StringCodec();
await nc.publish('events.user.created', sc.encode(JSON.stringify({
  userId: '12345',
  email: 'user@example.com',
  timestamp: new Date().toISOString()
})));
```

**Subscribing to Events**:

```javascript
// Create JetStream context
const js = nc.jetstream();

// Create or get stream
await js.streams.add({
  name: 'EVENTS',
  subjects: ['events.*'],
});

// Create consumer
const consumer = await js.consumers.get('EVENTS', 'my-consumer');

// Process messages
const messages = await consumer.consume();
for await (const m of messages) {
  const data = JSON.parse(sc.decode(m.data));
  console.log('Received event:', data);
  m.ack();
}
```

### Docker Compose Integration

Add NATS to your module's `docker-compose.yml`:

```yaml
services:
  my-module:
    image: my-module:latest
    depends_on:
      nats:
        condition: service_healthy
    secrets:
      - nats_auth_token
    environment:
      NATS_URL: nats://nats:4222
      NATS_AUTH_TOKEN_FILE: /run/secrets/nats_auth_token
    networks:
      - app-internal

secrets:
  nats_auth_token:
    file: ./secrets/nats_auth_token

networks:
  app-internal:
    external: true
```

## Configuration

### Memory Profiles

Choose a profile based on your expected message throughput:

| Profile | Container RAM | Max Memory Store | Max File Store | Use Case |
|---------|---------------|------------------|----------------|----------|
| **Small** | 512 MB | 280 MB | 2 GB | Development, low-volume events |
| **Medium** | 1 GB | 640 MB | 5 GB | Production, moderate traffic |
| **Large** | 2 GB | 1300 MB | 10 GB | High-volume event bus |

Default configuration in `docker-compose.nats.yml` is **Small**. See file for override examples.

### Stream Configuration

Streams are configured by application code or via NATS CLI:

```bash
# Create a stream
docker exec pmdl_nats nats stream add EVENTS \
  --subjects "events.*" \
  --retention limits \
  --max-msgs=-1 \
  --max-bytes=1GB \
  --max-age=168h \
  --storage file \
  --replicas 1
```

**Retention Policies**:

- `limits`: Keep until size/age/count limits reached
- `interest`: Keep until all consumers acknowledge
- `workqueue`: One-time delivery, delete after ack

## Backup & Restore

### Backup

```bash
# Run backup script
./backup-scripts/backup-nats.sh

# Backup is saved to: /var/backups/nats/nats-jetstream-<timestamp>.tar.gz
```

Backups include:
- All JetStream stream data
- Consumer state
- Configuration metadata

### Restore

```bash
# Restore from backup (requires confirmation)
./backup-scripts/restore-nats.sh /var/backups/nats/nats-jetstream-2026-02-22_10-30-00.tar.gz

# Automated restore (skip confirmation)
SKIP_CONFIRMATION=true ./backup-scripts/restore-nats.sh <backup-file>
```

**WARNING**: Restore is destructive - it will overwrite all existing streams and messages.

## Monitoring

### Health Check

```bash
# Container health status
docker ps --filter name=pmdl_nats

# Manual health check
docker exec pmdl_nats wget -q -O- http://localhost:8222/healthz
```

### Metrics

NATS exposes Prometheus metrics on port 8222:

```bash
# Server metrics
curl http://localhost:8222/metrics

# JetStream metrics
curl http://localhost:8222/jsz
```

**Key Metrics**:

- `nats_server_mem_bytes`: Memory usage
- `nats_jetstream_stream_messages`: Messages per stream
- `nats_jetstream_stream_bytes`: Bytes per stream
- `nats_server_slow_consumers`: Consumers falling behind

## Troubleshooting

### Issue: JetStream Not Enabled

**Symptom**: Error "JetStream not enabled" when creating streams

**Solution**: Verify `--jetstream` flag in command:

```bash
docker inspect pmdl_nats --format='{{.Args}}'
# Should include: --jetstream
```

### Issue: Out of Memory

**Symptom**: Messages rejected with "insufficient resources"

**Solution**: Increase `--max_memory_store` or use file-based streams instead of memory-based.

### Issue: Authentication Failures

**Symptom**: Clients cannot connect, error "authorization violation"

**Solution**: Verify token is correctly mounted:

```bash
# Check secret is mounted in container
docker exec pmdl_nats cat /run/secrets/nats_auth_token

# Check it matches your local secret
cat ../../secrets/nats_auth_token

# Verify command includes auth flag
docker inspect pmdl_nats --format='{{.Args}}' | grep auth_token_file
```

### View Logs

```bash
# Real-time logs
docker logs pmdl_nats -f

# Last 100 lines
docker logs pmdl_nats --tail 100
```

## Security Notes

1. **Authentication**: Always use token-based authentication in production
2. **Network Isolation**: NATS is on `app-internal` network only (no internet access)
3. **TLS**: Optional for single-VPS deployments, recommended for multi-host
4. **Secrets**: Never hardcode tokens - always use Docker secrets
5. **Read-only**: NATS can write config at startup, so `read_only: true` is NOT set

## Performance Tuning

### Message Size Limits

Default max message size is 1 MB. Increase if needed:

```yaml
command:
  - "--max_payload=8MB"
```

### Connection Limits

Default is unlimited. Set a limit on resource-constrained VPS:

```yaml
command:
  - "--max_connections=1000"
```

### Stream Retention

Configure per-stream retention to prevent unbounded growth:

```bash
# 7-day retention
nats stream add EVENTS --max-age=168h

# Size-based retention
nats stream add EVENTS --max-bytes=1GB

# Count-based retention
nats stream add EVENTS --max-msgs=1000000
```

## References

- **Full Documentation**: `PROFILE-SPEC.md`
- **NATS Docs**: https://docs.nats.io/
- **JetStream Guide**: https://docs.nats.io/nats-concepts/jetstream
- **Client Libraries**: https://nats.io/download/

## Status

- **Version**: 1.0
- **Status**: Complete
- **Profile Type**: OPTIONAL (off by default)
- **Network**: `app-internal` (backend)
- **Default Memory**: 512 MB
- **Created**: 2026-02-22
