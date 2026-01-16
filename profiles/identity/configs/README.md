# Identity Provider Configuration

This directory contains configuration files for the Community Solid Server (CSS).

## Files

- `file.json` - Main CSS configuration (file-based storage mode)

## Configuration Options

The default `file.json` configuration provides:

- File-based storage for pods
- WebID authentication
- OAuth 2.0 / OpenID Connect support
- WebSocket notifications
- Web Access Control (WAC) authorization

## Customization

To customize the server behavior, you can:

1. **Modify imports** - Add or remove CSS config modules
2. **Override components** - Add custom component configurations to the `@graph` array

### Common Customizations

**Enable memory storage (for testing):**
Replace `"css:config/storage/backend/file.json"` with `"css:config/storage/backend/memory.json"`

**Disable registration:**
Replace `"css:config/identity/access/public.json"` with `"css:config/identity/access/restricted.json"`

**Use static root pod:**
Add `"css:config/identity/pod/static.json"` to serve a static root container

## Resources

- [CSS Configuration Documentation](https://communitysolidserver.github.io/CommunitySolidServer/latest/usage/configuration/)
- [CSS Component Configs](https://github.com/CommunitySolidServer/CommunitySolidServer/tree/main/config)
