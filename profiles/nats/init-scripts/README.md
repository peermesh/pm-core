# NATS Init Scripts

NATS does not support traditional init scripts like databases. Stream and consumer creation is typically handled by:

1. **Application code** (recommended) - Declarative stream creation on startup
2. **Manual setup** - Using `nats` CLI after deployment
3. **Init container** - Separate container that runs setup commands

## Init Container Pattern (Optional)

If you need to pre-create streams before modules start, use an init container:

### 1. Add to docker-compose.yml

```yaml
services:
  nats-init:
    image: natsio/nats-box:latest
    depends_on:
      nats:
        condition: service_healthy
    volumes:
      - ./profiles/nats/init-scripts/init-streams.sh:/init-streams.sh:ro
    secrets:
      - nats_auth_token
    environment:
      NATS_URL: nats://nats:4222
    command: ["/init-streams.sh"]
    networks:
      - app-internal
    restart: "no"  # Only run once
```

### 2. Create init-streams.sh

```bash
#!/bin/sh
# Example: Create default streams

set -e

# Read auth token from secret
TOKEN=$(cat /run/secrets/nats_auth_token)

# Wait for NATS to be ready
echo "Waiting for NATS..."
sleep 5

# Create EVENTS stream (general event bus)
nats stream add EVENTS \
    --subjects "events.*" \
    --retention limits \
    --max-msgs=-1 \
    --max-bytes=1GB \
    --max-age=168h \
    --storage file \
    --replicas 1 \
    --server "$NATS_URL" \
    --token "$TOKEN" \
    --defaults || echo "Stream EVENTS already exists"

# Create TASKS stream (work queue)
nats stream add TASKS \
    --subjects "tasks.*" \
    --retention workqueue \
    --max-msgs=-1 \
    --max-bytes=512MB \
    --max-age=24h \
    --storage file \
    --replicas 1 \
    --server "$NATS_URL" \
    --token "$TOKEN" \
    --defaults || echo "Stream TASKS already exists"

echo "Stream initialization complete"
```

### 3. Make executable

```bash
chmod +x init-streams.sh
```

## Recommended Approach: Declarative Streams in Application Code

Instead of init scripts, create streams declaratively in your application:

### Node.js Example

```javascript
const { connect } = require('nats');

async function ensureStreams() {
  const token = await fs.readFile('/run/secrets/nats_auth_token', 'utf8');
  const nc = await connect({
    servers: process.env.NATS_URL || 'nats://nats:4222',
    token: token.trim()
  });

  const jsm = await nc.jetstreamManager();

  // Create or update EVENTS stream
  try {
    await jsm.streams.add({
      name: 'EVENTS',
      subjects: ['events.*'],
      retention: 'limits',
      max_bytes: 1 * 1024 * 1024 * 1024, // 1GB
      max_age: 7 * 24 * 60 * 60 * 1e9,   // 7 days in nanoseconds
      storage: 'file'
    });
    console.log('Stream EVENTS ready');
  } catch (err) {
    if (err.message.includes('already in use')) {
      console.log('Stream EVENTS already exists');
    } else {
      throw err;
    }
  }

  await nc.close();
}

ensureStreams().catch(console.error);
```

### Python Example

```python
import asyncio
import nats
from nats.js import JetStreamContext

async def ensure_streams():
    token = open('/run/secrets/nats_auth_token').read().strip()
    nc = await nats.connect(
        servers=['nats://nats:4222'],
        token=token
    )

    js: JetStreamContext = nc.jetstream()

    # Create EVENTS stream
    try:
        await js.add_stream(
            name='EVENTS',
            subjects=['events.*'],
            retention='limits',
            max_bytes=1 * 1024 * 1024 * 1024,  # 1GB
            max_age=7 * 24 * 60 * 60,          # 7 days
            storage='file'
        )
        print('Stream EVENTS ready')
    except Exception as e:
        if 'already in use' in str(e):
            print('Stream EVENTS already exists')
        else:
            raise

    await nc.close()

asyncio.run(ensure_streams())
```

## Manual Stream Creation

For one-off setup or testing:

```bash
# Enter NATS container
docker exec -it pmdl_nats sh

# Create stream interactively
nats stream add

# Or non-interactively
nats stream add EVENTS \
  --subjects "events.*" \
  --retention limits \
  --max-bytes=1GB \
  --max-age=168h \
  --storage file
```

## Best Practices

1. **Idempotent**: Stream creation should be idempotent (safe to run multiple times)
2. **Declarative**: Define streams in code alongside business logic
3. **Version Control**: Track stream configurations in your application repo
4. **Migration**: Handle stream schema changes gracefully
5. **Documentation**: Document stream subjects and message formats

## Stream Naming Conventions

Recommended naming patterns:

- **Streams**: UPPERCASE (e.g., `EVENTS`, `TASKS`, `AUDIT`)
- **Subjects**: lowercase with dots (e.g., `events.user.created`, `tasks.email.send`)
- **Consumers**: descriptive names (e.g., `email-processor`, `audit-logger`)

## Example Stream Configurations

### Event Bus

```
Name: EVENTS
Subjects: events.*
Retention: limits
Max Age: 7 days
Max Bytes: 1GB
Storage: file
```

### Work Queue

```
Name: TASKS
Subjects: tasks.*
Retention: workqueue (delete after ack)
Max Age: 24 hours
Max Bytes: 512MB
Storage: file
```

### Audit Log

```
Name: AUDIT
Subjects: audit.*
Retention: limits
Max Age: 90 days
Max Bytes: 10GB
Storage: file
```
