import { requireAdminKey, verifyAdminUser } from './_admin-auth.js';
import { getPortalAdminClient, readSiteConfigJson } from './_site-config.js';
import { defaultFulfillmentUsers } from './_fulfillment-defaults.js';
import { normalizePhone } from './_phone.js';
import { watiConfig, watiEnsureContact, watiSendNewOrder, NEW_ORDER_TEMPLATE } from './_wati-notify.js';
import { readTeamWhatsappSentMany, writeTeamWhatsappSent } from './_order-team-whatsapp.js';

/**
 * Broadcast "new order received" to the fulfilment team on WhatsApp.
 *
 * GET  ?orderIds=a,b,c  → { sent: { [orderId]: { sentAt, by, recipients } } }
 * POST { orderId }      → sends to every team member with a WhatsApp number
 *
 * Internal only. Recipients come from `fulfillment/users.json`; a customer
 * number can never be reached from here.
 */

const APP_ORIGIN = (process.env.ADMIN_PUBLIC_URL || 'https://admin.proto.co.za').replace(/\/$/, '');

async function loadTeamRecipients() {
  let data = await readSiteConfigJson('fulfillment/users.json', null);
  if (!data?.users?.length) data = defaultFulfillmentUsers();
  const seen = new Set();
  const recipients = [];
  for (const user of data.users || []) {
    const phone = normalizePhone(user.whatsapp || '');
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    recipients.push({ phone, name: user.name || 'Fulfilment' });
  }
  return recipients;
}

export default async function handler(req, res) {
  if (!(await requireAdminKey(req, res))) return;
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    const ids = String(req.query?.orderIds || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!ids.length) return res.status(200).json({ sent: {} });
    try {
      return res.status(200).json({ sent: await readTeamWhatsappSentMany(ids) });
    } catch (err) {
      console.error('order-team-whatsapp GET:', err?.message || err);
      return res.status(200).json({ sent: {} });
    }
  }

  if (req.method !== 'POST') return res.status(405).end();

  const orderId = String(req.body?.orderId || '').trim();
  if (!orderId) return res.status(400).json({ error: 'orderId is required' });

  const { baseUrl, token, configured } = watiConfig();
  if (!configured) {
    // Fail closed and say why — a silent no-op would look like a successful
    // broadcast and the team would never be told about the order.
    return res.status(503).json({ error: 'WATI is not configured (WATI_API_TOKEN missing)' });
  }

  try {
    const supabase = getPortalAdminClient();
    const { data: order, error } = await supabase
      .from('orders')
      .select('id, order_number, customers(name, business_name)')
      .eq('id', orderId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const recipients = await loadTeamRecipients();
    if (!recipients.length) {
      return res.status(400).json({ error: 'No team members have a WhatsApp number set' });
    }

    const customerName = order.customers?.name || order.customers?.business_name || 'Unknown customer';
    const fulfillmentUrl = `${APP_ORIGIN}/fulfillment?id=${encodeURIComponent(order.id)}`;

    const results = [];
    for (const recipient of recipients) {
      await watiEnsureContact(baseUrl, token, recipient.phone, recipient.name);
      let outcome;
      try {
        outcome = await watiSendNewOrder(baseUrl, token, recipient.phone, { customerName, fulfillmentUrl });
      } catch (err) {
        outcome = { success: false, error: err?.message || 'Send threw' };
      }
      results.push({ name: recipient.name, phone: recipient.phone, ok: outcome.success, error: outcome.error || null });
    }

    const delivered = results.filter((r) => r.ok);
    // The tag means "the team was told", so it is only set when at least one
    // message actually landed. An all-failed broadcast leaves the row untagged
    // and re-sendable.
    let record = null;
    if (delivered.length) {
      record = await writeTeamWhatsappSent(order.id, {
        sentAt: new Date().toISOString(),
        by: (await verifyAdminUser(req))?.email || null,
        template: NEW_ORDER_TEMPLATE,
        recipients: results.map(({ name, phone, ok }) => ({ name, phone, ok })),
      });
    }

    return res.status(delivered.length ? 200 : 502).json({
      ok: delivered.length > 0,
      sentCount: delivered.length,
      total: results.length,
      results,
      record,
    });
  } catch (err) {
    console.error('order-team-whatsapp POST:', err?.message || err);
    return res.status(500).json({ error: err.message || 'Failed to send team WhatsApp' });
  }
}
