import { createHash, timingSafeEqual } from 'node:crypto';
import { readOrderNotifyLog, readSiteConfigJson, writeOrderNotifyLog } from './_site-config.js';

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

function messageIndexFile(messageId) {
  const digest = createHash('sha256').update(String(messageId)).digest('hex');
  return `orders/notify-index/${digest}.json`;
}

function messageIds(payload) {
  return [...new Set([
    payload?.localMessageId,
    payload?.whatsappMessageId,
    payload?.messageId,
    payload?.id,
  ].map((value) => String(value || '').trim()).filter(Boolean))];
}

export function normalizeWatiDeliveryEvent(payload = {}) {
  const raw = `${payload.eventType || ''} ${payload.statusString || ''}`.toLowerCase();
  if (/read|replied/.test(raw)) return 'read';
  if (/deliver/.test(raw)) return 'delivered';
  if (/fail|undeliverable|reject/.test(raw)) return 'failed';
  if (/sent|template.*message/.test(raw)) return 'sent';
  return 'unknown';
}

function eventTime(payload) {
  const raw = payload?.timestamp || payload?.created || payload?.time;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) {
    return new Date(numeric < 1e12 ? numeric * 1000 : numeric).toISOString();
  }
  const date = raw ? new Date(raw) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function appendHistory(log, event) {
  return [...(Array.isArray(log?.deliveryHistory) ? log.deliveryHistory : []), event].slice(-25);
}

async function applyDeliveryEvent(payload) {
  const status = normalizeWatiDeliveryEvent(payload);
  if (status === 'unknown') return { matched: false, reason: 'unsupported-event' };

  let index = null;
  let matchedMessageId = null;
  for (const messageId of messageIds(payload)) {
    const candidate = await readSiteConfigJson(messageIndexFile(messageId), null);
    if (candidate?.orderId) {
      index = candidate;
      matchedMessageId = messageId;
      break;
    }
  }
  if (!index?.orderId) return { matched: false, reason: 'message-not-indexed' };

  const previous = await readOrderNotifyLog(index.orderId);
  if (!previous) return { matched: false, reason: 'order-log-not-found' };
  const at = eventTime(payload);
  const ids = new Set(messageIds(payload));
  if (index.messageId) ids.add(String(index.messageId));

  const details = (previous.sentDetails || []).map((entry) => {
    if (!ids.has(String(entry.messageId || ''))) return entry;
    return {
      ...entry,
      deliveryStatus: status,
      deliveryUpdatedAt: at,
      deliveryFailureCode: payload.failedCode || null,
      deliveryFailureReason: payload.failedDetail || null,
    };
  });
  const accepted = Number(previous.accepted ?? previous.sent ?? details.length);
  const delivered = details.filter((entry) => ['delivered', 'read'].includes(entry.deliveryStatus)).length;
  const read = details.filter((entry) => entry.deliveryStatus === 'read').length;
  const deliveryFailed = details.filter((entry) => entry.deliveryStatus === 'failed').length;

  await writeOrderNotifyLog(index.orderId, {
    ...previous,
    sentDetails: details,
    accepted,
    delivered,
    read,
    deliveryFailed,
    deliveryConfirmed: accepted > 0 && delivered === accepted,
    whatsappLastEventAt: at,
    deliveryHistory: appendHistory(previous, {
      type: 'whatsapp-status',
      status,
      ok: status !== 'failed',
      at,
      phone: index.phone || payload.waId || null,
      messageId: matchedMessageId,
      error: payload.failedDetail || null,
      code: payload.failedCode || null,
    }),
  });
  return { matched: true, orderId: index.orderId, status };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const expected = String(process.env.WEBHOOK_SECRET || '').trim();
  const provided = String(
    req.headers['x-webhook-secret']
    || req.headers.authorization?.replace(/^Bearer\s+/i, '')
    || req.query?.secret
    || '',
  ).trim();
  if (!expected || !safeEqual(expected, provided)) {
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }

  const events = Array.isArray(req.body) ? req.body : [req.body || {}];
  const results = [];
  for (const event of events.slice(0, 100)) {
    results.push(await applyDeliveryEvent(event));
  }
  return res.status(200).json({
    ok: true,
    received: events.length,
    matched: results.filter((result) => result.matched).length,
    results,
  });
}
