import { randomUUID } from 'crypto';
import { requireOwner, verifyAdminUser } from './_admin-auth.js';
import { getStockClient } from './_stock-client.js';
import { downloadNutstoreFile, isPathInLibrary } from './_nutstore-webdav.js';
import { fixImageFromBuffer, fixImageFromUrl } from './_image-pipeline.js';
import {
  acquireImageGenLock,
  acquireTransformSemaphore,
  fetchUsdToZarRate,
  logImageGenCost,
  releaseImageGenLock,
  releaseTransformSemaphore,
  resolveImageGenCost,
} from './_image-gen-cost.js';
import { assertImageGenBudgetAllowsSpend } from './_image-gen-budget.js';
import { writeRequiredProductPublishAudit } from './_product-loader-audit.js';
import {
  buildImageProcessingLiveObjectPath,
  copyImageProcessingStagedUrlToLive,
  removeImageProcessingLiveUrl,
  removeStagingObjects,
  stagingExpiresAt,
} from './_staging-storage.js';
import {
  JOB_STATUSES,
  canTransition,
  classifyImageTreatment,
  isProductionEnvironment,
  normalizeImageUrl,
  reviewChecklistComplete,
  slotField,
  treatmentPresentation,
} from '../lib/image-processing-lifecycle.mjs';

export const config = { api: { bodyParser: { sizeLimit: '15mb' } }, maxDuration: 60 };

const ACTIVE_STATUSES = [
  JOB_STATUSES.queued,
  JOB_STATUSES.processing,
  JOB_STATUSES.readyForReview,
  JOB_STATUSES.approved,
  JOB_STATUSES.applying,
  JOB_STATUSES.needsAttention,
];
const JOB_SELECT = [
  'id', 'environment', 'sku', 'target_slot', 'status', 'treatment', 'treatment_reason',
  'product_title', 'source_type', 'source_url', 'source_nutstore_path', 'source_storage_path',
  'source_content_type', 'processed_url', 'processed_storage_path', 'processed_model',
  'processed_version', 'expected_live_url', 'review_notes', 'error_message', 'queued_by',
  'approved_by', 'approved_at', 'applied_by', 'applied_at', 'applied_image_url', 'expires_at',
  'created_at', 'updated_at',
].join(', ');

export function deploymentEnvironment(env = process.env) {
  const current = String(env.VERCEL_ENV || '').trim().toLowerCase();
  if (current === 'production') return 'production';
  if (current === 'preview') return 'preview';
  return 'development';
}

function cleanSku(value) {
  return String(value || '').trim().toUpperCase();
}

function cleanSlot(value) {
  const slot = Number(value);
  if (!Number.isInteger(slot) || slot < 1 || slot > 4) throw new Error('targetSlot must be between 1 and 4');
  return slot;
}

function sourceContentType(value) {
  const type = String(value || 'image/jpeg').trim().toLowerCase();
  if (!/^image\/(?:avif|gif|jpe?g|png|webp)$/.test(type)) throw new Error('sourceContentType must be a supported image type');
  return type;
}

function sourceExtension(contentType) {
  const map = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };
  return map[contentType] || 'jpg';
}

function decodeSourceBase64(value) {
  const raw = String(value || '').trim();
  if (!raw || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) throw new Error('sourceBase64 must contain a valid image');
  const buffer = Buffer.from(raw, 'base64');
  if (!buffer.length || buffer.length > 10 * 1024 * 1024) throw new Error('Image upload must be between 1 byte and 10 MB');
  return buffer;
}

function publicUrlForPath(sb, path) {
  return sb.storage.from('product-images').getPublicUrl(path).data.publicUrl;
}

async function uploadOriginalSource(sb, { jobId, base64, contentType }) {
  const buffer = decodeSourceBase64(base64);
  const path = `staging/image-processing/${jobId}/source.${sourceExtension(contentType)}`;
  const { error } = await sb.storage.from('product-images').upload(path, buffer, {
    contentType,
    upsert: false,
  });
  if (error) throw new Error(`Could not save original for review: ${error.message}`);
  return { path, url: publicUrlForPath(sb, path) };
}

