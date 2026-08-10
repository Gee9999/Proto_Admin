import { createClient } from '@supabase/supabase-js';
import { requireAdminKey } from './_admin-auth.js';
import { buildProductLookupMap, collectLookupKeys, findProductBySku } from './_sku-match.js';
import {
  buildProductProfitability,
  itemSku,
  orderItems,
  supportedProductCostFields,
} from '../src/lib/productProfitability.js';

const VALID_PERIODS = [7, 30, 90, 120];

function parsePeriod(value) {
  const period = Number.parseInt(value, 10);
  return VALID_PERIODS.includes(period) ? period : 30;
}

function adminClient() {
  return createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function stockClient() {
  const url = process.env.VITE_STOCK_SUPABASE_URL;
  const key = process.env.VITE_STOCK_SUPABASE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function fetchProductsForOrders(client, orders) {
  if (!client) return [];
  const rawKeys = orders.flatMap((order) => orderItems(order).map(itemSku)).filter(Boolean);
  const keys = collectLookupKeys(rawKeys);
  const rows = [];
  for (let index = 0; index < keys.length; index += 250) {
    const { data, error } = await client.from('products').select('*').in('sku', keys.slice(index, index + 250));
    if (error) throw error;
    rows.push(...(data || []));
  }
  return rows;
}

export default async function handler(req, res) {
  if (!(await requireAdminKey(req, res))) return;
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const periodDays = parsePeriod(req.query.period);
  const cutoff = new Date(Date.now() - periodDays * 86400000).toISOString();
  const admin = adminClient();
  const { data: orders, error: ordersError } = await admin
    .from('orders')
    .select('id, total_ex_vat, created_at, original_items, final_items, items')
    .gte('created_at', cutoff);
  if (ordersError) return res.status(400).json({ error: ordersError.message });

  let productRows = [];
  const stock = stockClient();
  let costSourceAvailable = Boolean(stock);
  try {
    productRows = await fetchProductsForOrders(stock, orders || []);
  } catch (error) {
    // Revenue remains trustworthy when the optional ERP cost lookup is unavailable.
    costSourceAvailable = false;
    console.warn('product-profitability cost lookup:', error?.message || error);
  }

  const lookup = buildProductLookupMap(productRows);
  const result = buildProductProfitability({
    orders: orders || [],
    findProduct: (sku) => findProductBySku(lookup, sku),
  });

  return res.status(200).json({
    periodDays,
    generatedAt: new Date().toISOString(),
    ...result,
    source: {
      revenue: 'orders.total_ex_vat and saved order line prices',
      cost: result.costAvailable ? `ERP products (${result.costSourceFields.join(', ')})` : null,
      costLookupAvailable: costSourceAvailable,
      supportedCostFields: supportedProductCostFields,
    },
    caveats: [
      'Order revenue is authoritative; product revenue is limited to order lines with a saved unit price.',
      result.costAvailable
        ? 'Gross profit and margin cover only product lines matched to an ERP cost value.'
        : 'Gross profit and margin are unavailable because no supported ERP cost value was found.',
    ],
  });
}
