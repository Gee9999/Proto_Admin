import { createClient } from '@supabase/supabase-js';
import { requireAdminKey } from './_admin-auth.js';
import { getStockClient } from './_stock-client.js';
import { buildStockIntelligence } from '../src/lib/stockIntelligence.js';

const VALID_PERIODS = new Set([30, 90, 180, 365]);
const PAGE_SIZE = 1000;

function getAdminClient() {
  return createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

async function fetchAll(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < PAGE_SIZE) return rows;
  }
}

export default async function handler(req, res) {
  if (!(await requireAdminKey(req, res))) return;
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const requestedPeriod = Number.parseInt(req.query?.period, 10);
  const periodDays = VALID_PERIODS.has(requestedPeriod) ? requestedPeriod : 90;
  const cutoff = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();

  try {
    const stock = getStockClient();
    const admin = getAdminClient();
    const [stockRows, orders] = await Promise.all([
      fetchAll(() => stock
        .from('website_stock')
        .select('sku, barcode, title, category, stock_qty, available_stock, to_order, updated_at')
        .order('sku', { ascending: true })),
      fetchAll(() => admin
        .from('orders')
        .select('created_at, original_items, final_items, items')
        .gte('created_at', cutoff)
        .order('created_at', { ascending: true })),
    ]);

    return res.status(200).json(buildStockIntelligence({ stockRows, orders, periodDays }));
  } catch (error) {
    console.error('stock-intelligence:', error?.message || error);
    return res.status(500).json({ error: 'Stock intelligence is temporarily unavailable' });
  }
}

