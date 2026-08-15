import { useMemo, useRef, useState } from 'react';
import { Archive, CheckCircle, FileSpreadsheet, FolderOpen, Loader2, ShieldAlert } from 'lucide-react';
import { archiveVariantProduct, uploadProductImageSlot } from '../../lib/productLoaderApi';
import { matchVariantImages, parseVariantImportSheet, variantRowState } from '../../lib/productVariantImport';
import { readApiJson } from '../../lib/apiError';

export default function ProductLoaderVariantImport({ publishedBy = '', onShowToast }) {
  const sheetRef = useRef(null);
  const folderRef = useRef(null);
  const [sheetName, setSheetName] = useState('');
  const [rows, setRows] = useState([]);
  const [files, setFiles] = useState([]);
  const [unmatchedCount, setUnmatchedCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, sku: '' });
  const [error, setError] = useState('');

  const combine = (sheetRows, localFiles, previewRows = null) => {
    const matched = matchVariantImages(sheetRows, localFiles);
    const sourceBySku = new Map((previewRows || rows).map((row) => [row.sku, row]));
    setUnmatchedCount(matched.unmatched.length);
    setRows(matched.items.map((item) => ({ ...sourceBySku.get(item.sku), ...item })));
  };

  const preview = async (sheetRows, localFiles) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/product-loader-variant-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: sheetRows.map(({ sku, barcode }) => ({ sku, barcode })) }),
      });
      const json = await readApiJson(res, { fallback: 'Preview failed' });
      const bySku = new Map((json.rows || []).map((row) => [row.sku, row]));
      const enriched = sheetRows.map((row) => ({ ...row, ...(bySku.get(row.sku) || {}) }));
      combine(enriched, localFiles, enriched);
    } catch (err) {
      setError(err.message || 'Preview failed');
    } finally {
      setLoading(false);
    }
  };

  const chooseSheet = async (file) => {
    if (!file) return;
    setLoading(true);
    setError('');
    try {
      const parsed = await parseVariantImportSheet(file);
      setSheetName(file.name);
      await preview(parsed, files);
    } catch (err) {
      setRows([]);
      setError(err.message || 'Could not read the spreadsheet');
      setLoading(false);
    }
  };

  const chooseFolder = (selected) => {
    const localFiles = Array.from(selected || []);
    setFiles(localFiles);
    if (rows.length) combine(rows, localFiles);
  };

  const readyRows = useMemo(
    () => rows.filter((row) => variantRowState(row).ready),
    [rows],
  );

  const archive = async () => {
    if (!readyRows.length) return;
    const confirmed = window.confirm(
      `Send ${readyRows.length} new product${readyRows.length === 1 ? '' : 's'} to Archive? They will stay off the website until each product's category is selected and Make live is confirmed.`,
    );
    if (!confirmed) return;

    setPublishing(true);
    setError('');
    setProgress({ done: 0, total: readyRows.length, sku: '' });
    const results = [];
    let activeSku = '';
    try {
      for (let index = 0; index < readyRows.length; index += 1) {
        const row = readyRows[index];
        activeSku = row.sku;
        setProgress({ done: index, total: readyRows.length, sku: row.sku });
        const images = [];
        for (const image of row.images) {
          const uploaded = await uploadProductImageSlot({
            file: image.file,
            sku: row.sku,
            slot: image.slot,
            requireNew: true,
          });
          images.push({ slot: image.slot, url: uploaded.url });
        }
        results.push(await archiveVariantProduct({
          code: row.sku,
          barcode: row.barcode,
          title: row.title,
          description: row.title,
          price: row.price,
          stockQty: row.stockQty,
          availableStock: row.availableStock,
          unitsOfIssue: row.unitsOfIssue || 'EACH',
          images,
          publishedBy,
        }));
        setProgress({ done: index + 1, total: readyRows.length, sku: row.sku });
      }
      onShowToast?.(`Sent ${results.length} products to Archive. Choose each category there before making live.`, 'success');
      await preview(rows, files);
    } catch (err) {
      const message = `${activeSku ? `${activeSku}: ` : ''}${err.message || 'Archive failed'}`;
      await preview(rows, files);
      setError(message);
    } finally {
      setPublishing(false);
    }
  };

  const blocked = rows.length - readyRows.length;

  return (
    <div>
      <div style={{ padding: 12, marginBottom: 16, border: '1px solid #bfdbfe', borderRadius: 10, background: '#eff6ff', color: '#1e3a8a', fontSize: 13 }}>
        Upload the SKU/barcode/title Excel, then choose the local image folder. Several SKUs may share one barcode; each SKU keeps its own title and images. Ready rows go to Archive, not the live website.
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <button type="button" className="adm-btn-secondary" onClick={() => sheetRef.current?.click()} disabled={loading || publishing}>
          <FileSpreadsheet size={15} /> {sheetName || 'Choose Excel'}
        </button>
        <button type="button" className="adm-btn-secondary" onClick={() => folderRef.current?.click()} disabled={!rows.length || loading || publishing}>
          <FolderOpen size={15} /> {files.length ? `${files.length} local files selected` : 'Choose image folder'}
        </button>
        <input ref={sheetRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => chooseSheet(e.target.files?.[0])} />
        <input ref={folderRef} type="file" accept="image/*" multiple webkitdirectory="" directory="" hidden onChange={(e) => chooseFolder(e.target.files)} />
      </div>

      {loading && <p className="adm-muted"><Loader2 size={14} className="spin" /> Checking exact SKUs and Positill barcodes…</p>}
      {error && <div style={{ padding: 10, marginBottom: 14, border: '1px solid #fecaca', borderRadius: 8, background: '#fef2f2', color: '#b91c1c', fontSize: 13 }}>{error}</div>}

      {rows.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 16, marginBottom: 10, fontSize: 13 }}>
            <span style={{ color: '#15803d', fontWeight: 700 }}><CheckCircle size={14} /> {readyRows.length} ready</span>
            <span style={{ color: blocked ? '#b91c1c' : '#64748b', fontWeight: 700 }}><ShieldAlert size={14} /> {blocked} blocked</span>
            {unmatchedCount > 0 && <span className="adm-muted">{unmatchedCount} folder files unmatched</span>}
          </div>

          <div style={{ overflowX: 'auto', maxHeight: 440, border: '1px solid #e2e8f0', borderRadius: 8, marginBottom: 16 }}>
            <table className="adm-table" style={{ width: '100%' }}>
              <thead><tr><th>SKU</th><th>Barcode</th><th>Website title</th><th>Images</th><th>Status</th></tr></thead>
              <tbody>{rows.map((row) => {
                const state = variantRowState(row);
                return (
                  <tr key={row.sku} style={{ background: state.ready ? '#f0fdf4' : '#fef2f2' }}>
                    <td style={{ fontWeight: 700 }}>{row.sku}</td>
                    <td>{row.barcode}</td>
                    <td>{row.title}</td>
                    <td>{row.images?.map((image) => `#${image.slot} ${image.filename}`).join(', ') || '—'}</td>
                    <td style={{ color: state.ready ? '#15803d' : '#b91c1c', fontWeight: 700 }}>{state.reason}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>

          <button type="button" className="adm-btn-red" onClick={archive} disabled={!readyRows.length || publishing || loading}>
            {publishing ? <><Loader2 size={15} className="spin" /> {progress.done}/{progress.total} · {progress.sku}</> : <><Archive size={15} /> Send {readyRows.length} to Archive</>}
          </button>
          <p className="adm-section-note" style={{ marginTop: 8 }}>Nothing goes live from this screen. In Product Manager → Archive, open Make live and choose the correct category and full subcategory path for each SKU.</p>
        </>
      )}
    </div>
  );
}
