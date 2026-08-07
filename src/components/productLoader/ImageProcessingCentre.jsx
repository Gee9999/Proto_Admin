import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  Check,
  CheckCircle,
  Clock3,
  FolderOpen,
  ImageOff,
  Loader2,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  createNutstoreImageJobs,
  createUploadedImageJobs,
  clearImageProcessingJob,
  executeImageProcessingJob,
  fetchImageProcessingJobs,
  summarizeImageProcessingJobs,
  updateImageProcessingJob,
} from '../../lib/imageProcessingJobs.js';

const ACTIVE_STATUSES = new Set(['queued', 'processing', 'retrying']);
const EXECUTABLE_STATUSES = new Set(['processing', 'retrying']);
const REVIEW_STATUSES = new Set(['review', 'ready', 'completed']);
const APPROVED_STATUSES = new Set(['approved']);
const ARCHIVED_STATUSES = new Set(['archived']);
const CLEARABLE_STATUSES = new Set(['review', 'ready', 'completed', 'failed', 'error', 'rejected']);
const EXECUTION_MARKER_PREFIX = 'proto:image-processing:execute:';
const EXECUTION_MARKER_TTL_MS = 10 * 60_000;
const PRODUCT_MANAGER_SLOTS = Object.freeze([
  { value: 1, label: 'Main product image', field: 'image_url_one' },
  { value: 2, label: 'Gallery image 2', field: 'image_url_two' },
  { value: 3, label: 'Gallery image 3', field: 'image_url_three' },
  { value: 4, label: 'Gallery image 4', field: 'image_url_four' },
]);

function normalizedSku(value) {
  return String(value || '').trim().toUpperCase();
}

function productManagerSlot(value) {
  return PRODUCT_MANAGER_SLOTS.find((slot) => slot.value === Number(value)) || PRODUCT_MANAGER_SLOTS[0];
}

function executionMarkerKey(id) {
  return `${EXECUTION_MARKER_PREFIX}${id}`;
}

function hasRecentExecutionMarker(id) {
  try {
    const startedAt = Number(window.localStorage.getItem(executionMarkerKey(id)) || 0);
    if (startedAt && Date.now() - startedAt < EXECUTION_MARKER_TTL_MS) return true;
    window.localStorage.removeItem(executionMarkerKey(id));
  } catch { /* polling and the backend claim still guard execution */ }
  return false;
}

function markExecutionStarted(id) {
  try { window.localStorage.setItem(executionMarkerKey(id), String(Date.now())); } catch { /* ignore */ }
}

function clearExecutionMarker(id) {
  try { window.localStorage.removeItem(executionMarkerKey(id)); } catch { /* ignore */ }
}

function statusLabel(status) {
  return ({
    queued: 'Queued', processing: 'Processing', retrying: 'Retrying', review: 'Review',
    ready: 'Ready to review', completed: 'Ready to review', approved: 'Approved',
    rejected: 'Rejected', failed: 'Failed', error: 'Failed', archived: 'In Image Archive', published: 'Applied to Product Manager', restored: 'Original restored',
  })[status] || status;
}

