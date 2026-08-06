import { Jimp } from 'jimp';
import { downloadNutstoreFile, isPathInLibrary } from './_nutstore-webdav.js';
import { getStockClient } from './_image-gen-cost.js';
import { storagePathFromPublicUrl } from './_staging-storage.js';
import { logProductLoaderAudit } from './_product-loader-audit.js';
import {
  claimImageObject,
  createPrivateSourceUrl,
  downloadPrivateSource,
  readImageJob,
  readImageJobIndex,
  releaseImageObjectClaim,
  saveAndIndexImageJob,
  storePrivateSource,
} from './_image-processing-store.js';
import {
  fixImageFromUrl,
  resizeTo800White,
  uploadTransformedImage,
} from './_image-pipeline.js';
import {
  deriveJobStatus,
  imageFieldForSlot,
  normalizeImageSlot,
  resolveImageGenCost,
  summarizeJob,
} from '../lib/image-processing-centre.mjs';
import { fetchUsdToZarRate } from './_image-gen-cost.js';

const PRODUCT_BUCKET = 'product-images';

function updateJobRollup(job) {
  return {
    ...job,
    status: deriveJobStatus(job.images),
    summary: summarizeJob(job.images),
  };
}

export async function persistJob(job) {
  return saveAndIndexImageJob(updateJobRollup(job));
}

async function uploadFallbackTransform(job, image, buffer, fallbackError) {
  const resized = await resizeTo800White(buffer);
  const upload = await uploadTransformedImage(
    resized,
    `${image.sku || 'product'}-s${normalizeImageSlot(image.slot) || 1}.jpg`,
    'image/jpeg',
    { staging: true, sku: image.sku, slot: image.slot },
  );
  return {
    url: upload.url,
    storagePath: upload.storagePath,
    model: 'local-jimp-fallback',
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    fallbackError: fallbackError?.message || String(fallbackError || 'Local fallback used'),
  };
}

async function processStagedImage(job, image, { actor = 'processor' } = {}) {
  let materialized = image;
  if (image.source.type === 'nutstore' && !image.source.privatePath) {
    materialized = await materializeNutstoreSource(job, image);
  }
  if (!materialized.source.privatePath) throw new Error('Image source is not available in private staging');

  const sourceUrl = await createPrivateSourceUrl(materialized.source.privatePath, 600);
  const startedAt = new Date().toISOString();
  let transformed;
  try {
    transformed = await fixImageFromUrl(sourceUrl, {
      sku: materialized.sku,
      imageStyle: materialized.style,
      userInstructions: materialized.instructions,
      productTitle: materialized.productTitle,
      productDescription: materialized.productDescription,
      targetSlot: materialized.slot,
      staging: true,
    });
  } catch (error) {
    const original = await downloadPrivateSource(materialized.source.privatePath);
    transformed = await uploadFallbackTransform(job, materialized, original, error);
  }

  const storagePath = transformed.storagePath || storagePathFromPublicUrl(transformed.url);
  if (!storagePath) throw new Error('Processed image did not return a staging storage path');

  const stock = getStockClient();
  const { data, error } = await stock.storage.from(PRODUCT_BUCKET).download(storagePath);
  if (error) throw new Error(`Processed image was not stored correctly: ${error.message}`);
  const output = Buffer.from(await data.arrayBuffer());
  const quality = await analyzeImageQuality(output);
  const { costUsd, costSource } = resolveImageGenCost({
    model: transformed.model,
    tokensIn: transformed.tokensIn,
    tokensOut: transformed.tokensOut,
    costUsd: transformed.costUsd,
    isImageOutput: true,
  });
  const usdToZar = await fetchUsdToZarRate();
  const costZar = Number((costUsd * usdToZar).toFixed(4));
  const qualityFlags = [];
  if (quality.grade === 'needs_attention') qualityFlags.push('quality_needs_attention');
  if (transformed.fallbackError) qualityFlags.push('local_fallback_used');
  return {
    ...materialized,
    status: 'review',
    reviewUrl: transformed.url,
    outputStoragePath: storagePath,
    quality: { ...quality, worker: null, costSource, fallbackError: transformed.fallbackError || null },
    warnings: [...new Set([...(materialized.warnings || []), ...qualityFlags])],
    cost: {
      usd: costUsd,
      zar: costZar,
      latestUsd: costUsd,
      latestZar: costZar,
      source: transformed.fallbackError ? 'local_jimp_fallback' : costSource,
      model: transformed.model,
    },
    processing: { ...(materialized.processing || {}), startedAt, finishedAt: new Date().toISOString(), actor },
    error: null,
  };
}

