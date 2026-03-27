// =============================================================================
// Media Transcoding Pipeline
// =============================================================================
// Generates protocol-appropriate image variants from a canonical original.
// Uses sharp for image processing. Designed for Mode 1 (VPS) local transcoding.
//
// Blueprint: LOGIC-003 (Mechanic 3 — Transcoding Pipeline)
// Work Order: WO-021

import sharp from 'sharp';
import { join, basename, extname } from 'node:path';
import { stat, mkdir } from 'node:fs/promises';

// =============================================================================
// Default Variant Specifications
// =============================================================================
// Aligned with LOGIC-003 Mechanic 3 variant table plus WO-021 task spec.

const DEFAULT_JPEG_VARIANTS = [
  { name: 'thumbnail', width: 150, height: 150, fit: 'cover', format: 'jpeg', quality: 80 },
  { name: 'small',     width: 400, height: null, fit: 'inside', format: 'jpeg', quality: 85 },
  { name: 'medium',    width: 800, height: null, fit: 'inside', format: 'jpeg', quality: 85 },
  { name: 'large',     width: 1200, height: null, fit: 'inside', format: 'jpeg', quality: 90 },
];

const DEFAULT_WEBP_VARIANTS = [
  { name: 'thumbnail', width: 150, height: 150, fit: 'cover', format: 'webp', quality: 70 },
  { name: 'small',     width: 400, height: null, fit: 'inside', format: 'webp', quality: 80 },
  { name: 'medium',    width: 800, height: null, fit: 'inside', format: 'webp', quality: 80 },
  { name: 'large',     width: 1200, height: null, fit: 'inside', format: 'webp', quality: 85 },
];

// Blueprint variant names mapped to our pipeline names for protocol mapping
const BLUEPRINT_VARIANTS = {
  full:      { width: 4096, height: 4096, fit: 'inside', format: 'webp', quality: 90 },
  standard:  { width: 1024, height: 1024, fit: 'inside', format: 'webp', quality: 80 },
  thumbnail: { width: 256,  height: 256,  fit: 'cover',  format: 'webp', quality: 70 },
  avatar:    { width: 400,  height: 400,  fit: 'cover',  format: 'webp', quality: 85 },
};

// =============================================================================
// Core Transcoding Function
// =============================================================================

/**
 * Transcode an image into multiple variants (JPEG + WebP).
 *
 * @param {string} inputPath  - Absolute path to the source image file.
 * @param {string} outputDir  - Directory to write variant files into.
 * @param {object} [options]  - Override defaults.
 * @param {Array}  [options.jpegVariants]  - Custom JPEG variant specs.
 * @param {Array}  [options.webpVariants]  - Custom WebP variant specs.
 * @param {Array}  [options.extraVariants] - Additional variant specs to generate.
 * @returns {Promise<Array<{name: string, path: string, width: number, height: number, format: string, size: number}>>}
 */
