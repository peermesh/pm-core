// =============================================================================
// Media Upload & Serving Routes
// =============================================================================
// POST /api/media                     — Upload media file
// GET  /media/:profile_id/:filename   — Serve uploaded media
// PUT  /api/profile/:id/avatar        — Upload avatar image
// PUT  /api/profile/:id/banner        — Upload banner image

import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import Busboy from 'busboy';
import { pool } from '../db.js';
import { json, ensureDir, BASE_URL } from '../lib/helpers.js';
import { transcodeImage } from '../lib/media-transcoder.js';
import { hashAndStore, toContentId } from '../lib/content-store.js';

// =============================================================================
// Media Upload Constants
// =============================================================================

const MEDIA_BASE_DIR = '/data/media';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ACCEPTED_MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

const MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

/**
 * Parse a multipart/form-data upload.
 * Returns a promise that resolves with { fields, file }.
 */
function parseMultipartUpload(req, destDir, destFilename) {
  return new Promise((resolve, reject) => {
    let fileResult = null;
    let fileReceived = false;
    let writeFinished = false;
    let busboyFinished = false;
    const fields = {};
    let rejected = false;

    function tryResolve() {
      if (rejected) return;
      if (busboyFinished && (!fileReceived || writeFinished)) {
        resolve({ fields, file: fileResult });
      }
    }

    const busboy = Busboy({
      headers: req.headers,
      limits: {
        fileSize: MAX_FILE_SIZE,
        files: 1,
      },
    });

    busboy.on('field', (name, value) => {
      fields[name] = value;
    });

    busboy.on('file', (fieldname, fileStream, info) => {
      const { filename: origFilename, mimeType } = info;
      fileReceived = true;

      if (!ACCEPTED_MEDIA_TYPES.has(mimeType)) {
        fileStream.resume();
        rejected = true;
        reject(new Error(`Unsupported media type: ${mimeType}. Accepted: ${[...ACCEPTED_MEDIA_TYPES].join(', ')}`));
        return;
      }

      const ext = MIME_TO_EXT[mimeType] || extname(origFilename || '').toLowerCase() || '.bin';
      const savedName = destFilename
        ? `${destFilename}${ext}`
        : `${randomUUID()}${ext}`;

      ensureDir(destDir);
      const savePath = join(destDir, savedName);
      const writeStream = createWriteStream(savePath);
      let size = 0;

      fileStream.on('data', (chunk) => {
        size += chunk.length;
      });

      fileStream.on('limit', () => {
        writeStream.destroy();
        rejected = true;
        reject(new Error(`File exceeds maximum size of ${MAX_FILE_SIZE / (1024 * 1024)}MB`));
      });

      fileStream.pipe(writeStream);

      writeStream.on('finish', () => {
        fileResult = {
          filename: savedName,
          mimeType,
          size,
          savePath,
        };
        writeFinished = true;
        tryResolve();
      });

      writeStream.on('error', (err) => {
        if (!rejected) reject(err);
      });
    });

    busboy.on('finish', () => {
      busboyFinished = true;
      tryResolve();
    });

    busboy.on('error', (err) => {
      if (!rejected) reject(err);
    });

    req.pipe(busboy);
  });
}

