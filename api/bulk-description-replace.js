import { requireAdminKey } from './_admin-auth.js';
import { createClient } from '@supabase/supabase-js';

// Bulk description replace — matches products by barcode and overwrites
// website_stock.original_description. Updating that column fires the existing
// website_stock → website_products sync trigger, so the storefront copy updates
// automatically. Two modes: 'preview' (look up current values) and 'apply'.

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

const normBarcode = (v) => String(v ?? '').trim();

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
      const barcodes = [...new Set((req.body?.barcodes || []).map(normBarcode).filter(Boolean))].slice(0, MAX_ITEMS);
      if (!barcodes.length) return res.status(200).json({ rows: [] });

      const found = new Map();
      for (let i = 0; i < barcodes.length; i += CHUNK) {
        const chunk = barcodes.slice(i, i + CHUNK);
        const { data, error } = await supabase
          .from('website_stock')
          .select('sku, barcode, title, original_description')
          .in('barcode', chunk);
        if (error) return res.status(500).json({ error: error.message });
        for (const r of data || []) found.set(normBarcode(r.barcode), r);
      }

      const rows = barcodes.map((bc) => {
        const r = found.get(bc);
        return r
          ? { barcode: bc, found: true, sku: r.sku, title: r.title || '', currentDescription: r.original_description || '' }
          : { barcode: bc, found: false };
      });
      return res.status(200).json({ rows });
    }

    if (mode === 'apply') {
      const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, MAX_ITEMS) : [];
      const results = [];
      let updated = 0;
      let notFound = 0;
      let failed = 0;

      for (const it of items) {
        const barcode = normBarcode(it?.barcode);
        const description = String(it?.description ?? '').trim();
        if (!barcode || !description) { results.push({ barcode, status: 'skipped' }); continue; }

        const { data, error } = await supabase
          .from('website_stock')
          .update({ original_description: description, updated_at: new Date().toISOString() })
          .eq('barcode', barcode)
          .select('sku');

        if (error) { failed += 1; results.push({ barcode, status: 'error', error: error.message }); continue; }
        if (!data || !data.length) { notFound += 1; results.push({ barcode, status: 'notfound' }); continue; }
        updated += data.length;
        results.push({ barcode, status: 'updated', count: data.length });
      }

      return res.status(200).json({ updated, notFound, failed, results });
    }

    return res.status(400).json({ error: 'Unknown mode' });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Bulk description replace failed' });
  }
}
