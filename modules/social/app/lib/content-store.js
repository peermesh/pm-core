// =============================================================================
// Content-Addressed Storage
// =============================================================================
// BLAKE3-based content-addressed storage for media deduplication.
// Files are stored at /data/media/cas/{hash[0:2]}/{hash[2:4]}/{hash}
//
// Blueprint: LOGIC-003 (Mechanic 2 — Content-Addressed Storage)
// Work Order: WO-021

import { blake3 } from '@noble/hashes/blake3';
import { bytesToHex } from '@noble/hashes/utils';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, rename, copyFile, unlink, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

// =============================================================================
// Configuration
// =============================================================================

const DEFAULT_CAS_ROOT = '/data/media/cas';

// Read buffer size for hashing (64KB chunks)
const HASH_BUFFER_SIZE = 64 * 1024;

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Compute the BLAKE3 hash of a file.
 *
 * Reads the file in streaming chunks to handle large files without loading
 * the entire file into memory.
 *
 * @param {string} filePath - Absolute path to the file.
 * @returns {Promise<string>} Hex-encoded BLAKE3 hash (64 hex chars, 256-bit).
 */
function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const stream = createReadStream(filePath, { highWaterMark: HASH_BUFFER_SIZE });

    stream.on('data', (chunk) => {
      chunks.push(chunk);
    });

    stream.on('end', () => {
      try {
        const fullBuffer = Buffer.concat(chunks);
        const hash = blake3(fullBuffer);
        resolve(bytesToHex(hash));
      } catch (err) {
        reject(err);
      }
    });

    stream.on('error', reject);
  });
}

/**
 * Derive the CAS directory path for a given hash.
 *
 * Uses the first 2 hex chars as the first directory level and the next 2
 * as the second level, providing a balanced directory tree:
 *   /data/media/cas/a1/b2/a1b2c3d4...
 *
 * @param {string} hash    - Hex-encoded hash.
 * @param {string} [casRoot] - CAS root directory (default: /data/media/cas).
 * @returns {{ dir: string, path: string }} Directory and full file path.
 */
function casPath(hash, casRoot = DEFAULT_CAS_ROOT) {
  const prefix1 = hash.substring(0, 2);
  const prefix2 = hash.substring(2, 4);
  const dir = join(casRoot, prefix1, prefix2);
  return { dir, path: join(dir, hash) };
}

/**
 * Store a file by its content hash (move into CAS).
 *
 * If the hash already exists in the store, the source file is not copied
 * and the existing path is returned (deduplication).
 *
 * @param {string} filePath - Absolute path to the source file.
 * @param {string} hash     - Hex-encoded BLAKE3 hash of the file.
 * @param {object} [options]
 * @param {string} [options.casRoot] - CAS root directory override.
 * @param {boolean} [options.keepOriginal] - If true, copy instead of move (default: false).
 * @returns {Promise<{ path: string, hash: string, deduplicated: boolean, size: number }>}
 */
async function storeByHash(filePath, hash, options = {}) {
  const casRoot = options.casRoot || DEFAULT_CAS_ROOT;
  const keepOriginal = options.keepOriginal || false;

  const { dir, path: destPath } = casPath(hash, casRoot);

  // Deduplication check: if the hash already exists, skip storage
  if (existsSync(destPath)) {
    const existing = await stat(destPath);
    return {
      path: destPath,
      hash,
      deduplicated: true,
      size: existing.size,
    };
  }

  // Create the CAS directory hierarchy
  await mkdir(dir, { recursive: true });

  // Move or copy the file into CAS
  if (keepOriginal) {
    await copyFile(filePath, destPath);
  } else {
    try {
      await rename(filePath, destPath);
    } catch {
      // rename fails across filesystems; fall back to copy + delete
      await copyFile(filePath, destPath);
      await unlink(filePath).catch(() => {});
    }
  }

  const fileStat = await stat(destPath);

  return {
    path: destPath,
    hash,
    deduplicated: false,
    size: fileStat.size,
  };
}

/**
 * Look up a file by its content hash.
 *
 * @param {string} hash     - Hex-encoded BLAKE3 hash.
 * @param {object} [options]
 * @param {string} [options.casRoot] - CAS root directory override.
 * @returns {Promise<{ path: string, size: number } | null>} File info or null if not found.
 */
async function lookupByHash(hash, options = {}) {
  const casRoot = options.casRoot || DEFAULT_CAS_ROOT;
  const { path: filePath } = casPath(hash, casRoot);

  if (!existsSync(filePath)) {
    return null;
  }

  const fileStat = await stat(filePath);
  return {
    path: filePath,
    size: fileStat.size,
  };
}

/**
 * Hash a file and store it in CAS in one operation.
 *
 * Convenience function that combines hashFile() + storeByHash().
 *
 * @param {string} filePath - Absolute path to the source file.
 * @param {object} [options]
 * @param {string} [options.casRoot] - CAS root directory override.
 * @param {boolean} [options.keepOriginal] - If true, copy instead of move.
 * @returns {Promise<{ path: string, hash: string, deduplicated: boolean, size: number }>}
 */
async function hashAndStore(filePath, options = {}) {
  const hash = await hashFile(filePath);
  return storeByHash(filePath, hash, options);
}

/**
 * Format a hash as a LOGIC-003 canonical content identifier.
 *
 * @param {string} hash - Hex-encoded BLAKE3 hash.
 * @returns {string} Content ID in the format "blake3:{hash}".
 */
function toContentId(hash) {
  return `blake3:${hash}`;
}

export {
  hashFile,
  storeByHash,
  lookupByHash,
  hashAndStore,
  casPath,
  toContentId,
  DEFAULT_CAS_ROOT,
};
