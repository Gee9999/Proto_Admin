import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle,
  Clock3,
  FolderOpen,
  ImageOff,
  Loader2,
  RefreshCw,
  RotateCcw,
  Send,
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
const CLEARABLE_STATUSES = new Set(['review', 'ready', 'completed', 'failed', 'error', 'rejected']);
const EXECUTION_MARKER_PREFIX = 'proto:image-processing:execute:';
const EXECUTION_MARKER_TTL_MS = 10 * 60_000;

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
    rejected: 'Rejected', failed: 'Failed', error: 'Failed', published: 'Published', restored: 'Original restored',
  })[status] || status;
}

function qualityFlagLabel(flag) {
  const key = typeof flag === 'string' ? flag : (flag?.code || flag?.label || 'quality_warning');
  return String(key).replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function PreviewPane({ label, url, emptyText }) {
  return (
    <figure className="ipc-preview-pane">
      <figcaption>{label}</figcaption>
      <div className="ipc-preview-image">
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

  const summary = useMemo(() => summarizeImageProcessingJobs(jobs), [jobs]);
  const selectedJob = jobs.find((job) => job.id === selectedJobId) || jobs[0] || null;
  const hasActiveJobs = jobs.some((job) => ACTIVE_STATUSES.has(job.status));

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
        action === 'publish' ? `Published ${job.filename} to image slot ${details.imageSlot}` : `${statusLabel(action)}: ${job.filename}`,
        'success',
      );
    } catch (err) {
      setWorkerUnavailable(true);
      setError(err.message || `Could not ${action} this image`);
    } finally {
      setBusy('');
    }
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
        updated.push(await updateImageProcessingJob(job.id, action));
      }
      markQueueMutation();
      mergeJobs(updated);
      setWorkerUnavailable(false);
      onShowToast?.(`${action === 'approve' ? 'Approved' : 'Rejected'} ${updated.length} reviewed image${updated.length === 1 ? '' : 's'}`, 'success');
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
          <p>Remove backgrounds and visual noise, improve clarity, review every result, then explicitly publish it to an existing product image slot.</p>
        </div>
        <button type="button" className="adm-btn-ghost" onClick={() => void loadJobs()} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh queue
        </button>
      </div>

      <div className="ipc-readiness-note">
        <CheckCircle size={17} />
        <div><strong>Website-readiness check</strong><span>Checks background clutter, crop and centring, canvas consistency, clarity, lighting and detached stickers or barcode labels. Labels that may belong to the product are flagged for manual human review and are never automatically treated as removable.</span></div>
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
        <div><strong>{summary.approved}</strong><span>Approved / published</span></div>
        <div><strong>{summary.failed}</strong><span>Issues</span></div>
        <div className="ipc-summary-cost"><strong>R {summary.cost.toFixed(2)}</strong><span>Estimated batch cost</span></div>
      </div>

      {summary.review > 0 && (
        <div className="ipc-bulk-review" role="group" aria-label="Bulk review actions">
          <div><strong>{summary.review} processed image{summary.review === 1 ? '' : 's'} awaiting review</strong><span>Bulk approval still does not publish anything. Publishing remains a separate image-by-image action.</span></div>
          <button type="button" className="adm-btn-red" disabled={Boolean(busy)} onClick={() => void runBulkReviewAction('approve')}><Check size={14} /> Approve all reviewed</button>
          <button type="button" className="adm-btn-ghost" disabled={Boolean(busy)} onClick={() => void runBulkReviewAction('reject')}><X size={14} /> Reject all reviewed</button>
        </div>
      )}

      <div className="ipc-workspace">
        <aside className="ipc-queue" aria-label="Image batch queue">
          <header><strong>Batch queue</strong><span>{jobs.length}</span></header>
          {loading && !jobs.length ? (
            <p className="ipc-empty"><Loader2 size={16} className="spin" /> Loading queue…</p>
          ) : jobs.length ? jobs.map((job) => (
            <button key={job.id} type="button" className={`ipc-queue-row${selectedJob?.id === job.id ? ' ipc-queue-row--on' : ''}`} onClick={() => setSelectedJobId(job.id)}>
              <span className={`ipc-status-dot ipc-status-dot--${job.status}`} />
              <span className="ipc-queue-copy"><strong>{job.filename}</strong><small>{job.sku || (job.source === 'nutstore' ? 'Nutstore' : 'Local upload')}</small></span>
              <span className={`ipc-status ipc-status--${job.status}`}>{statusLabel(job.status)}</span>
            </button>
          )) : (
            <div className="ipc-empty"><Sparkles size={22} /><strong>No images queued</strong><span>Add selected Nutstore images or upload a folder to begin.</span></div>
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
                <PreviewPane label="Before" url={selectedJob.beforeUrl} emptyText="Original preview pending" />
                <PreviewPane label="After" url={selectedJob.afterUrl} emptyText={ACTIVE_STATUSES.has(selectedJob.status) ? 'Processing…' : 'Processed preview unavailable'} />
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
              {(APPROVED_STATUSES.has(selectedJob.status) || selectedJob.status === 'published') && (
                <div className="ipc-publish-box">
                  <div><strong>{selectedJob.status === 'published' ? 'Published to product' : 'Approved — not published yet'}</strong><span>Publishing is a separate, deliberate action and writes only to the selected existing image slot.</span></div>
                  <label>Image slot<select value={slots[selectedJob.id] || selectedJob.targetSlot} disabled={selectedJob.status === 'published'} onChange={(event) => setSlots((current) => ({ ...current, [selectedJob.id]: Number(event.target.value) }))}>{[1, 2, 3, 4].map((slot) => <option key={slot} value={slot}>Slot {slot}</option>)}</select></label>
                  <button type="button" className="adm-btn-red" disabled={Boolean(busy) || selectedJob.status === 'published' || !selectedJob.sku} onClick={() => void runAction(selectedJob, 'publish', { imageSlot: slots[selectedJob.id] || selectedJob.targetSlot, publishToExistingSlot: true })}><Send size={14} /> Publish to existing slot</button>
                  {selectedJob.status === 'published' && <button type="button" className="adm-btn-ghost" disabled={Boolean(busy)} onClick={() => void runAction(selectedJob, 'restore')}><RotateCcw size={14} /> Restore original</button>}
                </div>
              )}
              {selectedJob.status === 'restored' && <div className="ipc-publish-box"><div><strong>Original restored</strong><span>The processed version remains in history but is no longer the product image.</span></div></div>}
            </>
          ) : <div className="ipc-review-empty"><Sparkles size={28} /><strong>Select an image to review</strong><span>Before and after previews, quality checks and controlled publishing will appear here.</span></div>}
        </div>
      </div>
    </section>
  );
}