export async function advanceQueuedImageProcessing({ jobId = null, limit = 1, actor = 'processor' } = {}) {
  const rows = await readImageJobIndex();
  const selected = jobId ? rows.filter((row) => row.id === jobId) : rows;
  const updated = [];
  for (const row of selected) {
    if (updated.length >= limit) break;
    const job = await readImageJob(row.id);
    if (!job) continue;
    const index = job.images.findIndex((image) => image.status === 'queued');
    if (index < 0) continue;
    const image = job.images[index];
    const claimScope = `${image.targetTable}-${image.sku}-${image.slot}`;
    const claim = await claimImageObject('targets', claimScope, { workerId: actor, ttlSeconds: 600 });
    if (!claim) continue;

    try {
      job.images[index] = {
        ...image,
        status: 'processing',
        processing: {
          claimId: claim.id,
          workerId: actor,
          startedAt: new Date().toISOString(),
          expiresAt: claim.expiresAt,
        },
        error: null,
      };
      await persistJob(job);
      job.images[index] = await processStagedImage(job, job.images[index], { actor });
      const saved = await persistJob(job);
      updated.push(saved.images[index]);
    } catch (error) {
      job.images[index] = {
        ...job.images[index],
        status: 'failed',
        error: String(error?.message || error).slice(0, 500),
        processing: { ...(job.images[index].processing || {}), finishedAt: new Date().toISOString() },
      };
      await persistJob(job);
      updated.push(job.images[index]);
    } finally {
      await releaseImageObjectClaim('targets', claimScope, claim.id).catch(() => {});
    }
  }
  return updated;
}

export async function ingestLocalSource(jobId, image, base64) {
  const buffer = Buffer.from(String(base64 || ''), 'base64');
  const privatePath = await storePrivateSource({
    jobId,
    imageId: image.id,
    filename: image.source.filename,
    contentType: image.source.contentType,
    buffer,
  });
  return { ...image, source: { ...image.source, ref: null, privatePath, bytes: buffer.length } };
}

export async function ingestStagedSource(jobId, image) {
  const storagePath = storagePathFromPublicUrl(image.source.ref);
  if (!storagePath) throw new Error('Source URL must be an existing Proto product-images object');
  const stock = getStockClient();
  const { data, error } = await stock.storage.from(PRODUCT_BUCKET).download(storagePath);
  if (error) throw new Error(`Could not import staged source: ${error.message}`);
  const buffer = Buffer.from(await data.arrayBuffer());
  const privatePath = await storePrivateSource({
    jobId,
    imageId: image.id,
    filename: image.source.filename,
    contentType: image.source.contentType,
    buffer,
  });
  return { ...image, source: { ...image.source, ref: null, privatePath, bytes: buffer.length } };
}

export async function materializeNutstoreSource(job, image) {
  if (image.source.privatePath) return image;
  if (!isPathInLibrary(image.source.ref)) throw new Error('Nutstore path is outside the configured image library');
  const downloaded = await downloadNutstoreFile(image.source.ref);
  const privatePath = await storePrivateSource({
    jobId: job.id,
    imageId: image.id,
    filename: downloaded.filename || image.source.filename,
    contentType: downloaded.contentType || image.source.contentType,
    buffer: downloaded.buffer,
  });
  return {
    ...image,
    source: {
      ...image.source,
      filename: downloaded.filename || image.source.filename,
      contentType: downloaded.contentType || image.source.contentType,
      privatePath,
      bytes: downloaded.buffer.length,
    },
  };
}

export function estimatedImageCostUsd() {
  // The default processor is the self-hosted rembg/Pillow worker. It has no
  // per-image API charge; hosting/electricity is treated as fixed overhead.
  return 0;
}

export function canClaimWithinCostLimit(job, image) {
  const spent = Number(job.summary?.costUsd) || 0;
  const next = estimatedImageCostUsd(image);
  const limit = Number(job.maxCostUsd) || 0;
  return {
    allowed: limit <= 0 || (spent + next) <= (limit + 0.000001),
    spent,
    next,
    limit,
  };
}

