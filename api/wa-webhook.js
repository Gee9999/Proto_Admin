/**
 * WATI inbound webhook — the only way messages and delivery state enter our DB.
 *
 * Auth: shared secret in a HEADER compared with timingSafeEqual, mirroring
 * api/brevo-email-webhook.js. The previous WhatsApp build took the secret in the
 * query string with a plain `!==` compare, which leaked it into Vercel/proxy
 * access logs on every call (security review M2). Not repeating that.
 *
 * Every payload is stored raw in whatsapp_webhook_events BEFORE parsing, so a
 * shape we guessed wrong can be replayed and re-parsed rather than lost. This
 * matters because the WATI payload shapes here were written from the API docs,
 * not from observed production traffic.
 *
 * Configure in WATI → Settings → Webhooks:
 *   URL:    https://protoportal-admin.vercel.app/api/wa-webhook
 *   Header: x-webhook-secret: <WA_WEBHOOK_SECRET>
 */

import { timingSafeEqual } from 'crypto';
import { normalizePhone } from './_phone.js';
import {
  portalDb, logMessage, applyStatus, storeWebhookEvent, finishWebhookEvent,
} from './_whatsapp-db.js';

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}

/** WATI event name → our status ladder rung. Unlisted events are ignored. */
const STATUS_EVENTS = {
  sentmessage: 'sent',
  messagesent: 'sent',
  templatemessagesent: 'sent',
  sessionmessagesent: 'sent',
  deliveredmessage: 'delivered',
  messagedelivered: 'delivered',
  readmessage: 'read',
  messageread: 'read',
  failedmessage: 'failed',
  messagefailed: 'failed',
  templatemessagefailed: 'failed',
  undeliveredmessage: 'failed',
};

const INBOUND_EVENTS = new Set([
  'message', 'newcontactmessagereceived', 'messagereceived', 'replymessage', 'sessionmessagereceived',
]);

function eventName(p) {
  return String(p.eventType || p.event || p.type || '').trim().toLowerCase();
}

/** WATI has shipped several payload shapes; accept all of them. */
function extractPhone(p) {
  return normalizePhone(
    p.waId || p.wAid || p.whatsappNumber || p.phone || p.from
    || p.contact?.phone || p.contacts?.[0]?.wa_id || '',
  );
}

function extractText(p) {
  if (typeof p.text === 'string' && p.text) return p.text;
  return p.text?.body
    || p.message?.text?.body
    || p.messages?.[0]?.text?.body
    || p.messageText
    || p.body
    || p.buttonText
    || p.buttonReply?.text
    || p.interactive?.button_reply?.title
    || p.listReply?.title
    || '';
}

function extractWaMessageId(p) {
  return p.whatsappMessageId || p.messageId || p.id || p.message?.id || p.messages?.[0]?.id || null;
}

function extractTimestamp(p) {
  const raw = p.timestamp || p.created || p.eventTime || p.time;
  if (!raw) return new Date();
  // WATI sends both ISO strings and unix seconds.
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber) && asNumber > 1_000_000_000) {
    return new Date(asNumber < 1e12 ? asNumber * 1000 : asNumber);
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function messageKind(p) {
  return String(p.messageType || p.type || 'text').toLowerCase().includes('image') ? 'image'
    : String(p.messageType || 'text').toLowerCase();
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // WATI probes the URL with a GET when you save it.
  if (req.method === 'GET' || req.method === 'HEAD') return res.status(200).json({ ok: true });
  if (req.method !== 'POST') return res.status(405).end();

  const expected = process.env.WA_WEBHOOK_SECRET;
  if (!expected) {
    // Fail closed: an unauthenticated write path into the message ledger would
    // let anyone forge customer conversations.
    return res.status(503).json({ error: 'WA_WEBHOOK_SECRET is not configured' });
  }
  // Header is preferred (it stays out of access logs). WATI's webhook UI has no
  // custom-header field, so a `?secret=` query fallback is accepted — compared
  // in constant time either way. Tradeoff, accepted knowingly: the secret then
  // appears in Vercel/proxy access logs. Worst case for a leak is forged
  // INBOUND rows in the ledger (no send capability, no account access), and the
  // value is rotatable independently of WATI_API_TOKEN. Prefer the header if a
  // future WATI plan exposes one.
  const provided = String(
    req.headers['x-webhook-secret'] || req.query?.secret || '',
  ).trim();
  if (!safeEqual(provided, expected)) return res.status(401).json({ error: 'Unauthorised' });

  const payload = req.body || {};
  const name = eventName(payload);
  const phone = extractPhone(payload);
  const waMessageId = extractWaMessageId(payload);

  let db;
  let eventRow = { id: null, duplicate: false };
  try {
    db = portalDb();
    eventRow = await storeWebhookEvent(db, {
      // Prefer a provider id so retries dedupe; fall back to a composite.
      eventKey: payload.eventId || (waMessageId && name ? `${name}:${waMessageId}` : null),
      eventType: name,
      phone,
      payload,
    });
    // Already ingested this exact event — ack and stop.
    if (eventRow.duplicate) return res.status(200).json({ ok: true, duplicate: true });
  } catch (err) {
    // If we cannot even store the raw event, tell WATI to retry.
    return res.status(500).json({ error: err.message || 'store_failed' });
  }

  try {
    const at = extractTimestamp(payload);

    if (STATUS_EVENTS[name]) {
      if (!waMessageId) {
        await finishWebhookEvent(db, eventRow.id, 'status event without message id');
        return res.status(200).json({ ok: true, ignored: 'no_message_id' });
      }
      const status = STATUS_EVENTS[name];
      const errText = status === 'failed'
        ? String(payload.failureReason || payload.info || payload.error || 'WATI reported failure')
        : null;
      const matched = await applyStatus(db, waMessageId, status, at, errText);
      await finishWebhookEvent(db, eventRow.id, matched ? null : 'no matching outbound message');
      return res.status(200).json({ ok: true, status, matched: Boolean(matched) });
    }

    if (INBOUND_EVENTS.has(name) || (!name && phone)) {
      const text = extractText(payload);
      if (!phone) {
        await finishWebhookEvent(db, eventRow.id, 'inbound without phone');
        return res.status(200).json({ ok: true, ignored: 'no_phone' });
      }
      // Media-only messages have no text but still count as a reply and still
      // reopen the 24h window, so they are logged with an empty body.
      const { duplicate } = await logMessage(db, {
        phone,
        direction: 'in',
        waMessageId,
        body: text,
        messageType: messageKind(payload),
        status: 'received',
        raw: payload,
      });
      await finishWebhookEvent(db, eventRow.id, null);
      return res.status(200).json({ ok: true, inbound: true, duplicate });
    }

    // Unrecognised event: kept raw, marked handled so it doesn't look like a bug.
    await finishWebhookEvent(db, eventRow.id, null);
    return res.status(200).json({ ok: true, ignored: name || 'unknown_event' });
  } catch (err) {
    await finishWebhookEvent(db, eventRow.id, err.message || 'handler_failed').catch(() => {});
    // 200 so WATI doesn't hammer us — the raw event is stored and replayable.
    return res.status(200).json({ ok: false, error: err.message || 'handler_failed' });
  }
}
