import { createClient } from '@supabase/supabase-js';
import { requireAdminKey } from './_admin-auth.js';

function getAdminClient() {
  return createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

export default async function handler(req, res) {
  if (!(await requireAdminKey(req, res))) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const limit = Math.min(Math.max(parseInt(req.query?.limit || '100', 10), 1), 250);
  const supabase = getAdminClient();
  const { data, error } = await supabase.from('customer_feedback').select('id, customer_id, product_id, product_code, product_label, reason, detail, created_at').order('created_at', { ascending: false }).limit(limit);
  if (error) {
    if (error.code === '42P01') return res.status(200).json({ configured: false, items: [], summary: [] });
    return res.status(400).json({ error: 'Failed to load feedback' });
  }
  const summaryMap = new Map();
  (data || []).forEach((row) => summaryMap.set(row.reason, (summaryMap.get(row.reason) || 0) + 1));
  return res.status(200).json({ configured: true, items: data || [], summary: [...summaryMap.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count) });
}
