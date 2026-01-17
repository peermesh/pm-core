# Configuration Schema System

**Purpose**: Define how modules declare, validate, and manage configuration with environment variable mapping and BYOK (Bring Your Own Keys) support.

---

## Overview

The Configuration Schema System provides a standardized way for modules to:

1. **Declare** what configuration they need
2. **Validate** configuration values at startup
3. **Map** configuration to environment variables
4. **Mark** sensitive values for BYOK handling

This follows the core principle: modules declare their configuration needs, the foundation provides the validation and generation infrastructure.

---

## Quick Start

### 1. Define Configuration in module.json

```json
{
  "id": "my-module",
  "version": "1.0.0",
  "name": "My Module",
  "config": {
    "version": "1.0",
    "properties": {
      "apiEndpoint": {
        "type": "string",
        "description": "API endpoint URL",
        "format": "uri",
        "env": "MY_MODULE_API_ENDPOINT",
        "default": "https://api.example.com"
      },
      "apiKey": {
        "type": "string",
        "description": "API key for authentication",
        "secret": true,
        "env": "MY_MODULE_API_KEY",
        "minLength": 32
      }
    },
    "required": ["apiKey"]
  }
}
```

### 2. Generate .env.example

```bash
./foundation/lib/env-generate.sh ./modules/my-module
```

Output:

```env
# =============================================================================
# My Module Configuration
# Module ID: my-module
# Config Version: 1.0
# =============================================================================

# -----------------------------------------------------------------------------
# SECURITY NOTICE (BYOK - Bring Your Own Keys)
# -----------------------------------------------------------------------------
# This file contains SECRET fields marked with 'SECRET:' comments.
# - Do NOT commit actual secret values to version control
# - Copy this file to .env and fill in your own credentials
# -----------------------------------------------------------------------------

# API endpoint URL
# Type: string (uri) | Default: "https://api.example.com"
MY_MODULE_API_ENDPOINT="https://api.example.com"

# SECRET: Do not commit actual value
# API key for authentication
# Type: string | Required | Min length: 32
MY_MODULE_API_KEY=
```

### 3. User Creates .env

```bash
cp .env.example .env
# Edit .env with actual credentials
```

---

## Property Types

The schema supports these property types:

| Type | Description | Validation Options |
|------|-------------|-------------------|
| `string` | Text values | `minLength`, `maxLength`, `pattern`, `format`, `enum` |
| `number` | Decimal numbers | `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum` |
| `integer` | Whole numbers | `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum` |
| `boolean` | True/false | None |
| `array` | Lists | `minItems`, `maxItems`, `uniqueItems`, `items` |
| `object` | Nested objects | `additionalProperties` |

### String Formats

For string types, you can specify semantic formats:

| Format | Description | Example |
|--------|-------------|---------|
| `uri` | Full URI | `https://api.example.com/v1` |
| `uri-reference` | URI or relative reference | `/api/v1` |
| `email` | Email address | `user@example.com` |
| `hostname` | Hostname | `api.example.com` |
| `ipv4` | IPv4 address | `192.168.1.1` |
| `ipv6` | IPv6 address | `::1` |
| `date` | ISO 8601 date | `2026-01-16` |
| `date-time` | ISO 8601 datetime | `2026-01-16T10:30:00Z` |
| `time` | ISO 8601 time | `10:30:00` |
| `duration` | ISO 8601 duration | `PT1H30M` |
| `uuid` | UUID | `550e8400-e29b-41d4-a716-446655440000` |

---

## Environment Variable Mapping

Every property can map to an environment variable via the `env` field:

```json
{
  "port": {
    "type": "integer",
    "env": "MY_MODULE_PORT",
    "default": 8080
  }
}
```

### Naming Convention

Environment variables should follow `SCREAMING_SNAKE_CASE`:

- Prefix with module ID: `MY_MODULE_*`
- Use underscores for word separation
- All uppercase

```
my-module + apiEndpoint -> MY_MODULE_API_ENDPOINT
my-module + maxRetries  -> MY_MODULE_MAX_RETRIES
```

