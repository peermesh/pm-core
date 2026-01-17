# Dashboard Registration API

This document describes how modules register their UI components (routes, widgets, configuration panels) with the PeerMesh Dashboard.

## Overview

The Dashboard Registration API allows modules to extend the dashboard without modifying its core code. Modules declare their UI components in their manifest or through a registration API, and the dashboard dynamically includes them at runtime.

**Core Principle**: Modules declare their UI components; the dashboard renders them.

### Key Concepts

- **Routes**: URL paths that render module-specific pages (e.g., `/backup`, `/monitoring`)
- **Widgets**: Small status components displayed on the main dashboard
- **Config Panels**: Settings pages for module configuration

### When No Dashboard is Installed

If no dashboard module is installed, registration calls are **no-ops**. The registration functions return success but do nothing. This allows modules to always call registration functions without checking for dashboard availability.

## Schema

Dashboard registrations follow the schema defined in:
- **JSON Schema**: `foundation/schemas/dashboard.schema.json`
- **TypeScript**: `foundation/interfaces/dashboard.ts`
- **Python**: `foundation/interfaces/dashboard.py`

## Registration Structure

### DashboardRegistration

The main registration payload:

```json
{
  "moduleId": "backup-module",
  "displayName": "Backup Manager",
  "icon": "Archive",
  "version": "1.0.0",
  "routes": [...],
  "widgets": [...],
  "configPanels": [...]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `moduleId` | string | Yes | Module ID (must match module manifest) |
| `displayName` | string | No | Human-readable name for UI |
| `icon` | string | No | Icon name (e.g., lucide-react icon) |
| `version` | string | No | Module version |
| `routes` | array | No | Routes to register |
| `widgets` | array | No | Widgets to register |
| `configPanels` | array | No | Config panels to register |

### RouteRegistration

```json
{
  "path": "/backup",
  "component": "BackupDashboard",
  "label": "Backups",
  "icon": "Archive",
  "nav": "sidebar",
  "order": 30,
  "exact": true,
  "children": []
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `path` | string | - | URL path (e.g., `/backup`) |
| `component` | string | - | Component name to render |
| `label` | string | - | Navigation label |
| `icon` | string | - | Navigation icon |
| `nav` | string | `sidebar` | Placement: `sidebar`, `header`, `footer`, `settings`, `hidden` |
| `order` | number | `100` | Sort order (lower = higher priority) |
| `exact` | boolean | `true` | Exact path matching |
| `children` | array | - | Nested child routes |

### WidgetRegistration

```json
{
  "id": "backup-status",
  "component": "BackupStatusWidget",
  "label": "Backup Status",
  "size": "small",
  "order": 20,
  "refreshInterval": 60000,
  "permissions": ["backup:read"]
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | - | Unique widget ID within module |
| `component` | string | - | Widget component name |
| `label` | string | - | Widget title |
| `size` | string | `small` | Size: `small`, `medium`, `large`, `full` |
| `order` | number | `100` | Sort order on dashboard |
| `refreshInterval` | number | `30000` | Auto-refresh interval (ms) |
| `permissions` | array | - | Required permissions to view |

### ConfigPanelRegistration

```json
{
  "id": "backup-settings",
  "component": "BackupSettingsPanel",
  "label": "Backup Settings",
  "description": "Configure backup schedules and retention",
  "icon": "Settings",
  "category": "general",
  "order": 10,
  "permissions": ["backup:config"]
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | - | Unique panel ID within module |
| `component` | string | - | Panel component name |
| `label` | string | - | Panel title in settings |
| `description` | string | - | Brief description |
| `icon` | string | - | Icon in settings nav |
| `category` | string | `general` | Settings category grouping |
| `order` | number | `100` | Sort order within category |
| `permissions` | array | - | Required permissions |

## Registration Methods

### Method 1: Module Manifest (Recommended)

Declare dashboard components in your module's `module.json`:

```json
{
  "id": "backup-module",
  "name": "Backup Manager",
  "version": "1.0.0",
  "dashboard": {
    "routes": [
      {
        "path": "/backup",
        "component": "BackupDashboard",
        "label": "Backups",
        "icon": "Archive",
        "nav": "sidebar",
        "order": 30
      }
    ],
    "widgets": [
      {
        "id": "backup-status",
        "component": "BackupStatusWidget",
        "label": "Backup Status",
        "size": "small"
      }
    ],
    "configPanels": [
      {
        "id": "backup-settings",
        "component": "BackupSettingsPanel",
        "label": "Backup Settings"
      }
    ]
  }
}
```

Then use the registration script:

```bash
./foundation/lib/dashboard-register.sh backup-module
```

### Method 2: TypeScript API

```typescript
import { DashboardRegistry, DashboardRegistration } from 'foundation/interfaces/dashboard';

// Get registry instance (provided by dashboard module or noop)
const registry: DashboardRegistry = getDashboardRegistry();

// Register components
const registration: DashboardRegistration = {
  moduleId: 'backup-module',
  displayName: 'Backup Manager',
  icon: 'Archive',
  routes: [
    {
      path: '/backup',
      component: 'BackupDashboard',
      label: 'Backups',
      icon: 'Archive',
      nav: 'sidebar',
      order: 30
    }
  ],
  widgets: [
    {
      id: 'backup-status',
      component: 'BackupStatusWidget',
      label: 'Backup Status',
      size: 'small',
      refreshInterval: 60000
    }
  ]
};

const result = await registry.register(registration);

if (result.success) {
  console.log(`Registered ${result.routesRegistered} routes`);
  console.log(`Registered ${result.widgetsRegistered} widgets`);
} else {
  console.error('Registration failed:', result.errors);
}

// Later: unregister on module removal
await registry.unregister('backup-module');
```

### Method 3: Python API

```python
from foundation.interfaces.dashboard import (
    DashboardRegistration,
    DashboardRegistry,
    RouteRegistration,
    WidgetRegistration,
    NavPlacement,
    WidgetSize,
)

# Get registry instance
registry: DashboardRegistry = get_dashboard_registry()

# Register components
registration = DashboardRegistration(
    module_id='backup-module',
    display_name='Backup Manager',
    icon='Archive',
    routes=[
        RouteRegistration(
            path='/backup',
            component='BackupDashboard',
            label='Backups',
            icon='Archive',
            nav=NavPlacement.SIDEBAR,
            order=30
        )
    ],
    widgets=[
        WidgetRegistration(
            id='backup-status',
            component='BackupStatusWidget',
            label='Backup Status',
            size=WidgetSize.SMALL,
            refresh_interval=60000
        )
    ]
)

result = await registry.register(registration)

if result.success:
    print(f"Registered {result.routes_registered} routes")
    print(f"Registered {result.widgets_registered} widgets")
else:
    print(f"Registration failed: {result.errors}")

# Later: unregister on module removal
await registry.unregister('backup-module')
```

### Method 4: Bash Script

```bash
#!/usr/bin/env bash

# Register a module's dashboard components
./foundation/lib/dashboard-register.sh my-module

# JSON output
./foundation/lib/dashboard-register.sh my-module --json

# Quiet mode (suppress warnings)
./foundation/lib/dashboard-register.sh my-module --quiet

# Unregister
./foundation/lib/dashboard-register.sh my-module --unregister
```

## Events

The dashboard registry emits events when registrations change:

| Event | Description |
|-------|-------------|
| `dashboard.module.registered` | Module registered its components |
| `dashboard.module.unregistered` | Module unregistered |
| `dashboard.route.added` | New route registered |
| `dashboard.route.removed` | Route removed |
| `dashboard.widget.added` | New widget registered |
| `dashboard.widget.removed` | Widget removed |
| `dashboard.config-panel.added` | New config panel registered |
| `dashboard.config-panel.removed` | Config panel removed |

Subscribe to events (TypeScript):

```typescript
eventBus.subscribe('dashboard.module.registered', (event) => {
  const payload = event.payload as ModuleRegisteredPayload;
  console.log(`Module ${payload.moduleId} registered ${payload.routeCount} routes`);
});
```

## Querying Registrations

### Get All Registrations

```typescript
const all = await registry.getRegistrations();
```

### Get Filtered Registrations

```typescript
// By module
const byModule = await registry.getRegistrations({ moduleId: 'backup-module' });

// By nav placement
const sidebarRoutes = await registry.getRoutes('sidebar');

// By category
const generalPanels = await registry.getConfigPanels('general');
```

### Get All Routes

```typescript
const routes = await registry.getRoutes();
// Returns routes with moduleId attached
for (const route of routes) {
  console.log(`${route.moduleId}: ${route.path} -> ${route.component}`);
}
```

### Get All Widgets

```typescript
const widgets = await registry.getWidgets();
// Sorted by order
for (const widget of widgets) {
  console.log(`${widget.moduleId}: ${widget.id} (${widget.size})`);
}
```

## No-Op Behavior

When no dashboard is installed, the `NoopDashboardRegistry` is used:

- `register()` returns success with 0 items registered and a warning
- `unregister()` returns true
- `getRegistrations()` returns empty array
- `getRoutes()`, `getWidgets()`, `getConfigPanels()` return empty arrays
- `isAvailable()` returns false

This allows modules to always call registration functions without conditional checks.

## Best Practices

1. **Use descriptive paths**: `/backup` not `/b`
2. **Set reasonable orders**: Use multiples of 10 for easy insertion
3. **Include icons**: Improves navigation UX
4. **Use permissions**: Protect sensitive panels
5. **Set refresh intervals wisely**: Don't refresh too frequently
6. **Categorize config panels**: Use meaningful categories

## Examples

### Monitoring Module

```json
{
  "moduleId": "monitoring",
  "displayName": "System Monitor",
  "icon": "Activity",
  "routes": [
    {
      "path": "/monitor",
      "component": "MonitorDashboard",
      "label": "Monitoring",
      "icon": "Activity",
      "nav": "sidebar",
      "order": 10
    },
    {
      "path": "/monitor/alerts",
      "component": "AlertsPage",
      "label": "Alerts",
      "nav": "hidden"
    }
  ],
  "widgets": [
    {
      "id": "cpu-usage",
      "component": "CpuWidget",
      "label": "CPU Usage",
      "size": "small",
      "refreshInterval": 5000
    },
    {
      "id": "memory-usage",
      "component": "MemoryWidget",
      "label": "Memory Usage",
      "size": "small",
      "refreshInterval": 5000
    },
    {
      "id": "service-health",
      "component": "ServiceHealthWidget",
      "label": "Service Health",
      "size": "medium",
      "refreshInterval": 10000
    }
  ],
  "configPanels": [
    {
      "id": "alert-settings",
      "component": "AlertSettingsPanel",
      "label": "Alert Configuration",
      "description": "Configure alert thresholds and notifications",
      "icon": "Bell",
      "category": "notifications"
    }
  ]
}
```

### Database Module

```json
{
  "moduleId": "database-admin",
  "displayName": "Database Admin",
  "icon": "Database",
  "routes": [
    {
      "path": "/database",
      "component": "DatabaseDashboard",
      "label": "Database",
      "icon": "Database",
      "nav": "sidebar",
      "order": 50,
      "children": [
        {
          "path": "/database/tables",
          "component": "TablesPage",
          "label": "Tables"
        },
        {
          "path": "/database/queries",
          "component": "QueriesPage",
          "label": "Query Editor"
        }
      ]
    }
  ],
  "widgets": [
    {
      "id": "db-connections",
      "component": "ConnectionsWidget",
      "label": "Active Connections",
      "size": "small",
      "refreshInterval": 10000
    },
    {
      "id": "db-size",
      "component": "DatabaseSizeWidget",
      "label": "Database Size",
      "size": "small",
      "refreshInterval": 60000
    }
  ]
}
```

## See Also

- [Module Manifest](./MODULE-MANIFEST.md) - Module configuration
- [Event Bus Interface](./EVENT-BUS-INTERFACE.md) - Inter-module events
- [Connection Abstraction](./CONNECTION-ABSTRACTION.md) - Service connections
