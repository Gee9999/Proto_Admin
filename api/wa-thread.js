/**
 * One conversation: GET the thread, POST a reply.
 *
 * The 24h rule is enforced server-side, not just hinted at in the UI. WhatsApp
 * only permits free-form ("session") messages within 24 hours of the contact's
 * last inbound message; outside that window only an approved template may be
 * sent. A reply attempted outside the window is rejected with 409 and the
 * reason, rather than being handed to WATI to bounce.
 */

import { requireAdminKey, verifyAdminUser } from './_admin-auth.js';
import { normalizePhone } from './_phone.js';
import { checkRateLimit, clientIp } from './_rate-limit.js';
import { sendSessionMessage, sendTemplate, WatiNotConfigured } from './_wati-client.js';
import {
  portalDb, getContact, logMessage, attachWaMessageId, markRead,
  sessionOpen, sessionMsRemaining,
} from './_whatsapp-db.js';

const THREAD_LIMIT = 200;

export default async function handler(req, res) {
  if (!(await requireAdminKey(req, res))) return;
  res.setHeader('Cache-Control', 'no-store');

  const phone = normalizePhone(req.query.phone || req.body?.phone || '');
  if (!phone) return res.status(400).json({ error: 'phone is required' });

  let db;
  try { db = portalDb(); } catch (err) { return res.status(500).json({ error: err.message }); }

  if (req.method === 'GET') {
    try {
      const contact = await getContact(db, phone);
      const { data, error } = await db
        .from('whatsapp_messages')
        .select('id, direction, body, message_type, template_name, broadcast_id, status, error, sent_by,'
          + ' created_at, sent_at, delivered_at, read_at, failed_at')
        .eq('phone', phone)
        .order('created_at', { ascending: false })
        .limit(THREAD_LIMIT);
      if (error) throw new Error(error.message);

      if (req.query.markRead === 'true') await markRead(db, phone);

      return res.status(200).json({
        contact: contact
          ? { ...contact, phoneDisplay: `+${contact.phone}`,
              sessionOpen: sessionOpen(contact), sessionMsRemaining: sessionMsRemaining(contact) }
          : null,
        messages: (data || []).reverse(), // oldest first for rendering
      });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to load conversation' });
    }
  }

  if (req.method !== 'POST') return res.status(405).end();

  // Manual replies are a send path — throttle them. Nothing in the old build
  // was rate limited at all (security review, posture note).
  const limit = await checkRateLimit({
    bucket: `wa-reply:${clientIp(req)}`, max: 60, windowSeconds: 60,
  });
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfter || 60));
    return res.status(429).json({ error: 'Too many replies, slow down' });
  }

  const text = String(req.body?.text || '').trim();
  const templateName = String(req.body?.templateName || '').trim();
  if (!text && !templateName) return res.status(400).json({ error: 'text or templateName is required' });

  try {
    const contact = await getContact(db, phone);
    const open = sessionOpen(contact);

    // Free-form reply outside the window is not sendable — say so precisely.
    if (text && !templateName && !open) {
      return res.status(409).json({
        error: 'session_closed',
        message: contact?.last_inbound_at
          ? 'The 24-hour reply window closed. Send an approved template instead.'
          : 'This contact has never messaged us, so only an approved template can be sent.',
        lastInboundAt: contact?.last_inbound_at || null,
      });
    }

    const admin = await verifyAdminUser(req);
    const sentBy = admin?.email || 'admin';

    // Queue first so a crash mid-send still leaves a trace in the ledger.
    const { message } = await logMessage(db, {
      phone,
      direction: 'out',
      body: text || `[template] ${templateName}`,
      messageType: templateName ? 'template' : 'text',
      templateName: templateName || null,
      status: 'queued',
      sentBy,
    });

    const result = templateName
      ? await sendTemplate(phone, templateName, req.body?.parameters || [])
      : await sendSessionMessage(phone, text);

    if (!result.success) {
      await db.from('whatsapp_messages')
        .update({ status: 'failed', failed_at: new Date().toISOString(), error: result.error, raw: result.response })
        .eq('id', message.id);
      return res.status(502).json({ error: result.error || 'WATI rejected the message' });
    }

    await db.from('whatsapp_messages')
      .update({ status: 'sent', sent_at: new Date().toISOString(), raw: result.response })
      .eq('id', message.id);
    await attachWaMessageId(db, message.id, result.messageId);

    return res.status(200).json({
      ok: true,
      messageId: message.id,
      waMessageId: result.messageId || null,
      // Delivery is confirmed by webhook, not by this response.
      pending: !result.messageId,
    });
  } catch (err) {
    if (err instanceof WatiNotConfigured) {
      return res.status(503).json({ error: 'WATI_API_TOKEN is not configured' });
    }
    return res.status(500).json({ error: err.message || 'Failed to send reply' });
  }
}