export default function registerRoutes(routes) {
  // POST /api/media — Upload media file
  routes.push({
    method: 'POST',
    pattern: '/api/media',
    handler: async (req, res) => {
      let result;
      try {
        const tempDir = join(MEDIA_BASE_DIR, '_tmp');
        result = await parseMultipartUpload(req, tempDir);
      } catch (err) {
        return json(res, 400, { error: 'Bad Request', message: err.message });
      }

      const { fields, file } = result;
      const profileId = fields.profile_id;

      if (!profileId) {
        return json(res, 400, { error: 'Bad Request', message: 'Missing required field: profile_id' });
      }

      if (!file) {
        return json(res, 400, { error: 'Bad Request', message: 'No file uploaded' });
      }

      const profileResult = await pool.query(
        'SELECT id FROM social_profiles.profile_index WHERE id = $1',
        [profileId]
      );
      if (profileResult.rowCount === 0) {
        return json(res, 404, { error: 'Not Found', message: `Profile ${profileId} not found` });
      }

      const profileMediaDir = join(MEDIA_BASE_DIR, profileId);
      ensureDir(profileMediaDir);

      const { rename } = await import('node:fs/promises');
      const finalPath = join(profileMediaDir, file.filename);
      try {
        await rename(file.savePath, finalPath);
      } catch (err) {
        const { copyFile, unlink } = await import('node:fs/promises');
        await copyFile(file.savePath, finalPath);
        await unlink(file.savePath).catch(() => {});
      }

      const mediaUrl = `${BASE_URL}/media/${profileId}/${file.filename}`;

      // Content-addressed storage: hash and store in CAS (WO-021)
      let casResult = null;
      try {
        casResult = await hashAndStore(finalPath, { keepOriginal: true });
        console.log(`[media] CAS: ${toContentId(casResult.hash)} (dedup: ${casResult.deduplicated})`);
      } catch (err) {
        console.warn(`[media] CAS storage skipped:`, err.message);
      }

      // Transcoding: generate variants in background (WO-021)
      let variants = [];
      if (file.mimeType.startsWith('image/') && file.mimeType !== 'image/gif') {
        try {
          const variantDir = join(profileMediaDir, 'variants');
          variants = await transcodeImage(finalPath, variantDir);
          console.log(`[media] Transcoded ${variants.length} variants for ${file.filename}`);
        } catch (err) {
          console.warn(`[media] Transcoding skipped:`, err.message);
        }
      }

      console.log(`[media] Uploaded: ${mediaUrl} (${file.mimeType}, ${file.size} bytes)`);

      json(res, 201, {
        url: mediaUrl,
        filename: file.filename,
        content_type: file.mimeType,
        size: file.size,
        profile_id: profileId,
        content_id: casResult ? toContentId(casResult.hash) : null,
        deduplicated: casResult ? casResult.deduplicated : false,
        variants: variants.map(v => ({ name: v.name, format: v.format, width: v.width, height: v.height, size: v.size })),
      });
    },
  });

  // GET /media/:profile_id/:filename — Serve uploaded media files
  routes.push({
    method: 'GET',
    pattern: /^\/media\/([^/]+)\/([^/]+)$/,
    handler: async (req, res, matches) => {
      const profileId = matches[1];
      const filename = matches[2];

      if (profileId.includes('..') || filename.includes('..') ||
          profileId.includes('/') || filename.includes('/')) {
        return json(res, 400, { error: 'Bad Request', message: 'Invalid path' });
      }

      const filePath = join(MEDIA_BASE_DIR, profileId, filename);

      if (!existsSync(filePath)) {
        return json(res, 404, { error: 'Not Found', message: 'Media file not found' });
      }

      const ext = extname(filename).toLowerCase();
      const contentTypeMap = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
      };
      const contentType = contentTypeMap[ext] || 'application/octet-stream';

      let stat;
      try {
        stat = statSync(filePath);
      } catch {
        return json(res, 404, { error: 'Not Found', message: 'Media file not found' });
      }

      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stat.size,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'ETag': `"${profileId}-${filename}"`,
        'Access-Control-Allow-Origin': '*',
      });

      const readStream = createReadStream(filePath);
      readStream.pipe(res);
    },
  });

  // PUT /api/profile/:id/avatar — Upload avatar image
  routes.push({
    method: 'PUT',
    pattern: /^\/api\/profile\/([^/]+)\/avatar$/,
    handler: async (req, res, matches) => {
      const profileId = matches[1];

      const profileResult = await pool.query(
        'SELECT id FROM social_profiles.profile_index WHERE id = $1',
        [profileId]
      );
      if (profileResult.rowCount === 0) {
        return json(res, 404, { error: 'Not Found', message: `Profile ${profileId} not found` });
      }

      const profileMediaDir = join(MEDIA_BASE_DIR, profileId);
      let result;
      try {
        result = await parseMultipartUpload(req, profileMediaDir, 'avatar');
      } catch (err) {
        return json(res, 400, { error: 'Bad Request', message: err.message });
      }

      if (!result.file) {
        return json(res, 400, { error: 'Bad Request', message: 'No file uploaded' });
      }

      const avatarUrl = `${BASE_URL}/media/${profileId}/${result.file.filename}`;

      await pool.query(
        'UPDATE social_profiles.profile_index SET avatar_url = $1, updated_at = NOW() WHERE id = $2',
        [avatarUrl, profileId]
      );

      console.log(`[media] Avatar uploaded for profile ${profileId}: ${avatarUrl}`);

      json(res, 200, {
        avatar_url: avatarUrl,
        filename: result.file.filename,
        content_type: result.file.mimeType,
        size: result.file.size,
      });
    },
  });

  // PUT /api/profile/:id/banner — Upload banner image
  routes.push({
    method: 'PUT',
    pattern: /^\/api\/profile\/([^/]+)\/banner$/,
    handler: async (req, res, matches) => {
      const profileId = matches[1];

      const profileResult = await pool.query(
        'SELECT id FROM social_profiles.profile_index WHERE id = $1',
        [profileId]
      );
      if (profileResult.rowCount === 0) {
        return json(res, 404, { error: 'Not Found', message: `Profile ${profileId} not found` });
      }

      const profileMediaDir = join(MEDIA_BASE_DIR, profileId);
      let result;
      try {
        result = await parseMultipartUpload(req, profileMediaDir, 'banner');
      } catch (err) {
        return json(res, 400, { error: 'Bad Request', message: err.message });
      }

      if (!result.file) {
        return json(res, 400, { error: 'Bad Request', message: 'No file uploaded' });
      }

      const bannerUrl = `${BASE_URL}/media/${profileId}/${result.file.filename}`;

      await pool.query(
        'UPDATE social_profiles.profile_index SET banner_url = $1, updated_at = NOW() WHERE id = $2',
        [bannerUrl, profileId]
      );

      console.log(`[media] Banner uploaded for profile ${profileId}: ${bannerUrl}`);

      json(res, 200, {
        banner_url: bannerUrl,
        filename: result.file.filename,
        content_type: result.file.mimeType,
        size: result.file.size,
      });
    },
  });
}
