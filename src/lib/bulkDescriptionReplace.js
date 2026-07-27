// Bulk title replace — parse a BARCODE/TITLE spreadsheet, preview the matches
// against the live catalogue, then apply. Titles are written to
// website_stock.title (see api/bulk-description-replace.js).

export const BULK_DESCRIPTION_MAX = 5000;

const TITLE_HEADERS = ['TITLE', 'NAME', 'PRODUCT', 'DESCRIPTION'];

/** Parse an .xlsx/.csv with BARCODE + (TITLE|NAME|PRODUCT|DESCRIPTION) → [{barcode, title}]. */
export async function parseDescriptionSheet(file) {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error('No sheet found in that file.');
  const table = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  if (!table.length) throw new Error('That file appears to be empty.');

  let headerIdx = -1;
  let barcodeCol = -1;
  let titleCol = -1;
  for (let i = 0; i < Math.min(table.length, 10); i += 1) {
    const rowCells = (table[i] || []).map((c) => String(c || '').trim().toUpperCase());
    // Prefer exact header matches over substring, and never let the barcode and
    // title resolve to the SAME column (e.g. a "PRODUCT BARCODE" header matches
    // both — without this guard, titles would be overwritten with barcodes).
    const bc = rowCells.indexOf('BARCODE') !== -1
      ? rowCells.indexOf('BARCODE')
      : rowCells.findIndex((c) => c.includes('BARCODE'));
    let tc = rowCells.findIndex((c, idx) => idx !== bc && TITLE_HEADERS.includes(c));
    if (tc === -1) tc = rowCells.findIndex((c, idx) => idx !== bc && TITLE_HEADERS.some((h) => c.includes(h)));
    if (bc !== -1 && tc !== -1 && bc !== tc) { headerIdx = i; barcodeCol = bc; titleCol = tc; break; }
  }
  if (headerIdx === -1) {
    throw new Error('Could not find BARCODE and TITLE columns. The first row must have a BARCODE header and a TITLE (or NAME/PRODUCT/DESCRIPTION) header.');
  }

  // Last row wins if a barcode repeats (later rows treated as corrections).
  const map = new Map();
  for (let i = headerIdx + 1; i < table.length; i += 1) {
    const row = table[i] || [];
    const barcode = String(row[barcodeCol] ?? '').trim();
    const title = String(row[titleCol] ?? '').trim();
    if (!barcode || !title) continue;
    map.set(barcode, title);
  }
  const items = [...map.entries()].map(([barcode, title]) => ({ barcode, title }));
  if (!items.length) throw new Error('No rows with both a barcode and a title were found.');
  if (items.length > BULK_DESCRIPTION_MAX) {
    throw new Error(`Too many rows (${items.length}). Max ${BULK_DESCRIPTION_MAX} per run.`);
  }
  return items;
}

/** Look up the current title for each barcode; merge in the new title. */
export async function previewDescriptions(items) {
  const res = await fetch('/api/bulk-description-replace', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'preview', barcodes: items.map((i) => i.barcode) }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Preview failed');
  const byBarcode = new Map(items.map((i) => [i.barcode, i.title]));
  return (json.rows || []).map((r) => ({
    ...r,
    newTitle: byBarcode.get(r.barcode) || '',
    unchanged: r.found && (r.currentTitle || '').trim() === (byBarcode.get(r.barcode) || '').trim(),
  }));
}

/** Apply the title updates. Returns { updated, notFound, failed, results }. */
export async function applyDescriptions(items) {
  const res = await fetch('/api/bulk-description-replace', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'apply', items }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Apply failed');
  return json;
}

/** Download a CSV of barcodes that had no matching product. */
export function downloadUnmatchedCsv(rows) {
  const unmatched = (rows || []).filter((r) => !r.found);
  if (!unmatched.length) return;
  const lines = [['BARCODE', 'NEW TITLE'], ...unmatched.map((r) => [r.barcode, r.newTitle || ''])];
  const csv = lines
    .map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'unmatched-barcodes.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
