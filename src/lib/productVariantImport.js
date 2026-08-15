import { parseDescriptionRows } from './bulkDescriptionReplace';
import { isImageFile } from './parseIntakeFilename';

const cleanSku = (value) => String(value ?? '').trim().toUpperCase();

export async function parseVariantImportSheet(file) {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error('No sheet found in that file.');
  const table = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  const rows = parseDescriptionRows(table);
  const missingBarcode = rows.filter((row) => !row.barcode);
  if (missingBarcode.length) {
    throw new Error(`${missingBarcode.length} row${missingBarcode.length === 1 ? '' : 's'} do not have a barcode. Every new website SKU needs its Positill barcode.`);
  }
  return rows;
}

/**
 * Match local files conservatively: SKU.jpg is slot 1 and SKU.2.jpg through
 * SKU.4.jpg are the extra slots. Exact SKU wins, so a real SKU ending in .2
 * is never stripped when it exists in the workbook.
 */
export function matchVariantImages(rows, files) {
  const rowSkus = new Set((rows || []).map((row) => cleanSku(row.sku)));
  const matches = new Map([...rowSkus].map((sku) => [sku, new Map()]));
  const unmatched = [];
  const duplicates = [];

  for (const file of Array.from(files || []).filter(isImageFile)) {
    const name = String(file.name || '');
    const dot = name.lastIndexOf('.');
    const stem = cleanSku(dot > 0 ? name.slice(0, dot) : name);
    let sku = rowSkus.has(stem) ? stem : '';
    let slot = 1;

    if (!sku) {
      const slotMatch = stem.match(/^(.*)\.([2-4])$/);
      if (slotMatch && rowSkus.has(slotMatch[1])) {
        sku = slotMatch[1];
        slot = Number(slotMatch[2]);
      }
    }

    if (!sku) {
      unmatched.push(file);
      continue;
    }
    const slots = matches.get(sku);
    if (slots.has(slot)) {
      duplicates.push({ sku, slot, filenames: [slots.get(slot).name, file.name] });
      continue;
    }
    slots.set(slot, file);
  }

  const items = (rows || []).map((row) => {
    const sku = cleanSku(row.sku);
    const slots = matches.get(sku) || new Map();
    return {
      ...row,
      sku,
      images: [...slots.entries()]
        .map(([slot, file]) => ({ slot, file, filename: file.name }))
        .sort((a, b) => a.slot - b.slot),
      hasPrimaryImage: slots.has(1),
      duplicateSlots: duplicates.filter((item) => item.sku === sku),
    };
  });

  return { items, unmatched, duplicates };
}

export function variantRowState(row) {
  if (row.existing) return { ready: false, reason: 'SKU already exists — blocked to protect its images' };
  if (!row.sourceFound) return { ready: false, reason: 'Barcode not found in the product source' };
  if (!row.price || Number(row.price) <= 0) return { ready: false, reason: 'No valid website price found' };
  if (row.duplicateSlots?.length) return { ready: false, reason: 'More than one file targets the same image slot' };
  if (!row.hasPrimaryImage) return { ready: false, reason: 'Main image missing (use SKU.jpg)' };
  return { ready: true, reason: 'Ready' };
}
