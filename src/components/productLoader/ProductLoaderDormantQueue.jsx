import { AlertTriangle, CheckCircle2, Clock3, Eye, Loader2, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { classifyDormantRow, DORMANT_SECTION_LABELS } from '../../lib/parseIntakeFilename';

function findNode(tree, id) {
  for (const n of tree) {
    if (n.id === id) return n;
    if (n.children?.length) {
      const f = findNode(n.children, id);
      if (f) return f;
    }
  }
  return null;
}

function childrenOf(tree, id) {
  return findNode(tree, id)?.children || [];
}

export default function ProductLoaderDormantQueue({
  taxonomyTree,
  rows,
  edits,
  setEdits,
  loading,
  saving,
  error = '',
  loaded = false,
  onRefresh,
  onRetry,
  onSaveCategories,
  onRemove,
  onOpen,
  imageIntakeText,
  setImageIntakeText,
  imageIntakeItems = [],
  imageIntakeLoading = false,
  imageIntakeError = '',
  onLookupImageIntake,
  onQueueImageIntake,
  imageJobs = [],
  selectedImageJobId = '',
  onSelectImageJob,
  imageJobBusy = false,
  onProcessImageJob,
  onApproveImageJob,
}) {
  const selectedJob = imageJobs.find((job) => job.id === selectedImageJobId) || null;
  const sections = {
    waitingImages: [],
    waitingCategories: [],
    waitingApproval: [],
    readyToPublish: [],
  };

  for (const row of rows) {
    const key = classifyDormantRow(row);
    sections[key].push(row);
  }

  const renderSection = (key) => {
    const list = sections[key];
    if (!list.length) return null;
    return (
      <section key={key} className="pl-dormant-section">
        <h4>
          {DORMANT_SECTION_LABELS[key]} <span className="adm-muted">({list.length})</span>
        </h4>
        <div className="pl-dormant-list">
          {list.map((row) => {
            const edit = edits[row.sku] || { categoryId: '', sub1Id: '', sub2Id: '', sub3Id: '', sub4Id: '' };
            const sub1Options = edit.categoryId ? childrenOf(taxonomyTree, edit.categoryId) : [];
            const busy = saving === `rm-${row.sku}` || saving === `cat-${row.sku}` || saving === `pub-${row.sku}`;

            return (
              <article key={row.sku} className="pl-dormant-card">
                <div className="pl-dormant-card-head">
                  <div>
                    <strong>{row.title}</strong>
                    <span className="adm-muted">{row.sku}</span>
                  </div>
                  <span className="adm-muted">R{Number(row.price || 0).toFixed(2)}</span>
                </div>
                <div className="pl-dormant-card-fields">
                  <select
                    className="adm-select adm-select--enhanced"
                    value={edit.categoryId}
                    onChange={(e) => setEdits((prev) => ({
                      ...prev,
                      [row.sku]: { ...edit, categoryId: e.target.value, sub1Id: '' },
                    }))}
                  >
                    <option value="">Category</option>
                    {taxonomyTree.map((cat) => <option key={cat.id} value={cat.id}>{cat.label}</option>)}
                  </select>
                  {sub1Options.length > 0 && (
                    <select
                      className="adm-select adm-select--enhanced"
                      value={edit.sub1Id}
                      onChange={(e) => setEdits((prev) => ({
                        ...prev,
                        [row.sku]: { ...edit, sub1Id: e.target.value },
                      }))}
                    >
                      <option value="">Subcategory</option>
                      {sub1Options.map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
                    </select>
                  )}
                </div>
                <div className="pl-action-row">
                  <button type="button" className="adm-btn-ghost adm-btn--sm" disabled={busy} onClick={() => onOpen?.(row)}>
                    Open
                  </button>
                  <button type="button" className="adm-btn-ghost adm-btn--sm" disabled={busy} onClick={() => onSaveCategories?.(row.sku)}>
                    Save categories
                  </button>
                  <button type="button" className="adm-btn-ghost adm-btn--sm" style={{ color: '#dc2626' }} disabled={busy} onClick={() => onRemove?.(row.sku)}>
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    );
  };

  return (
    <div className="pl-section">
      <div className="pl-section-head-row">
        <p className="pl-section-note">Preview-only image review. Originals stay intact; this screen cannot publish to live products.</p>
        <button type="button" className="adm-btn-ghost adm-btn--sm" onClick={onRefresh} disabled={loading}>
          {loading ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
          Refresh queue
        </button>
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 12px', borderRadius: 8, border: '1px solid #fecaca', background: '#fef2f2', color: '#991b1b', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <AlertTriangle size={14} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
          <button type="button" className="adm-btn-ghost adm-btn--sm" onClick={onRetry} disabled={loading}>
            Retry queue load
          </button>
        </div>
      )}

      {loading && !rows.length && <p className="adm-muted"><Loader2 size={14} className="spin" /> Loading queue...</p>}
      {!loading && !rows.length && loaded && !error && <p className="adm-muted">No products are waiting in Image Processing Centre.</p>}

      <section className="pl-dormant-section" style={{ marginTop: 18 }}>
        <h4>Nutstore image intake</h4>
        <p className="adm-muted">Paste one Nutstore image path per line. Only an exact existing SKU and image slot can be queued.</p>
        <textarea className="adm-input" rows={3} value={imageIntakeText} onChange={(event) => setImageIntakeText?.(event.target.value)} placeholder="/PTR Photos/Folder/SKU.1.jpg" style={{ width: '100%', resize: 'vertical', margin: '8px 0' }} />
        <button type="button" className="adm-btn-ghost adm-btn--sm" onClick={onLookupImageIntake} disabled={imageIntakeLoading}>
          {imageIntakeLoading ? <Loader2 size={13} className="spin" /> : <Eye size={13} />} Check exact matches
        </button>
        {imageIntakeError && <p style={{ color: '#b91c1c', marginTop: 8 }}>{imageIntakeError}</p>}
        {!!imageIntakeItems.length && <div className="pl-dormant-list" style={{ marginTop: 10 }}>
          {imageIntakeItems.map((item) => (
            <article key={item.path} className="pl-dormant-card">
              <strong>{item.filename}</strong>
              <span className="adm-muted">{item.code || 'No exact SKU'} · slot {item.imageSlot || 1}</span>
              {item.canQueue ? <p style={{ color: '#15803d', margin: '6px 0' }}>Exact product match — ready to queue.</p> : <p style={{ color: '#b45309', margin: '6px 0' }}>{item.queueBlocker || 'This file cannot enter the queue.'}</p>}
              <button type="button" className="adm-btn-ghost adm-btn--sm" disabled={!item.canQueue} onClick={() => onQueueImageIntake?.(item)}>Queue for review</button>
            </article>
          ))}
        </div>}
      </section>

      <section className="pl-dormant-section" style={{ marginTop: 18 }}>
        <h4>Processing queue <span className="adm-muted">({imageJobs.length})</span></h4>
        <p className="adm-muted">Queued → Processing → Ready for review → Approved. Errors are kept as Needs attention.</p>
        {!imageJobs.length && <p className="adm-muted">No preview images queued yet.</p>}
        {!!imageJobs.length && <div className="pl-dormant-list">
          {imageJobs.map((job) => {
            const labels = { queued: 'Queued', processing: 'Processing', ready_for_review: 'Ready for review', needs_attention: 'Needs attention', approved: 'Approved' };
            return <button key={job.id} type="button" className="pl-dormant-card" style={{ textAlign: 'left', borderColor: selectedImageJobId === job.id ? '#8B1A1A' : undefined }} onClick={() => onSelectImageJob?.(job.id)}>
              <strong>{job.title || job.sku}</strong><span className="adm-muted">{job.sku} · slot {job.targetSlot}</span>
              <span style={{ display: 'block', marginTop: 6, fontWeight: 700, color: job.status === 'needs_attention' ? '#b45309' : job.status === 'approved' ? '#15803d' : '#475569' }}>{labels[job.status] || job.status}</span>
            </button>;
          })}
        </div>}
        {selectedJob && <div className="pl-preview-card" style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}><strong>{selectedJob.sku} · image slot {selectedJob.targetSlot}</strong><span className="adm-muted">Original retained · {selectedJob.history.length} history event{selectedJob.history.length === 1 ? '' : 's'}</span></div>
          <div className="pl-preview-card-body" style={{ marginTop: 12 }}>
            <div><small className="adm-muted">Original from Nutstore</small><div className="pl-preview-thumb"><img src={selectedJob.originalUrl} alt={`Original ${selectedJob.sku}`} /></div></div>
            <div><small className="adm-muted">Processed preview</small><div className="pl-preview-thumb">{selectedJob.processedUrl ? <img src={selectedJob.processedUrl} alt={`Processed preview ${selectedJob.sku}`} /> : <span className="adm-muted">No result yet</span>}</div></div>
          </div>
          {selectedJob.error && <p style={{ color: '#b91c1c' }}>{selectedJob.error}</p>}
          <div className="pl-action-row" style={{ marginTop: 12 }}>
            <button type="button" className="adm-btn-red adm-btn--sm" disabled={imageJobBusy || selectedJob.status !== 'queued'} onClick={onProcessImageJob}>{imageJobBusy ? <Loader2 size={12} className="spin" /> : <Sparkles size={12} />} Process preview</button>
            <button type="button" className="adm-btn-ghost adm-btn--sm" disabled={selectedJob.status !== 'ready_for_review' || !selectedJob.processedUrl} onClick={onApproveImageJob}><CheckCircle2 size={12} /> Approve preview</button>
          </div>
          <p className="adm-muted" style={{ marginTop: 8 }}>{selectedJob.processedUrl ? 'Approval is available because the processed preview is visible. Approval stays preview-only.' : 'Approval is disabled until a processed image is visible.'}</p>
          <details style={{ marginTop: 10 }}><summary><Clock3 size={13} /> Processing history</summary><ul>{selectedJob.history.map((event, index) => <li key={`${event.at}-${index}`}>{new Date(event.at).toLocaleString()} — {event.label}</li>)}</ul></details>
        </div>}
      </section>

      {renderSection('waitingImages')}
      {renderSection('waitingCategories')}
      {renderSection('waitingApproval')}
      {renderSection('readyToPublish')}
    </div>
  );
}
