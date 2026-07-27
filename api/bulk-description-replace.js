import { requireAdminKey } from './_admin-auth.js';
import { createClient } from '@supabase/supabase-js';

// Bulk title replace — matches products by barcode and overwrites
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
          .select('sku, barcode, title')
          .in('barcode', chunk);
        if (error) return res.status(500).json({ error: error.message });
        for (const r of data || []) found.set(normBarcode(r.barcode), r);
      }

      const rows = barcodes.map((bc) => {
        const r = found.get(bc);
        return r
          ? { barcode: bc, found: true, sku: r.sku, currentTitle: r.title || '' }
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
        const title = String(it?.title ?? it?.description ?? '').trim();
        if (!barcode || !title) { results.push({ barcode, status: 'skipped' }); continue; }

        const { data, error } = await supabase
          .from('website_stock')
          .update({ title, updated_at: new Date().toISOString() })
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
