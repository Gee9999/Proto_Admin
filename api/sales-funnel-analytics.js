import { createClient } from '@supabase/supabase-js';
import { requireAdminKey } from './_admin-auth.js';
import { normalizeOrderStatus } from './_order-status.js';
import {
  buildSalesFunnelStages,
  measuredCoverage,
  parseSalesFunnelPeriod,
  salesFunnelStartDate,
} from '../lib/sales-funnel.mjs';

function getAdminClient() {
  return createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

function countResult(result, unavailableMessage) {
  if (result.error) return { available: false, count: null, reason: unavailableMessage };
  return { available: true, count: result.count || 0 };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireAdminKey(req, res))) return;

  if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: 'Supabase env not configured on this deployment' });
  }

  const periodDays = parseSalesFunnelPeriod(req.query?.period);
  const startDate = salesFunnelStartDate(periodDays);
  const supabase = getAdminClient();

  try {
    const [searchesRes, productViewsRes, cartsRes, ordersRes] = await Promise.all([
      supabase.from('search_analytics').select('id', { count: 'exact', head: true }).gte('created_at', startDate),
      supabase.from('analytics_events').select('event_type', { count: 'exact', head: true }).eq('event_type', 'product_view').gte('created_at', startDate),
      supabase.from('search_analytics').select('id', { count: 'exact', head: true }).eq('added_to_cart', true).gte('created_at', startDate),
      supabase.from('orders').select('status').gte('created_at', startDate),
    ]);

    const paidOrders = ordersRes.error
      ? { available: false, count: null, reason: 'Order data is unavailable.' }
      : {
          available: true,
          count: (ordersRes.data || []).filter((order) => normalizeOrderStatus(order.status) === 'payment received').length,
        };

    const stages = buildSalesFunnelStages({
      searches: countResult(searchesRes, 'Search tracking is not available in this environment.'),
      productViews: countResult(productViewsRes, 'Product-view tracking is not available in this environment.'),
      carts: countResult(cartsRes, 'Search-attributed cart tracking is not available in this environment.'),
      paidOrders,
    });

    const warnings = stages
      .filter((stage) => !stage.available)
      .map((stage) => `${stage.label}: ${stage.detail}`);

    return res.status(200).json({
      periodDays,
      generatedAt: new Date().toISOString(),
      stages,
      coverage: measuredCoverage(stages),
      warnings,
      interpretation: 'Stage volumes use different event grains. They should not be treated as a unique-visitor conversion funnel.',
    });
  } catch (error) {
    console.error('sales-funnel-analytics GET:', error?.message || error);
    return res.status(500).json({ error: 'Failed to load sales funnel analytics' });
  }
}
