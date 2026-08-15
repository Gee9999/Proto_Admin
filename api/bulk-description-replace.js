import { requireAdminKey } from './_admin-auth.js';
import { createClient } from '@supabase/supabase-js';

// Bulk title replace — matches products by exact SKU and overwrites
// website_stock.title (the product name shown on the storefront). Updating that
// column fires the existing website_stock → website_products sync trigger, so
// the storefront copy updates automatically. Two modes: 'preview' and 'apply'.

export const config = { api: { bodyParser: { sizeLimit: '8mb' } } };

const MAX_ITEMS = 5000;
const CHUNK = 400;

function getStockAdminClient() {
  return createClient(
    process.env.VITE_STOCK_SUPABASE_URL,
    process.env.VITE_STOCK_SUPABASE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

const normSku = (v) => String(v ?? '').trim().toUpperCase();
const normBarcode = (v) => String(v ?? '').trim().toUpperCase();

export function resolvePreviewRows(items, stockRows) {
  const bySku = new Map();
  const byBarcode = new Map();
  for (const row of stockRows || []) {
    const sku = normSku(row?.sku);
    const barcode = normBarcode(row?.barcode);
    if (sku) {
      const rows = bySku.get(sku) || [];
      rows.push(row);
      bySku.set(sku, rows);
    }
    if (barcode) {
      const rows = byBarcode.get(barcode) || [];
      rows.push(row);
      byBarcode.set(barcode, rows);
    }
  }

  return items.map((item) => {
    const requestedSku = normSku(item?.sku);
    const requestedBarcode = normBarcode(item?.barcode);
    const candidates = requestedBarcode
      ? (byBarcode.get(requestedBarcode) || []).filter((row) => normSku(row.sku) === requestedSku)
      : (bySku.get(requestedSku) || []);

    if (candidates.length === 1) {
      const row = candidates[0];
      return {
        sku: normSku(row.sku),
        requestedSku,
        found: true,
        barcode: normBarcode(row.barcode),
        currentTitle: row.title || '',
        matchedBy: requestedBarcode ? 'barcode_and_sku' : 'sku',
      };
    }
    if (candidates.length > 1) {
      return {
        sku: requestedSku,
        found: false,
        ambiguous: true,
        barcode: requestedBarcode,
        reason: 'ambiguous_barcode_and_sku',
      };
    }

    const skuExists = (bySku.get(requestedSku) || []).length > 0;
    return {
      sku: requestedSku,
      found: false,
      barcode: requestedBarcode,
      reason: requestedBarcode && skuExists ? 'barcode_mismatch' : 'not_found',
    };
  });
}

export default async function handler(req, res) {
  if (!(await requireAdminKey(req, res))) return;
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = getStockAdminClient();
  const mode = String(req.body?.mode || '').trim();

  try {
    if (mode === 'preview') {
      const rawItems = Array.isArray(req.body?.items)
        ? req.body.items
        : (req.body?.skus || []).map((sku) => ({ sku, barcode: '' }));
      const itemMap = new Map();
      for (const item of rawItems) {
        const sku = normSku(item?.sku);
        if (!sku) continue;
        itemMap.set(sku, { sku, barcode: normBarcode(item?.barcode) });
        if (itemMap.size >= MAX_ITEMS) break;
      }
      const items = [...itemMap.values()];
      if (!items.length) return res.status(200).json({ rows: [] });

      const skus = [...new Set(items.map((item) => item.sku))];
      const barcodes = [...new Set(items.map((item) => item.barcode).filter(Boolean))];

      const found = new Map();
      for (let i = 0; i < skus.length; i += CHUNK) {
        const chunk = skus.slice(i, i + CHUNK);
        const { data, error } = await supabase
          .from('website_stock')
          .select('sku, barcode, title')
          .in('sku', chunk);
        if (error) return res.status(500).json({ error: error.message });
        for (const r of data || []) found.set(`${normSku(r.sku)}\u0000${normBarcode(r.barcode)}`, r);
      }
      for (let i = 0; i < barcodes.length; i += CHUNK) {
        const chunk = barcodes.slice(i, i + CHUNK);
        const { data, error } = await supabase
          .from('website_stock')
          .select('sku, barcode, title')
          .in('barcode', chunk);
        if (error) return res.status(500).json({ error: error.message });
        for (const r of data || []) found.set(`${normSku(r.sku)}\u0000${normBarcode(r.barcode)}`, r);
      }

      return res.status(200).json({ rows: resolvePreviewRows(items, [...found.values()]) });
    }

    if (mode === 'apply') {
      const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, MAX_ITEMS) : [];
      const results = [];
      let updated = 0;
      let notFound = 0;
      let failed = 0;

      for (const it of items) {
        const sku = normSku(it?.sku);
        const barcode = normBarcode(it?.barcode);
        const title = String(it?.title ?? it?.description ?? '').trim();
        if (!sku || !title) { results.push({ sku, status: 'skipped' }); continue; }

        const { data: current, error: lookupError } = await supabase
          .from('website_stock')
          .select('sku, barcode')
          .eq('sku', sku)
          .maybeSingle();
        if (lookupError) { failed += 1; results.push({ sku, status: 'error', error: lookupError.message }); continue; }
        if (!current) { notFound += 1; results.push({ sku, status: 'notfound' }); continue; }
        if (barcode && normBarcode(current.barcode) !== barcode) {
          failed += 1;
          results.push({ sku, status: 'barcode_mismatch' });
          continue;
        }

        const { data, error } = await supabase
          .from('website_stock')
          .update({ title, updated_at: new Date().toISOString() })
          .eq('sku', sku)
          .select('sku');

        if (error) { failed += 1; results.push({ sku, status: 'error', error: error.message }); continue; }
        if (!data || !data.length) { notFound += 1; results.push({ sku, status: 'notfound' }); continue; }
        updated += 1;
        results.push({ sku, status: 'updated', count: 1 });
      }

      return res.status(200).json({ updated, notFound, failed, results });
    }

    return res.status(400).json({ error: 'Unknown mode' });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Bulk description replace failed' });
  }
}
