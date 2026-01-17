/**
 * PeerMesh Foundation - Dashboard Registration Interface
 *
 * This file defines the TypeScript interfaces for the dashboard registration system.
 * Modules use these interfaces to register their UI components (routes, widgets,
 * config panels) with the dashboard at runtime.
 *
 * Core Principle: Modules declare their UI components, the dashboard renders them.
 * A module that provides backup functionality can register its backup routes,
 * status widgets, and configuration panels without knowing dashboard internals.
 *
 * @module foundation/interfaces/dashboard
 * @version 1.0.0
 */

/**
 * Navigation placement options for routes.
 */
export type NavPlacement = 'sidebar' | 'header' | 'footer' | 'settings' | 'hidden';

/**
 * Widget size options for status widgets.
 */
export type WidgetSize = 'small' | 'medium' | 'large' | 'full';

/**
 * RouteRegistration defines a route registered by a module.
 *
 * Routes are URL paths that the dashboard will render. Modules can register
 * multiple routes with their own components, navigation placement, and ordering.
 *
 * @example
 * ```typescript
 * const route: RouteRegistration = {
 *   path: '/backup',
 *   component: 'BackupDashboard',
 *   label: 'Backups',
 *   icon: 'Archive',
 *   nav: 'sidebar',
 *   order: 30
 * };
 * ```
 */
export interface RouteRegistration {
  /** URL path for this route (e.g., '/backup', '/backup/history') */
  path: string;

  /** Component name or path to lazy-load */
  component: string;

  /** Display label for navigation */
  label?: string;

  /** Icon name from the icon set (e.g., lucide-react icons) */
  icon?: string;

  /** Where this route appears in navigation (default: 'sidebar') */
  nav?: NavPlacement;

  /** Sort order in navigation (lower = higher priority, default: 100) */
  order?: number;

  /** Whether path must match exactly (default: true) */
  exact?: boolean;

  /** Nested child routes */
  children?: RouteRegistration[];
}

/**
 * WidgetRegistration defines a status widget registered by a module.
 *
 * Widgets are small UI components displayed on the main dashboard. They typically
 * show at-a-glance status information and may auto-refresh periodically.
 *
 * @example
 * ```typescript
 * const widget: WidgetRegistration = {
 *   id: 'backup-status',
 *   component: 'BackupStatusWidget',
 *   label: 'Backup Status',
 *   size: 'small',
 *   refreshInterval: 60000
 * };
 * ```
 */
export interface WidgetRegistration {
  /** Unique widget identifier within the module */
  id: string;

  /** Widget component name or path to lazy-load */
  component: string;

  /** Display label for the widget */
  label?: string;

  /** Default size of the widget (default: 'small') */
  size?: WidgetSize;

  /** Sort order on dashboard (lower = higher priority, default: 100) */
  order?: number;

  /** Auto-refresh interval in milliseconds (default: 30000) */
  refreshInterval?: number;

  /** Required permissions to view this widget */
  permissions?: string[];
}

/**
 * ConfigPanelRegistration defines a configuration panel registered by a module.
 *
 * Config panels appear in the settings area and allow users to configure
 * module-specific options.
 *
 * @example
 * ```typescript
 * const panel: ConfigPanelRegistration = {
 *   id: 'backup-settings',
 *   component: 'BackupSettingsPanel',
 *   label: 'Backup Settings',
 *   description: 'Configure backup schedules and retention',
 *   icon: 'Settings',
 *   category: 'general'
 * };
 * ```
 */
export interface ConfigPanelRegistration {
  /** Unique config panel identifier within the module */
  id: string;

  /** Config panel component name or path to lazy-load */
  component: string;

  /** Display label for the config panel */
  label?: string;

  /** Brief description of what this panel configures */
  description?: string;

  /** Icon name from the icon set */
  icon?: string;

  /** Category grouping in settings (default: 'general') */
  category?: string;

  /** Sort order within category (lower = higher priority, default: 100) */
  order?: number;