export async function prepareWorkerClaim(job, image, { expiresIn = 600 } = {}) {
  let materialized = image;
  if (image.source.type === 'nutstore' && !image.source.privatePath) {
    materialized = await materializeNutstoreSource(job, image);
  }
  if (!materialized.source.privatePath) throw new Error('Image source is not available in private staging');

  const sourceUrl = await createPrivateSourceUrl(materialized.source.privatePath, expiresIn);
  const stock = getStockClient();
  await stock.storage.createBucket(PRODUCT_BUCKET, { public: true }).catch(() => {});
  const outputPath = `staging/image-processing/outputs/${job.id}/${image.id}.jpg`;
  const { data, error } = await stock.storage.from(PRODUCT_BUCKET).createSignedUploadUrl(outputPath, { upsert: true });
  if (error) throw error;

  return {
    image: materialized,
    claimPayload: {
      jobId: job.id,
      imageId: image.id,
      sku: image.sku,
      slot: image.slot,
      source: {
        url: sourceUrl,
        contentType: materialized.source.contentType,
        filename: materialized.source.filename,
        expiresIn,
      },
      output: {
        path: outputPath,
        signedUploadUrl: data.signedUrl,
        token: data.token,
        contentType: 'image/jpeg',
        headers: { 'x-upsert': 'true', 'cache-control': 'max-age=0' },
      },
      processing: {
        remove_background: true,
        background: 'white',
        cleanup_noise: true,
        crop: true,
        padding_ratio: 0.08,
        width: 1600,
        height: 1600,
        output_format: 'jpeg',
        quality: 90,
        review_policy: 'manual_before_publish',
      },
      estimatedCostUsd: estimatedImageCostUsd(image),
    },
  };
}

export async function analyzeImageQuality(buffer) {
  const image = await Jimp.read(buffer);
  const { width, height, data } = image.bitmap;
  let borderPixels = 0;
  let whiteBorderPixels = 0;
  let borderDeviation = 0;
  let clippedPixels = 0;
  const borderDepth = Math.max(1, Math.round(Math.min(width, height) * 0.03));

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const isBorder = x < borderDepth || y < borderDepth || x >= width - borderDepth || y >= height - borderDepth;
      if (!isBorder) continue;
      const idx = ((y * width) + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const deviation = ((255 - r) + (255 - g) + (255 - b)) / (3 * 255);
      borderPixels += 1;
      borderDeviation += deviation;
      if (r >= 245 && g >= 245 && b >= 245) whiteBorderPixels += 1;
      if ((x === 0 || y === 0 || x === width - 1 || y === height - 1) && (r < 235 || g < 235 || b < 235)) {
        clippedPixels += 1;
      }
    }
  }

  const metrics = {
    width,
    height,
    bytes: buffer.length,
    whiteBorderRatio: borderPixels ? whiteBorderPixels / borderPixels : 0,
    borderNoise: borderPixels ? borderDeviation / borderPixels : 1,
    clippedEdgeRatio: clippedPixels / Math.max(1, (width * 2) + (height * 2) - 4),
  };
  return { ...metrics, ...qualityScoreFromMetrics(metrics) };
}

export async function completeWorkerOutput(job, image, payload = {}) {
  const expectedPath = `staging/image-processing/outputs/${job.id}/${image.id}.jpg`;
  if (String(payload.outputPath || '') !== expectedPath) throw new Error('Worker output path does not match the claim');
  const stock = getStockClient();
  const { data, error } = await stock.storage.from(PRODUCT_BUCKET).download(expectedPath);
  if (error) throw new Error(`Worker output was not uploaded: ${error.message}`);
  const output = Buffer.from(await data.arrayBuffer());
  const quality = await analyzeImageQuality(output);
  const publicUrl = stock.storage.from(PRODUCT_BUCKET).getPublicUrl(expectedPath).data.publicUrl;
  const workerWarnings = Array.isArray(payload.warnings)
    ? payload.warnings.map((warning) => String(warning).slice(0, 120)).slice(0, 20)
    : [];
  const ambiguousLabelWarning = workerWarnings.includes('possible_detached_label_or_barcode')
    ? ['manual_label_barcode_review_required']
    : [];
  return {
    ...image,
    status: 'review',
    reviewUrl: publicUrl,
    outputStoragePath: expectedPath,
    quality: { ...quality, worker: payload.quality || null },
    warnings: [...new Set([...(image.warnings || []), ...workerWarnings, ...ambiguousLabelWarning])],
    cost: {
      usd: 0,
      zar: 0,
      latestUsd: 0,
      latestZar: 0,
      source: 'self_hosted_fixed_overhead',
      model: 'rembg-local',
    },
    processing: { ...(image.processing || {}), finishedAt: new Date().toISOString() },
    error: null,
  };
}

async function objectExists(bucket, path) {
  const parts = path.split('/');
  const name = parts.pop();
  const { data, error } = await bucket.list(parts.join('/'), { search: name, limit: 5 });
  return !error && (data || []).some((row) => row.name === name);
}

