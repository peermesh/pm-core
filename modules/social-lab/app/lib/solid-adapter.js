// =============================================================================
// Solid Pod Adapter (SolidAdapter — ARCH-008 Reference Implementation)
// =============================================================================
// Implements the abstract data layer interface for Solid Pod storage.
// All Solid-specific operations are encapsulated here — application code
// MUST NOT import @inrupt/solid-client directly (per DATA-001 TS-4, TS-6).
//
// Blueprint references:
//   - F-026 Solid Protocol Core (server integration, Pod lifecycle, WAC, RDF)
//   - DATA-001 Profile Schema (Pod directory structure, vocab, ACL patterns)
//   - ARCH-008 Data Layer Abstraction Architecture
//
// Phase 1: Local-only. Requires @inrupt/solid-client + @inrupt/vocab-common-rdf
// in package.json. Does NOT require a running Solid server — operations degrade
// gracefully when CSS is unavailable.

import {
  getSolidDataset,
  saveSolidDatasetAt,
  createSolidDataset,
  createContainerAt,
  setThing,
  getThing,
  getStringNoLocale,
  getUrl,
  getDatetime,
  buildThing,
  createThing,
} from '@inrupt/solid-client';

import { FOAF, VCARD, DCTERMS } from '@inrupt/vocab-common-rdf';

// ---------------------------------------------------------------------------
// RDF Vocabulary Constants (from src/vocab/ pattern — no hardcoded URI strings)
// ---------------------------------------------------------------------------

/** PeerMesh Social Lab namespace */
const PMSL = 'https://vocab.peermesh.org/social-lab#';

/** ActivityStreams 2.0 namespace */
const AS = 'https://www.w3.org/ns/activitystreams#';

/** Solid terms namespace */
const SOLID = 'http://www.w3.org/ns/solid/terms#';

/** Schema.org namespace */
const SCHEMA = 'http://schema.org/';

/**
 * Vocabulary predicate map — single source of truth for all RDF predicates
 * used by the SolidAdapter. Application code references these constants.
 */
export const VOCAB = Object.freeze({
  // FOAF predicates (re-exported from @inrupt/vocab-common-rdf)
  foafName: FOAF.name,
  foafImg: FOAF.img,
  foafHomepage: FOAF.homepage,

  // VCARD predicates
  vcardFn: VCARD.fn,
  vcardHasPhoto: VCARD.hasPhoto,
  vcardNote: VCARD.note,

  // ActivityStreams 2.0
  asPreferredUsername: `${AS}preferredUsername`,
  asSummary: `${AS}summary`,
  asIcon: `${AS}icon`,
  asImage: `${AS}image`,
  asInbox: `${AS}inbox`,
  asOutbox: `${AS}outbox`,
  asFollowing: `${AS}following`,
  asFollowers: `${AS}followers`,

  // Schema.org
  schemaDateCreated: `${SCHEMA}dateCreated`,
  schemaDateModified: `${SCHEMA}dateModified`,

  // Solid terms
  solidPublicTypeIndex: `${SOLID}publicTypeIndex`,
  solidPrivateTypeIndex: `${SOLID}privateTypeIndex`,

  // PMSL custom predicates
  pmslOmniAccountId: `${PMSL}omniAccountId`,
  pmslActivityPubActor: `${PMSL}activityPubActor`,
  pmslAtProtocolDID: `${PMSL}atProtocolDID`,
  pmslDeploymentMode: `${PMSL}deploymentMode`,
  pmslProfileVersion: `${PMSL}profileVersion`,
  pmslProxyActorUri: `${PMSL}proxyActorUri`,
  pmslHolochainAgentId: `${PMSL}holochainAgentId`,
  pmslSsbFeedId: `${PMSL}ssbFeedId`,
  pmslActivityFeed: `${PMSL}activityFeed`,
});