### Array Values in Environment

Arrays are passed as comma-separated values:

```json
{
  "allowedHosts": {
    "type": "array",
    "items": { "type": "string" },
    "env": "MY_MODULE_ALLOWED_HOSTS"
  }
}
```

```env
MY_MODULE_ALLOWED_HOSTS="host1.example.com,host2.example.com"
```

---

## Validation Rules

### Required Fields

Mark required properties in the `required` array:

```json
{
  "config": {
    "properties": {
      "apiKey": { "type": "string" },
      "optionalSetting": { "type": "string" }
    },
    "required": ["apiKey"]
  }
}
```

### Value Constraints

#### Numbers

```json
{
  "port": {
    "type": "integer",
    "minimum": 1,
    "maximum": 65535
  },
  "timeout": {
    "type": "number",
    "exclusiveMinimum": 0,
    "maximum": 300
  }
}
```

#### Strings

```json
{
  "username": {
    "type": "string",
    "minLength": 3,
    "maxLength": 64,
    "pattern": "^[a-z][a-z0-9_]*$"
  },
  "logLevel": {
    "type": "string",
    "enum": ["debug", "info", "warn", "error"]
  }
}
```

#### Arrays

```json
{
  "tags": {
    "type": "array",
    "items": { "type": "string" },
    "minItems": 1,
    "maxItems": 10,
    "uniqueItems": true
  }
}
```

---

## Secret Handling (BYOK Pattern)

The BYOK (Bring Your Own Keys) pattern ensures users provide their own credentials. The foundation never stores or manages secrets - it only validates that required secrets are provided.

### Marking Secrets

```json
{
  "apiKey": {
    "type": "string",
    "description": "API key (user must provide)",
    "secret": true,
    "env": "MY_MODULE_API_KEY"
  },
  "databasePassword": {
    "type": "string",
    "description": "Database password",
    "secret": true,
    "env": "MY_MODULE_DB_PASSWORD"
  }
}
```

### What `secret: true` Does

1. **In .env.example**: Value is always empty (never includes defaults)
2. **In logs**: Value is masked or omitted
3. **In UI**: Value is obscured (password field)
4. **In validation**: Presence is checked, value is not logged

### Security Notice

Generated .env.example files include a security notice when secrets are present:

```env
# -----------------------------------------------------------------------------
# SECURITY NOTICE (BYOK - Bring Your Own Keys)
# -----------------------------------------------------------------------------
# This file contains SECRET fields marked with 'SECRET:' comments.
# - Do NOT commit actual secret values to version control
# - Copy this file to .env and fill in your own credentials
# - Use a secrets manager in production (SOPS, Vault, etc.)
# -----------------------------------------------------------------------------
```

---

## Property Groups (UI Organization)

For modules with many settings, group related properties:

```json
{
  "config": {
    "properties": {
      "apiEndpoint": { ... },
      "apiKey": { ... },
      "maxRetries": { ... },
      "timeout": { ... },
      "enableDebug": { ... }
    },
    "groups": [
      {
        "name": "Connection",
        "description": "API connection settings",
        "properties": ["apiEndpoint", "apiKey"]
      },
      {
        "name": "Reliability",
        "description": "Retry and timeout settings",
        "properties": ["maxRetries", "timeout"]
      },
      {
        "name": "Advanced",
        "description": "Advanced settings",
        "properties": ["enableDebug"],
        "collapsed": true
      }
    ]
  }
}
```

Groups affect UI rendering in the dashboard config panel but don't change validation or .env generation.

---

## Generating .env Files

### Basic Usage

```bash
# Generate .env.example in module directory
./foundation/lib/env-generate.sh ./modules/my-module

# Custom output path
./foundation/lib/env-generate.sh ./modules/my-module --output ./my-module.env

# Only show secret fields (for secrets audit)
./foundation/lib/env-generate.sh ./modules/my-module --secrets-only
```

### Options

