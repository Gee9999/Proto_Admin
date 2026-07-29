import { requireAdminKey } from './_admin-auth.js';
import { PROTO_URLS } from './_proto-urls.js';
import { readSiteConfigJson } from './_site-config.js';
import {
  normalizeWhatsapp,
  sanitizeTemplateParam,
  watiConfig,
  watiEnsureContact,
  watiSendTemplate,
  watiSendSessionMessage,
  shouldUseSessionBackup,
  formatNotifyError,
  isUtilityOrderTemplate,
} from './_wati-notify.js';

const USERS_FILE = 'fulfillment/users.json';

/**
 * Sends a test order notification (template + optional session message) to every
 * fulfillment team member using the exact same WATI calls as a real order.
 */
export default async function handler(req, res) {
  if (!(await requireAdminKey(req, res))) return;
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).end();

  const { baseUrl, token } = watiConfig();
  if (!token) {
    return res.status(503).json({ error: 'WATI_API_TOKEN is not configured on the admin portal.' });
  }

  const data = await readSiteConfigJson(USERS_FILE, { users: [] });
  const recipients = (data.users || [])
    .filter((u) => u?.orderAlerts !== false)
    .map((u) => ({ name: String(u.name || '').trim(), phone: normalizeWhatsapp(u.whatsapp || u.phone || '') }))
    .filter((u) => u.phone);

  if (!recipients.length) {
    return res.status(400).json({ error: 'No team members have active WhatsApp order alerts.' });
  }

  const templateName = process.env.WATI_ORDER_TEMPLATE || 'proto_order_notis';
  const now = new Date().toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const adminUrl = PROTO_URLS.admin;

  const results = [];
  for (const r of recipients) {
    const detail = { name: r.name, phone: `+${r.phone}`, template: null, session: null, sessionAttempted: false };

    try {
      await watiEnsureContact(baseUrl, token, r.phone, r.name);
    } catch { /* contact may already exist */ }

    const templateResult = await watiSendTemplate(baseUrl, token, r.phone, [
      { name: '1', value: sanitizeTemplateParam(now, 120) },
      { name: '2', value: sanitizeTemplateParam('Proto Admin — TEST', 120) },
      { name: '3', value: sanitizeTemplateParam('This is a test of the order notification. No action needed.', 900) },
      { name: '4', value: sanitizeTemplateParam(adminUrl, 900) },
    ], templateName);

    detail.template = {
      ok: templateResult.success,
      error: templateResult.error || null,
      messageId: templateResult.messageId || null,
    };

    const sessionAttempted = shouldUseSessionBackup(templateResult.success);
    detail.sessionAttempted = sessionAttempted;

    if (sessionAttempted) {
      const text = `🧪 *Proto test notification*\nSent ${now} from the admin dashboard. If you can read this, order alerts reach you.`;
      const sessionResult = await watiSendSessionMessage(baseUrl, token, r.phone, text);
      detail.session = {
        ok: sessionResult.success,
        error: sessionResult.error || null,
      };
    }

    detail.ok = Boolean(detail.template?.ok || detail.session?.ok);
    if (!detail.ok) {
      detail.error = formatNotifyError({
        templateError: detail.template?.error || null,
        sessionError: detail.session?.error || null,
        sessionAttempted,
      });
    }
    results.push(detail);
  }

  const sent = results.filter((r) => r.ok).length;
  return res.status(200).json({
    ok: sent === results.length,
    template: templateName,
    templateCategory: isUtilityOrderTemplate() ? 'UTILITY' : 'MARKETING',
    teamSize: results.length,
    sent,
    failed: results.length - sent,
    results,
  });
}