  /** Required permissions to access this config panel */
  permissions?: string[];
}

/**
 * DashboardRegistration is the complete registration payload from a module.
 *
 * This is what modules submit to register all their UI components with
 * the dashboard at once.
 *
 * @example
 * ```typescript
 * const registration: DashboardRegistration = {
 *   moduleId: 'backup-module',
 *   displayName: 'Backup Manager',
 *   icon: 'Archive',
 *   version: '1.0.0',
 *   routes: [
 *     { path: '/backup', component: 'BackupDashboard', label: 'Backups', icon: 'Archive' }
 *   ],
 *   widgets: [
 *     { id: 'backup-status', component: 'BackupStatusWidget', label: 'Backup Status' }
 *   ],
 *   configPanels: [
 *     { id: 'backup-settings', component: 'BackupSettingsPanel', label: 'Backup Settings' }
 *   ]
 * };
 * ```
 */
export interface DashboardRegistration {
  /** Module ID registering these components */
  moduleId: string;

  /** Human-readable module name for display */
  displayName?: string;

  /** Default icon for this module */
  icon?: string;

  /** Module version */
  version?: string;

  /** Routes registered by this module */
  routes?: RouteRegistration[];

  /** Status widgets registered by this module */
  widgets?: WidgetRegistration[];

  /** Configuration panels registered by this module */
  configPanels?: ConfigPanelRegistration[];
}

/**
 * RegistrationResult is returned after a registration operation.
 */
export interface RegistrationResult {
  /** Whether registration was successful */
  success: boolean;

  /** Module ID that was registered */
  moduleId: string;

  /** Number of routes registered */
  routesRegistered?: number;

  /** Number of widgets registered */
  widgetsRegistered?: number;

  /** Number of config panels registered */
  configPanelsRegistered?: number;

  /** Error messages if registration failed */
  errors?: string[];

  /** Non-fatal warnings during registration */
  warnings?: string[];
}

/**
 * RegistrationQuery options for querying registrations.
 */
export interface RegistrationQuery {
  /** Filter by module ID */
  moduleId?: string;

  /** Filter by route path pattern */
  pathPattern?: string;

  /** Filter by nav placement */
  nav?: NavPlacement;

  /** Include only routes with specific permissions */
  permissions?: string[];
}

/**
 * DashboardRegistry is the protocol for managing dashboard registrations.
 *
 * The dashboard core implements this interface; modules call register()
 * to add their UI components and can later unregister them.
 *
 * If no dashboard is installed, calls to this interface are no-ops.
 *
 * @example
 * ```typescript
 * const registry: DashboardRegistry = getDashboardRegistry();
 *
 * // Register module components
 * const result = await registry.register({
 *   moduleId: 'backup-module',
 *   displayName: 'Backup Manager',
 *   routes: [...],
 *   widgets: [...]
 * });
 *
 * if (result.success) {
 *   console.log(`Registered ${result.routesRegistered} routes`);
 * }
 *
 * // Later, when module is uninstalled
 * await registry.unregister('backup-module');
 * ```
 */
export interface DashboardRegistry {
  /**
   * Register a module's dashboard components.
   *
   * @param registration - Dashboard registration payload
   * @returns Registration result with counts and any errors
   */
  register(registration: DashboardRegistration): Promise<RegistrationResult>;

  /**
   * Unregister all components for a module.
   *
   * @param moduleId - Module ID to unregister
   * @returns True if unregistration was successful
   */
  unregister(moduleId: string): Promise<boolean>;

  /**
   * Get all registrations, optionally filtered.
   *
   * @param query - Optional query to filter registrations
   * @returns Array of matching registrations
   */
  getRegistrations(query?: RegistrationQuery): Promise<DashboardRegistration[]>;

  /**
   * Get a specific module's registration.
   *
   * @param moduleId - Module ID to retrieve
   * @returns Registration or undefined if not found
   */
  getRegistration(moduleId: string): Promise<DashboardRegistration | undefined>;