async function transcodeImage(inputPath, outputDir, options = {}) {
  const jpegVariants = options.jpegVariants || DEFAULT_JPEG_VARIANTS;
  const webpVariants = options.webpVariants || DEFAULT_WEBP_VARIANTS;
  const extraVariants = options.extraVariants || [];
  const allVariants = [...jpegVariants, ...webpVariants, ...extraVariants];

  // Ensure output directory exists
  await mkdir(outputDir, { recursive: true });

  // Read source image metadata for aspect ratio decisions
  const image = sharp(inputPath);
  const metadata = await image.metadata();
  const srcWidth = metadata.width;
  const srcHeight = metadata.height;

  const baseName = basename(inputPath, extname(inputPath));
  const results = [];

  for (const variant of allVariants) {
    // Skip variants wider than the source (no upscaling)
    if (variant.width && srcWidth && variant.width > srcWidth &&
        variant.height && srcHeight && variant.height > srcHeight) {
      // Still generate the variant but at original size to ensure all names exist
    }

    const ext = variant.format === 'webp' ? '.webp' : '.jpg';
    const suffix = variant.format === 'webp' ? `-${variant.name}.webp` : `-${variant.name}.jpg`;
    const outFilename = `${baseName}${suffix}`;
    const outPath = join(outputDir, outFilename);

    // Build resize options
    const resizeOpts = {
      fit: variant.fit || 'inside',
      withoutEnlargement: true,
    };
    if (variant.width)  resizeOpts.width = variant.width;
    if (variant.height) resizeOpts.height = variant.height;

    // Build format-specific output options
    let pipeline = sharp(inputPath)
      .rotate() // auto-orient from EXIF
      .resize(resizeOpts);

    if (variant.format === 'webp') {
      pipeline = pipeline.webp({ quality: variant.quality || 80 });
    } else {
      pipeline = pipeline.jpeg({ quality: variant.quality || 85, mozjpeg: true });
    }

    await pipeline.toFile(outPath);

    // Read output metadata and file size
    const outMeta = await sharp(outPath).metadata();
    const outStat = await stat(outPath);

    results.push({
      name: variant.name,
      format: variant.format,
      path: outPath,
      width: outMeta.width,
      height: outMeta.height,
      size: outStat.size,
    });
  }

  return results;
}

/**
 * Generate a single blueprint-aligned variant (full, standard, thumbnail, avatar).
 *
 * @param {string} inputPath  - Absolute path to source image.
 * @param {string} outputDir  - Directory to write the variant into.
 * @param {string} variantName - One of: 'full', 'standard', 'thumbnail', 'avatar'.
 * @returns {Promise<{name: string, path: string, width: number, height: number, format: string, size: number}>}
 */
async function generateBlueprintVariant(inputPath, outputDir, variantName) {
  const spec = BLUEPRINT_VARIANTS[variantName];
  if (!spec) {
    throw new Error(`Unknown blueprint variant: ${variantName}. Valid: ${Object.keys(BLUEPRINT_VARIANTS).join(', ')}`);
  }

  await mkdir(outputDir, { recursive: true });

  const baseName = basename(inputPath, extname(inputPath));
  const ext = spec.format === 'webp' ? '.webp' : '.jpg';
  const outPath = join(outputDir, `${baseName}-${variantName}${ext}`);

  const resizeOpts = {
    width: spec.width,
    height: spec.height,
    fit: spec.fit,
    withoutEnlargement: true,
  };

  let pipeline = sharp(inputPath)
    .rotate()
    .resize(resizeOpts);

  if (spec.format === 'webp') {
    pipeline = pipeline.webp({ quality: spec.quality });
  } else {
    pipeline = pipeline.jpeg({ quality: spec.quality, mozjpeg: true });
  }

  await pipeline.toFile(outPath);

  const outMeta = await sharp(outPath).metadata();
  const outStat = await stat(outPath);

  return {
    name: variantName,
    format: spec.format,
    path: outPath,
    width: outMeta.width,
    height: outMeta.height,
    size: outStat.size,
  };
}

/**
 * Generate all blueprint-aligned variants for protocol distribution.
 *
 * @param {string} inputPath  - Absolute path to source image.
 * @param {string} outputDir  - Directory to write variants into.
 * @returns {Promise<Array<{name: string, path: string, width: number, height: number, format: string, size: number}>>}
 */
async function generateAllBlueprintVariants(inputPath, outputDir) {
  const results = [];
  for (const name of Object.keys(BLUEPRINT_VARIANTS)) {
    const result = await generateBlueprintVariant(inputPath, outputDir, name);
    results.push(result);
  }
  return results;
}

export {
  transcodeImage,
  generateBlueprintVariant,
  generateAllBlueprintVariants,
  DEFAULT_JPEG_VARIANTS,
  DEFAULT_WEBP_VARIANTS,
  BLUEPRINT_VARIANTS,
};
