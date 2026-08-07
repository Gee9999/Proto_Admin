import { readApiJson } from './apiError.js';

const JOBS_ENDPOINT = '/api/image-processing-jobs';
const REQUEST_TIMEOUT_MS = 15_000;
const EXECUTION_TIMEOUT_MS = 4 * 60_000;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

async function requestImageJobs(url, options = {}) {
  const { timeoutMs = REQUEST_TIMEOUT_MS, ...fetchOptions } = options;
  const controller = new AbortController();
  const externalSignal = fetchOptions.signal;
  const abortFromCaller = () => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener?.('abort', abortFromCaller, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('timeout'));
  }, timeoutMs);
  try {
    return await fetch(url, { ...fetchOptions, signal: controller.signal });
  } catch (error) {
    if (timedOut && timeoutMs === EXECUTION_TIMEOUT_MS) {
      const pendingError = new Error('Image processing is taking longer than expected. The queue will keep checking for the result.');
      pendingError.code = 'IMAGE_EXECUTION_PENDING';
      throw pendingError;
    }
    if (controller.signal.aborted) throw new Error('The image queue did not respond. Please retry.');
    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener?.('abort', abortFromCaller);
  }
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
    targetSlot: Number(job.destination?.slot || job.target_slot || job.image_slot || 1) || 1,
    destination: job.destination || null,
    error: job.error || job.error_message || '',
    createdAt: job.created_at || job.createdAt || '',
  };
}

function normalizePayload(payload) {
  const jobs = Array.isArray(payload) ? payload : (payload?.jobs || payload?.items || (payload?.job ? [payload.job] : []));
  return asArray(jobs).map(normalizeImageProcessingJob).filter((job) => job.id);
}

export async function fetchImageProcessingJobs({ signal } = {}) {
  const res = await requestImageJobs(JOBS_ENDPOINT, { cache: 'no-store', signal });
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
    const res = await requestImageJobs(JOBS_ENDPOINT, {
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
    // Send uploads as JSON rather than multipart. The API accepts both, but
    // JSON avoids multipart parsing differences between local Vite and Vercel
    // functions that previously let a selected image reach the request without
    // creating a queue item.
    const items = await Promise.all(batch.map(async (file) => ({
      filename: file.webkitRelativePath || file.name,
      contentType: file.type || 'image/jpeg',
      base64: await fileToBase64(file),
    })));
    const res = await requestImageJobs(JOBS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'upload', items }),
    });
    const json = await readApiJson(res, { fallback: 'Could not upload images for processing' });
    created.push(...normalizePayload(json));
  }
  return created;
}

async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let start = 0; start < bytes.length; start += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(start, start + chunkSize));
  }
  return btoa(binary);
}

export async function updateImageProcessingJob(id, action, details = {}, { signal } = {}) {
  if (!id) throw new Error('Image job is missing an ID');
  const isExecution = action === 'execute';
  const res = await requestImageJobs(`${JOBS_ENDPOINT}?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(isExecution ? { 'Idempotency-Key': `image-execute:${id}` } : {}),
    },
    body: JSON.stringify({ action, ...details }),
    signal,
    timeoutMs: isExecution ? EXECUTION_TIMEOUT_MS : REQUEST_TIMEOUT_MS,
  });
  const json = await readApiJson(res, { fallback: `Could not ${action} this image` });
  return normalizeImageProcessingJob({ id, ...(isExecution ? { status: 'processing' } : {}), ...(json.job || json) });
}

export async function executeImageProcessingJob(id, { signal } = {}) {
  return updateImageProcessingJob(id, 'execute', {}, { signal });
}

export async function clearImageProcessingJob(id) {
  if (!id) throw new Error('Image job is missing an ID');
  const res = await requestImageJobs(`${JOBS_ENDPOINT}?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'clear' }),
  });
  const json = await readApiJson(res, { fallback: 'Could not clear this image from the queue' });
  return String(json.removed || id);
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
