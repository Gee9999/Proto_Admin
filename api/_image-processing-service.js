import { Jimp } from 'jimp';
import { downloadNutstoreFile, isPathInLibrary } from './_nutstore-webdav.js';
import { getStockClient } from './_image-gen-cost.js';
import { storagePathFromPublicUrl } from './_staging-storage.js';
import { logProductLoaderAudit } from './_product-loader-audit.js';
import {
  createPrivateSourceUrl,
  downloadPrivateSource,
  removeImageJobRecord,
  removePrivateImageArtifacts,
  saveAndIndexImageJob,
  storePrivateSource,
} from './_image-processing-store.js';
import {
  downloadFalOutput,
  FAL_BACKGROUND_COST_USD,
  FAL_BACKGROUND_MODEL,
  FAL_USD_TO_ZAR,
  removeBackgroundWithFal,
  standardizeFalOutput,
} from './_fal-image-provider.js';
import {
  ALLOWED_TARGET_TABLES,
  deriveJobStatus,
  normalizeImageSku,
  normalizeImageSlot,
  productManagerDestination,
  qualityScoreFromMetrics,
  summarizeJob,
} from '../lib/image-processing-centre.mjs';

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
  return FAL_BACKGROUND_COST_USD;
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
      const alpha = data[idx + 3];
      const transparent = alpha <= 16;
      const deviation = transparent ? 0 : ((255 - r) + (255 - g) + (255 - b)) / (3 * 255);
      borderPixels += 1;
      borderDeviation += deviation;
      if (transparent || (r >= 245 && g >= 245 && b >= 245)) whiteBorderPixels += 1;
      if (!transparent && (x === 0 || y === 0 || x === width - 1 || y === height - 1) && (r < 235 || g < 235 || b < 235)) {
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

// The cut-out is retained privately as the reusable master. The review and
// archive derivative is deliberately what the customer will see: a consistent
// 1600 × 1600 white JPEG, rather than a transparent image on an unknown page.
export async function createWebsiteReadyDerivative(masterBuffer, { size = 1600 } = {}) {
  const master = await Jimp.read(masterBuffer);
  const canvas = new Jimp({ width: size, height: size, color: 0xffffffff });
  canvas.composite(master, 0, 0);
  const buffer = await canvas.getBuffer('image/jpeg');
  return { buffer, width: size, height: size, background: '#FFFFFF', format: 'jpeg' };
}

async function storeTransparentMaster(job, image, buffer) {
  return storePrivateSource({
    jobId: job.id,
    imageId: `${image.id}-transparent-master`,
    filename: `${image.id}-transparent-master.png`,
    contentType: 'image/png',
    buffer,
  });
}

async function uploadWebsiteReadyDerivative(job, image, buffer) {
  // The review derivative is an archive asset, not catalogue media.  Keep it
  // in the private site-config bucket until the operator explicitly applies it
  // to Product Manager, at which point only the final copy becomes public.
  const path = await storePrivateSource({
    jobId: job.id,
    imageId: `${image.id}-website-ready`,
    filename: `${image.id}-1600-white.jpg`,
    contentType: 'image/jpeg',
    buffer,
  });
  return { path, url: null };
}

export async function completeWorkerOutput(job, image, payload = {}) {
  const expectedPath = `staging/image-processing/outputs/${job.id}/${image.id}.jpg`;
  if (String(payload.outputPath || '') !== expectedPath) throw new Error('Worker output path does not match the claim');
  const stock = getStockClient();
  const { data, error } = await stock.storage.from(PRODUCT_BUCKET).download(expectedPath);
  if (error) throw new Error(`Worker output was not uploaded: ${error.message}`);
  const transparentMaster = Buffer.from(await data.arrayBuffer());
  const transparentPrivatePath = await storeTransparentMaster(job, image, transparentMaster);
  const websiteReady = await createWebsiteReadyDerivative(transparentMaster);
  const websiteReadyStorage = await uploadWebsiteReadyDerivative(job, image, websiteReady.buffer);
  const quality = await analyzeImageQuality(websiteReady.buffer);
  const workerWarnings = Array.isArray(payload.warnings)
    ? payload.warnings.map((warning) => String(warning).slice(0, 120)).slice(0, 20)
    : [];
  const ambiguousLabelWarning = workerWarnings.includes('possible_detached_label_or_barcode')
    ? ['manual_label_barcode_review_required']
    : [];
  return {
    ...image,
    status: 'review',
    reviewUrl: websiteReadyStorage.url,
    outputStoragePath: websiteReadyStorage.path,
    processed: {
      transparentPrivatePath,
      websiteReady: { ...websiteReadyStorage, ...websiteReady },
    },
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

export async function processImageWithFal(job, image, providerOptions = {}) {
  let materialized = image;
  if (image.source.type === 'nutstore' && !image.source.privatePath) {
    materialized = await materializeNutstoreSource(job, image);
  }
  if (!materialized.source.privatePath) throw new Error('Image source is not available in private staging');

  const sourceUrl = await createPrivateSourceUrl(materialized.source.privatePath, 900);
  const removed = await removeBackgroundWithFal(sourceUrl, providerOptions);
  const transparent = await downloadFalOutput(removed.outputUrl, providerOptions);
  const standardized = await standardizeFalOutput(transparent);
  const transparentPrivatePath = await storeTransparentMaster(job, materialized, standardized.buffer);
  const websiteReady = await createWebsiteReadyDerivative(standardized.buffer);
  const websiteReadyStorage = await uploadWebsiteReadyDerivative(job, materialized, websiteReady.buffer);
  const quality = await analyzeImageQuality(websiteReady.buffer);

  const previousUsd = Number(image.cost?.usd) || 0;
  const previousZar = Number(image.cost?.zar) || 0;
  const latestZar = Number((FAL_BACKGROUND_COST_USD * FAL_USD_TO_ZAR).toFixed(2));
  return {
    ...materialized,
    status: 'review',
    reviewUrl: websiteReadyStorage.url,
    outputStoragePath: websiteReadyStorage.path,
    processed: {
      transparentPrivatePath,
      websiteReady: { ...websiteReadyStorage, ...websiteReady },
    },
    quality: { ...quality, provider: 'fal.ai' },
    warnings: [...new Set([...(image.warnings || []), ...standardized.warnings])],
    cost: {
      usd: Number((previousUsd + FAL_BACKGROUND_COST_USD).toFixed(4)),
      zar: Number((previousZar + latestZar).toFixed(2)),
      latestUsd: FAL_BACKGROUND_COST_USD,
      latestZar,
      source: 'fal_pay_per_image',
      model: FAL_BACKGROUND_MODEL,
    },
    processing: {
      ...(image.processing || {}),
      provider: 'fal.ai',
      model: FAL_BACKGROUND_MODEL,
      requestId: removed.requestId,
      finishedAt: new Date().toISOString(),
    },
    error: null,
  };
}

const CLEARABLE_IMAGE_STATUSES = new Set(['review', 'ready', 'completed', 'failed', 'error', 'rejected']);

export async function clearUnpublishedImage(job, image) {
  if (!CLEARABLE_IMAGE_STATUSES.has(image.status)) {
    throw new Error('Only an unapproved image awaiting review, rejected, or failed can be cleared');
  }
  if (image.publishedUrl || image.publishedAt || image.approvedAt) {
    throw new Error('Approved or published images cannot be cleared from this queue');
  }

  const outputPrefix = `staging/image-processing/outputs/${job.id}/${image.id}.`;
  const outputPaths = [...new Set([
    image.outputStoragePath,
    `${outputPrefix}png`,
    `${outputPrefix}jpg`,
  ].filter((path) => String(path || '').startsWith(outputPrefix)))];
  if (outputPaths.length) {
    const stock = getStockClient();
    const { error } = await stock.storage.from(PRODUCT_BUCKET).remove(outputPaths);
    if (error) throw new Error(`Could not remove staged output: ${error.message}`);
  }

  await removePrivateImageArtifacts(job, image);
  const remainingImages = job.images.filter((row) => row.id !== image.id);
  if (!remainingImages.length) {
    await removeImageJobRecord(job.id);
    return null;
  }
  return persistJob({ ...job, images: remainingImages });
}

async function objectExists(bucket, path) {
  const parts = path.split('/');
  const name = parts.pop();
  const { data, error } = await bucket.list(parts.join('/'), { search: name, limit: 5 });
  return !error && (data || []).some((row) => row.name === name);
}

function imageProcessingError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function imageSlotForField(field) {
  const slot = ['image_url_one', 'image_url_two', 'image_url_three', 'image_url_four'].indexOf(field) + 1;
  return slot || null;
}

function resolvedProductDestination(image, requestedSlot = image.slot) {
  const slot = normalizeImageSlot(requestedSlot);
  if (!slot) {
    throw imageProcessingError('ipc_invalid_destination', 'Choose a valid Product Manager image position.');
  }
  const stored = image.destination;
  const manuallyAssigned = stored?.source === 'manual_selection';
  const destination = productManagerDestination({
    sku: manuallyAssigned ? stored.sku : image.sku,
    slot,
    targetTable: manuallyAssigned ? stored.table : image.targetTable,
  });
  if (!destination.sku || !destination.field || !ALLOWED_TARGET_TABLES.includes(destination.table)) {
    throw imageProcessingError(
      'ipc_invalid_destination',
      'This image does not have a valid Product Manager destination. Upload it again using the exact product SKU.',
    );
  }

  // Jobs created before the explicit destination contract do not have this
  // field, so derive it for backward compatibility. If a stored destination
  // is present, it must still point to the same Product Manager product.
  if (stored && !manuallyAssigned && (
    String(stored.system || '').toLowerCase() !== 'product_manager'
    || String(stored.table || '').toLowerCase() !== destination.table
    || String(stored.sku || '').toUpperCase() !== destination.sku
  )) {
    throw imageProcessingError(
      'ipc_destination_conflict',
      'This image’s saved Product Manager destination no longer matches its SKU. It was not sent anywhere.',
    );
  }
  return destination;
}

async function readExactProduct(stock, destination) {
  const { data, error } = await stock
    .from(destination.table)
    .select(`sku,title,${destination.field}`)
    .eq('sku', destination.sku)
    .limit(2);
  if (error) throw error;
  const rows = data || [];
  if (!rows.length) {
    throw imageProcessingError(
      'ipc_product_not_found',
      `No exact Product Manager product matches SKU ${destination.sku}. Nothing was changed.`,
    );
  }
  if (rows.length > 1) {
    throw imageProcessingError(
      'ipc_product_conflict',
      `Product Manager has more than one product with SKU ${destination.sku}. Resolve the duplicate before sending this image.`,
    );
  }
  return rows[0];
}

function assertNoJobDestinationConflict(job, image, destination) {
  const conflict = (job.images || []).find((candidate) => {
    if (candidate.id === image.id || ['rejected', 'failed', 'restored'].includes(candidate.status)) return false;
    const manuallyAssigned = candidate.destination?.source === 'manual_selection';
    const candidateSlot = candidate.publication?.slot || (manuallyAssigned ? candidate.destination?.slot : candidate.slot);
    const candidateDestination = productManagerDestination({
      sku: candidate.publication?.sku || (manuallyAssigned ? candidate.destination?.sku : candidate.sku),
      slot: candidateSlot,
      targetTable: candidate.publication?.table || (manuallyAssigned ? candidate.destination?.table : candidate.targetTable),
    });
    return candidateDestination.table === destination.table
      && candidateDestination.sku === destination.sku
      && candidateDestination.field === destination.field;
  });
  if (conflict) {
    throw imageProcessingError(
      'ipc_job_destination_conflict',
      `This batch already contains ${conflict.source?.filename || 'another image'} for ${destination.label} of SKU ${destination.sku}.`,
    );
  }
}

function conditionalImageUpdate(stock, destination, expectedUrl, nextUrl) {
  let query = stock
    .from(destination.table)
    .update({ [destination.field]: nextUrl, updated_at: new Date().toISOString() })
    .eq('sku', destination.sku);
  query = expectedUrl == null
    ? query.is(destination.field, null)
    : query.eq(destination.field, expectedUrl);
  return query.select('sku');
}

export function markImageApproved(image, { actor }) {
  if (image.status === 'approved' || image.status === 'archived' || image.status === 'published') return image;
  if (image.status !== 'review') throw new Error('Only an image awaiting review can be approved');
  const qualityFlags = [...new Set([...(image.quality?.flags || []), ...(image.warnings || [])])];
  if (image.quality?.requiresManualReview || qualityFlags.length > 0) {
    throw new Error('This image has quality flags and cannot be approved until the issues are resolved and reprocessed.');
  }
  return {
    ...image,
    status: 'approved',
    approvedAt: new Date().toISOString(),
    approvedBy: actor,
    error: null,
  };
}

export async function archiveApprovedImage(job, image, { actor, stockClient = null } = {}) {
  if (image.status === 'archived') return image;
  if (image.status !== 'approved') {
    throw new Error('Only an explicitly approved image can be saved to the Image Archive');
  }
  if (!image.processed?.transparentPrivatePath) {
    throw new Error('Approved image has no private transparent master to archive');
  }
  const sourcePath = image.outputStoragePath;
  if (!sourcePath?.startsWith('image-processing/sources/')) {
    throw new Error('Approved image does not have a website-ready 1600px white derivative');
  }

  // The approved derivative is already a private immutable object.  The
  // archive records that object rather than duplicating it into the public
  // product-images bucket.
  const archivePath = sourcePath;
  return {
    ...image,
    status: 'archived',
    archivedAt: new Date().toISOString(),
    archivedBy: actor,
    archive: {
      assetId: `asset_${job.id}_${image.id}`,
      originalPrivatePath: image.source?.privatePath || null,
      transparentPrivatePath: image.processed.transparentPrivatePath,
      // Private variants intentionally have no durable public URL.  The API
      // mints short-lived review URLs when an owner opens the archive.
      originalUrl: null,
      transparentMasterUrl: null,
      websiteReadyPath: archivePath,
      websiteReadyUrl: null,
      specification: { width: 1600, height: 1600, background: '#FFFFFF', format: 'jpeg' },
    },
    error: null,
  };
}

// A filename normally supplies the destination SKU.  When an image comes from
// a camera or supplier folder with an opaque name, the owner may deliberately
// bind it to one verified Product Manager SKU.  This only stages the target;
// publishing still requires approval and a second explicit confirmation.
export async function assignImageDestination(image, {
  actor,
  sku,
  slot = image.slot,
  stockClient = null,
} = {}) {
  if (!['review', 'approved', 'archived'].includes(image.status)) {
    throw imageProcessingError('ipc_destination_assignment_not_allowed', 'Choose a Product Manager destination only after processing is ready for review, approved, or archived.');
  }
  const destination = productManagerDestination({
    sku: normalizeImageSku(sku),
    slot,
  });
  if (!destination.sku || !destination.field || !ALLOWED_TARGET_TABLES.includes(destination.table)) {
    throw imageProcessingError('ipc_invalid_destination', 'Choose a valid exact Product Manager product and image position.');
  }
  const stock = stockClient || getStockClient();
  await readExactProduct(stock, destination);
  return {
    ...image,
    destination: {
      ...destination,
      source: 'manual_selection',
      assignedAt: new Date().toISOString(),
      assignedBy: actor,
    },
    error: null,
  };
}

export async function applyArchivedImage(job, image, {
  actor,
  slot = image.slot,
  allowOverwrite = false,
  stockClient = null,
}) {
  if (image.status === 'published') return image;
  if (image.status !== 'archived') throw new Error('Only an explicitly archived image can be applied to Product Manager');
  const destination = resolvedProductDestination(image, slot);
  if (destination.slot !== image.slot && !allowOverwrite) {
    throw imageProcessingError(
      'ipc_destination_confirmation_required',
      `Confirm sending this image to ${destination.label}; it differs from the position detected from the filename.`,
    );
  }
  assertNoJobDestinationConflict(job, image, destination);
  const stock = stockClient || getStockClient();
  const product = await readExactProduct(stock, destination);
  const previousUrl = product[destination.field] || null;
  if (previousUrl && !allowOverwrite) {
    throw imageProcessingError(
      'image_exists',
      `${destination.label} for SKU ${destination.sku} already has an image. Review it and explicitly confirm replacement.`,
    );
  }

  const sourcePath = image.archive?.websiteReadyPath;
  if (!sourcePath?.startsWith('image-processing/sources/')) throw new Error('Archived website-ready image is not available');
  const safeJob = job.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(-16);
  const safeImage = image.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(-16);
  const outputExtension = sourcePath.toLowerCase().endsWith('.png') ? 'png' : 'jpg';
  const livePath = `${destination.sku}/${destination.slot}-${safeJob}-${safeImage}.${outputExtension}`;
  const bucket = stock.storage.from(PRODUCT_BUCKET);
  const archivedBuffer = await downloadPrivateSource(sourcePath);
  const { error: copyError } = await bucket.upload(livePath, archivedBuffer, {
    contentType: 'image/jpeg', cacheControl: 'max-age=31536000, immutable', upsert: false,
  });
  if (copyError && !(await objectExists(bucket, livePath))) throw new Error(`Could not stage the Product Manager image: ${copyError.message}`);
  const liveUrl = bucket.getPublicUrl(livePath).data.publicUrl;

  const { data: updatedRows, error: updateError } = await conditionalImageUpdate(
    stock,
    destination,
    previousUrl,
    liveUrl,
  );
  if (updateError) throw updateError;
  if (!updatedRows?.length) {
    throw imageProcessingError(
      'ipc_product_image_conflict',
      `Product Manager changed ${destination.label} for SKU ${destination.sku} while this result was being sent. Refresh and review the latest image before trying again.`,
    );
  }

  await logProductLoaderAudit(stock, {
    sku: destination.sku,
    action: 'update',
    source: 'image_processing_centre',
    publishMode: 'archived_asset_apply',
    imageSlot: destination.slot,
    imageSource: image.source.type,
    oldValues: { [destination.field]: previousUrl },
    newValues: { outcome: 'approved', [destination.field]: liveUrl, jobId: job.id, quality: image.quality },
    publishedBy: actor,
  });

  return {
    ...image,
    status: 'published',
    slot: destination.slot,
    targetTable: destination.table,
    destination,
    publishedUrl: liveUrl,
    publishedAt: new Date().toISOString(),
    publishedBy: actor,
    publication: {
      ...destination,
      previousUrl,
      originalUrl: previousUrl,
      liveUrl,
      livePath,
    },
    error: null,
  };
}

// Compatibility guard: a stale client cannot convert an approved review into
// a live product-image change. Future clients must use archive then apply.
export async function publishApprovedImage() {
  throw imageProcessingError(
    'archive_required',
    'Direct publishing is disabled. Save the approved result to the Image Archive, then explicitly apply the archived asset.',
  );
}

export async function restorePublishedOriginal(job, image, { actor, stockClient = null }) {
  if (image.status === 'restored') return image;
  if (image.status !== 'published' || !image.publication?.field) {
    throw new Error('Only a published processed image can be restored');
  }
  const publicationSlot = normalizeImageSlot(image.publication.slot)
    || imageSlotForField(image.publication.field);
  const destination = productManagerDestination({
    sku: image.publication.sku || image.sku,
    slot: publicationSlot,
    targetTable: image.publication.table || image.targetTable,
  });
  if (!destination.field || destination.field !== image.publication.field || !ALLOWED_TARGET_TABLES.includes(destination.table)) {
    throw imageProcessingError('ipc_restore_destination_invalid', 'The saved Product Manager destination is invalid; the original was not changed.');
  }
  const stock = stockClient || getStockClient();
  const product = await readExactProduct(stock, destination);
  const liveUrl = image.publication.liveUrl || image.publishedUrl || null;
  if (!liveUrl || product[destination.field] !== liveUrl) {
    throw imageProcessingError(
      'ipc_restore_conflict',
      `Restore stopped because ${destination.label} for SKU ${destination.sku} has changed since this result was sent. It will not overwrite a newer Product Manager image.`,
    );
  }
  const previousUrl = image.publication.originalUrl ?? image.publication.previousUrl ?? null;
  const { data: restoredRows, error } = await conditionalImageUpdate(stock, destination, liveUrl, previousUrl);
  if (error) throw error;
  if (!restoredRows?.length) {
    throw imageProcessingError(
      'ipc_restore_conflict',
      `Restore stopped because Product Manager changed ${destination.label} for SKU ${destination.sku}. Refresh and review the current image.`,
    );
  }

  await logProductLoaderAudit(stock, {
    sku: destination.sku,
    action: 'update',
    source: 'image_processing_centre',
    publishMode: 'restore_original',
    imageSlot: destination.slot,
    imageSource: image.source.type,
    oldValues: { [destination.field]: liveUrl },
    newValues: { outcome: 'restored_original', [destination.field]: previousUrl, jobId: job.id },
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
