/**
 * Contacts, read from OUR ledger — not from WATI.
 *
 * Every column the table shows (last message sent, its delivery status, when
 * they last replied) is a stored value maintained by the migration-060 trigger.
 * The old build paginated all of WATI and then fired one getMessages call per
 * visible row on every render; this is a single indexed query.
 */

import { requireAdminKey } from './_admin-auth.js';
import { portalDb, sessionOpen, sessionMsRemaining } from './_whatsapp-db.js';

const MAX_PAGE_SIZE = 100;

export default async function handler(req, res) {
  if (!(await requireAdminKey(req, res))) return;
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const db = portalDb();
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(10, Number(req.query.pageSize || 50)));
    const search = String(req.query.search || '').trim();
    const businessTypes = [].concat(req.query.businessType || []).filter(Boolean);
    const scope = String(req.query.scope || 'all'); // all | broadcastable | unread | inbox

    let q = db
      .from('whatsapp_contacts')
      .select(
        'phone, wa_name, customer_id, business_type, accept_whatsapp, opted_in_at, allow_broadcast,'
        + ' contact_status, is_team, last_outbound_at, last_outbound_template, last_outbound_body,'
        + ' last_outbound_status, last_inbound_at, last_inbound_preview, session_expires_at,'
        + ' unread_count, inbound_count, outbound_count, first_seen_at',
        { count: 'exact' },
      )
      .eq('is_team', false);

    if (scope === 'broadcastable') q = q.eq('accept_whatsapp', true).eq('allow_broadcast', true);
    if (scope === 'unread') q = q.gt('unread_count', 0);
    if (scope === 'inbox') q = q.not('last_inbound_at', 'is', null);

    if (businessTypes.length) q = q.in('business_type', businessTypes);

    if (search) {
      // Escape LIKE wildcards so a '%' typed in the search box is a literal.
      const term = search.replace(/[%_]/g, (m) => `\\${m}`);
      q = q.or(`phone.ilike.%${term}%,wa_name.ilike.%${term}%`);
    }

    // Inbox sorts by conversation recency; every other view by newest contact activity.
    const orderCol = scope === 'inbox' ? 'last_inbound_at' : 'last_outbound_at';
    q = q.order(orderCol, { ascending: false, nullsFirst: false })
      .range((page - 1) * pageSize, (page - 1) * pageSize + pageSize - 1);

    const { data, error, count } = await q;
    if (error) throw new Error(error.message);

    const contacts = (data || []).map((c) => ({
      ...c,
      phoneDisplay: `+${c.phone}`,
      sessionOpen: sessionOpen(c),
      sessionMsRemaining: sessionMsRemaining(c),
    }));

    return res.status(200).json({ contacts, page, pageSize, total: count ?? contacts.length });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to load WhatsApp contacts' });
  }
}
