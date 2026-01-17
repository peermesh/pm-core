"""
PeerMesh Foundation - Event Bus Interface

This file defines the Python protocol (interface) for the event bus system.
The foundation core includes only this interface - actual implementations
are provided by add-on modules (e.g., eventbus-redis, eventbus-nats, eventbus-memory).

Usage:
    from foundation.interfaces.eventbus import EventBus, Event

Example:
    # Publishing an event
    await event_bus.publish(
        topic='backup-module.backup.completed',
        payload={
            'backup_id': 'daily-2024-01-16',
            'size': 1073741824,
            'duration': 45000
        }
    )

    # Subscribing to events
    subscription = event_bus.subscribe(
        topic='backup-module.backup.*',
        handler=lambda event: print(f"Backup event: {event.type}")
    )

    # Cleanup when done
    event_bus.unsubscribe(subscription)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Awaitable, Callable, Dict, List, Optional, Protocol, TypeVar, Union
from datetime import datetime
import uuid

T = TypeVar('T')


class HealthStatus(str, Enum):
    """Health status values for modules."""
    HEALTHY = 'healthy'
    DEGRADED = 'degraded'
    UNHEALTHY = 'unhealthy'
    UNKNOWN = 'unknown'


class CheckStatus(str, Enum):
    """Individual health check status values."""
    PASS = 'pass'
    WARN = 'warn'
    FAIL = 'fail'


class StopReason(str, Enum):
    """Reasons a module may be stopped."""
    REQUESTED = 'requested'
    ERROR = 'error'
    DEPENDENCY = 'dependency'
    SYSTEM_SHUTDOWN = 'system-shutdown'


@dataclass
class HealthCheck:
    """Individual health check result."""
    name: str
    status: CheckStatus
    message: Optional[str] = None


@dataclass
class EventMetadata:
    """Additional metadata about an event."""
    version: Optional[str] = None
    retry_count: Optional[int] = None
    original_timestamp: Optional[int] = None
    extra: Dict[str, Any] = field(default_factory=dict)


@dataclass
class Event:
    """
    Event represents a message published on the event bus.

    Events follow the CloudEvents specification with PeerMesh extensions.
    All events must have an id, timestamp, source module, and type.

    Attributes:
        id: Unique event identifier (UUIDv4)
        timestamp: Unix timestamp in milliseconds when event was created
        source: Module ID that emitted this event
        type: Event type in format: source.entity.action
        specversion: Event format specification version
        datacontenttype: Content type of the payload
        subject: Specific subject/resource this event relates to
        correlation_id: ID linking related events in a workflow
        causation_id: ID of the event that caused this event
        payload: Event-specific data
        metadata: Additional metadata about the event
    """
    id: str
    timestamp: int
    source: str
    type: str
    specversion: str = '1.0'
    datacontenttype: str = 'application/json'
    subject: Optional[str] = None
    correlation_id: Optional[str] = None
    causation_id: Optional[str] = None
    payload: Optional[Dict[str, Any]] = None
    metadata: Optional[EventMetadata] = None

    @classmethod
    def create(
        cls,
        source: str,
        event_type: str,
        payload: Optional[Dict[str, Any]] = None,
        subject: Optional[str] = None,
        correlation_id: Optional[str] = None,
        causation_id: Optional[str] = None,
    ) -> 'Event':
        """
        Factory method to create a new event with auto-generated id and timestamp.

        Args:
            source: Module ID that is emitting this event
            event_type: Event type (e.g., "module.entity.action")
            payload: Event-specific data
            subject: Specific subject/resource this event relates to
            correlation_id: ID linking related events in a workflow
            causation_id: ID of the event that caused this event

        Returns:
            A new Event instance
        """
        return cls(
            id=str(uuid.uuid4()),
            timestamp=int(datetime.utcnow().timestamp() * 1000),
            source=source,
            type=event_type,
            payload=payload,
            subject=subject,
            correlation_id=correlation_id,
            causation_id=causation_id,
        )


@dataclass
class Subscription:
    """
    Subscription represents an active event subscription.

    Use the subscription ID to unsubscribe when the handler is no longer needed.

    Attributes:
        id: Unique subscription identifier
        topic: Topic pattern this subscription is listening to
        active: Whether the subscription is currently active
    """
    id: str
    topic: str
    active: bool = True


@dataclass
class SubscribeOptions:
    """
    Configuration for event subscription.

    Attributes:
        exclude_self: If True, only receive events from other modules (not from self)
        group: Consumer group name for competing consumers pattern
        from_beginning: If True, receive historical events from the beginning
    """
    exclude_self: bool = False
    group: Optional[str] = None
    from_beginning: bool = False


@dataclass
class PublishOptions:
    """
    Configuration for event publishing.

    Attributes:
        correlation_id: Correlation ID to link this event with a workflow
        causation_id: Causation ID indicating what event caused this one
        wait_for_ack: If True, wait for the event to be acknowledged/persisted
    """
    correlation_id: Optional[str] = None
    causation_id: Optional[str] = None
    wait_for_ack: bool = False


# Type alias for event handlers
EventHandler = Callable[[Event], Union[None, Awaitable[None]]]


class EventBus(Protocol):
    """
    EventBus is the core protocol (interface) for inter-module communication.

    Modules use the event bus to publish events and subscribe to topics.
    The foundation core provides a no-op implementation; actual implementations
    are provided by add-on modules.

    This is a Protocol class - it defines the interface that implementations must follow.
    Use this for type hints; do not instantiate directly.
    """

    async def publish(
        self,
        topic: str,
        payload: Any,
        options: Optional[PublishOptions] = None,
    ) -> None:
        """
        Publish an event to the event bus.

        Args:
            topic: Topic to publish to (e.g., "module.entity.action")
            payload: Event payload data
            options: Optional publish configuration
        """
        ...

    def subscribe(
        self,
        topic: str,
        handler: EventHandler,
        options: Optional[SubscribeOptions] = None,
    ) -> Subscription:
        """
        Subscribe to events matching a topic pattern.

        Topic patterns support wildcards:
        - `*` matches a single segment (e.g., "module.*.created")
        - `#` matches zero or more segments (e.g., "module.#")

        Args:
            topic: Topic pattern to subscribe to
            handler: Function to call when events are received
            options: Optional subscription configuration

        Returns:
            Subscription object that can be used to unsubscribe
        """
        ...

    def unsubscribe(self, subscription: Subscription) -> None:
        """
        Unsubscribe from a topic.

        Args:
            subscription: Subscription to cancel
        """
        ...

    def is_connected(self) -> bool:
        """
        Check if the event bus is connected and operational.

        Returns:
            True if the event bus is ready to use
        """
        ...

    async def close(self) -> None:
        """
        Gracefully close the event bus connection.
        """
        ...


# Standard event types defined by the foundation
class FoundationEventTypes:
    """Standard event types defined by the foundation core."""
    MODULE_INSTALLED = 'foundation.module.installed'
    MODULE_STARTED = 'foundation.module.started'
    MODULE_STOPPED = 'foundation.module.stopped'
    MODULE_UNINSTALLED = 'foundation.module.uninstalled'
    MODULE_HEALTH_CHANGED = 'foundation.module.health-changed'
    MODULE_CONFIG_UPDATED = 'foundation.module.config-updated'
    CONNECTION_ESTABLISHED = 'foundation.connection.established'
    CONNECTION_LOST = 'foundation.connection.lost'
    SYSTEM_STARTUP = 'foundation.system.startup'
    SYSTEM_SHUTDOWN = 'foundation.system.shutdown'


# Payload dataclasses for standard foundation events
@dataclass
class ModuleInstalledPayload:
    """Payload for module.installed events."""
    module_id: str
    version: str
    previous_version: Optional[str] = None


@dataclass
class ModuleStartedPayload:
    """Payload for module.started events."""
    module_id: str
    startup_duration: Optional[int] = None  # milliseconds


@dataclass
class ModuleStoppedPayload:
    """Payload for module.stopped events."""
    module_id: str
    reason: StopReason


@dataclass
class ModuleHealthChangedPayload:
    """Payload for module.health-changed events."""
    module_id: str
    status: HealthStatus
    previous_status: Optional[HealthStatus] = None
    message: Optional[str] = None
    checks: Optional[List[HealthCheck]] = None
