# My Module

> Brief description of what this module does.

## Overview

Provide a more detailed explanation of the module's purpose and functionality.

## Requirements

### Foundation Version
- Minimum: 1.0.0

### Dependencies
- List any required connections (databases, caches, etc.)
- List any required modules

## Installation

```bash
# From the core root directory
cp -r foundation/templates/module-template modules/my-module
cd modules/my-module
# Edit module.json with your module details
```

**Note on relative paths**: The `$schema` in `module.json` and the `extends.file` in `docker-compose.yml` use paths like `../../foundation/...`. These resolve correctly when the module is at `modules/<name>/` but NOT from the template's own location at `foundation/templates/module-template/`. This is intentional -- the paths are designed for the copy destination.

## Configuration

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `MY_MODULE_EXAMPLE_SETTING` | An example configuration setting | `default-value` | No |
| `MY_MODULE_API_KEY` | API key for external service | - | Yes |

### Environment File

Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
# Edit .env with your values
```

## Usage

Describe how to use the module once installed.

### Dashboard

If this module registers with the dashboard:
- Navigate to `/my-module` in the dashboard
- Describe available UI features

### API

If this module exposes an API:
- Describe endpoints
- Provide examples

### Events

This module emits the following events:

| Event | Description | Payload |
|-------|-------------|---------|
| `my-module.example.created` | Emitted when... | `{ id: string, ... }` |
| `my-module.example.deleted` | Emitted when... | `{ id: string }` |

## Development

### Project Structure

```
my-module/
├── module.json           # Module manifest
├── docker-compose.yml    # Service definitions
├── .env.example          # Example environment file
├── secrets-required.txt  # List of required secret files
├── hooks/
│   ├── install.sh        # Installation script
│   ├── start.sh          # Start service script
│   ├── stop.sh           # Stop service script
│   ├── uninstall.sh      # Cleanup script
│   └── health.sh         # Health check script
└── README.md             # This file
```

### Running Locally

```bash
# Start the module
docker compose up -d

# Check logs
docker compose logs -f

# Run health check
./hooks/health.sh
```

### Testing

Describe how to run tests.

## Troubleshooting

### Common Issues

**Issue: Description of common problem**
- Solution step 1
- Solution step 2

## License

MIT License - see LICENSE file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## Support

- GitHub Issues: https://github.com/your-org/my-module/issues
- Documentation: Link to docs