async function uploadManualCandidate(sb, { jobId, base64, contentType }) {
  const buffer = decodeSourceBase64(base64);
  const path = `staging/image-processing/${jobId}/candidate.${sourceExtension(contentType)}`;
  const { error } = await sb.storage.from('product-images').upload(path, buffer, {
    contentType,
    upsert: false,
  });
  if (error) throw new Error(`Could not save manual candidate for review: ${error.message}`);
  return { path, url: publicUrlForPath(sb, path) };
}

function originalUrlForJob(job) {
  if (job.source_url) return job.source_url;
  if (job.source_nutstore_path) return `/api/nutstore-thumbnail?path=${encodeURIComponent(job.source_nutstore_path)}`;
  return '';
}

function safeMessage(error) {
  return String(error?.message || error || 'Image processing failed').slice(0, 800);
}

function buildProcessingPrompt(job) {
  const product = job.product_title ? ` Product: ${job.product_title}.` : '';
  const common = `Create a catalogue-quality review image of this exact product.${product}
Use a pure white (#FFFFFF) background, centred composition, and even padding.
Preserve the exact shape, colours, proportions, branding, printed labels, barcodes, stickers, logos and product markings.
Do not add, remove, merge, duplicate, obscure, invent or reinterpret any product component. No text, props, watermarks or extra products.`;

  if (job.treatment === 'transparent') {
    return `${common}
This is transparent or reflective packaging: preserve clear edges, transparency, reflections and the full silhouette. Do not turn clear material opaque, remove the packaging, or make the product look empty.`;
  }
  if (job.treatment === 'fine_detail') {
    return `${common}
This is a fine-detail or bead product: preserve every tiny component, bead row, count, arrangement, card detail and printed backing. Clean only the background; do not simplify, smooth away, rearrange or replace details.`;
  }
  return `${common}
For a multi-piece product, retain every visible item in its original arrangement. This result is for manual review only.`;
}

async function operatorEmail(req) {
  const user = await verifyAdminUser(req);
  return String(user?.email || 'owner').trim().toLowerCase();
}

async function getJob(sb, id, environment) {
  const { data, error } = await sb
    .from('image_processing_review_jobs')
    .select(JOB_SELECT)
    .eq('id', String(id || '').trim())
    .eq('environment', environment)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Image-processing job not found');
  return data;
}

async function addEvent(sb, jobId, event, actor, details = {}) {
  const { error } = await sb.from('image_processing_review_job_events').insert({
    job_id: jobId,
    event,
    actor: actor || null,
    details,
  });
  if (error) throw new Error(`Could not record image-processing event: ${error.message}`);
}

function mapJob(job, events = []) {
  const treatment = treatmentPresentation(job.treatment);
  return {
    ...job,
    targetSlot: job.target_slot,
    originalUrl: originalUrlForJob(job),
    processedUrl: job.processed_url || '',
    treatmentLabel: treatment.label,
    manualOnly: treatment.manualOnly,
    treatmentReason: job.treatment_reason || '',
    error: job.error_message || '',
    history: events.map((event) => ({
      at: event.created_at,
      label: event.event.replaceAll('_', ' '),
      actor: event.actor || null,
      details: event.details || {},
    })),
  };
}

