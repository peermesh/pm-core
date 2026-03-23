// =============================================================================
// Per-Protocol Media Variant Preparation
// =============================================================================
// Each federated protocol has different media constraints. This module
// ensures uploaded media meets each protocol's requirements before
// distribution.
//
// Blueprint: LOGIC-003 (Mechanic 4 — Per-Protocol Media Distribution)
// Work Order: WO-021

import sharp from 'sharp';
import { stat, mkdir } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';

// =============================================================================
// Protocol Constraints (from LOGIC-003 Mechanic 4 table)
// =============================================================================

const PROTOCOL_LIMITS = {
  activitypub: {
    maxSizeBytes: 40 * 1024 * 1024,  // 40MB (instance-dependent, 40MB is upper bound)
    maxDimension: 4096,
    preferredFormat: 'webp',
    variantName: 'full',
  },
  atprotocol: {
    maxSizeBytes: 1 * 1024 * 1024,   // 1MB for blobs in repo
    maxDimension: 1024,
    preferredFormat: 'webp',
    variantName: 'standard',
  },
  nostr: {
    // Nostr has no native media hosting; media is served via URL.
    // No size limit on the file itself, but we serve via hosted URL.
    maxSizeBytes: null,
    maxDimension: null,
    preferredFormat: null,
    variantName: 'full',
  },
  matrix: {
    maxSizeBytes: 50 * 1024 * 1024,  // 50MB typical homeserver limit
    maxDimension: 4096,
    preferredFormat: 'webp',
    variantName: 'full',
  },
  rss: {
    // RSS enclosures use URL references, thumbnail for preview
    maxSizeBytes: null,
    maxDimension: 256,
    preferredFormat: 'webp',
    variantName: 'thumbnail',
  },
  indieweb: {
    // Self-hosted, no hard limit
    maxSizeBytes: null,
    maxDimension: 4096,
    preferredFormat: 'webp',
    variantName: 'full',
  },
};

// =============================================================================
// Helper: Resize and compress to meet size constraint
// =============================================================================

/**
 * Iteratively resize/compress an image until it fits under a byte limit.
 *
 * Strategy: start at the target dimensions and reduce quality in steps.
 * If quality reduction alone is insufficient, reduce dimensions by 75%.
 *
 * @param {string} inputPath    - Source image path.
 * @param {string} outputPath   - Destination path.
 * @param {number} maxBytes     - Maximum file size in bytes.
 * @param {number} maxDimension - Maximum width/height in pixels.
 * @param {string} format       - 'webp' or 'jpeg'.
 * @returns {Promise<{ path: string, width: number, height: number, size: number, format: string }>}
 */
async function fitToConstraint(inputPath, outputPath, maxBytes, maxDimension, format) {
  const fmt = format || 'webp';
  let quality = fmt === 'webp' ? 80 : 85;
  let dim = maxDimension || 4096;
  const minQuality = 30;
  const qualityStep = 10;
  const dimScaleFactor = 0.75;

  for (let attempt = 0; attempt < 10; attempt++) {
    let pipeline = sharp(inputPath)
      .rotate()
      .resize({
        width: dim,
        height: dim,
        fit: 'inside',
        withoutEnlargement: true,
      });

    if (fmt === 'webp') {
      pipeline = pipeline.webp({ quality });
    } else {
      pipeline = pipeline.jpeg({ quality, mozjpeg: true });
    }

    await pipeline.toFile(outputPath);

    const outStat = await stat(outputPath);
    if (!maxBytes || outStat.size <= maxBytes) {
      const meta = await sharp(outputPath).metadata();
      return {
        path: outputPath,
        width: meta.width,
        height: meta.height,
        size: outStat.size,
        format: fmt,
      };
    }

    // Try reducing quality first
    if (quality > minQuality) {
      quality -= qualityStep;
    } else {
      // Quality floor reached; reduce dimensions
      dim = Math.floor(dim * dimScaleFactor);
      quality = fmt === 'webp' ? 80 : 85; // reset quality for new dimension
    }
  }

  // Return whatever we have after 10 attempts (best-effort)
  const meta = await sharp(outputPath).metadata();
  const outStat = await stat(outputPath);
  return {
    path: outputPath,
    width: meta.width,
    height: meta.height,
    size: outStat.size,
    format: fmt,
  };
}

// =============================================================================
// Per-Protocol Preparation Functions
// =============================================================================

/**
 * Prepare media for ActivityPub distribution.
 *
 * Ensures the image is under the AP instance limit (default 40MB).
 * Most images will already fit; this is a safety net for very large originals.
 *
 * @param {string} mediaPath - Absolute path to the source image.
 * @param {object} [options]
 * @param {string} [options.outputDir] - Output directory (default: same as source).
 * @param {number} [options.maxSizeBytes] - Override max size (default: 40MB).
 * @returns {Promise<{ path: string, width: number, height: number, size: number, format: string, protocol: string }>}
 */
