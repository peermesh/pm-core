/**
 * PeerMesh Foundation - Connection Abstraction Interface
 *
 * This file defines the TypeScript interfaces for the connection abstraction system.
 * Modules declare what connections they need (database, cache, etc.) and the foundation
 * resolves these to available providers at runtime.
 *
 * Core Principle: Modules declare requirements, not implementations.
 * A module that needs "a database" can work with Postgres, MySQL, or SQLite - the
 * foundation matches requirements to available providers.
 *
 * @module foundation/interfaces/connection
 * @version 1.0.0
 */

/**
 * Connection types supported by the foundation.
 */
export type ConnectionType = 'database' | 'cache' | 'storage' | 'queue' | 'eventbus' | 'custom';

/**
 * Standard database providers.
 */
export type DatabaseProvider = 'postgres' | 'mysql' | 'mariadb' | 'sqlite' | 'mongodb' | 'cockroachdb';

/**
 * Standard cache providers.
 */
export type CacheProvider = 'redis' | 'memcached' | 'valkey' | 'dragonfly';

/**
 * Standard storage providers.
 */
export type StorageProvider = 'local' | 's3' | 'minio' | 'gcs' | 'azure-blob';

/**
 * Standard queue providers.
 */
export type QueueProvider = 'rabbitmq' | 'redis' | 'nats' | 'kafka' | 'sqs';

/**
 * Standard event bus providers.
 */
export type EventBusProvider = 'redis' | 'nats' | 'kafka' | 'memory' | 'noop';

/**
 * All provider types.
 */
export type Provider = DatabaseProvider | CacheProvider | StorageProvider | QueueProvider | EventBusProvider | string;

/**
 * Configuration options for a connection.
 */
export interface ConnectionConfig {
  /** Hostname or IP address */
  host?: string;

  /** Port number */
  port?: number;

  /** Database name (for database connections) */
  database?: string;

  /** Username for authentication */
  username?: string;

  /** Password for authentication (typically from env or secrets) */
  password?: string;

  /** Whether to use SSL/TLS */
  ssl?: boolean;

  /** Connection pool size */
  poolSize?: number;

  /** Connection timeout in milliseconds */
  timeout?: number;

  /** Provider-specific configuration options */
  extra?: Record<string, unknown>;
}

/**
 * A connection requirement declared by a module.
 *
 * Modules declare what they need, not which specific implementation.
 * The foundation matches requirements to available providers.
 *
 * @example
 * ```typescript
 * const requirement: ConnectionRequirement = {
 *   type: 'database',
 *   providers: ['postgres', 'mysql', 'sqlite'], // Any of these will work
 *   required: true,
 *   name: 'primary-db',
 *   config: { poolSize: 20 }
 * };
 * ```
 */
export interface ConnectionRequirement {
  /** Type of connection required */
  type: ConnectionType;

  /** Acceptable providers for this connection (in order of preference) */
  providers: Provider[];

  /** Whether this connection is required for the module to function */
  required?: boolean;

  /** Unique name for this connection requirement */
  name?: string;

  /** Default configuration for this connection */
  config?: ConnectionConfig;
}

/**
 * A connection provider offered by a module.
 *
 * Provider modules (like postgres-provider, redis-provider) declare what
 * connection types they can satisfy.
 *
 * @example
 * ```typescript
 * const provider: ConnectionProvider = {
 *   name: 'postgres',
 *   type: 'database',
 *   provides: ['postgres', 'postgresql'],
 *   version: '16',
 *   config: { host: 'postgres', port: 5432 }
 * };
 * ```
 */
export interface ConnectionProvider {
  /** Provider name (e.g., 'postgres', 'redis') */
  name: string;

  /** Type of connection this provider offers */
  type: ConnectionType;

  /** List of provider identifiers this satisfies */
  provides: string[];

  /** Version of the provider software */
  version?: string;

  /** Default configuration for this provider */
  config?: ConnectionConfig;
}

/**
 * A connection that has been matched to a provider.
 *
 * After resolution, modules receive this object containing the final
 * configuration to connect to the service.
 */
export interface ResolvedConnection {
  /** Name of the requirement that was satisfied */
  requirementName: string;

  /** Module ID providing this connection */
  providerModule: string;

  /** Name of the provider being used */
  providerName: string;

  /** Type of the connection */
  type: ConnectionType;

  /** Final resolved configuration */
  config: ConnectionConfig;

  /** Connection string (if applicable) */
  connectionString?: string;

  /** Environment variables to set for this connection */
  envVars?: Record<string, string>;
}

/**
 * Information about an unresolved connection requirement.
 */
export interface UnresolvedConnection {
  /** The requirement that could not be satisfied */
  requirement: ConnectionRequirement;

  /** Reason the connection could not be resolved */
  reason: string;
}