function qualityFlagLabel(flag) {
  const key = typeof flag === 'string' ? flag : (flag?.code || flag?.label || 'quality_warning');
  return String(key).replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function PreviewPane({ label, url, emptyText, websiteReady = false }) {
  return (
    <figure className="ipc-preview-pane">
      <figcaption>{label}</figcaption>
      <div className={`ipc-preview-image${websiteReady ? ' ipc-preview-image--white' : ''}`}>
        {url ? <img src={url} alt={`${label} product`} /> : <span><ImageOff size={22} />{emptyText}</span>}
      </div>
    </figure>
  );
}

export default function ImageProcessingCentre({
  nutstoreSelection = [],
  uploadSelection = [],
  onNutstoreSelectionConsumed,
  onUploadSelectionConsumed,
  onShowToast,
}) {
  const folderRef = useRef(null);
  const fileRef = useRef(null);
  const processInFlightRef = useRef('');
  const executionInFlightRef = useRef(new Set());
  const queueMutationVersionRef = useRef(0);
  const queueLoadSequenceRef = useRef(0);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [workerUnavailable, setWorkerUnavailable] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [selectedJobId, setSelectedJobId] = useState('');
  const [slots, setSlots] = useState({});
  const [destination, setDestination] = useState({ status: 'idle', product: null, error: '' });
  const [destinationLookupAttempt, setDestinationLookupAttempt] = useState(0);
  const [destinationSearch, setDestinationSearch] = useState('');
  const [destinationCandidate, setDestinationCandidate] = useState({ status: 'idle', product: null, matchedBy: '', error: '' });
  const [queueView, setQueueView] = useState('queue');
  const [applyConfirmation, setApplyConfirmation] = useState(null);
  const [revisionAdjustments, setRevisionAdjustments] = useState({});

  const summary = useMemo(() => summarizeImageProcessingJobs(jobs), [jobs]);
  const selectedJob = jobs.find((job) => job.id === selectedJobId) || jobs[0] || null;
  const hasActiveJobs = jobs.some((job) => ACTIVE_STATUSES.has(job.status));
  const archivedJobs = jobs.filter((job) => ['archived', 'published', 'restored'].includes(job.status));
  const queuedJobs = jobs.filter((job) => !['archived', 'published', 'restored'].includes(job.status));
  const visibleJobs = queueView === 'archive' ? archivedJobs : queuedJobs;
  const selectedSlot = productManagerSlot(slots[selectedJob?.id] || selectedJob?.destination?.slot || selectedJob?.targetSlot);
  const destinationProduct = destination.status === 'found' ? destination.product : null;
  const currentDestinationImage = destinationProduct?.[selectedSlot.field] || '';

  useEffect(() => {
    const sku = normalizedSku(selectedJob?.destination?.sku || selectedJob?.sku);
    const shouldResolve = sku && ['approved', 'archived', 'published'].includes(selectedJob?.status);
    if (!shouldResolve) {
      setDestination({ status: 'idle', product: null, error: '' });
      return undefined;
    }

    const controller = new AbortController();
    setDestination({ status: 'loading', product: null, error: '' });
    fetch(`/api/product-loader-lookup?code=${encodeURIComponent(sku)}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Could not check Product Manager');
        const product = payload.websiteRow || null;
        if (!product || normalizedSku(product.sku) !== sku) {
          setDestination({
            status: 'missing',
            product: null,
            error: `No exact Product Manager product matches SKU ${sku}.`,
          });
          return;
        }
        setDestination({ status: 'found', product, error: '' });
      })
      .catch((lookupError) => {
        if (lookupError?.name === 'AbortError') return;
        setDestination({ status: 'error', product: null, error: lookupError.message || 'Could not check Product Manager' });
      });
    return () => controller.abort();
  }, [destinationLookupAttempt, selectedJob?.destination?.sku, selectedJob?.sku, selectedJob?.status]);

  useEffect(() => {
    setDestinationSearch('');
    setDestinationCandidate({ status: 'idle', product: null, matchedBy: '', error: '' });
  }, [selectedJob?.id]);

  const mergeJobs = useCallback((incoming) => {
    setJobs((current) => {
      const byId = new Map(current.map((job) => [job.id, job]));
      for (const job of incoming) byId.set(job.id, { ...byId.get(job.id), ...job });
      return [...byId.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    });
  }, []);

  const markQueueMutation = useCallback(() => {
    queueMutationVersionRef.current += 1;
  }, []);

  const loadJobs = useCallback(async ({ quiet = false } = {}) => {
    const loadSequence = ++queueLoadSequenceRef.current;
    const mutationVersion = queueMutationVersionRef.current;
    if (!quiet) setLoading(true);
    try {
      const rows = await fetchImageProcessingJobs();
      if (
        loadSequence !== queueLoadSequenceRef.current
        || mutationVersion !== queueMutationVersionRef.current
      ) return;
      setJobs(rows);
      setWorkerUnavailable(false);
      setError('');
    } catch (err) {
      if (
        loadSequence !== queueLoadSequenceRef.current
        || mutationVersion !== queueMutationVersionRef.current
      ) return;
      setWorkerUnavailable(true);
      setError(err.message || 'The image worker is unavailable');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => { void loadJobs(); }, [loadJobs]);

  useEffect(() => {
    if (!hasActiveJobs) return undefined;
    let stopped = false;
    let timer;
    const poll = async () => {
      await loadJobs({ quiet: true });
      if (!stopped) timer = window.setTimeout(poll, 5000);
    };
    timer = window.setTimeout(poll, 3000);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [hasActiveJobs, loadJobs]);

  useEffect(() => {
    for (const job of jobs) {
      if (!ACTIVE_STATUSES.has(job.status)) clearExecutionMarker(job.id);
    }
  }, [jobs]);

  useEffect(() => {
    if (!selectedJobId && jobs[0]?.id) setSelectedJobId(jobs[0].id);
  }, [jobs, selectedJobId]);

  const queueNutstore = async () => {
    if (!nutstoreSelection.length) return;
    markQueueMutation();
    setBusy('nutstore');
    setError('');
    try {
      const created = await createNutstoreImageJobs(nutstoreSelection);
      markQueueMutation();
      mergeJobs(created);
      setWorkerUnavailable(false);
      onNutstoreSelectionConsumed?.();
      onShowToast?.(`Added ${nutstoreSelection.length} Nutstore image${nutstoreSelection.length === 1 ? '' : 's'} to processing`, 'success');
    } catch (err) {
      setWorkerUnavailable(true);
      setError(err.message || 'Could not queue the Nutstore images');
    } finally {
      setBusy('');
    }
  };

  const queueUploads = async (fileList, { consumeHandoff = false } = {}) => {
    const files = [...(fileList || [])].filter((file) => file.type.startsWith('image/'));
    if (!files.length) {
      setError('No supported image files were found in that selection.');
      return;
    }
    markQueueMutation();
    setBusy('upload');
    setError('');
    try {
      const created = await createUploadedImageJobs(files);
      markQueueMutation();
      mergeJobs(created);
      setWorkerUnavailable(false);
      if (consumeHandoff) onUploadSelectionConsumed?.();
      onShowToast?.(`Added ${files.length} image${files.length === 1 ? '' : 's'} to processing`, 'success');
    } catch (err) {
      setWorkerUnavailable(true);
      setError(err.message || 'Could not upload these images');
    } finally {
      setBusy('');
      if (folderRef.current) folderRef.current.value = '';
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const runAction = async (job, action, details = {}) => {
    markQueueMutation();
    setBusy(`${action}:${job.id}`);
    setError('');
    try {
      const updated = await updateImageProcessingJob(job.id, action, details);
      markQueueMutation();
      mergeJobs([updated]);
      setWorkerUnavailable(false);
      onShowToast?.(
        action === 'apply' ? `Applied ${job.filename} to Product Manager — ${productManagerSlot(details.imageSlot).label}` : `${statusLabel(action)}: ${job.filename}`,
        'success',
      );
      return updated;
    } catch (err) {
      setWorkerUnavailable(true);
      setError(err.message || `Could not ${action} this image`);
      return null;
    } finally {
      setBusy('');
    }
  };

  const findProductManagerDestination = async () => {
    const code = destinationSearch.trim();
    if (!code) {
      setDestinationCandidate({ status: 'error', product: null, matchedBy: '', error: 'Enter a Product Manager SKU, barcode or product name first.' });
      return;
    }
    setDestinationCandidate({ status: 'loading', product: null, matchedBy: '', error: '' });
    try {
      const response = await fetch(`/api/product-loader-lookup?code=${encodeURIComponent(code)}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not search Product Manager');
      if (!payload.websiteRow?.sku) throw new Error('No Product Manager product was found. Try its SKU or barcode.');
      setDestinationCandidate({ status: 'found', product: payload.websiteRow, matchedBy: payload.matchedBy || 'search', error: '' });
    } catch (lookupError) {
      setDestinationCandidate({ status: 'error', product: null, matchedBy: '', error: lookupError.message || 'Could not search Product Manager' });
    }
  };

  const useProductManagerDestination = async (job) => {
    const product = destinationCandidate.product;
    if (!product?.sku) return;
    const updated = await runAction(job, 'assign_destination', { destinationSku: product.sku, imageSlot: selectedSlot.value });
    if (!updated) return;
    setDestination({ status: 'found', product, error: '' });
    onShowToast?.(`Saved ${product.sku} as the proposed Product Manager destination. Nothing has been sent.`, 'success');
  };

  const requestProductManagerApply = (job) => {
    if (!job.archive?.assetId || !destinationProduct) return;
    setApplyConfirmation({ jobId: job.id, assetId: job.archive.assetId });
  };

  const confirmProductManagerApply = async (job) => {
    if (applyConfirmation?.jobId !== job.id || applyConfirmation.assetId !== job.archive?.assetId) return;
    const updated = await runAction(job, 'apply', {
      imageSlot: selectedSlot.value,
      publishToExistingSlot: Boolean(currentDestinationImage),
      confirmArchiveAssetId: job.archive.assetId,
    });
    if (updated) setApplyConfirmation(null);
  };

  const createArchiveRevision = async (job) => {
    const adjustments = revisionAdjustments[job.id] || { paddingRatio: 0.08, background: '#FFFFFF', shadow: 'none' };
    const updated = await runAction(job, 'create_revision', { adjustments });
    if (!updated) return;
    setSelectedJobId(updated.id);
    setQueueView('queue');
    onShowToast?.(`Created revision ${updated.revision?.number || 'new'} from the retained transparent master. The archive original remains unchanged.`, 'success');
  };

  const clearJob = async (job) => {
    const confirmed = window.confirm(`Clear ${job.filename} from the queue? This removes its private upload and staged processed preview. It does not change any product or Nutstore image.`);
    if (!confirmed) return;
    markQueueMutation();
    setBusy(`clear:${job.id}`);
    setError('');
    try {
      await clearImageProcessingJob(job.id);
      markQueueMutation();
      setJobs((current) => current.filter((row) => row.id !== job.id));
      setSelectedJobId('');
      clearExecutionMarker(job.id);
      setWorkerUnavailable(false);
      onShowToast?.(`Cleared ${job.filename} from the processing queue`, 'success');
    } catch (err) {
      setWorkerUnavailable(true);
      setError(err.message || 'Could not clear this image from the queue');
    } finally {
      setBusy('');
    }
  };

  useEffect(() => {
    if (busy || processInFlightRef.current) return undefined;
    const resumable = jobs.find((job) => (
      EXECUTABLE_STATUSES.has(job.status)
      && !executionInFlightRef.current.has(job.id)
      && !hasRecentExecutionMarker(job.id)
    ));
    const candidate = resumable || jobs.find((job) => job.status === 'queued');
    if (!candidate) return undefined;

    processInFlightRef.current = candidate.id;
    markQueueMutation();
    setBusy(`${candidate.status === 'queued' ? 'process' : 'execute'}:${candidate.id}`);
    setError('');
    void (async () => {
      try {
        let updated = candidate;
        if (candidate.status === 'queued') {
          updated = await updateImageProcessingJob(candidate.id, 'process');
          markQueueMutation();
          mergeJobs([updated]);
        }

        if (EXECUTABLE_STATUSES.has(updated.status)) {
          executionInFlightRef.current.add(candidate.id);
          markExecutionStarted(candidate.id);
          setBusy(`execute:${candidate.id}`);
          updated = await executeImageProcessingJob(candidate.id);
          markQueueMutation();
          mergeJobs([updated]);
        }
        setWorkerUnavailable(false);
      } catch (err) {
        const stillPolling = err.code === 'IMAGE_EXECUTION_PENDING';
        setWorkerUnavailable(!stillPolling);
        setError(err.message || `Could not process ${candidate.filename}`);
        await loadJobs({ quiet: true });
      } finally {
        executionInFlightRef.current.delete(candidate.id);
        processInFlightRef.current = '';
        setBusy('');
      }
    })();
    return undefined;
  }, [busy, jobs, loadJobs, markQueueMutation, mergeJobs]);

  const runBulkReviewAction = async (action) => {
    const candidates = jobs.filter((job) => REVIEW_STATUSES.has(job.status));
    if (!candidates.length) return;
    markQueueMutation();
    setBusy(`bulk:${action}`);
    setError('');
    try {
      const updated = [];
      for (const job of candidates) {
        if (action === 'archive') {
          throw new Error('Bulk archive is disabled. Approve each result after human review, then save the approved result to the Image Archive.');
        }
        updated.push(await updateImageProcessingJob(job.id, action));
      }
      markQueueMutation();
      mergeJobs(updated);
      setWorkerUnavailable(false);
      onShowToast?.(`${action === 'archive' ? 'Saved to the Image Archive' : 'Rejected'} ${updated.length} reviewed image${updated.length === 1 ? '' : 's'}`, 'success');
    } catch (err) {
      setError(err.message || `Could not ${action} the reviewed batch`);
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="pl-section ipc-centre" aria-labelledby="ipc-title">
      <div className="ipc-hero">
        <div>
          <span className="ipc-eyebrow"><Sparkles size={14} /> Owner workspace</span>
          <h3 id="ipc-title">Image Processing Centre</h3>
          <p>Prepare a website-ready image, complete manual human review, then save it to the controlled Image Archive. Product Manager placement is a separate, explicitly confirmed action.</p>
        </div>
        <button type="button" className="adm-btn-ghost" onClick={() => void loadJobs()} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh queue
        </button>
      </div>

      <div className="ipc-readiness-note">
        <CheckCircle size={17} />
        <div><strong>Website-ready standard</strong><span>Approved archive versions use a clean white 1600 × 1600 canvas. The original upload and transparent cleaned master are retained privately for restoration and future adjustments. Checks flag clutter, crop and centring, canvas consistency, clarity, lighting and ambiguous labels for human review.</span></div>
      </div>

      {workerUnavailable && (
        <div className="ipc-worker-warning" role="status">
          <AlertTriangle size={17} />
          <div><strong>Processing unavailable</strong><span>{error || 'The image service could not be reached. Existing Product Loader tools remain available; retry when the service is available.'}</span></div>
          <button type="button" className="adm-btn-ghost adm-btn--sm" onClick={() => void loadJobs()}>Retry</button>
        </div>
      )}
      {!workerUnavailable && error && <p className="pl-error" role="alert">{error}</p>}

      <div className="ipc-sources">
        <article className="ipc-source-card">
          <div className="ipc-source-icon"><FolderOpen size={19} /></div>
          <div><strong>Selected from Nutstore</strong><span>{nutstoreSelection.length ? `${nutstoreSelection.length} image(s) waiting to be added` : 'Select images in the Nutstore tab, then choose Improve selected.'}</span></div>
          <button type="button" className="adm-btn-red" disabled={!nutstoreSelection.length || Boolean(busy)} onClick={() => void queueNutstore()}>
            {busy === 'nutstore' ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} Add selected
          </button>
        </article>
        <article className="ipc-source-card">
          <div className="ipc-source-icon"><Upload size={19} /></div>
          <div><strong>Upload from this computer</strong><span>{uploadSelection.length ? `${uploadSelection.length} image(s) handed over from Product Loader Upload.` : 'Choose loose images or an entire supplier folder. Original filenames are preserved.'}</span></div>
          <div className="ipc-source-actions">
            {uploadSelection.length > 0 && <button type="button" className="adm-btn-red" disabled={Boolean(busy)} onClick={() => void queueUploads(uploadSelection, { consumeHandoff: true })}>{busy === 'upload' ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} Add handed-over images</button>}
            <button type="button" className="adm-btn-red" disabled={Boolean(busy)} onClick={() => folderRef.current?.click()}><FolderOpen size={14} /> Folder</button>
            <button type="button" className="adm-btn-ghost" disabled={Boolean(busy)} onClick={() => fileRef.current?.click()}>Images</button>
          </div>
          <input ref={folderRef} className="ipc-file-input" type="file" accept="image/*" multiple webkitdirectory="" onChange={(event) => void queueUploads(event.target.files)} />
          <input ref={fileRef} className="ipc-file-input" type="file" accept="image/*" multiple onChange={(event) => void queueUploads(event.target.files)} />
        </article>
      </div>

      <div className="ipc-summary" aria-label="Processing summary">
        <div><strong>{summary.total}</strong><span>Total images</span></div>
        <div><strong>{summary.processing}</strong><span>Processing</span></div>
        <div><strong>{summary.review}</strong><span>Needs review</span></div>
        <div><strong>{summary.approved}</strong><span>In archive</span></div>
        <div><strong>{summary.failed}</strong><span>Issues</span></div>
        <div className="ipc-summary-cost"><strong>R {summary.cost.toFixed(2)}</strong><span>Estimated batch cost</span></div>
      </div>

      {summary.review > 0 && (
        <div className="ipc-bulk-review" role="group" aria-label="Bulk review actions">
          <div><strong>{summary.review} processed image{summary.review === 1 ? '' : 's'} awaiting review</strong><span>Saving to the archive never changes Product Manager or the live website. Each asset can be adjusted, assigned and applied later.</span></div>
          <button type="button" className="adm-btn-red" disabled={Boolean(busy)} onClick={() => void runBulkReviewAction('archive')}><Archive size={14} /> Save all reviewed to archive</button>
          <button type="button" className="adm-btn-ghost" disabled={Boolean(busy)} onClick={() => void runBulkReviewAction('reject')}><X size={14} /> Reject all reviewed</button>
        </div>
      )}

      <div className="ipc-workspace">
        <aside className="ipc-queue" aria-label="Image asset queue and archive">
          <header><strong>Image assets</strong><span>{jobs.length}</span></header>
          <div className="ipc-queue-tabs" role="tablist" aria-label="Image asset location">
            <button type="button" role="tab" aria-selected={queueView === 'queue'} className={`ipc-queue-tab${queueView === 'queue' ? ' ipc-queue-tab--on' : ''}`} onClick={() => setQueueView('queue')}>Processing queue <span>{queuedJobs.length}</span></button>
            <button type="button" role="tab" aria-selected={queueView === 'archive'} className={`ipc-queue-tab${queueView === 'archive' ? ' ipc-queue-tab--on' : ''}`} onClick={() => setQueueView('archive')}><Archive size={12} /> Image Archive <span>{archivedJobs.length}</span></button>
          </div>
          {loading && !jobs.length ? (
            <p className="ipc-empty"><Loader2 size={16} className="spin" /> Loading queue…</p>
          ) : visibleJobs.length ? visibleJobs.map((job) => (
            <button key={job.id} type="button" className={`ipc-queue-row${selectedJob?.id === job.id ? ' ipc-queue-row--on' : ''}`} onClick={() => setSelectedJobId(job.id)}>
              <span className={`ipc-status-dot ipc-status-dot--${job.status}`} />
              <span className="ipc-queue-copy"><strong>{job.filename}</strong><small>{job.sku || (job.source === 'nutstore' ? 'Nutstore' : 'Local upload')}</small></span>
              <span className={`ipc-status ipc-status--${job.status}`}>{statusLabel(job.status)}</span>
            </button>
          )) : (
            <div className="ipc-empty">{queueView === 'archive' ? <Archive size={22} /> : <Sparkles size={22} />}<strong>{queueView === 'archive' ? 'No archived images yet' : 'No images queued'}</strong><span>{queueView === 'archive' ? 'Reviewed results saved here stay private and separate from processing assets.' : 'Add selected Nutstore images or upload a folder to begin.'}</span></div>
          )}
        </aside>

        <div className="ipc-review">
          {selectedJob ? (
            <>
              <header className="ipc-review-head">
                <div><span className={`ipc-status ipc-status--${selectedJob.status}`}>{statusLabel(selectedJob.status)}</span><h4>{selectedJob.filename}</h4><p>{selectedJob.sku ? `Product ${selectedJob.sku}` : 'Product code will be matched from the filename'} · {selectedJob.source === 'nutstore' ? 'Nutstore' : 'Local upload'}</p></div>
                <div className="ipc-cost"><span>Processing cost</span><strong>R {selectedJob.estimatedCost.toFixed(2)}</strong></div>
              </header>
              <div className="ipc-comparison">
                <PreviewPane label="Original retained" url={selectedJob.beforeUrl} emptyText="Original preview pending" />
                <PreviewPane label="Website-ready white 1600 × 1600" url={selectedJob.afterUrl} emptyText={ACTIVE_STATUSES.has(selectedJob.status) ? 'Processing…' : 'Website-ready preview unavailable'} websiteReady />
              </div>
              <div className="ipc-asset-line" aria-label="Retained image versions">
                <Archive size={15} />
                <div><strong>Archive versions are retained</strong><span>Original upload · transparent cleaned master · white-background website-ready version</span></div>
              </div>
              <div className="ipc-quality">
                <div><strong>Quality check</strong>{selectedJob.qualityScore != null && <span className="ipc-score">{Math.round(Number(selectedJob.qualityScore))}/100</span>}</div>
                {selectedJob.qualityFlags.length ? (
                  <ul>{selectedJob.qualityFlags.map((flag, index) => <li key={`${qualityFlagLabel(flag)}-${index}`}><AlertTriangle size={13} /> {qualityFlagLabel(flag)}</li>)}</ul>
                ) : <p><CheckCircle size={14} /> No quality warnings reported.</p>}
              </div>
              {selectedJob.error && <p className="ipc-job-error"><AlertTriangle size={14} /> {selectedJob.error}</p>}
              <div className="ipc-review-actions">
                {REVIEW_STATUSES.has(selectedJob.status) && <>
                  <button type="button" className="adm-btn-red" disabled={Boolean(busy)} onClick={() => void runAction(selectedJob, 'approve')}><Check size={14} /> Approve result</button>
                  <button type="button" className="adm-btn-ghost" disabled={Boolean(busy)} onClick={() => void runAction(selectedJob, 'reject')}><X size={14} /> Reject</button>
                  <button type="button" className="adm-btn-ghost" disabled={Boolean(busy)} onClick={() => void runAction(selectedJob, 'retry')}><RotateCcw size={14} /> Process again</button>
                </>}
                {['failed', 'error', 'rejected'].includes(selectedJob.status) && <button type="button" className="adm-btn-red" disabled={Boolean(busy)} onClick={() => void runAction(selectedJob, 'retry')}><RotateCcw size={14} /> Retry processing</button>}
                {CLEARABLE_STATUSES.has(selectedJob.status) && <button type="button" className="adm-btn-ghost" disabled={Boolean(busy)} onClick={() => void clearJob(selectedJob)}><Trash2 size={14} /> Clear from queue</button>}
                {ACTIVE_STATUSES.has(selectedJob.status) && <span className="ipc-wait"><Clock3 size={14} /> {selectedJob.status === 'processing' ? 'Removing the background and preparing the catalogue image…' : 'Waiting to start; this page processes queued images automatically.'}</span>}
              </div>
              {APPROVED_STATUSES.has(selectedJob.status) && (
                <div className="ipc-publish-box">
                  <div className="ipc-destination-copy">
                    <span className="ipc-destination-eyebrow"><CheckCircle size={12} /> Approved for archive</span>
                    <strong>Save the approved result before choosing any live destination</strong>
                    <span>This creates a retained white-background 1600 × 1600 archive asset. It does not change Product Manager or the website.</span>
                  </div>
                  <button type="button" className="adm-btn-red" disabled={Boolean(busy)} onClick={() => void runAction(selectedJob, 'archive')}><Archive size={14} /> Save approved result to Image Archive</button>
                </div>
              )}
              {(ARCHIVED_STATUSES.has(selectedJob.status) || selectedJob.status === 'published') && (
                <div className="ipc-publish-box">
                  <div className="ipc-destination-copy">
                    <span className="ipc-destination-eyebrow"><Archive size={12} /> Controlled Image Archive</span>
                    <strong>{selectedJob.status === 'published' ? 'Previously applied image retained in archive' : 'Saved in the Image Archive'}</strong>
                    <span>{selectedJob.status === 'published'
                      ? 'This website-ready white 1600 × 1600 version has already been applied to Product Manager. Its archive record remains available for traceability and restore.'
                      : 'This website-ready white 1600 × 1600 version is staged only. It has not changed Product Manager or the live website.'}
                    </span>
                    {destination.status === 'loading' && <span>Checking a proposed Product Manager destination…</span>}
                    {destinationProduct && (
                      <div className="ipc-destination-product">
                        <div className="ipc-destination-current-image">
                          {currentDestinationImage ? <img src={currentDestinationImage} alt={`Current ${selectedSlot.label} for ${destinationProduct.title || destinationProduct.sku}`} /> : <ImageOff size={20} />}
                        </div>
                        <div>
                          <span className="ipc-destination-confirmed"><CheckCircle size={13} /> Proposed Product Manager destination</span>
                          <strong>{destinationProduct.title || 'Untitled product'}</strong>
                          <span>SKU {destinationProduct.sku}</span>
                          <span>{selectedSlot.label} · {currentDestinationImage ? 'Current product image shown for later comparison. No replacement is being made here.' : 'This position is empty. No image is being added here.'}</span>
                        </div>
                      </div>
                    )}
                    {['missing', 'error'].includes(destination.status) && (
                      <div className="ipc-destination-blocked"><AlertTriangle size={13} /> <span>{destination.error} This archive asset stays private until you deliberately choose its proposed Product Manager product below.</span>
                        {selectedJob.status !== 'published' && <div className="ipc-destination-lookup">
                          <label>Find Product Manager product<input value={destinationSearch} onChange={(event) => setDestinationSearch(event.target.value)} placeholder="SKU, barcode or product name" /></label>
                          <button type="button" className="adm-btn-ghost adm-btn--sm" disabled={Boolean(busy) || destinationCandidate.status === 'loading'} onClick={() => void findProductManagerDestination()}>{destinationCandidate.status === 'loading' ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Find product</button>
                        </div>}
                        {destinationCandidate.status === 'error' && <span>{destinationCandidate.error}</span>}
                        {destinationCandidate.status === 'found' && <div className="ipc-destination-candidate"><strong>{destinationCandidate.product.title || 'Untitled product'}</strong><span>SKU {destinationCandidate.product.sku} · matched by {destinationCandidate.matchedBy}</span><button type="button" className="adm-btn-red adm-btn--sm" disabled={Boolean(busy)} onClick={() => void useProductManagerDestination(selectedJob)}><Check size={14} /> Stage this Product Manager destination</button></div>}
                      </div>
                    )}
                    {destination.status === 'idle' && <span>You may look up a Product Manager product now, but this remains a staged intent only.</span>}
                  </div>
                  {selectedJob.status !== 'published' && <label>Proposed image position<select value={selectedSlot.value} onChange={(event) => setSlots((current) => ({ ...current, [selectedJob.id]: Number(event.target.value) }))}>{PRODUCT_MANAGER_SLOTS.map((slot) => <option key={slot.value} value={slot.value}>{slot.label}</option>)}</select></label>}
                  {destination.status === 'error' && selectedJob.status !== 'published' && <button type="button" className="adm-btn-ghost" disabled={Boolean(busy)} onClick={() => setDestinationLookupAttempt((attempt) => attempt + 1)}><RefreshCw size={14} /> Check Product Manager again</button>}
                   {selectedJob.status === 'archived' && destinationProduct && (applyConfirmation?.jobId === selectedJob.id ? (
                    <div className="ipc-intent-note ipc-apply-confirmation" role="alertdialog" aria-label="Confirm Product Manager image replacement">
                      <AlertTriangle size={15} />
                      <div>
                        <strong>Confirm and apply to Product Manager.</strong>
                        <span>SKU {destinationProduct.sku} · {destinationProduct.title || 'Untitled product'} · {selectedSlot.label}</span>
                        <span>{currentDestinationImage ? 'The current Product Manager image will be replaced only after confirmation.' : 'This selected Product Manager position is empty; the archive asset will be added only after confirmation.'}</span>
                        <div className="ipc-comparison ipc-apply-comparison" aria-label={`Current and proposed ${selectedSlot.label} comparison`}>
                          <PreviewPane label={`Current Product Manager ${selectedSlot.label}`} url={currentDestinationImage} emptyText="This Product Manager position is empty" />
                          <PreviewPane label="Proposed archive asset" url={selectedJob.afterUrl} emptyText="Website-ready archive preview unavailable" websiteReady />
                        </div>
                      </div>
                      <button type="button" className="adm-btn-red adm-btn--sm" disabled={Boolean(busy)} onClick={() => void confirmProductManagerApply(selectedJob)}>Confirm and apply to Product Manager</button>
                      <button type="button" className="adm-btn-ghost adm-btn--sm" disabled={Boolean(busy)} onClick={() => setApplyConfirmation(null)}>Cancel</button>
                    </div>
                   ) : <div className="ipc-intent-note"><ArrowRight size={15} /><span><strong>Archive asset is ready for a deliberate live application.</strong> Compare it with the chosen Product Manager position first; this remains a separate action from processing and approval.</span><button type="button" className="adm-btn-ghost adm-btn--sm" disabled={Boolean(busy)} onClick={() => requestProductManagerApply(selectedJob)}>Apply to Product Manager</button></div>)}
                  {selectedJob.status === 'published' && <button type="button" className="adm-btn-ghost" disabled={Boolean(busy)} onClick={() => void runAction(selectedJob, 'restore')}><RotateCcw size={14} /> Restore original</button>}
                </div>
              )}
              {(ARCHIVED_STATUSES.has(selectedJob.status) || selectedJob.status === 'published' || selectedJob.status === 'restored') && (
                <div className="ipc-publish-box ipc-archive-adjustments" aria-label="Create adjusted archive revision">
                  <div className="ipc-destination-copy">
                    <span className="ipc-destination-eyebrow"><RotateCcw size={12} /> Create adjusted revision</span>
                    <strong>Adjust the archived website version without uploading again</strong>
                    <span>This makes a new review item from the retained transparent master. The current archive version stays intact and nothing is sent to Product Manager.</span>
                  </div>
                  <label>White canvas padding
                    <select value={(revisionAdjustments[selectedJob.id]?.paddingRatio ?? 0.08)} onChange={(event) => setRevisionAdjustments((current) => ({ ...current, [selectedJob.id]: { ...(current[selectedJob.id] || {}), paddingRatio: Number(event.target.value), background: '#FFFFFF' } }))} disabled={Boolean(busy)}>
                      <option value={0.04}>Tight · 4%</option><option value={0.08}>Standard · 8%</option><option value={0.12}>Relaxed · 12%</option><option value={0.16}>Wide · 16%</option>
                    </select>
                  </label>
                  <label>Background
                    <select value="#FFFFFF" disabled><option value="#FFFFFF">Pure white · #FFFFFF</option></select>
                  </label>
                  <label>Shadow
                    <select value={(revisionAdjustments[selectedJob.id]?.shadow ?? 'none')} onChange={(event) => setRevisionAdjustments((current) => ({ ...current, [selectedJob.id]: { ...(current[selectedJob.id] || {}), shadow: event.target.value, background: '#FFFFFF' } }))} disabled={Boolean(busy)}>
                      <option value="none">None</option><option value="soft">Soft natural shadow</option>
                    </select>
                  </label>
                  <button type="button" className="adm-btn-ghost" disabled={Boolean(busy)} onClick={() => void createArchiveRevision(selectedJob)}><RotateCcw size={14} /> Create new archive revision</button>
                </div>
              )}
              {selectedJob.status === 'restored' && <div className="ipc-publish-box"><div><strong>Original restored</strong><span>The processed version remains in the private archive and can be adjusted again later. No new live action is available from this workspace.</span></div></div>}
            </>
          ) : <div className="ipc-review-empty"><Sparkles size={28} /><strong>Select an image to review</strong><span>Before and after previews, quality checks and controlled publishing will appear here.</span></div>}
        </div>
      </div>
    </section>
  );
}