async function listJobs(sb, environment) {
  const { data: jobs, error } = await sb
    .from('image_processing_review_jobs')
    .select(JOB_SELECT)
    .eq('environment', environment)
    .order('updated_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);

  const ids = (jobs || []).map((job) => job.id);
  let events = [];
  if (ids.length) {
    const result = await sb
      .from('image_processing_review_job_events')
      .select('job_id, event, actor, details, created_at')
      .in('job_id', ids)
      .order('created_at', { ascending: true });
    if (result.error) throw new Error(result.error.message);
    events = result.data || [];
  }
  const byJob = new Map();
  for (const event of events) {
    const list = byJob.get(event.job_id) || [];
    list.push(event);
    byJob.set(event.job_id, list);
  }
  return (jobs || []).map((job) => mapJob(job, byJob.get(job.id) || []));
}

async function queueJob(sb, req, environment, actor) {
  const body = req.body || {};
  const sku = cleanSku(body.sku);
  const targetSlot = cleanSlot(body.targetSlot);
  if (!sku) throw new Error('sku is required');

  const { data: product, error: productError } = await sb
    .from('website_stock')
    .select('sku, title, category, subcategory_one, subcategory_two, image_url_one, image_url_two, image_url_three, image_url_four')
    .eq('sku', sku)
    .maybeSingle();
  if (productError) throw new Error(productError.message);
  if (!product) throw new Error('An exact existing website SKU is required before an image can enter the processing queue');

  const { data: existing, error: existingError } = await sb
    .from('image_processing_review_jobs')
    .select('id, status')
    .eq('environment', environment)
    .eq('sku', sku)
    .eq('target_slot', targetSlot)
    .in('status', ACTIVE_STATUSES)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) throw new Error(`This SKU and image slot already have an active ${existing.status.replaceAll('_', ' ')} job`);

  const nutstorePath = String(body.nutstorePath || '').trim();
  const sourceImageUrl = String(body.sourceImageUrl || '').trim();
  const base64 = String(body.sourceBase64 || '').trim();
  const contentType = sourceContentType(body.sourceContentType);
  const sourceCount = [nutstorePath, sourceImageUrl, base64].filter(Boolean).length;
  if (!sourceCount) throw new Error('Choose a Nutstore image, upload an image, or provide an image URL');
  if (sourceCount > 1) throw new Error('Choose one source image for each review job');
  if (nutstorePath && !isPathInLibrary(nutstorePath)) throw new Error('Nutstore image must be inside PTR Photos');
  if (sourceImageUrl && !/^https:\/\//i.test(sourceImageUrl)) throw new Error('sourceImageUrl must be an HTTPS URL');

  const plan = classifyImageTreatment({
    productTitle: product.title,
    category: product.category,
    subcategoryOne: product.subcategory_one,
    subcategoryTwo: product.subcategory_two,
    filename: body.filename,
  });
  const jobId = randomUUID();
  let uploadedSource = null;
  try {
    if (base64) uploadedSource = await uploadOriginalSource(sb, { jobId, base64, contentType });
    const field = slotField(targetSlot);
    const row = {
      id: jobId,
      environment,
      sku,
      target_slot: targetSlot,
      status: JOB_STATUSES.queued,
      treatment: plan.treatment,
      treatment_reason: plan.reason,
      product_title: product.title || sku,
      source_type: nutstorePath ? 'nutstore' : (base64 ? 'upload' : 'url'),
      source_url: uploadedSource?.url || sourceImageUrl || null,
      source_nutstore_path: nutstorePath || null,
      source_storage_path: uploadedSource?.path || null,
      source_content_type: contentType,
      // Preserve the raw DB value for the later conditional update. The
      // comparison helper handles legacy comma-separated image values without
      // allowing a stale approval to overwrite a newer image.
      expected_live_url: product[field] == null ? null : String(product[field]),
      queued_by: actor,
      expires_at: stagingExpiresAt(),
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await sb
      .from('image_processing_review_jobs')
      .insert(row)
      .select(JOB_SELECT)
      .single();
    if (error) throw new Error(error.code === '23505'
      ? 'This SKU and image slot already have an active image-processing job'
      : error.message);
    await addEvent(sb, data.id, 'queued', actor, {
      treatment: plan.treatment,
      reason: plan.reason,
      manualOnly: plan.manualOnly,
      targetSlot,
      sourceType: row.source_type,
    });
    return mapJob(data, []);
  } catch (error) {
    if (uploadedSource?.url) await removeStagingObjects(sb, [uploadedSource.url], { skipLiveReferenced: false });
    throw error;
  }
}

async function processJob(sb, job, actor) {
  const treatment = treatmentPresentation(job.treatment);
  if (treatment.manualOnly) {
    throw new Error(`${treatment.label} is a manual lane. Upload a manually prepared candidate for review; AI processing is deliberately disabled for this product type.`);
  }
  if (!canTransition(job.status, JOB_STATUSES.processing)) {
    throw new Error(`A ${job.status.replaceAll('_', ' ')} job cannot be processed`);
  }
  const { data: working, error: lockError } = await sb
    .from('image_processing_review_jobs')
    .update({ status: JOB_STATUSES.processing, error_message: null, updated_at: new Date().toISOString() })
    .eq('id', job.id)
    .eq('status', job.status)
    .select(JOB_SELECT)
    .maybeSingle();
  if (lockError) throw new Error(lockError.message);
  if (!working) throw new Error('This job changed while you were starting it. Refresh and try again.');
  await addEvent(sb, job.id, 'processing_started', actor, { treatment: job.treatment, targetSlot: job.target_slot });

  const startedAt = Date.now();
  let transformLocked = false;
  let imageLocked = false;
  try {
    await assertImageGenBudgetAllowsSpend(sb);
    await acquireTransformSemaphore(sb, { batchId: job.id, operator: actor, ttlSec: 120 });
    transformLocked = true;
    await acquireImageGenLock(sb, { sku: job.sku, slot: job.target_slot, batchId: job.id, operator: actor, ttlSec: 120 });
    imageLocked = true;

    const processingOptions = {
      sku: job.sku,
      targetSlot: job.target_slot,
      imageStyle: treatment.imageStyle,
      prompt: buildProcessingPrompt(job),
      staging: true,
      stagingPath: `staging/image-processing/${job.id}/processed.jpg`,
    };
    let result;
    if (job.source_nutstore_path) {
      const source = await downloadNutstoreFile(job.source_nutstore_path);
      result = await fixImageFromBuffer(
        source.buffer,
        source.contentType,
        job.source_nutstore_path.split('/').pop() || `${job.sku}.jpg`,
        processingOptions,
      );
    } else if (job.source_url) {
      result = await fixImageFromUrl(job.source_url, processingOptions);
    } else {
      throw new Error('The original source is missing. Queue the image again.');
    }

    const { costUsd, costSource } = resolveImageGenCost({
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd,
      isImageOutput: true,
    });
    const usdToZar = await fetchUsdToZarRate();
    await logImageGenCost(sb, {
      sku: job.sku,
      slot: job.target_slot,
      operation: 'image_processing_centre',
      model: result.model,
      imageStyle: processingOptions.imageStyle,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd,
      costSource,
      usdToZar,
      operator: actor,
      batchId: job.id,
      processingMs: Date.now() - startedAt,
      status: 'ok',
    });

    const { data: ready, error: readyError } = await sb
      .from('image_processing_review_jobs')
      .update({
        status: JOB_STATUSES.readyForReview,
        processed_url: result.url,
        processed_storage_path: result.storagePath || null,
        processed_model: result.model || null,
        processed_version: result.storagePath || result.url,
        error_message: null,
        expires_at: stagingExpiresAt(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)
      .eq('status', JOB_STATUSES.processing)
      .select(JOB_SELECT)
      .single();
    if (readyError) throw new Error(readyError.message);
    await addEvent(sb, job.id, 'review_ready', actor, {
      treatment: job.treatment,
      model: result.model || null,
      costUsd,
      version: result.storagePath || result.url,
    });
    return mapJob(ready, []);
  } catch (error) {
    const message = safeMessage(error);
    await sb
      .from('image_processing_review_jobs')
      .update({ status: JOB_STATUSES.needsAttention, error_message: message, updated_at: new Date().toISOString() })
      .eq('id', job.id)
      .eq('status', JOB_STATUSES.processing);
    await addEvent(sb, job.id, 'failed', actor, { message }).catch(() => {});
    throw new Error(message);
  } finally {
    if (imageLocked) await releaseImageGenLock(sb, job.sku, job.target_slot);
    if (transformLocked) await releaseTransformSemaphore(sb, job.id);
  }
}

async function uploadCandidateJob(sb, job, actor, body) {
  if (![JOB_STATUSES.queued, JOB_STATUSES.needsAttention].includes(job.status)) {
    throw new Error(`A ${job.status.replaceAll('_', ' ')} job cannot accept a replacement candidate`);
  }
  const candidateBase64 = String(body.candidateBase64 || '').trim();
  const candidateContentType = sourceContentType(body.candidateContentType);
  if (!candidateBase64) throw new Error('Choose a prepared candidate image before uploading it for review');

  let uploaded = null;
  try {
    uploaded = await uploadManualCandidate(sb, {
      jobId: job.id,
      base64: candidateBase64,
      contentType: candidateContentType,
    });
    const now = new Date().toISOString();
    const { data, error } = await sb
      .from('image_processing_review_jobs')
      .update({
        status: JOB_STATUSES.readyForReview,
        processed_url: uploaded.url,
        processed_storage_path: uploaded.path,
        processed_model: 'manual',
        processed_version: uploaded.path,
        error_message: null,
        expires_at: stagingExpiresAt(),
        updated_at: now,
      })
      .eq('id', job.id)
      .eq('status', job.status)
      .select(JOB_SELECT)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('This job changed while the candidate was uploading. Refresh and try again.');
    await addEvent(sb, job.id, 'manual_candidate_ready', actor, {
      treatment: job.treatment,
      candidatePath: uploaded.path,
    });
    return mapJob(data, []);
  } catch (error) {
    if (uploaded?.url) await removeStagingObjects(sb, [uploaded.url], { skipLiveReferenced: false });
    throw error;
  }
}

async function approveJob(sb, job, actor, body) {
  if (!canTransition(job.status, JOB_STATUSES.approved)) {
    throw new Error(`A ${job.status.replaceAll('_', ' ')} job cannot be approved`);
  }
  if (!job.processed_url) throw new Error('A visible processed image is required before approval');
  if (!reviewChecklistComplete(body.reviewChecklist)) {
    throw new Error('Confirm that the product is correct, labels are preserved, and the background is clean before approval');
  }
  if (!String(job.processed_storage_path || '').startsWith('staging/image-processing/')) {
    throw new Error('The review candidate is not a protected Image Processing Centre staging file. Upload or process a new candidate.');
  }
  const notes = String(body.reviewNotes || '').trim().slice(0, 2000);
  const approvedAt = new Date().toISOString();
  await writeRequiredProductPublishAudit(sb, {
    sku: job.sku,
    source: 'image_processing_centre',
    publishMode: 'ipc_approved',
    imageSlot: job.target_slot,
    imageSource: job.source_type,
    oldValues: { expectedLiveUrl: job.expected_live_url || null },
    newValues: {
      workflow: 'image_processing_centre',
      jobId: job.id,
      state: 'approved',
      treatment: job.treatment,
      candidateUrl: job.processed_url,
      candidatePath: job.processed_storage_path,
      expectedLiveUrl: job.expected_live_url || null,
      checklist: body.reviewChecklist,
      notes: notes || null,
    },
    publishedBy: actor,
  });
  const { data, error } = await sb
    .from('image_processing_review_jobs')
    .update({
      status: JOB_STATUSES.approved,
      review_notes: notes || null,
      approved_by: actor,
      approved_at: approvedAt,
      updated_at: approvedAt,
    })
    .eq('id', job.id)
    .eq('status', JOB_STATUSES.readyForReview)
    .eq('processed_url', job.processed_url)
    .select(JOB_SELECT)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('This job changed while you were approving it. Refresh and review again.');
  await addEvent(sb, job.id, 'review_approved', actor, { checklist: body.reviewChecklist, notes: notes || null })
    .catch((eventError) => console.error('image-processing review event:', eventError.message));
  return mapJob(data, []);
}

async function applyJob(sb, job, actor, body, environment) {
  if (!isProductionEnvironment(environment)) {
    throw new Error('Applying an image to the live catalogue is disabled outside production');
  }
  if (!canTransition(job.status, JOB_STATUSES.applying)) {
    throw new Error(`A ${job.status.replaceAll('_', ' ')} job cannot be applied to the live catalogue`);
  }
  if (cleanSku(body.confirmSku) !== job.sku) throw new Error(`Type ${job.sku} exactly to apply this approved image`);
  if (!job.processed_url) throw new Error('The approved image is missing');
  if (!String(job.processed_storage_path || '').startsWith('staging/image-processing/')) {
    throw new Error('The approved staging image is no longer a protected Image Processing Centre candidate. Review a new candidate.');
  }

  const applyingAt = new Date().toISOString();
  const { data: applying, error: claimError } = await sb
    .from('image_processing_review_jobs')
    .update({
      status: JOB_STATUSES.applying,
      error_message: null,
      updated_at: applyingAt,
    })
    .eq('id', job.id)
    .eq('status', JOB_STATUSES.approved)
    .select(JOB_SELECT)
    .maybeSingle();
  if (claimError) throw new Error(claimError.message);
  if (!applying) throw new Error('This approved job is already being applied or has changed. Refresh before trying again.');

  const field = slotField(job.target_slot);
  let copied = null;
  let liveUpdated = false;
  try {
    const { data: live, error: liveError } = await sb
      .from('website_stock')
      .select(`sku, ${field}`)
      .eq('sku', job.sku)
      .maybeSingle();
    if (liveError) throw new Error(liveError.message);
    if (!live) throw new Error('The live product no longer exists');
    const currentValue = live[field] == null ? null : String(live[field]);
    if (normalizeImageUrl(currentValue) !== normalizeImageUrl(job.expected_live_url)) {
      throw new Error('The live image changed after this review. Queue and review the latest version before applying anything.');
    }

    const attemptId = `${job.id}-${Date.now()}`;
    const plannedLivePath = buildImageProcessingLiveObjectPath(job.sku, job.target_slot, attemptId);
    await writeRequiredProductPublishAudit(sb, {
      sku: job.sku,
      source: 'image_processing_centre',
      publishMode: 'ipc_apply_authorized',
      imageSlot: job.target_slot,
      imageSource: job.source_type,
      oldValues: { [field]: currentValue },
      newValues: {
        workflow: 'image_processing_centre',
        jobId: job.id,
        state: 'apply_authorized',
        treatment: job.treatment,
        expectedLiveUrl: job.expected_live_url || null,
        candidateUrl: job.processed_url,
        candidatePath: job.processed_storage_path,
        plannedLivePath,
        targetField: field,
        attemptId,
      },
      publishedBy: actor,
    });
    await addEvent(sb, job.id, 'apply_started', actor, {
      expectedLiveUrl: job.expected_live_url || null,
      targetSlot: job.target_slot,
      plannedLivePath,
      attemptId,
    });

    // Copy rather than move: a stale conditional write cannot replace the
    // prior SKU/slot object, and the reviewed staging candidate remains
    // recoverable until the job expires or is discarded.
    copied = await copyImageProcessingStagedUrlToLive(
      sb,
      job.processed_url,
      job.sku,
      job.target_slot,
      attemptId,
    );

    let update = sb
      .from('website_stock')
      .update({ [field]: copied.url, updated_at: new Date().toISOString() })
      .eq('sku', job.sku);
    update = currentValue === null ? update.is(field, null) : update.eq(field, currentValue);
    const { data: updated, error: updateError } = await update
      .select(`sku, ${field}`)
      .maybeSingle();
    if (updateError) throw new Error(updateError.message);
    if (!updated) throw new Error('The live image changed while this approval was being applied. Nothing was overwritten.');
    if (normalizeImageUrl(updated[field]) !== normalizeImageUrl(copied.url)) {
      throw new Error('The live image did not persist. Check the product before retrying.');
    }
    liveUpdated = true;

    const appliedAt = new Date().toISOString();
    const { data: applied, error: appliedError } = await sb
      .from('image_processing_review_jobs')
      .update({
        status: JOB_STATUSES.applied,
        applied_by: actor,
        applied_at: appliedAt,
        applied_image_url: copied.url,
        updated_at: appliedAt,
      })
      .eq('id', job.id)
      .eq('status', JOB_STATUSES.applying)
      .select(JOB_SELECT)
      .maybeSingle();
    if (appliedError) throw new Error(appliedError.message);
    if (!applied) throw new Error('The product image was updated, but the review job could not be finalized. Refresh and reconcile before another action.');
    await addEvent(sb, job.id, 'applied', actor, { targetSlot: job.target_slot, liveUrl: copied.url })
      .catch((eventError) => console.error('image-processing applied event:', eventError.message));
    return mapJob(applied, []);
  } catch (error) {
    if (copied?.url && !liveUpdated) {
      await removeImageProcessingLiveUrl(sb, copied.url);
    }
    if (!liveUpdated) {
      const message = safeMessage(error);
      await sb
        .from('image_processing_review_jobs')
        .update({ status: JOB_STATUSES.needsAttention, error_message: message, updated_at: new Date().toISOString() })
        .eq('id', job.id)
        .eq('status', JOB_STATUSES.applying);
      await addEvent(sb, job.id, 'failed', actor, { message, phase: 'apply' }).catch(() => {});
    } else {
      // The conditional website_stock write already succeeded. Never roll it
      // back blindly; recover the job state so the UI/audit can be reconciled
      // without inviting a second apply attempt.
      const { error: recoveryError } = await sb
        .from('image_processing_review_jobs')
        .update({
          status: JOB_STATUSES.applied,
          applied_by: actor,
          applied_at: new Date().toISOString(),
          applied_image_url: copied?.url || null,
          error_message: `Finalization recovered after: ${safeMessage(error)}`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)
        .eq('status', JOB_STATUSES.applying);
      if (recoveryError) console.error('image-processing apply recovery:', recoveryError.message);
    }
    throw error;
  }
}

async function discardJob(sb, job, actor) {
  if ([JOB_STATUSES.processing, JOB_STATUSES.applied, JOB_STATUSES.expired].includes(job.status)) {
    throw new Error(`A ${job.status.replaceAll('_', ' ')} job cannot be discarded`);
  }
  await removeStagingObjects(sb, [job.source_url, job.processed_url], { skipLiveReferenced: true });
  const { data, error } = await sb
    .from('image_processing_review_jobs')
    .update({ status: JOB_STATUSES.discarded, updated_at: new Date().toISOString() })
    .eq('id', job.id)
    .in('status', [JOB_STATUSES.queued, JOB_STATUSES.needsAttention, JOB_STATUSES.readyForReview, JOB_STATUSES.approved])
    .select(JOB_SELECT)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('This job changed while you were discarding it. Refresh and try again.');
  await addEvent(sb, job.id, 'discarded', actor, {});
  return mapJob(data, []);
}

async function health(sb, environment) {
  const { data, error } = await sb.storage.listBuckets();
  const storageReady = !error && (data || []).some((bucket) => bucket.id === 'product-images');
  return {
    environment,
    processorConfigured: Boolean(process.env.OPENROUTER_API_KEY),
    stockStorageConfigured: Boolean(
      process.env.STOCK_SUPABASE_POOLER_URL
      || process.env.STOCK_SUPABASE_URL
      || process.env.VITE_STOCK_SUPABASE_URL,
    ),
    storageReady,
    storageError: error?.message || null,
    manualApprovalRequired: true,
  };
}

export default async function handler(req, res) {
  if (!(await requireOwner(req, res))) return;
  res.setHeader('Cache-Control', 'no-store');
  const environment = deploymentEnvironment();
  const sb = getStockClient();

  try {
    const action = String(req.method === 'GET' ? req.query?.action || 'list' : req.body?.action || '').trim();
    if (req.method === 'GET' && action === 'health') return res.status(200).json(await health(sb, environment));
    if (req.method === 'GET' && action === 'list') return res.status(200).json({ jobs: await listJobs(sb, environment) });
    if (req.method !== 'POST') return res.status(405).end();

    const actor = await operatorEmail(req);
    if (action === 'queue') return res.status(200).json({ job: await queueJob(sb, req, environment, actor) });

    const job = await getJob(sb, req.body?.jobId, environment);
    if (action === 'process') return res.status(200).json({ job: await processJob(sb, job, actor) });
    if (action === 'upload_candidate') return res.status(200).json({ job: await uploadCandidateJob(sb, job, actor, req.body || {}) });
    if (action === 'approve') return res.status(200).json({ job: await approveJob(sb, job, actor, req.body || {}) });
    if (action === 'apply') return res.status(200).json({ job: await applyJob(sb, job, actor, req.body || {}, environment) });
    if (action === 'discard') return res.status(200).json({ job: await discardJob(sb, job, actor) });
    return res.status(400).json({ error: 'Unknown image-processing action' });
  } catch (error) {
    const message = safeMessage(error);
    const status = /not found/i.test(message) ? 404
      : /cannot|must|required|exact|changed|already|missing|disabled|not available/i.test(message) ? 409
        : /budget/i.test(message) ? 402
          : 400;
    return res.status(status).json({ error: message });
  }
}