| Option | Description |
|--------|-------------|
| `--output, -o` | Custom output path |
| `--format` | Output format: `env` (default), `docker` |
| `--no-comments` | Suppress description comments |
| `--no-defaults` | Don't include default values |
| `--secrets-only` | Only output secret fields |

### Generated Output Structure

```env
# =============================================================================
# Module Name Configuration
# Module ID: module-id
# Config Version: 1.0
# Generated by: env-generate.sh
# Generated at: 2026-01-16T10:30:00Z
# =============================================================================

# Description of the property
# Type: string | Default: "value"
PROPERTY_NAME="value"

# SECRET: Do not commit actual value
# Description of secret property
# Type: string | Required | Min length: 32
SECRET_PROPERTY=
```

---

## Deprecation

Mark deprecated properties to guide users during migration:

```json
{
  "oldSetting": {
    "type": "string",
    "deprecated": true,
    "deprecationMessage": "Use 'newSetting' instead. Will be removed in v2.0."
  }
}
```

Deprecated properties:

- Generate a warning comment in .env.example
- Show a warning in dashboard UI
- Still validate if provided

---

## Complete Example

Here's a comprehensive module configuration example:

```json
{
  "$schema": "../../schemas/module.schema.json",
  "id": "notification-service",
  "version": "1.0.0",
  "name": "Notification Service",
  "config": {
    "version": "1.0",
    "properties": {
      "smtpHost": {
        "type": "string",
        "description": "SMTP server hostname",
        "format": "hostname",
        "env": "NOTIFY_SMTP_HOST",
        "default": "localhost"
      },
      "smtpPort": {
        "type": "integer",
        "description": "SMTP server port",
        "minimum": 1,
        "maximum": 65535,
        "env": "NOTIFY_SMTP_PORT",
        "default": 587
      },
      "smtpUsername": {
        "type": "string",
        "description": "SMTP authentication username",
        "env": "NOTIFY_SMTP_USER"
      },
      "smtpPassword": {
        "type": "string",
        "description": "SMTP authentication password",
        "secret": true,
        "env": "NOTIFY_SMTP_PASSWORD"
      },
      "smtpTls": {
        "type": "boolean",
        "description": "Enable TLS for SMTP",
        "env": "NOTIFY_SMTP_TLS",
        "default": true
      },
      "fromAddress": {
        "type": "string",
        "description": "Default from email address",
        "format": "email",
        "env": "NOTIFY_FROM_ADDRESS"
      },
      "allowedRecipients": {
        "type": "array",
        "description": "Allowed recipient domains (empty = all)",
        "items": {
          "type": "string",
          "format": "hostname"
        },
        "uniqueItems": true,
        "env": "NOTIFY_ALLOWED_RECIPIENTS"
      },
      "rateLimitPerMinute": {
        "type": "integer",
        "description": "Maximum emails per minute",
        "minimum": 1,
        "maximum": 1000,
        "env": "NOTIFY_RATE_LIMIT",
        "default": 60
      }
    },
    "required": ["fromAddress"],
    "groups": [
      {
        "name": "SMTP Server",
        "description": "Mail server connection settings",
        "properties": ["smtpHost", "smtpPort", "smtpTls"]
      },
      {
        "name": "Authentication",
        "description": "SMTP credentials (BYOK)",
        "properties": ["smtpUsername", "smtpPassword"]
      },
      {
        "name": "Sending",
        "description": "Email sending options",
        "properties": ["fromAddress", "allowedRecipients", "rateLimitPerMinute"]
      }
    ]
  }
}
```

---

## Related Documentation

- [Module Manifest](./MODULE-MANIFEST.md) - Complete module.json reference
- [Lifecycle Hooks](./LIFECYCLE-HOOKS.md) - How modules start/stop
- [Connection Abstraction](./CONNECTION-ABSTRACTION.md) - Database/cache requirements

---

## Schema Reference

The complete JSON Schema for configuration is at:

```
foundation/schemas/config.schema.json
```

Use this for IDE autocompletion and validation.
