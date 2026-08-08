import { AlertTriangle, Loader2, PackagePlus, RefreshCw, Trash2 } from 'lucide-react';
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
  onPublish,
}) {
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
                  {key === 'readyToPublish' && (
                    <button type="button" className="adm-btn-red adm-btn--sm" disabled={busy} onClick={() => onPublish?.(row)}>
                      {saving === `pub-${row.sku}` ? <Loader2 size={12} className="spin" /> : <PackagePlus size={12} />}
                      Publish
                    </button>
                  )}
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
        <p className="pl-section-note">Review staged products before approval. Originals stay intact until publish.</p>
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

      {renderSection('waitingImages')}
      {renderSection('waitingCategories')}
      {renderSection('waitingApproval')}
      {renderSection('readyToPublish')}
    </div>
  );
}