/**
 * Result of attempting to resolve module connections.
 */
export interface ResolutionResult {
  /** Whether all required connections were resolved */
  success: boolean;

  /** Successfully resolved connections */
  resolved: ResolvedConnection[];

  /** Connections that could not be resolved */
  unresolved: UnresolvedConnection[];

  /** Non-fatal warnings during resolution */
  warnings: string[];
}

/**
 * ConnectionResolver resolves module connection requirements to available providers.
 *
 * The resolver:
 * 1. Reads module's connection requirements
 * 2. Scans available provider modules
 * 3. Matches requirements to providers based on type and provider list
 * 4. Returns resolved configurations or errors
 *
 * @example
 * ```typescript
 * const resolver: ConnectionResolver = getConnectionResolver();
 *
 * // Resolve connections for a module
 * const result = await resolver.resolve('my-module', requirements);
 *
 * if (result.success) {
 *   for (const conn of result.resolved) {
 *     console.log(`${conn.requirementName} -> ${conn.providerName}`);
 *   }
 * } else {
 *   for (const unresolved of result.unresolved) {
 *     console.error(`Cannot satisfy: ${unresolved.requirement.name}`);
 *   }
 * }
 * ```
 */
export interface ConnectionResolver {
  /**
   * Resolve connection requirements for a module.
   *
   * @param moduleId - ID of the module requesting connections
   * @param requirements - Connection requirements to resolve
   * @returns Resolution result with resolved and unresolved connections
   */
  resolve(moduleId: string, requirements: ConnectionRequirement[]): Promise<ResolutionResult>;

  /**
   * Get all available connection providers.
   *
   * @returns Map of provider names to provider definitions
   */
  getAvailableProviders(): Promise<Map<string, ConnectionProvider>>;

  /**
   * Check if a specific provider is available.
   *
   * @param providerName - Name of the provider to check
   * @returns True if the provider is installed and available
   */
  isProviderAvailable(providerName: string): Promise<boolean>;

  /**
   * Get connection information for a resolved connection.
   *
   * @param moduleId - Module that owns the connection
   * @param connectionName - Name of the connection
   * @returns Resolved connection info or undefined if not found
   */
  getConnection(moduleId: string, connectionName: string): Promise<ResolvedConnection | undefined>;
}

/**
 * Connection represents an active connection to a service.
 *
 * This is the runtime interface that modules use to interact with
 * their resolved connections.
 */
export interface Connection {
  /** The resolved connection information */
  info: ResolvedConnection;

  /** Check if the connection is alive */
  ping(): Promise<boolean>;

  /** Get the raw connection client (type depends on provider) */
  getClient<T = unknown>(): T;

  /** Close the connection */
  close(): Promise<void>;
}

/**
 * ConnectionFactory creates Connection instances from resolved configurations.
 *
 * Each provider module registers a factory for its connection type.
 */
export interface ConnectionFactory {
  /** Provider name this factory handles */
  providerName: string;

  /** Connection type this factory creates */
  connectionType: ConnectionType;

  /**
   * Create a connection from resolved configuration.
   *
   * @param resolved - Resolved connection configuration
   * @returns Active connection instance
   */
  create(resolved: ResolvedConnection): Promise<Connection>;
}

/**
 * Utility function to build a connection string from config.
 *
 * @param type - Connection type
 * @param provider - Provider name
 * @param config - Connection configuration
 * @returns Connection string (format depends on type/provider)
 */
export function buildConnectionString(
  type: ConnectionType,
  provider: string,
  config: ConnectionConfig
): string {
  const { host = 'localhost', port, database, username, password, ssl } = config;

  switch (type) {
    case 'database':
      switch (provider) {
        case 'postgres':
        case 'postgresql':
          return `postgresql://${username ? `${username}${password ? `:${password}` : ''}@` : ''}${host}${port ? `:${port}` : ''}/${database || 'postgres'}${ssl ? '?sslmode=require' : ''}`;
        case 'mysql':
        case 'mariadb':
          return `mysql://${username ? `${username}${password ? `:${password}` : ''}@` : ''}${host}${port ? `:${port}` : ''}/${database || 'mysql'}`;
        case 'mongodb':
          return `mongodb://${username ? `${username}${password ? `:${password}` : ''}@` : ''}${host}${port ? `:${port}` : ''}/${database || 'test'}`;
        case 'sqlite':
          return database || ':memory:';
        default:
          return `${provider}://${host}${port ? `:${port}` : ''}`;
      }
    case 'cache':
      return `redis://${username ? `${username}${password ? `:${password}` : ''}@` : ''}${host}${port ? `:${port}` : ''}/0`;
    default:
      return `${provider}://${host}${port ? `:${port}` : ''}`;
  }
}