// ---------------------------------------------------------------------------
// Pod Directory Structure (DATA-001 Section 1)
// ---------------------------------------------------------------------------

/**
 * Containers that must exist in every Social Lab Pod.
 * Relative to Pod root URL. Trailing slash = LDP BasicContainer.
 */
const POD_CONTAINERS = [
  'profile/',
  'media/',
  'media/attachments/',
  'social/',
  'federation/',
  'posts/',
  'credentials/',
  'security/',
  'encrypted-sync/',
  'activity-log/',
  'activity-log/blobs/',
  'dht-entries/',
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Establish a Solid session context for Pod operations.
 * In Phase 1 this is a thin wrapper — actual Solid-OIDC auth requires a
 * running CSS instance and will be wired in Phase 2.
 *
 * @param {string} webid - The user's WebID URI
 * @param {object} session - An @inrupt/solid-client-authn-node Session (or null for unauthenticated reads)
 * @returns {{ webid: string, session: object|null, podUrl: string }}
 */
export function connectToPod(webid, session = null) {
  // Derive Pod root from WebID (convention: /profile/card#me -> pod root is two levels up)
  // e.g., https://alice.pod.example/profile/card#me -> https://alice.pod.example/
  let podUrl;
  try {
    const url = new URL(webid.replace(/#.*$/, ''));
    // Remove /profile/card to get root
    const pathParts = url.pathname.split('/').filter(Boolean);
    if (pathParts.length >= 2 && pathParts[0] === 'profile') {
      url.pathname = '/';
    }
    podUrl = url.toString();
  } catch {
    podUrl = webid.replace(/profile\/card#me$/, '');
  }

  return {
    webid,
    session,
    podUrl,
    authenticated: session !== null,
  };
}

/**
 * Read a profile from a Solid Pod.
 * Fetches the /profile/card document and extracts profile predicates.
 *
 * @param {string} podUrl - Pod root URL (e.g., https://alice.pod.example/)
 * @returns {Promise<object>} Profile data as a plain object
 */
export async function readProfile(podUrl) {
  const cardUrl = new URL('profile/card', podUrl).toString();

  try {
    const dataset = await getSolidDataset(cardUrl);
    const profileThing = getThing(dataset, `${cardUrl}#me`);

    if (!profileThing) {
      return {
        found: false,
        podUrl,
        cardUrl,
        error: 'No #me subject found in profile card',
      };
    }

    return {
      found: true,
      podUrl,
      cardUrl,
      profile: {
        displayName: getStringNoLocale(profileThing, VOCAB.foafName),
        username: getStringNoLocale(profileThing, VOCAB.asPreferredUsername),
        bio: getStringNoLocale(profileThing, VOCAB.asSummary),
        avatarUrl: getUrl(profileThing, VOCAB.foafImg),
        homepageUrl: getUrl(profileThing, VOCAB.foafHomepage),
        omniAccountId: getStringNoLocale(profileThing, VOCAB.pmslOmniAccountId),
        profileVersion: getStringNoLocale(profileThing, VOCAB.pmslProfileVersion),
        deploymentMode: getStringNoLocale(profileThing, VOCAB.pmslDeploymentMode),
        apActorUri: getUrl(profileThing, VOCAB.pmslActivityPubActor),
        atDid: getStringNoLocale(profileThing, VOCAB.pmslAtProtocolDID),
        dateCreated: getDatetime(profileThing, VOCAB.schemaDateCreated),
        dateModified: getDatetime(profileThing, VOCAB.schemaDateModified),
        inbox: getUrl(profileThing, VOCAB.asInbox),
        outbox: getUrl(profileThing, VOCAB.asOutbox),
        following: getUrl(profileThing, VOCAB.asFollowing),
        followers: getUrl(profileThing, VOCAB.asFollowers),
        publicTypeIndex: getUrl(profileThing, VOCAB.solidPublicTypeIndex),
        privateTypeIndex: getUrl(profileThing, VOCAB.solidPrivateTypeIndex),
      },
    };
  } catch (err) {
    return {
      found: false,
      podUrl,
      cardUrl,
      error: err.message,
    };
  }
}

/**
 * Write profile data to a Solid Pod.
 * Creates or updates the /profile/card document.
 *
 * @param {string} podUrl - Pod root URL
 * @param {object} profileData - Profile fields to write
 * @param {object} session - Authenticated Solid session (required for writes)
 * @returns {Promise<object>} Result with success status
 */
export async function writeProfile(podUrl, profileData, session) {
  if (!session) {
    return {
      success: false,
      error: 'Authenticated session required for write operations',
    };
  }

  const cardUrl = new URL('profile/card', podUrl).toString();
  const meUrl = `${cardUrl}#me`;

  try {
    // Try to fetch existing dataset, or create new one
    let dataset;
    try {
      dataset = await getSolidDataset(cardUrl, { fetch: session.fetch });
    } catch {
      dataset = createSolidDataset();
    }

    // Build the profile Thing with all provided fields
    let profileBuilder = buildThing(
      getThing(dataset, meUrl) || createThing({ url: meUrl })
    );

    if (profileData.displayName) {
      profileBuilder = profileBuilder
        .addStringNoLocale(VOCAB.foafName, profileData.displayName)
        .addStringNoLocale(VCARD.fn, profileData.displayName);
    }
    if (profileData.username) {
      profileBuilder = profileBuilder
        .addStringNoLocale(VOCAB.asPreferredUsername, profileData.username);
    }
    if (profileData.bio) {
      profileBuilder = profileBuilder
        .addStringNoLocale(VOCAB.asSummary, profileData.bio);
    }
    if (profileData.avatarUrl) {
      profileBuilder = profileBuilder
        .addUrl(VOCAB.foafImg, profileData.avatarUrl)
        .addUrl(VOCAB.asIcon, profileData.avatarUrl);
    }
    if (profileData.homepageUrl) {
      profileBuilder = profileBuilder
        .addUrl(VOCAB.foafHomepage, profileData.homepageUrl);
    }
    if (profileData.omniAccountId) {
      profileBuilder = profileBuilder
        .addStringNoLocale(VOCAB.pmslOmniAccountId, profileData.omniAccountId);
    }
    if (profileData.profileVersion) {
      profileBuilder = profileBuilder
        .addStringNoLocale(VOCAB.pmslProfileVersion, profileData.profileVersion);
    }
    if (profileData.deploymentMode) {
      profileBuilder = profileBuilder
        .addStringNoLocale(VOCAB.pmslDeploymentMode, profileData.deploymentMode);
    }

    // Set timestamps
    const now = new Date();
    profileBuilder = profileBuilder
      .addDatetime(VOCAB.schemaDateModified, now);
    if (profileData._isNew) {
      profileBuilder = profileBuilder
        .addDatetime(VOCAB.schemaDateCreated, now);
    }

    // Type declarations
    profileBuilder = profileBuilder
      .addUrl('http://www.w3.org/1999/02/22-rdf-syntax-ns#type', FOAF.Person)
      .addUrl('http://www.w3.org/1999/02/22-rdf-syntax-ns#type', `${AS}Person`);

    const profileThing = profileBuilder.build();
    dataset = setThing(dataset, profileThing);

    // Save to Pod
    await saveSolidDatasetAt(cardUrl, dataset, { fetch: session.fetch });

    return {
      success: true,
      cardUrl,
      meUrl,
    };
  } catch (err) {
    return {
      success: false,
      cardUrl,
      error: err.message,
    };
  }
}

/**
 * Create the DATA-001 Pod directory structure.
 * Creates all required LDP containers for a Social Lab Pod.
 *
 * @param {string} podUrl - Pod root URL
 * @param {object} session - Authenticated Solid session
 * @returns {Promise<object>} Result with list of created containers
 */
export async function createPodStructure(podUrl, session) {
  if (!session) {
    return {
      success: false,
      error: 'Authenticated session required to create Pod structure',
    };
  }

  const results = [];
  const errors = [];

  for (const container of POD_CONTAINERS) {
    const containerUrl = new URL(container, podUrl).toString();
    try {
      await createContainerAt(containerUrl, { fetch: session.fetch });
      results.push({ container, url: containerUrl, status: 'created' });
    } catch (err) {
      // 409 Conflict means container already exists — that is fine
      if (err.message && err.message.includes('409')) {
        results.push({ container, url: containerUrl, status: 'exists' });
      } else {
        errors.push({ container, url: containerUrl, error: err.message });
      }
    }
  }

  return {
    success: errors.length === 0,
    podUrl,
    containers: results,
    errors,
  };
}

/**
 * Sync a PostgreSQL profile record to a Solid Pod.
 * Reads profile from the database result and writes it to the Pod.
 *
 * @param {object} profile - Profile record from PostgreSQL (snake_case fields)
 * @param {object} session - Authenticated Solid session
 * @returns {Promise<object>} Sync result
 */
export async function syncProfileToPod(profile, session) {
  if (!profile || !profile.source_pod_uri) {
    return {
      success: false,
      error: 'Profile must have a source_pod_uri to sync to Pod',
    };
  }

  const podUrl = profile.source_pod_uri;

  // Map PostgreSQL snake_case fields to profile data
  const profileData = {
    displayName: profile.display_name,
    username: profile.username,
    bio: profile.bio,
    avatarUrl: profile.avatar_url,
    homepageUrl: profile.homepage_url,
    omniAccountId: profile.omni_account_id,
    profileVersion: profile.profile_version || '0.1.0',
    deploymentMode: profile.deployment_mode || 'vps',
  };

  // Write profile to Pod
  const writeResult = await writeProfile(podUrl, profileData, session);

  return {
    success: writeResult.success,
    profileId: profile.id,
    podUrl,
    cardUrl: writeResult.cardUrl,
    error: writeResult.error,
    syncedAt: new Date().toISOString(),
  };
}

/**
 * Read profile data from a Solid Pod and return it in a format suitable
 * for updating the PostgreSQL cache (DATA-002 pattern).
 *
 * @param {string} podUrl - Pod root URL
 * @returns {Promise<object>} Profile data mapped to PostgreSQL column names
 */
export async function syncProfileFromPod(podUrl) {
  const result = await readProfile(podUrl);

  if (!result.found) {
    return {
      success: false,
      podUrl,
      error: result.error,
    };
  }

  const p = result.profile;

  // Map Solid profile fields to PostgreSQL snake_case columns
  return {
    success: true,
    podUrl,
    dbFields: {
      display_name: p.displayName,
      username: p.username,
      bio: p.bio,
      avatar_url: p.avatarUrl,
      homepage_url: p.homepageUrl,
      profile_version: p.profileVersion,
      deployment_mode: p.deploymentMode,
    },
    fullProfile: p,
    syncedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Get the list of required Pod containers (DATA-001 structure).
 * Useful for conformance checking and Pod health verification.
 *
 * @returns {string[]} Array of container paths relative to Pod root
 */
export function getPodContainerPaths() {
  return [...POD_CONTAINERS];
}

/**
 * Derive the profile card URL from a Pod URL.
 *
 * @param {string} podUrl - Pod root URL
 * @returns {string} URL of the profile card document
 */
export function getCardUrl(podUrl) {
  return new URL('profile/card', podUrl).toString();
}

/**
 * Derive the WebID from a Pod URL.
 *
 * @param {string} podUrl - Pod root URL
 * @returns {string} WebID URI (card URL + #me fragment)
 */
export function getWebId(podUrl) {
  return `${getCardUrl(podUrl)}#me`;
}
