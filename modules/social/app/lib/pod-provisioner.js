// =============================================================================
// Pod Provisioner Stub (Phase 1 — LOCAL ONLY)
// =============================================================================
// In Phase 1, this module does NOT actually provision Pods. It generates the
// Pod URL that WOULD be used when a Community Solid Server (CSS) is available,
// and documents the requirements for Phase 2 deployment.
//
// Blueprint references:
//   - F-026 Section 2: Pod Provisioning and Lifecycle Management
//   - DATA-001 Section 1: Pod Directory Structure
//
// Phase 2 Requirements (documented here, implemented later):
//   - Community Solid Server (CSS) running as a Docker service in Core
//   - Traefik routing: pod.{domain} -> CSS container
//   - CSS configured for multi-user Pod provisioning
//   - Filesystem storage backend (Docker volume) for Mode 1 (VPS)
//
// Core integration steps (for the Core team):
//   1. Add CSS container to docker-compose.yml:
//      community-solid-server:
//        image: solidproject/community-solid-server:latest
//        volumes:
//          - solid-pods:/data
//        environment:
//          - CSS_BASE_URL=https://pod.${DOMAIN}
//          - CSS_CONFIG=/config/default.json
//   2. Add Traefik routing label for pod.{domain}
//   3. Create shared Docker volume: solid-pods
//   4. Configure CSS for multi-user registration

const DOMAIN = process.env.DOMAIN || 'peers.social';

/**
 * Pod lifecycle states (F-026 Section 2).
 * @readonly
 * @enum {string}
 */
export const POD_STATES = Object.freeze({
  PROVISIONING: 'provisioning',
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  ARCHIVED: 'archived',
  DELETED: 'deleted',
  /** Phase 1 only: CSS not deployed, Pod URL is generated but not provisioned */
  STUB: 'stub',
});

/**
 * Generate the Pod URL that WOULD be used for a given profile.
 * Supports both subdomain and path-based patterns (F-026 Section 2).
 *
 * @param {string} profileId - Profile UUID
 * @param {object} [options]
 * @param {string} [options.username] - Username for subdomain-based URL
 * @param {'subdomain'|'path'} [options.pattern='path'] - URL pattern to use
 * @returns {{ podUrl: string, webid: string, pattern: string }}
 */
export function generatePodUrl(profileId, options = {}) {
  const { username, pattern = 'path' } = options;

  let podUrl;
  if (pattern === 'subdomain' && username) {
    // Subdomain pattern: https://{username}.pod.{domain}/
    // Requires wildcard DNS — preferred when available
    podUrl = `https://${username}.pod.${DOMAIN}/`;
  } else {
    // Path-based pattern: https://pod.{domain}/{profileId}/
    // Fallback for environments without wildcard DNS
    podUrl = `https://pod.${DOMAIN}/${profileId}/`;
  }

  const webid = `${podUrl}profile/card#me`;

  return { podUrl, webid, pattern };
}

/**
 * Attempt to provision a Pod for a profile.
 * In Phase 1 this always returns provisioned: false because CSS is not deployed.
 *
 * @param {string} profileId - Profile UUID
 * @param {object} [options]
 * @param {string} [options.username] - Username for subdomain-based URL
 * @param {'subdomain'|'path'} [options.pattern='path'] - URL pattern to use
 * @returns {Promise<object>} Provisioning result
 */
export async function provisionPod(profileId, options = {}) {
  const { podUrl, webid, pattern } = generatePodUrl(profileId, options);

  // Phase 1: CSS is not deployed. Return stub result.
  return {
    profileId,
    podUrl,
    webid,
    pattern,
    provisioned: false,
    state: POD_STATES.STUB,
    reason: 'CSS not deployed. Community Solid Server must be added to Core as a Docker service before Pod provisioning is available.',
    requirements: [
      'Community Solid Server (CSS) Docker container',
      'Traefik routing: pod.{domain} -> CSS',
      'Docker volume: solid-pods (filesystem storage backend)',
      'CSS multi-user registration configuration',
    ],
    phase: 1,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Check the provisioning status of a Pod.
 *
 * @param {string} profileId - Profile UUID
 * @param {object} [options]
 * @param {string} [options.podUrl] - Known Pod URL (skips generation)
 * @returns {Promise<object>} Pod status
 */
export async function getPodStatus(profileId, options = {}) {
  const podUrl = options.podUrl || generatePodUrl(profileId).podUrl;

  // Phase 1: all Pods are stubs
  // Phase 2: this will attempt HTTP HEAD against the Pod URL to check if CSS responds
  return {
    profileId,
    podUrl,
    state: POD_STATES.STUB,
    cssAvailable: false,
    reason: 'CSS not deployed',
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Check if CSS is available at the expected URL.
 * Phase 1: always returns false.
 * Phase 2: will issue HTTP HEAD to pod.{domain}/.well-known/solid.
 *
 * @returns {Promise<boolean>}
 */
export async function isCssAvailable() {
  // Phase 2 implementation:
  // try {
  //   const res = await fetch(`https://pod.${DOMAIN}/.well-known/solid`, { method: 'HEAD' });
  //   return res.ok;
  // } catch {
  //   return false;
  // }
  return false;
}

/**
 * Get the expected CSS base URL for the current environment.
 *
 * @returns {string}
 */
export function getCssBaseUrl() {
  return `https://pod.${DOMAIN}`;
}
