"""
PeerMesh Foundation - Connection Abstraction Interface

This file defines the Python protocols (interfaces) for the connection abstraction system.
Modules declare what connections they need (database, cache, etc.) and the foundation
resolves these to available providers at runtime.

Core Principle: Modules declare requirements, not implementations.
A module that needs "a database" can work with Postgres, MySQL, or SQLite - the
foundation matches requirements to available providers.

Usage:
    from foundation.interfaces.connection import (
        ConnectionRequirement,
        ConnectionResolver,
        ResolvedConnection,
    )

Example:
    requirement = ConnectionRequirement(
        type='database',
        providers=['postgres', 'mysql', 'sqlite'],
        required=True,
        name='primary-db'
    )

    result = await resolver.resolve('my-module', [requirement])
    if result.success:
        for conn in result.resolved:
            print(f"{conn.requirement_name} -> {conn.provider_name}")
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Literal, Optional, Protocol, TypeVar, Union


class ConnectionType(str, Enum):
    """Connection types supported by the foundation."""
    DATABASE = 'database'
    CACHE = 'cache'
    STORAGE = 'storage'
    QUEUE = 'queue'
    EVENTBUS = 'eventbus'
    CUSTOM = 'custom'


class DatabaseProvider(str, Enum):
    """Standard database providers."""
    POSTGRES = 'postgres'
    MYSQL = 'mysql'
    MARIADB = 'mariadb'
    SQLITE = 'sqlite'
    MONGODB = 'mongodb'
    COCKROACHDB = 'cockroachdb'


class CacheProvider(str, Enum):
    """Standard cache providers."""
    REDIS = 'redis'
    MEMCACHED = 'memcached'
    VALKEY = 'valkey'
    DRAGONFLY = 'dragonfly'


class StorageProvider(str, Enum):
    """Standard storage providers."""
    LOCAL = 'local'
    S3 = 's3'
    MINIO = 'minio'
    GCS = 'gcs'
    AZURE_BLOB = 'azure-blob'


class QueueProvider(str, Enum):
    """Standard queue providers."""
    RABBITMQ = 'rabbitmq'
    REDIS = 'redis'
    NATS = 'nats'
    KAFKA = 'kafka'
    SQS = 'sqs'


class EventBusProvider(str, Enum):
    """Standard event bus providers."""
    REDIS = 'redis'
    NATS = 'nats'
    KAFKA = 'kafka'
    MEMORY = 'memory'
    NOOP = 'noop'


@dataclass
class ConnectionConfig:
    """
    Configuration options for a connection.

    Attributes:
        host: Hostname or IP address
        port: Port number
        database: Database name (for database connections)
        username: Username for authentication
        password: Password for authentication (typically from env or secrets)
        ssl: Whether to use SSL/TLS
        pool_size: Connection pool size
        timeout: Connection timeout in milliseconds
        extra: Provider-specific configuration options
    """
    host: Optional[str] = None
    port: Optional[int] = None
    database: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    ssl: bool = False
    pool_size: int = 10
    timeout: int = 30000
    extra: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ConnectionRequirement:
    """
    A connection requirement declared by a module.

    Modules declare what they need, not which specific implementation.
    The foundation matches requirements to available providers.

    Attributes:
        type: Type of connection required
        providers: Acceptable providers for this connection (in order of preference)
        required: Whether this connection is required for the module to function
        name: Unique name for this connection requirement
        config: Default configuration for this connection

    Example:
        requirement = ConnectionRequirement(
            type=ConnectionType.DATABASE,
            providers=['postgres', 'mysql', 'sqlite'],
            required=True,
            name='primary-db',
            config=ConnectionConfig(pool_size=20)
        )
    """
    type: ConnectionType
    providers: List[str]
    required: bool = True
    name: Optional[str] = None
    config: Optional[ConnectionConfig] = None


@dataclass
class ConnectionProvider:
    """
    A connection provider offered by a module.

    Provider modules (like postgres-provider, redis-provider) declare what
    connection types they can satisfy.

    Attributes:
        name: Provider name (e.g., 'postgres', 'redis')
        type: Type of connection this provider offers
        provides: List of provider identifiers this satisfies
        version: Version of the provider software
        config: Default configuration for this provider

    Example:
        provider = ConnectionProvider(
            name='postgres',
            type=ConnectionType.DATABASE,
            provides=['postgres', 'postgresql'],
            version='16',
            config=ConnectionConfig(host='postgres', port=5432)
        )
    """
    name: str
    type: ConnectionType
    provides: List[str]
    version: Optional[str] = None
    config: Optional[ConnectionConfig] = None


@dataclass
class ResolvedConnection:
    """
    A connection that has been matched to a provider.

    After resolution, modules receive this object containing the final
    configuration to connect to the service.

    Attributes:
        requirement_name: Name of the requirement that was satisfied
        provider_module: Module ID providing this connection
        provider_name: Name of the provider being used
        type: Type of the connection
        config: Final resolved configuration
        connection_string: Connection string (if applicable)
        env_vars: Environment variables to set for this connection
    """
    requirement_name: str
    provider_module: str
    provider_name: str
    type: ConnectionType
    config: ConnectionConfig
    connection_string: Optional[str] = None
    env_vars: Optional[Dict[str, str]] = None


@dataclass
class UnresolvedConnection:
    """
    Information about an unresolved connection requirement.

    Attributes:
        requirement: The requirement that could not be satisfied
        reason: Reason the connection could not be resolved
    """
    requirement: ConnectionRequirement
    reason: str


@dataclass
class ResolutionResult:
    """
    Result of attempting to resolve module connections.

    Attributes:
        success: Whether all required connections were resolved
        resolved: Successfully resolved connections
        unresolved: Connections that could not be resolved
        warnings: Non-fatal warnings during resolution
    """
    success: bool
    resolved: List[ResolvedConnection]
    unresolved: List[UnresolvedConnection] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)


T = TypeVar('T')


class Connection(Protocol):
    """
    Connection represents an active connection to a service.

    This is the runtime interface that modules use to interact with
    their resolved connections.
    """

    @property
    def info(self) -> ResolvedConnection:
        """The resolved connection information."""
        ...

    async def ping(self) -> bool:
        """Check if the connection is alive."""
        ...

    def get_client(self) -> Any:
        """Get the raw connection client (type depends on provider)."""
        ...

    async def close(self) -> None:
        """Close the connection."""
        ...


class ConnectionFactory(Protocol):
    """
    ConnectionFactory creates Connection instances from resolved configurations.

    Each provider module registers a factory for its connection type.
    """

    @property
    def provider_name(self) -> str:
        """Provider name this factory handles."""
        ...

    @property
    def connection_type(self) -> ConnectionType:
        """Connection type this factory creates."""
        ...

    async def create(self, resolved: ResolvedConnection) -> Connection:
        """
        Create a connection from resolved configuration.

        Args:
            resolved: Resolved connection configuration

        Returns:
            Active connection instance
        """
        ...


class ConnectionResolver(Protocol):
    """
    ConnectionResolver resolves module connection requirements to available providers.

    The resolver:
    1. Reads module's connection requirements
    2. Scans available provider modules
    3. Matches requirements to providers based on type and provider list
    4. Returns resolved configurations or errors

    Example:
        result = await resolver.resolve('my-module', requirements)
        if result.success:
            for conn in result.resolved:
                print(f"{conn.requirement_name} -> {conn.provider_name}")
        else:
            for unresolved in result.unresolved:
                print(f"Cannot satisfy: {unresolved.requirement.name}")
    """

    async def resolve(
        self,
        module_id: str,
        requirements: List[ConnectionRequirement],
    ) -> ResolutionResult:
        """
        Resolve connection requirements for a module.

        Args:
            module_id: ID of the module requesting connections
            requirements: Connection requirements to resolve

        Returns:
            Resolution result with resolved and unresolved connections
        """
        ...

    async def get_available_providers(self) -> Dict[str, ConnectionProvider]:
        """
        Get all available connection providers.

        Returns:
            Dictionary of provider names to provider definitions
        """
        ...

    async def is_provider_available(self, provider_name: str) -> bool:
        """
        Check if a specific provider is available.

        Args:
            provider_name: Name of the provider to check

        Returns:
            True if the provider is installed and available
        """
        ...

    async def get_connection(
        self,
        module_id: str,
        connection_name: str,
    ) -> Optional[ResolvedConnection]:
        """
        Get connection information for a resolved connection.

        Args:
            module_id: Module that owns the connection
            connection_name: Name of the connection

        Returns:
            Resolved connection info or None if not found
        """
        ...


def build_connection_string(
    conn_type: ConnectionType,
    provider: str,
    config: ConnectionConfig,
) -> str:
    """
    Build a connection string from configuration.

    Args:
        conn_type: Connection type
        provider: Provider name
        config: Connection configuration

    Returns:
        Connection string (format depends on type/provider)
    """
    host = config.host or 'localhost'
    port = config.port
    database = config.database
    username = config.username
    password = config.password
    ssl = config.ssl

    # Build auth part
    auth = ''
    if username:
        auth = username
        if password:
            auth = f"{auth}:{password}"
        auth = f"{auth}@"

    # Build port part
    port_str = f":{port}" if port else ""

    if conn_type == ConnectionType.DATABASE:
        if provider in ('postgres', 'postgresql'):
            db = database or 'postgres'
            ssl_param = '?sslmode=require' if ssl else ''
            return f"postgresql://{auth}{host}{port_str}/{db}{ssl_param}"
        elif provider in ('mysql', 'mariadb'):
            db = database or 'mysql'
            return f"mysql://{auth}{host}{port_str}/{db}"
        elif provider == 'mongodb':
            db = database or 'test'
            return f"mongodb://{auth}{host}{port_str}/{db}"
        elif provider == 'sqlite':
            return database or ':memory:'
        else:
            return f"{provider}://{host}{port_str}"
    elif conn_type == ConnectionType.CACHE:
        return f"redis://{auth}{host}{port_str}/0"
    else:
        return f"{provider}://{host}{port_str}"
