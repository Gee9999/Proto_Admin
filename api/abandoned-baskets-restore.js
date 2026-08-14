import { createClient } from '@supabase/supabase-js';
import { requireAdminKey } from './_admin-auth.js';

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

function serviceClient() {
  return createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
export default async function handler(req, res) {
  if (!(await requireAdminKey(req, res))) return;
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const customerId = String(req.body?.customerId || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(customerId)) {
    return res.status(400).json({ error: 'A valid customer is required' });
  }

  const supabase = serviceClient();
  const { data: row, error: loadError } = await supabase
    .from('customer_account_carts')
    .select('*')
    .eq('customer_id', customerId)
    .maybeSingle();
  if (loadError) return res.status(503).json({ error: loadError.message });
  if (!row || !Array.isArray(row.archived_items) || !row.archived_items.length) {
    return res.status(409).json({ error: 'This customer has no expired basket to restore' });
  }
  if (Array.isArray(row.items) && row.items.length) {
    return res.status(409).json({ error: 'The customer already has an active basket' });
  }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const { data, error } = await supabase
    .from('customer_account_carts')
    .update({
      items: row.archived_items,
      archived_items: [],
      archived_at: null,
      activity_at: now,
      started_at: nowIso,
      expires_at: new Date(now + THREE_DAYS_MS).toISOString(),
      extension_used: true,
      reminder_3d_sent_at: nowIso,
      reminder_1d_sent_at: null,
      revision: Number(row.revision || 0) + 1,
      updated_at: nowIso,
    })
    .eq('customer_id', customerId)
    .eq('revision', row.revision)
    .select('customer_id,expires_at,revision')
    .maybeSingle();
  if (error) return res.status(503).json({ error: error.message });
  if (!data) return res.status(409).json({ error: 'The basket changed before it could be restored' });

  return res.status(200).json({
    ok: true,
    customerId: data.customer_id,
    expiresAt: data.expires_at,
    revision: data.revision,
  });
}
