/**
 * Nightly contact reconcile — cron.
 *
 * Three jobs, in order:
 *   1. Mirror every opted-in customer (customers.accept_whatsapp) into
 *      whatsapp_contacts. This is what makes the audience gate work: opt-in is
 *      OUR data from the registration form, never a WATI contact attribute.
 *   2. Mark fulfilment team numbers so they can never receive a broadcast.
 *   3. Pull WATI's contact list to refresh display names and pick up STOP /
 *      invalid-number states (allow_broadcast, contact_status).
 *
 * Message history is never sourced from here — the webhook owns that. This job
 * only touches identity and eligibility fields, so it can be re-run safely.
 */

import { requireCronOrAdminKey } from './_admin-auth.js';
import { normalizePhone } from './_phone.js';
import { fetchAllContacts, contactPhone, watiConfig } from './_wati-client.js';
import { loadFulfillmentTeamPhones } from './_fulfillment-team.js';
import { portalDb } from './_whatsapp-db.js';

const PAGE = 1000;

export default async function handler(req, res) {
  if (!(await requireCronOrAdminKey(req, res))) return;
  res.setHeader('Cache-Control', 'no-store');

  const db = portalDb();
  const summary = { customersMirrored: 0, optedIn: 0, teamFlagged: 0, watiMatched: 0, watiSkipped: false };

  try {
    // ── 1. customers → whatsapp_contacts ──
    const rows = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db
        .from('customers')
        .select('id, name, business_name, business_type, phone, accept_whatsapp, whatsapp_opt_in_at')
        .not('phone', 'is', null)
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      rows.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }

    // First phone wins if two customers share a number.
    const seen = new Set();
    const upserts = [];
    for (const c of rows) {
      const phone = normalizePhone(c.phone);
      if (!phone || seen.has(phone)) continue;
      seen.add(phone);
      if (c.accept_whatsapp) summary.optedIn += 1;
      upserts.push({
        phone,
        wa_name: c.name || c.business_name || null,
        customer_id: c.id,
        business_type: c.business_type || null,
        accept_whatsapp: Boolean(c.accept_whatsapp),
        opted_in_at: c.whatsapp_opt_in_at || null,
        updated_at: new Date().toISOString(),
      });
    }

    for (let i = 0; i < upserts.length; i += 500) {
      const { error } = await db
        .from('whatsapp_contacts')
        .upsert(upserts.slice(i, i + 500), { onConflict: 'phone' });
      if (error) throw new Error(error.message);
    }
    summary.customersMirrored = upserts.length;

    // ── 2. team numbers are never broadcast targets ──
    const teamPhones = [...(await loadFulfillmentTeamPhones())];
    if (teamPhones.length) {
      const { error } = await db
        .from('whatsapp_contacts')
        .update({ is_team: true, updated_at: new Date().toISOString() })
        .in('phone', teamPhones);
      if (error) throw new Error(error.message);
      summary.teamFlagged = teamPhones.length;
    }

    // ── 3. refresh names + deliverability state from WATI ──
    if (!watiConfig().configured) {
      summary.watiSkipped = true;
    } else {
      const watiContacts = await fetchAllContacts();
      const patches = [];
      for (const wc of watiContacts) {
        const phone = contactPhone(wc);
        if (!phone) continue;
        const status = String(wc.contactStatus || 'UNKNOWN').toUpperCase();
        patches.push({
          phone,
          wa_name: wc.fullName || wc.firstName || null,
          contact_status: status,
          // WATI flips allowBroadcast to false on STOP / opt-out. Honour it.
          allow_broadcast: wc.allowBroadcast !== false,
          wati_synced_at: new Date().toISOString(),
        });
      }
      for (let i = 0; i < patches.length; i += 500) {
        const { error } = await db
          .from('whatsapp_contacts')
          .upsert(patches.slice(i, i + 500), { onConflict: 'phone' });
        if (error) throw new Error(error.message);
      }
      summary.watiMatched = patches.length;
    }

    return res.status(200).json({ ok: true, ...summary });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'WhatsApp sync failed', ...summary });
  }
}
