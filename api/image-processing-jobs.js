import { hasAdminKey, requireOwner, verifyAdminUser } from './_admin-auth.js';
import {
  createPrivateSourceUrl,
  readImageJob,
  readImageJobIndex,
} from './_image-processing-store.js';
import {
  ingestLocalSource,
  ingestStagedSource,
  estimatedImageCostUsd,
  advanceQueuedImageProcessing,
  markImageApproved,
  persistJob,
  publishApprovedImage,
  rejectImage,
  restorePublishedOriginal,
} from './_image-processing-service.js';
import { parseImageProcessingRequest } from './_image-processing-request.js';
import { parseLoaderFilename } from './_product-loader-filename.js';
import { parseNutstoreFilename } from './_nutstore-filename.js';
import {
  IMAGE_JOB_LIMITS,
  jobFingerprint,
  normalizeCreateImage,
  stableJobId,
} from '../lib/image-processing-centre.mjs';

export const config = { api: { bodyParser: false } };

async function requestActor(req) {
  if (hasAdminKey(req)) return 'server-admin';
  const user = await verifyAdminUser(req);
  return String(user?.email || 'owner').toLowerCase();
}

function splitPublicId(value) {
  const raw = String(value || '').trim();
  const marker = raw.indexOf('~');
  return marker > 0
    ? { jobId: raw.slice(0, marker), imageId: raw.slice(marker + 1) }
    : { jobId: raw, imageId: '' };
}

function publicImageJob(job, image) {
  const warnings = [...new Set([
    ...(image.warnings || []),
    ...(image.quality?.grade === 'needs_attention' ? ['quality_needs_attention'] : []),
  ])];
  return {
    id: `${job.id}~${image.id}`,
    manifestId: job.id,
    imageId: image.id,
    filename: image.source?.filename,
    sku: image.sku,
    source: image.source?.type === 'local_upload' ? 'upload' : image.source?.type,
    source_path: image.source?.type === 'nutstore' ? image.source.ref : '',
    status: image.status,
    after_url: image.publishedUrl || image.reviewUrl || '',
    processed_url: image.reviewUrl || '',
    quality_score: image.quality?.score ?? null,
    quality_flags: warnings,
    cost_usd: Number(image.cost?.usd) || 0,
    cost_zar: Number(image.cost?.zar) || 0,
    estimated_cost_zar: Number(image.cost?.zar) || Number(((Number(image.estimatedCostUsd) || 0) * 18).toFixed(2)),
    target_slot: image.slot,
    restored_url: image.restoredUrl || '',
    error: image.error || '',
    created_at: image.createdAt || job.createdAt,
    updated_at: job.updatedAt,
  };
}

async function publicJobItemsWithSource(job, images = job?.images || []) {
  return Promise.all(images.map(async (image) => {
    const row = publicImageJob(job, image);
    if (!image.source?.privatePath) return row;
    try {
      row.before_url = await createPrivateSourceUrl(image.source.privatePath, 600);
      row.original_url = row.before_url;
    } catch { /* preview remains unavailable until the next refresh */ }
    return row;
  }));
}

function adaptIncomingItem(item, batchSource) {
  if (item?.source?.type || item?.sourceType) return item;
  const source = String(batchSource || '').toLowerCase();
  const filename = String(item?.filename || item?.name || item?.path || '').replace(/\\/g, '/');
  const basename = filename.split('/').pop() || filename;
  if (source === 'nutstore') {
    const parsed = parseNutstoreFilename(basename);
    return {
      ...item,
      sku: item.sku || item.code || parsed.code,
      slot: item.slot || parsed.imageSlot,
      source: { type: 'nutstore', path: item.path, filename: basename, contentType: item.contentType || 'image/jpeg' },
    };
  }
  if (source === 'upload' || source === 'local_upload') {
    const parsed = parseLoaderFilename(basename);
    return {
      ...item,
      sku: item.sku || item.code || parsed.code,
      slot: item.slot || parsed.imageSlot,
      source: {
        type: 'local_upload',
        filename,
        contentType: item.contentType,
        base64: item.base64,
      },
    };
  }
  return item;
}