  /**
   * Get all registered routes.
   *
   * @param nav - Optional nav placement filter
   * @returns Array of all routes with their moduleId
   */
  getRoutes(nav?: NavPlacement): Promise<Array<RouteRegistration & { moduleId: string }>>;

  /**
   * Get all registered widgets.
   *
   * @returns Array of all widgets with their moduleId
   */
  getWidgets(): Promise<Array<WidgetRegistration & { moduleId: string }>>;

  /**
   * Get all registered config panels.
   *
   * @param category - Optional category filter
   * @returns Array of all config panels with their moduleId
   */
  getConfigPanels(category?: string): Promise<Array<ConfigPanelRegistration & { moduleId: string }>>;

  /**
   * Check if the dashboard is available.
   *
   * @returns True if the dashboard module is installed and ready
   */
  isAvailable(): boolean;
}

/**
 * Event types emitted by the dashboard registry.
 */
export const DASHBOARD_EVENT_TYPES = {
  MODULE_REGISTERED: 'dashboard.module.registered',
  MODULE_UNREGISTERED: 'dashboard.module.unregistered',
  ROUTE_ADDED: 'dashboard.route.added',
  ROUTE_REMOVED: 'dashboard.route.removed',
  WIDGET_ADDED: 'dashboard.widget.added',
  WIDGET_REMOVED: 'dashboard.widget.removed',
  CONFIG_PANEL_ADDED: 'dashboard.config-panel.added',
  CONFIG_PANEL_REMOVED: 'dashboard.config-panel.removed',
} as const;

/**
 * Payload for module registered event.
 */
export interface ModuleRegisteredPayload {
  moduleId: string;
  displayName?: string;
  routeCount: number;
  widgetCount: number;
  configPanelCount: number;
}

/**
 * Payload for module unregistered event.
 */
export interface ModuleUnregisteredPayload {
  moduleId: string;
}

/**
 * Payload for route added event.
 */
export interface RouteAddedPayload {
  moduleId: string;
  route: RouteRegistration;
}

/**
 * Payload for widget added event.
 */
export interface WidgetAddedPayload {
  moduleId: string;
  widget: WidgetRegistration;
}

/**
 * Payload for config panel added event.
 */
export interface ConfigPanelAddedPayload {
  moduleId: string;
  configPanel: ConfigPanelRegistration;
}

/**
 * NoopDashboardRegistry is a no-operation implementation.
 *
 * When no dashboard module is installed, this implementation can be used
 * to satisfy the DashboardRegistry interface without any actual registration.
 */
export class NoopDashboardRegistry implements DashboardRegistry {
  private warned = false;

  private warnOnce(): void {
    if (!this.warned) {
      console.warn('[Dashboard] Dashboard module not installed. Registration has no effect.');
      this.warned = true;
    }
  }

  async register(registration: DashboardRegistration): Promise<RegistrationResult> {
    this.warnOnce();
    return {
      success: true,
      moduleId: registration.moduleId,
      routesRegistered: 0,
      widgetsRegistered: 0,
      configPanelsRegistered: 0,
      warnings: ['Dashboard module not installed; registration ignored'],
    };
  }

  async unregister(_moduleId: string): Promise<boolean> {
    return true;
  }

  async getRegistrations(_query?: RegistrationQuery): Promise<DashboardRegistration[]> {
    return [];
  }

  async getRegistration(_moduleId: string): Promise<DashboardRegistration | undefined> {
    return undefined;
  }

  async getRoutes(_nav?: NavPlacement): Promise<Array<RouteRegistration & { moduleId: string }>> {
    return [];
  }

  async getWidgets(): Promise<Array<WidgetRegistration & { moduleId: string }>> {
    return [];
  }

  async getConfigPanels(_category?: string): Promise<Array<ConfigPanelRegistration & { moduleId: string }>> {
    return [];
  }

  isAvailable(): boolean {
    return false;
  }
}
