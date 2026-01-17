"""
PeerMesh Foundation - Dashboard Registration Interface

This file defines the Python protocols (interfaces) for the dashboard registration system.
Modules use these interfaces to register their UI components (routes, widgets,
config panels) with the dashboard at runtime.

Core Principle: Modules declare their UI components, the dashboard renders them.
A module that provides backup functionality can register its backup routes,
status widgets, and configuration panels without knowing dashboard internals.

Usage:
    from foundation.interfaces.dashboard import (
        DashboardRegistration,
        DashboardRegistry,
        RouteRegistration,
        WidgetRegistration,
    )

Example:
    registration = DashboardRegistration(
        module_id='backup-module',
        display_name='Backup Manager',
        icon='Archive',
        routes=[
            RouteRegistration(
                path='/backup',
                component='BackupDashboard',
                label='Backups',
                icon='Archive'
            )
        ],
        widgets=[
            WidgetRegistration(
                id='backup-status',
                component='BackupStatusWidget',
                label='Backup Status'
            )
        ]
    )

    result = await registry.register(registration)
    if result.success:
        print(f"Registered {result.routes_registered} routes")
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Protocol


class NavPlacement(str, Enum):
    """Navigation placement options for routes."""
    SIDEBAR = 'sidebar'
    HEADER = 'header'
    FOOTER = 'footer'
    SETTINGS = 'settings'
    HIDDEN = 'hidden'


class WidgetSize(str, Enum):
    """Widget size options for status widgets."""
    SMALL = 'small'
    MEDIUM = 'medium'
    LARGE = 'large'
    FULL = 'full'


@dataclass
class RouteRegistration:
    """
    A route registered by a module for the dashboard.

    Routes are URL paths that the dashboard will render. Modules can register
    multiple routes with their own components, navigation placement, and ordering.

    Attributes:
        path: URL path for this route (e.g., '/backup', '/backup/history')
        component: Component name or path to lazy-load
        label: Display label for navigation
        icon: Icon name from the icon set (e.g., lucide-react icons)
        nav: Where this route appears in navigation (default: 'sidebar')
        order: Sort order in navigation (lower = higher priority, default: 100)
        exact: Whether path must match exactly (default: True)
        children: Nested child routes

    Example:
        route = RouteRegistration(
            path='/backup',
            component='BackupDashboard',
            label='Backups',
            icon='Archive',
            nav=NavPlacement.SIDEBAR,
            order=30
        )
    """
    path: str
    component: str
    label: Optional[str] = None
    icon: Optional[str] = None
    nav: NavPlacement = NavPlacement.SIDEBAR
    order: int = 100
    exact: bool = True
    children: Optional[List['RouteRegistration']] = None


@dataclass
class WidgetRegistration:
    """
    A status widget registered by a module.

    Widgets are small UI components displayed on the main dashboard. They typically
    show at-a-glance status information and may auto-refresh periodically.

    Attributes:
        id: Unique widget identifier within the module
        component: Widget component name or path to lazy-load
        label: Display label for the widget
        size: Default size of the widget (default: 'small')
        order: Sort order on dashboard (lower = higher priority, default: 100)
        refresh_interval: Auto-refresh interval in milliseconds (default: 30000)
        permissions: Required permissions to view this widget

    Example:
        widget = WidgetRegistration(
            id='backup-status',
            component='BackupStatusWidget',
            label='Backup Status',
            size=WidgetSize.SMALL,
            refresh_interval=60000
        )
    """
    id: str
    component: str
    label: Optional[str] = None
    size: WidgetSize = WidgetSize.SMALL
    order: int = 100
    refresh_interval: int = 30000
    permissions: Optional[List[str]] = None


@dataclass
class ConfigPanelRegistration:
    """
    A configuration panel registered by a module.

    Config panels appear in the settings area and allow users to configure
    module-specific options.

    Attributes:
        id: Unique config panel identifier within the module
        component: Config panel component name or path to lazy-load
        label: Display label for the config panel
        description: Brief description of what this panel configures
        icon: Icon name from the icon set
        category: Category grouping in settings (default: 'general')
        order: Sort order within category (lower = higher priority, default: 100)
        permissions: Required permissions to access this config panel

    Example:
        panel = ConfigPanelRegistration(
            id='backup-settings',
            component='BackupSettingsPanel',
            label='Backup Settings',
            description='Configure backup schedules and retention',
            icon='Settings',
            category='general'
        )
    """
    id: str
    component: str
    label: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None
    category: str = 'general'
    order: int = 100
    permissions: Optional[List[str]] = None


@dataclass
class DashboardRegistration:
    """
    Complete dashboard registration for a module.

    This is what modules submit to register all their UI components with
    the dashboard at once.

    Attributes:
        module_id: Module ID registering these components
        display_name: Human-readable module name for display
        icon: Default icon for this module
        version: Module version
        routes: Routes registered by this module
        widgets: Status widgets registered by this module
        config_panels: Configuration panels registered by this module

    Example:
        registration = DashboardRegistration(
            module_id='backup-module',
            display_name='Backup Manager',
            icon='Archive',
            version='1.0.0',
            routes=[
                RouteRegistration(path='/backup', component='BackupDashboard')
            ],
            widgets=[
                WidgetRegistration(id='backup-status', component='BackupStatusWidget')
            ],
            config_panels=[
                ConfigPanelRegistration(id='backup-settings', component='BackupSettingsPanel')
            ]
        )
    """
    module_id: str
    display_name: Optional[str] = None
    icon: Optional[str] = None
    version: Optional[str] = None
    routes: List[RouteRegistration] = field(default_factory=list)
    widgets: List[WidgetRegistration] = field(default_factory=list)
    config_panels: List[ConfigPanelRegistration] = field(default_factory=list)


@dataclass
class RegistrationResult:
    """
    Result of a dashboard registration operation.

    Attributes:
        success: Whether registration was successful
        module_id: Module ID that was registered
        routes_registered: Number of routes registered
        widgets_registered: Number of widgets registered
        config_panels_registered: Number of config panels registered
        errors: Error messages if registration failed
        warnings: Non-fatal warnings during registration
    """
    success: bool
    module_id: str
    routes_registered: int = 0
    widgets_registered: int = 0
    config_panels_registered: int = 0
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)


@dataclass
class RegistrationQuery:
    """
    Query options for filtering registrations.

    Attributes:
        module_id: Filter by module ID
        path_pattern: Filter by route path pattern
        nav: Filter by nav placement
        permissions: Include only routes with specific permissions
    """
    module_id: Optional[str] = None
    path_pattern: Optional[str] = None
    nav: Optional[NavPlacement] = None
    permissions: Optional[List[str]] = None


@dataclass
class RouteWithModule(RouteRegistration):
    """Route registration with associated module ID."""
    module_id: str = ''


@dataclass
class WidgetWithModule(WidgetRegistration):
    """Widget registration with associated module ID."""
    module_id: str = ''


@dataclass
class ConfigPanelWithModule(ConfigPanelRegistration):
    """Config panel registration with associated module ID."""
    module_id: str = ''


class DashboardRegistry(Protocol):
    """
    Protocol for managing dashboard registrations.

    The dashboard core implements this protocol; modules call register()
    to add their UI components and can later unregister them.

    If no dashboard is installed, calls to this protocol are no-ops.

    Example:
        result = await registry.register(DashboardRegistration(
            module_id='backup-module',
            display_name='Backup Manager',
            routes=[...],
            widgets=[...]
        ))

        if result.success:
            print(f"Registered {result.routes_registered} routes")

        # Later, when module is uninstalled
        await registry.unregister('backup-module')
    """

    async def register(self, registration: DashboardRegistration) -> RegistrationResult:
        """
        Register a module's dashboard components.

        Args:
            registration: Dashboard registration payload

        Returns:
            Registration result with counts and any errors
        """
        ...

    async def unregister(self, module_id: str) -> bool:
        """
        Unregister all components for a module.

        Args:
            module_id: Module ID to unregister

        Returns:
            True if unregistration was successful
        """
        ...

    async def get_registrations(
        self,
        query: Optional[RegistrationQuery] = None
    ) -> List[DashboardRegistration]:
        """
        Get all registrations, optionally filtered.

        Args:
            query: Optional query to filter registrations

        Returns:
            List of matching registrations
        """
        ...

    async def get_registration(self, module_id: str) -> Optional[DashboardRegistration]:
        """
        Get a specific module's registration.

        Args:
            module_id: Module ID to retrieve

        Returns:
            Registration or None if not found
        """
        ...

    async def get_routes(self, nav: Optional[NavPlacement] = None) -> List[RouteWithModule]:
        """
        Get all registered routes.

        Args:
            nav: Optional nav placement filter

        Returns:
            List of all routes with their module_id
        """
        ...

    async def get_widgets(self) -> List[WidgetWithModule]:
        """
        Get all registered widgets.

        Returns:
            List of all widgets with their module_id
        """
        ...

    async def get_config_panels(
        self,
        category: Optional[str] = None
    ) -> List[ConfigPanelWithModule]:
        """
        Get all registered config panels.

        Args:
            category: Optional category filter

        Returns:
            List of all config panels with their module_id
        """
        ...

    def is_available(self) -> bool:
        """
        Check if the dashboard is available.

        Returns:
            True if the dashboard module is installed and ready
        """
        ...


# Standard event types defined by the dashboard
class DashboardEventTypes:
    """Standard event types emitted by the dashboard registry."""
    MODULE_REGISTERED = 'dashboard.module.registered'
    MODULE_UNREGISTERED = 'dashboard.module.unregistered'
    ROUTE_ADDED = 'dashboard.route.added'
    ROUTE_REMOVED = 'dashboard.route.removed'
    WIDGET_ADDED = 'dashboard.widget.added'
    WIDGET_REMOVED = 'dashboard.widget.removed'
    CONFIG_PANEL_ADDED = 'dashboard.config-panel.added'
    CONFIG_PANEL_REMOVED = 'dashboard.config-panel.removed'


@dataclass
class ModuleRegisteredPayload:
    """Payload for module registered event."""
    module_id: str
    display_name: Optional[str] = None
    route_count: int = 0
    widget_count: int = 0
    config_panel_count: int = 0


@dataclass
class ModuleUnregisteredPayload:
    """Payload for module unregistered event."""
    module_id: str


@dataclass
class RouteAddedPayload:
    """Payload for route added event."""
    module_id: str
    route: RouteRegistration


@dataclass
class WidgetAddedPayload:
    """Payload for widget added event."""
    module_id: str
    widget: WidgetRegistration


@dataclass
class ConfigPanelAddedPayload:
    """Payload for config panel added event."""
    module_id: str
    config_panel: ConfigPanelRegistration


class NoopDashboardRegistry:
    """
    No-operation implementation of DashboardRegistry.

    When no dashboard module is installed, this implementation can be used
    to satisfy the DashboardRegistry protocol without any actual registration.
    """

    def __init__(self) -> None:
        self._warned = False

    def _warn_once(self) -> None:
        if not self._warned:
            import warnings
            warnings.warn(
                "[Dashboard] Dashboard module not installed. Registration has no effect.",
                stacklevel=3
            )
            self._warned = True

    async def register(self, registration: DashboardRegistration) -> RegistrationResult:
        """Register (no-op) a module's dashboard components."""
        self._warn_once()
        return RegistrationResult(
            success=True,
            module_id=registration.module_id,
            routes_registered=0,
            widgets_registered=0,
            config_panels_registered=0,
            warnings=['Dashboard module not installed; registration ignored']
        )

    async def unregister(self, module_id: str) -> bool:
        """Unregister (no-op) all components for a module."""
        return True

    async def get_registrations(
        self,
        query: Optional[RegistrationQuery] = None
    ) -> List[DashboardRegistration]:
        """Get all registrations (always empty)."""
        return []

    async def get_registration(self, module_id: str) -> Optional[DashboardRegistration]:
        """Get a specific module's registration (always None)."""
        return None

    async def get_routes(self, nav: Optional[NavPlacement] = None) -> List[RouteWithModule]:
        """Get all registered routes (always empty)."""
        return []

    async def get_widgets(self) -> List[WidgetWithModule]:
        """Get all registered widgets (always empty)."""
        return []

    async def get_config_panels(
        self,
        category: Optional[str] = None
    ) -> List[ConfigPanelWithModule]:
        """Get all registered config panels (always empty)."""
        return []

    def is_available(self) -> bool:
        """Check if dashboard is available (always False)."""
        return False