export function markImageApproved(image, { actor }) {
  if (image.status === 'approved' || image.status === 'published') return image;
  if (image.status !== 'review') throw new Error('Only an image awaiting review can be approved');
  return {
    ...image,
    status: 'approved',
    approvedAt: new Date().toISOString(),
    approvedBy: actor,
    error: null,
  };
}

export async function publishApprovedImage(job, image, { actor, slot = image.slot, allowOverwrite = false }) {
  if (image.status === 'published') return image;
  if (image.status !== 'approved') throw new Error('Only an explicitly approved image can be published');
  const field = imageFieldForSlot(slot);
  if (!field) throw new Error('Image slot must be 1, 2, 3, or 4');
  const stock = getStockClient();
  const { data: product, error: fetchError } = await stock
    .from(image.targetTable)
    .select(`sku,${field}`)
    .eq('sku', image.sku)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (!product) throw new Error(`Product ${image.sku} does not exist in ${image.targetTable}`);
  if (product[field] && !(image.overwrite || allowOverwrite)) {
    const err = new Error(`Image slot ${image.slot} already has an image; create the job with overwrite approval enabled`);
    err.code = 'image_exists';
    throw err;
  }

  const sourcePath = image.outputStoragePath || storagePathFromPublicUrl(image.reviewUrl);
  if (!sourcePath?.startsWith('staging/')) throw new Error('Approved output is not in staging storage');
  const safeJob = job.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(-16);
  const safeImage = image.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(-16);
  const livePath = `${image.sku}/${slot}-${safeJob}-${safeImage}.jpg`;
  const bucket = stock.storage.from(PRODUCT_BUCKET);
  const { error: moveError } = await bucket.move(sourcePath, livePath);
  if (moveError && !(await objectExists(bucket, livePath))) throw new Error(`Could not promote approved image: ${moveError.message}`);
  const liveUrl = bucket.getPublicUrl(livePath).data.publicUrl;

  const { error: updateError } = await stock
    .from(image.targetTable)
    .update({ [field]: liveUrl, updated_at: new Date().toISOString() })
    .eq('sku', image.sku);
  if (updateError) throw updateError;

  await logProductLoaderAudit(stock, {
    sku: image.sku,
    action: 'update',
    source: 'image_processing_centre',
    publishMode: 'approved_review',
    imageSlot: slot,
    imageSource: image.source.type,
    oldValues: { [field]: product[field] || null },
    newValues: { outcome: 'approved', [field]: liveUrl, jobId: job.id, quality: image.quality },
    publishedBy: actor,
  });

  return {
    ...image,
    status: 'published',
    slot,
    publishedUrl: liveUrl,
    publishedAt: new Date().toISOString(),
    publishedBy: actor,
    publication: {
      field,
      previousUrl: product[field] || null,
      liveUrl,
      livePath,
    },
    error: null,
  };
}

export async function restorePublishedOriginal(job, image, { actor }) {
  if (image.status === 'restored') return image;
  if (image.status !== 'published' || !image.publication?.field) {
    throw new Error('Only a published processed image can be restored');
  }
  const field = image.publication.field;
  if (!['image_url_one', 'image_url_two', 'image_url_three', 'image_url_four'].includes(field)) {
    throw new Error('Stored publication slot is invalid');
  }
  const stock = getStockClient();
  const previousUrl = image.publication.previousUrl || null;
  const { error } = await stock
    .from(image.targetTable)
    .update({ [field]: previousUrl, updated_at: new Date().toISOString() })
    .eq('sku', image.sku);
  if (error) throw error;

  await logProductLoaderAudit(stock, {
    sku: image.sku,
    action: 'update',
    source: 'image_processing_centre',
    publishMode: 'restore_original',
    imageSlot: image.slot,
    imageSource: image.source.type,
    oldValues: { [field]: image.publication.liveUrl || image.publishedUrl || null },
    newValues: { outcome: 'restored_original', [field]: previousUrl, jobId: job.id },
    publishedBy: actor,
  });

  return {
    ...image,
    status: 'restored',
    restoredAt: new Date().toISOString(),
    restoredBy: actor,
    restoredUrl: previousUrl,
    error: null,
  };
}

export async function rejectImage(image, { actor, reason = '' } = {}) {
  if (image.status === 'approved') throw new Error('An approved image cannot be rejected');
  if (image.status === 'rejected') return image;
  return {
    ...image,
    status: 'rejected',
    rejectedAt: new Date().toISOString(),
    rejectedBy: actor,
    rejectionReason: String(reason || '').trim().slice(0, 500) || null,
  };
}
