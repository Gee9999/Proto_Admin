import { requireAdminKey } from './_admin-auth.js';
import { createClient } from '@supabase/supabase-js';
import { matchPositillCandidates, normalizeCode, normalizeCompany, normalizeEmail, normalizePhone } from '../lib/customerPositillMatch.js';

function getAdminClient() {
  return createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

function cleanName(value) { return String(value || '').trim(); }
function escapeIlike(value) { return String(value || '').replace(/[\\%_]/g, '\\$&'); }

/** Read-only advisory link from an online customer application to Positill snapshot. */
export default async function handler(req, res) {
  if (!(await requireAdminKey(req, res))) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET required' });
  const customerId = cleanName(req.query.customerId);
  if (!customerId) return res.status(400).json({ error: 'customerId required' });

  try {
    const sb = getAdminClient();
    const { data: application, error: appError } = await sb.from('customers').select('id,name,business_name,email,phone,claimed_customer_code,customer_code').eq('id', customerId).maybeSingle();
    if (appError) return res.status(400).json({ error: appError.message });
    if (!application) return res.status(404).json({ error: 'Customer application not found' });

    // Query only exact/near-exact keys; never pull the full customer table into
    // the request and never expose SQL credentials or raw bridge responses.
    const code = normalizeCode(application.claimed_customer_code || application.customer_code);
    const email = normalizeEmail(application.email);
    const phone = normalizePhone(application.phone);
    const company = cleanName(application.business_name || application.name);
    const queries = [];
    if (code) queries.push(sb.from('proto_active_customers').select('id,account_code,name,contact_name,email,sales_last_12_months,invoice_count,last_purchase_date').eq('account_code', code));
    if (email) queries.push(sb.from('proto_active_customers').select('id,account_code,name,contact_name,email,sales_last_12_months,invoice_count,last_purchase_date').eq('email', email));
    // Escape wildcard characters so a customer-supplied business name cannot
    // turn this exact-name lookup into a broad table scan.
    if (company.length >= 4) queries.push(sb.from('proto_active_customers').select('id,account_code,name,contact_name,email,sales_last_12_months,invoice_count,last_purchase_date').ilike('name', escapeIlike(company)));
    const results = await Promise.all(queries);
    const candidates = [...new Map(results.flatMap((result) => result.data || []).map((row) => [row.id, row])).values()];
    const matched = matchPositillCandidates(application, candidates);
    const snapshotFields = ['account_code', 'email', 'name', 'sales_last_12_months', 'invoice_count', 'last_purchase_date'];
    return res.status(200).json({
      ok: true,
      readOnly: true,
      source: 'proto_active_customers',
      sourceLabel: 'Imported Positill customer snapshot',
      snapshotFields,
      unavailableFields: phone ? ['phone (not present in current Positill snapshot)'] : [],
      application: { id: application.id, email: application.email || null, phone: application.phone || null, businessName: application.business_name || application.name || null },
      matches: matched.matches.map(({ candidate, score, confidence, evidence }) => ({ candidate, score, confidence, evidence })),
      ambiguous: matched.ambiguous,
      recommendation: matched.recommendation,
      safeguards: ['Advisory evidence only — staff must verify before linking.', 'No customer, account or SQL data was changed.'],
    });
  } catch (error) {
    console.error('customer-positill-match:', error?.message || error);
    return res.status(500).json({ error: 'Could not load Positill match evidence' });
  }
}
