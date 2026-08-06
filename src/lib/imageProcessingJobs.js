import { readApiJson } from './apiError.js';

const JOBS_ENDPOINT = '/api/image-processing-jobs';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function normalizeImageProcessingJob(job = {}) {
  const input = job.input || job.source_image || {};
  const output = job.output || job.processed_image || {};
  const quality = job.quality || job.quality_report || {};
  return {
    ...job,
    id: String(job.id || job.job_id || ''),
    filename: job.filename || input.filename || input.name || 'Untitled image',
    sku: job.sku || job.product_code || input.sku || '',
    source: job.source || input.source || 'upload',
    sourcePath: job.source_path || input.path || '',
    beforeUrl: job.before_url || job.original_url || input.url || input.preview_url || '',
    afterUrl: job.after_url || job.processed_url || output.url || output.preview_url || '',
    status: String(job.status || 'queued').toLowerCase(),
    qualityFlags: asArray(job.quality_flags || quality.flags),
    qualityScore: job.quality_score ?? quality.score ?? null,
    estimatedCost: Number(job.estimated_cost_zar ?? job.cost_zar ?? job.cost?.zar ?? 0) || 0,
    targetSlot: Number(job.target_slot || job.image_slot || 1) || 1,
    error: job.error || job.error_message || '',
    createdAt: job.created_at || job.createdAt || '',
  };
}

function normalizePayload(payload) {
  const jobs = Array.isArray(payload) ? payload : (payload?.jobs || payload?.items || (payload?.job ? [payload.job] : []));
  return asArray(jobs).map(normalizeImageProcessingJob).filter((job) => job.id);
}

export async function fetchImageProcessingJobs({ signal } = {}) {
  const res = await fetch(JOBS_ENDPOINT, { cache: 'no-store', signal });
  const json = await readApiJson(res, { fallback: 'Could not load the image queue' });
  return normalizePayload(json);
}

export async function createNutstoreImageJobs(items) {
  const cleanItems = asArray(items)
    .filter((item) => item?.path)
    .map((item) => ({ path: item.path, filename: item.filename || item.name || item.path.split('/').pop() }));
  if (!cleanItems.length) throw new Error('Select one or more Nutstore images first');

  const created = [];
  for (let index = 0; index < cleanItems.length; index += 50) {
    const res = await fetch(JOBS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'nutstore', items: cleanItems.slice(index, index + 50) }),
    });
    const json = await readApiJson(res, { fallback: 'Could not add Nutstore images to the queue' });
    created.push(...normalizePayload(json));
  }
  return created;
}

export async function createUploadedImageJobs(files) {
  const images = asArray(files).filter((file) => file?.type?.startsWith('image/'));
  if (!images.length) throw new Error('Choose a folder containing image files');

  const batches = [];
  let current = [];
  let bytes = 0;
  for (const file of images) {
    if (current.length && (current.length >= 40 || bytes + file.size > 20 * 1024 * 1024)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(file);
    bytes += file.size;
  }
  if (current.length) batches.push(current);

  const created = [];
  for (const batch of batches) {
    const body = new FormData();
    body.set('source', 'upload');
    for (const file of batch) body.append('images', file, file.webkitRelativePath || file.name);
    const res = await fetch(JOBS_ENDPOINT, { method: 'POST', body });
    const json = await readApiJson(res, { fallback: 'Could not upload images for processing' });
    created.push(...normalizePayload(json));
  }
  return created;
}

export async function updateImageProcessingJob(id, action, details = {}) {
  if (!id) throw new Error('Image job is missing an ID');
  const res = await fetch(`${JOBS_ENDPOINT}?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...details }),
  });
  const json = await readApiJson(res, { fallback: `Could not ${action} this image` });
  return normalizeImageProcessingJob({ id, ...(json.job || json) });
}

export function summarizeImageProcessingJobs(jobs) {
  const rows = asArray(jobs);
  return {
    total: rows.length,
    processing: rows.filter((job) => ['queued', 'processing', 'retrying'].includes(job.status)).length,
    review: rows.filter((job) => ['review', 'ready', 'completed'].includes(job.status)).length,
    approved: rows.filter((job) => ['approved', 'published', 'restored'].includes(job.status)).length,
    failed: rows.filter((job) => ['failed', 'error', 'rejected'].includes(job.status)).length,
    cost: rows.reduce((sum, job) => sum + (Number(job.estimatedCost) || 0), 0),
  };
}