async function createJob(req, res, actor) {
  const items = req.body?.items;
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'items[] is required' });
  if (items.length > IMAGE_JOB_LIMITS.maxImages) {
    return res.status(400).json({ error: `A job may contain at most ${IMAGE_JOB_LIMITS.maxImages} images` });
  }

  const normalized = items.map((item) => normalizeCreateImage(adaptIncomingItem(item, req.body?.source)));
  const invalid = normalized
    .map((result, index) => ({ index, errors: result.errors }))
    .filter((result) => result.errors.length);
  if (invalid.length) return res.status(400).json({ error: 'One or more images are invalid', invalid });

  const uploadBytes = normalized.reduce((sum, result) => sum + result.uploadBytes, 0);
  if (uploadBytes > IMAGE_JOB_LIMITS.maxUploadBytesPerJob) {
    return res.status(413).json({ error: 'Combined local uploads exceed 24 MB' });
  }

  const images = normalized.map((result) => result.image);
  const targetKeys = images.map((image) => `${image.targetTable}:${image.sku}:${image.slot}`);
  if (new Set(targetKeys).size !== targetKeys.length) {
    return res.status(409).json({ error: 'A job cannot contain the same product image slot more than once' });
  }

  const fingerprint = jobFingerprint(images);
  const idempotencyKey = String(
    req.headers['idempotency-key'] || req.body?.idempotencyKey || fingerprint,
  ).trim().slice(0, 200);
  const id = stableJobId(idempotencyKey, fingerprint);
  const existing = await readImageJob(id);
  if (existing) return res.status(200).json({ ok: true, idempotent: true, jobs: await publicJobItemsWithSource(existing) });

  const estimatedCostUsd = 0;
  const maxCostUsd = 0;

  const createdAt = new Date().toISOString();
  const prepared = [];
  for (let index = 0; index < images.length; index += 1) {
    let image = { ...images[index], status: 'queued', createdAt, error: null };
    if (image.source.type === 'local_upload') {
      image = await ingestLocalSource(id, image, normalized[index].base64);
    } else if (image.source.type === 'staged_url') {
      image = await ingestStagedSource(id, image);
    }
    image.estimatedCostUsd = estimatedImageCostUsd(image);
    prepared.push(image);
  }

  const sourceTypes = new Set(prepared.map((image) => image.source.type));
  const job = await persistJob({
    id,
    version: 0,
    status: 'queued',
    sourceFlow: sourceTypes.size === 1 ? [...sourceTypes][0] : 'mixed',
    createdAt,
    createdBy: actor,
    idempotencyKeyHash: id.slice(4),
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(4)),
    maxCostUsd,
    images: prepared,
  });
  return res.status(201).json({ ok: true, idempotent: false, jobs: await publicJobItemsWithSource(job) });
}

async function reviewAction(req, res, actor, action) {
  const publicId = splitPublicId(req.query?.id || req.body?.id);
  const imageId = String(req.body?.imageId || publicId.imageId).trim();
  const job = await readImageJob(publicId.jobId);
  if (!job) return res.status(404).json({ error: 'Image processing job not found' });
  const index = job.images.findIndex((image) => image.id === imageId);
  if (index < 0) return res.status(404).json({ error: 'Image processing item not found' });

  try {
    if (action === 'approve') {
      job.images[index] = markImageApproved(job.images[index], { actor });
    } else if (action === 'publish') {
      job.images[index] = await publishApprovedImage(job, job.images[index], {
        actor,
        slot: req.body?.imageSlot || job.images[index].slot,
        allowOverwrite: req.body?.publishToExistingSlot === true,
      });
    } else if (action === 'reject') {
      job.images[index] = await rejectImage(job.images[index], { actor, reason: req.body?.reason });
    } else if (action === 'restore') {
      job.images[index] = await restorePublishedOriginal(job, job.images[index], { actor });
    } else if (action === 'retry') {
      if (!['failed', 'rejected', 'review'].includes(job.images[index].status)) {
        return res.status(409).json({ error: 'Only failed, rejected, or review images can be reprocessed' });
      }
      job.images[index] = {
        ...job.images[index],
        status: 'queued',
        reviewUrl: null,
        outputStoragePath: null,
        quality: null,
        error: null,
        processing: null,
      };
    }
    const saved = await persistJob(job);
    return res.status(200).json({ ok: true, job: publicImageJob(saved, saved.images[index]) });
  } catch (error) {
    const status = error.code === 'image_exists' ? 409 : 400;
    return res.status(status).json({ error: error.message || `${action} failed` });
  }
}

export default async function handler(req, res) {
  if (!(await requireOwner(req, res))) return;
  res.setHeader('Cache-Control', 'no-store');
  const actor = await requestActor(req);

  try {
    if (req.method === 'GET') {
      const publicId = splitPublicId(req.query?.id);
      if (publicId.jobId) {
        const job = await readImageJob(publicId.jobId);
        if (!job) return res.status(404).json({ error: 'Image processing job not found' });
        const images = publicId.imageId
          ? job.images.filter((image) => image.id === publicId.imageId)
          : job.images;
        return res.status(200).json({ jobs: await publicJobItemsWithSource(job, images) });
      }
      await advanceQueuedImageProcessing({ limit: 1, actor }).catch((error) => {
        console.warn('image-processing-jobs:auto-advance', error?.message || error);
      });
      const rows = await readImageJobIndex();
      const manifests = await Promise.all(rows.slice(0, 100).map((row) => readImageJob(row.id)));
      const jobRows = await Promise.all(manifests.filter(Boolean).map((job) => publicJobItemsWithSource(job)));
      return res.status(200).json({ jobs: jobRows.flat() });
    }
    if (!['POST', 'PATCH'].includes(req.method)) return res.status(405).end();

    req.body = await parseImageProcessingRequest(req);

    const action = String(req.body?.action || 'create').trim().toLowerCase();
    if (action === 'create') return await createJob(req, res, actor);
    if (['approve', 'publish', 'reject', 'retry', 'restore'].includes(action)) return await reviewAction(req, res, actor, action);
    return res.status(400).json({ error: 'Unsupported image processing action' });
  } catch (error) {
    console.error('image-processing-jobs:', error?.message || error);
    return res.status(500).json({ error: error?.message || 'Image processing request failed' });
  }
}
