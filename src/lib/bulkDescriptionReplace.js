// Bulk description replace — parse a BARCODE/DESCRIPTION spreadsheet, preview
// the matches against the live catalogue, then apply. Descriptions are written
// to website_stock.original_description (see api/bulk-description-replace.js).

export const BULK_DESCRIPTION_MAX = 5000;

/** Parse an .xlsx/.csv with BARCODE + DESCRIPTION columns → [{barcode, description}]. */
export async function parseDescriptionSheet(file) {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error('No sheet found in that file.');
  const table = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  if (!table.length) throw new Error('That file appears to be empty.');

  let headerIdx = -1;
  let barcodeCol = -1;
  let descCol = -1;
  for (let i = 0; i < Math.min(table.length, 10); i += 1) {
    const row = (table[i] || []).map((c) => String(c || '').trim().toUpperCase());
    const bc = row.findIndex((c) => c === 'BARCODE' || c.includes('BARCODE'));
    const dc = row.findIndex((c) => c.includes('DESCRIPTION'));
    if (bc !== -1 && dc !== -1) { headerIdx = i; barcodeCol = bc; descCol = dc; break; }
  }
  if (headerIdx === -1) {
    throw new Error('Could not find BARCODE and DESCRIPTION columns. The first row must have those headers.');
  }

  // Last row wins if a barcode repeats (later rows treated as corrections).
  const map = new Map();
  for (let i = headerIdx + 1; i < table.length; i += 1) {
    const row = table[i] || [];
    const barcode = String(row[barcodeCol] ?? '').trim();
    const description = String(row[descCol] ?? '').trim();
    if (!barcode || !description) continue;
    map.set(barcode, description);
  }
  const items = [...map.entries()].map(([barcode, description]) => ({ barcode, description }));
  if (!items.length) throw new Error('No rows with both a barcode and a description were found.');
  if (items.length > BULK_DESCRIPTION_MAX) {
    throw new Error(`Too many rows (${items.length}). Max ${BULK_DESCRIPTION_MAX} per run.`);
  }
  return items;
}

/** Look up current title/description for each barcode; merge in the new text. */
export async function previewDescriptions(items) {
  const res = await fetch('/api/bulk-description-replace', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'preview', barcodes: items.map((i) => i.barcode) }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Preview failed');
  const byBarcode = new Map(items.map((i) => [i.barcode, i.description]));
  return (json.rows || []).map((r) => ({
    ...r,
    newDescription: byBarcode.get(r.barcode) || '',
    unchanged: r.found && (r.currentDescription || '').trim() === (byBarcode.get(r.barcode) || '').trim(),
  }));
}

/** Apply the description updates. Returns { updated, notFound, failed, results }. */
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
  const lines = [['BARCODE', 'NEW DESCRIPTION'], ...unmatched.map((r) => [r.barcode, r.newDescription || ''])];
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