async function prepareForAP(mediaPath, options = {}) {
  const limits = PROTOCOL_LIMITS.activitypub;
  const maxBytes = options.maxSizeBytes || limits.maxSizeBytes;
  const outputDir = options.outputDir || join(mediaPath, '..');

  await mkdir(outputDir, { recursive: true });

  // Check if original already fits
  const origStat = await stat(mediaPath);
  if (origStat.size <= maxBytes) {
    const meta = await sharp(mediaPath).metadata();
    return {
      path: mediaPath,
      width: meta.width,
      height: meta.height,
      size: origStat.size,
      format: meta.format,
      protocol: 'activitypub',
    };
  }

  const baseName = basename(mediaPath, extname(mediaPath));
  const outPath = join(outputDir, `${baseName}-ap.webp`);

  const result = await fitToConstraint(
    mediaPath, outPath, maxBytes, limits.maxDimension, limits.preferredFormat
  );

  return { ...result, protocol: 'activitypub' };
}

/**
 * Prepare media for AT Protocol (Bluesky) distribution.
 *
 * AT Protocol limits blobs to 1MB in the repo. This function ensures
 * the output image fits within that constraint, aggressively resizing
 * and compressing if necessary.
 *
 * @param {string} mediaPath - Absolute path to the source image.
 * @param {object} [options]
 * @param {string} [options.outputDir] - Output directory (default: same as source).
 * @param {number} [options.maxSizeBytes] - Override max size (default: 1MB).
 * @returns {Promise<{ path: string, width: number, height: number, size: number, format: string, protocol: string }>}
 */
async function prepareForAT(mediaPath, options = {}) {
  const limits = PROTOCOL_LIMITS.atprotocol;
  const maxBytes = options.maxSizeBytes || limits.maxSizeBytes;
  const outputDir = options.outputDir || join(mediaPath, '..');

  await mkdir(outputDir, { recursive: true });

  const baseName = basename(mediaPath, extname(mediaPath));
  const outPath = join(outputDir, `${baseName}-at.webp`);

  const result = await fitToConstraint(
    mediaPath, outPath, maxBytes, limits.maxDimension, limits.preferredFormat
  );

  return { ...result, protocol: 'atprotocol' };
}

/**
 * Prepare media for Nostr distribution.
 *
 * Nostr has no native media hosting. Media is referenced by URL in event
 * content. This function returns a reference object pointing to the
 * hosted full-resolution variant. The caller is responsible for hosting
 * the file and generating the final URL.
 *
 * Optionally generates NIP-94 file metadata fields.
 *
 * @param {string} mediaPath - Absolute path to the source image.
 * @param {object} [options]
 * @param {string} [options.hostedBaseUrl] - Base URL where media will be served.
 * @param {string} [options.hash] - BLAKE3 hash of the file (for NIP-94 `x` tag).
 * @returns {Promise<{ path: string, width: number, height: number, size: number, format: string, protocol: string, hostedUrl: string|null, nip94Tags: Array }>}
 */
async function prepareForNostr(mediaPath, options = {}) {
  const meta = await sharp(mediaPath).metadata();
  const fileStat = await stat(mediaPath);
  const filename = basename(mediaPath);

  // Build the hosted URL if a base URL is provided
  const hostedUrl = options.hostedBaseUrl
    ? `${options.hostedBaseUrl.replace(/\/$/, '')}/${filename}`
    : null;

  // NIP-94 file metadata tags (kind 1063)
  // See: https://github.com/nostr-protocol/nips/blob/master/94.md
  const nip94Tags = [
    ['url', hostedUrl || ''],
    ['m', `image/${meta.format}`],
    ['size', String(fileStat.size)],
    ['dim', `${meta.width}x${meta.height}`],
  ];

  if (options.hash) {
    nip94Tags.push(['x', options.hash]);
    nip94Tags.push(['ox', options.hash]);
  }

  return {
    path: mediaPath,
    width: meta.width,
    height: meta.height,
    size: fileStat.size,
    format: meta.format,
    protocol: 'nostr',
    hostedUrl,
    nip94Tags,
  };
}

/**
 * Prepare media variants for all supported protocols in one call.
 *
 * @param {string} mediaPath - Absolute path to the source image.
 * @param {object} [options]
 * @param {string} [options.outputDir]     - Output directory for generated variants.
 * @param {string} [options.hostedBaseUrl] - Base URL for Nostr hosted media.
 * @param {string} [options.hash]          - BLAKE3 hash for NIP-94 tags.
 * @returns {Promise<{ activitypub: object, atprotocol: object, nostr: object }>}
 */
async function prepareForAllProtocols(mediaPath, options = {}) {
  const [ap, at, nostr] = await Promise.all([
    prepareForAP(mediaPath, options),
    prepareForAT(mediaPath, options),
    prepareForNostr(mediaPath, options),
  ]);

  return { activitypub: ap, atprotocol: at, nostr };
}

export {
  prepareForAP,
  prepareForAT,
  prepareForNostr,
  prepareForAllProtocols,
  fitToConstraint,
  PROTOCOL_LIMITS,
};
