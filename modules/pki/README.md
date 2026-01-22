# PKI Module

Internal Public Key Infrastructure (PKI) module using [step-ca](https://smallstep.com/docs/step-ca) for automated TLS certificate provisioning.

## Overview

This module provides:

- **Internal Certificate Authority** - Self-hosted CA for issuing TLS certificates
- **Automated Certificate Provisioning** - Issue certificates for PostgreSQL, Redis, and other services
- **Zero-Maintenance Renewal** - Automatic certificate renewal before expiry
- **ACME Protocol Support** - Standard protocol for automated certificate management
- **Offline Operation** - Works completely offline (local-first, no external dependencies)

## Quick Start

### 1. Install the Module

```bash
./modules/pki/hooks/install.sh
```

This will:
- Create necessary directories
- Generate secure CA and provisioner passwords
- Set up Docker networks

### 2. Start the CA

```bash
./modules/pki/hooks/start.sh
# Or using docker compose directly:
docker compose -f modules/pki/docker-compose.yml up -d
```

### 3. Provision Certificates

```bash
# Provision certificate for PostgreSQL
./modules/pki/scripts/provision-cert.sh postgres

# Provision certificate for Redis
./modules/pki/scripts/provision-cert.sh redis

# Provision certificate for a custom service
./modules/pki/scripts/provision-cert.sh my-service --san my-service.pmdl.local
```

## Architecture

```
                    +-------------------+
                    |    step-ca        |
                    |  (Certificate     |
                    |   Authority)      |
                    +--------+----------+
                             |
                             | Issues certificates
                             v
    +------------+    +------------+    +------------+
    | PostgreSQL |    |   Redis    |    |  Traefik   |
    |   (TLS)    |    |   (TLS)    |    |   (TLS)    |
    +------------+    +------------+    +------------+
```

### Components

| Service | Container | Port | Purpose |
|---------|-----------|------|---------|
| step-ca | pmdl_step_ca | 9000 | Certificate Authority |
| cert-renewer | pmdl_cert_renewer | - | Automatic renewal sidecar |

## Configuration

### Environment Variables

Copy `.env.example` to `.env` and customize:

| Variable | Default | Description |
|----------|---------|-------------|
| `PKI_CA_NAME` | PeerMesh Internal CA | Name shown in certificates |
| `PKI_CA_DNS_NAME` | ca.pmdl.local | CA server DNS name |
| `PKI_CERT_DURATION` | 720h (30 days) | Default certificate validity |
| `PKI_RENEWAL_WINDOW` | 480h (20 days) | When to trigger renewal |
| `PKI_ACME_ENABLED` | true | Enable ACME protocol |
| `PKI_AUTO_RENEW_ENABLED` | true | Enable automatic renewal |

### Secrets

Secrets are stored in `configs/` directory (auto-generated on install):

| File | Purpose |
|------|---------|
| `ca_password` | Password for CA key encryption |
| `provisioner_password` | Password for certificate provisioning |

## Certificate Management

### Provision a Certificate

```bash
# Basic usage
./modules/pki/scripts/provision-cert.sh <service-name>

# With additional SANs
./modules/pki/scripts/provision-cert.sh api-gateway \
  --san api.pmdl.local \
  --san gateway.pmdl.local

# With custom duration
./modules/pki/scripts/provision-cert.sh short-lived --duration 168h

# Force overwrite existing
./modules/pki/scripts/provision-cert.sh postgres --force

# Output as JSON
./modules/pki/scripts/provision-cert.sh redis --json
```

### List Certificates

```bash
# List all certificates
./modules/pki/scripts/list-certs.sh

# Show only expiring certificates
./modules/pki/scripts/list-certs.sh --expiring

# Output as JSON
./modules/pki/scripts/list-certs.sh --json
```

### Renew Certificates

```bash
# Renew a specific certificate
./modules/pki/scripts/renew-cert.sh postgres

# Renew all expiring certificates
./modules/pki/scripts/renew-cert.sh --all

# Force renewal even if not expiring
./modules/pki/scripts/renew-cert.sh redis --force
```

### Revoke a Certificate

```bash
# Revoke a certificate (requires confirmation)
./modules/pki/scripts/revoke-cert.sh old-service

# Revoke with reason
./modules/pki/scripts/revoke-cert.sh old-service --reason cessation-of-operation

# Force revoke (no confirmation)
./modules/pki/scripts/revoke-cert.sh old-service --force
```

## Using Certificates in Services

### PostgreSQL TLS Configuration

Add to your PostgreSQL service in docker-compose.yml:

```yaml
services:
  postgres:
    image: postgres:16
    volumes:
      # Mount the certificate volume
      - pmdl_pki_certs:/certs:ro
    environment:
      # Enable SSL
      POSTGRES_SSL_MODE: require
    command:
      - -c
      - ssl=on
      - -c
      - ssl_cert_file=/certs/services/postgres/cert.pem
      - -c
      - ssl_key_file=/certs/services/postgres/key.pem
      - -c
      - ssl_ca_file=/certs/root_ca.crt

volumes:
  pmdl_pki_certs:
    external: true
```

### Redis TLS Configuration

```yaml
services:
  redis:
    image: redis:7
    volumes:
      - pmdl_pki_certs:/certs:ro
    command:
      - redis-server
      - --tls-port 6379
      - --port 0
      - --tls-cert-file /certs/services/redis/cert.pem
      - --tls-key-file /certs/services/redis/key.pem
      - --tls-ca-cert-file /certs/root_ca.crt
      - --tls-auth-clients no

volumes:
  pmdl_pki_certs:
    external: true
```

### Connecting with TLS

For clients connecting to TLS-enabled services, mount the root CA:

```yaml
services:
  app:
    volumes:
      - pmdl_pki_certs:/certs:ro
    environment:
      # PostgreSQL
      PGSSLROOTCERT: /certs/root_ca.crt
      PGSSLMODE: verify-full

      # Or for general SSL
      SSL_CERT_FILE: /certs/root_ca.crt
```

## Health Monitoring

### Check Module Health

```bash
# Text output
./modules/pki/hooks/health.sh

# JSON output (for dashboard)
./modules/pki/hooks/health.sh json
```

### Health Status Codes

| Exit Code | Status | Meaning |
|-----------|--------|---------|
| 0 | Healthy | CA running, all certificates valid |
| 1 | Unhealthy | CA not running or critical failure |
| 2 | Degraded | CA running but certificates expiring soon |

## Dashboard Integration

The module provides dashboard components for the PeerMesh Dashboard:

- **Status Widget** - Shows CA health and certificate counts
- **PKI Page** - Full certificate management interface
- **Config Panel** - Adjust PKI settings

Access at: `http://dashboard-url/pki`

## Troubleshooting

### CA Won't Start

```bash
# Check container logs
docker logs pmdl_step_ca

# Verify secrets exist
ls -la modules/pki/configs/

# Re-run install
./modules/pki/hooks/install.sh
```

### Certificate Provisioning Fails

```bash
# Check CA is healthy
docker exec pmdl_step_ca step ca health

# Verify provisioner password
cat modules/pki/configs/provisioner_password

# Check CA logs
docker logs pmdl_step_ca --tail 50
```

### Certificates Not Renewing

```bash
# Check renewer status
docker logs pmdl_cert_renewer

# Manually trigger renewal
./modules/pki/scripts/renew-cert.sh --all --force
```

### Root CA Expiring

The root CA is valid for 10 years by default. If it's approaching expiry:

1. **Back up the current CA data**
2. **Plan for service certificates to be reissued**
3. **Re-initialize the CA** (this is a major operation)

## Security Considerations

### Secret Management

- CA password and provisioner password are auto-generated with secure random values
- Secrets are stored with 600 permissions (owner read/write only)
- Never commit secrets to version control
- Consider using Docker secrets or external secret management for production

### Root CA Protection

The root CA private key is the most critical secret:

- Stored in the `pmdl_pki_ca_data` Docker volume
- Back up this volume securely and offline
- If compromised, all issued certificates must be considered compromised

### Network Security

- The CA API is bound to `127.0.0.1:9000` by default (local access only)
- The `pki-internal` network is set to internal mode
- Consider additional firewall rules for production

### Certificate Rotation

- Default certificates are valid for 30 days
- Automatic renewal happens at 20 days before expiry
- This provides a 10-day grace period for failed renewals

## Backup and Recovery

### Backup CA Data

```bash
# Backup CA data volume
docker run --rm \
  -v pmdl_pki_ca_data:/data:ro \
  -v $(pwd)/backups:/backup \
  alpine tar czf /backup/pki-ca-backup.tar.gz -C /data .

# Backup secrets
tar czf backups/pki-secrets-backup.tar.gz modules/pki/configs/
```

### Restore CA Data

```bash
# Stop PKI services
./modules/pki/hooks/stop.sh

# Restore CA data
docker run --rm \
  -v pmdl_pki_ca_data:/data \
  -v $(pwd)/backups:/backup \
  alpine tar xzf /backup/pki-ca-backup.tar.gz -C /data

# Start PKI services
./modules/pki/hooks/start.sh
```

## API Endpoints

The module exposes the following API endpoints (via dashboard):

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/modules/pki/health` | GET | Module health status |
| `/api/modules/pki/certificates` | GET | List all certificates |
| `/api/modules/pki/config` | GET/POST | Get/set configuration |
| `/api/modules/pki/provision` | POST | Provision new certificate |
| `/api/modules/pki/renew` | POST | Renew certificate |
| `/api/modules/pki/revoke` | POST | Revoke certificate |

## License

MIT License - See LICENSE file for details.

## References

- [step-ca Documentation](https://smallstep.com/docs/step-ca)
- [ACME Protocol (RFC 8555)](https://tools.ietf.org/html/rfc8555)
- [PostgreSQL SSL Configuration](https://www.postgresql.org/docs/current/ssl-tcp.html)
- [Redis TLS Configuration](https://redis.io/topics/encryption)
