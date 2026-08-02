/**
 * WATI HTTP client — transport only.
 *
 * WATI is not the source of truth for anything in this feature. Contact state
 * and message history live in our own tables (migration 060); this module just
 * moves bytes to and from WATI and normalises their responses.
 *
 * Deliberately does NOT read or write WATI contact custom params. The previous
 * build kept per-contact state in WATI's own contact attributes; replacing that
 * with columns we own is the point of this rebuild. See migration 060 and the
 * guard in tests/whatsapp-ledger.test.js.
 */

import { normalizePhone } from './_phone.js';

const DEFAULT_BASE = 'https://live-mt-server.wati.io/10138950';

export function watiConfig() {
  const baseUrl = String(process.env.WATI_API_URL || DEFAULT_BASE).replace(/\/$/, '');
  const token = process.env.WATI_API_TOKEN || '';
  return { baseUrl, token, configured: Boolean(token) };
}

export class WatiNotConfigured extends Error {
  constructor() {
    super('WATI_API_TOKEN is not configured');
    this.code = 'wati_not_configured';
  }
}

/** WhatsApp template params cannot contain newlines/tabs or 4+ consecutive spaces. */
export function sanitizeTemplateParam(value, maxLen = 900) {
  let text = String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {4,}/g, '   ')
    .trim();
  if (text.length > maxLen) text = `${text.slice(0, maxLen - 1)}…`;
  return text;
}

async function watiFetch(path, { method = 'GET', body, timeoutMs = 20_000 } = {}) {
  const { baseUrl, token, configured } = watiConfig();
  if (!configured) throw new WatiNotConfigured();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    const text = await res.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text.slice(0, 500) }; }
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

export async function watiRequest(path, opts) {
  const { ok, status, json } = await watiFetch(path, opts);
  if (!ok) {
    const message = json?.info || json?.message || json?.error || `WATI request failed (${status})`;
    const err = new Error(message);
    err.status = status;
    throw err;
  }
  return json;
}

function watiMessageId(json) {
  return json?.messageId
    || json?.whatsappMessageId
    || json?.id
    || json?.localMessageId
    || json?.message?.id
    || null;
}

function watiInfo(json) {
  return String(json?.info || json?.message || json?.error || json?.description || '').trim();
}

/**
 * HTTP 200 from WATI does NOT mean the message was accepted — the old build
 * learned this the hard way. Treat only an explicit success marker or a real
 * message id as a send, and surface WATI's own rejection text otherwise.
 */
export function parseSendResult({ ok, status, json }) {
  const info = watiInfo(json);
  const messageId = watiMessageId(json);
  const flag = json?.result;

  const explicitFail = flag === false
    || json?.ok === false
    || json?.validWhatsAppNumber === false
    || /undeliverable|invalid phone|not a valid whatsapp|template.*not found|rejected|does not exist|opt.?ed out/i.test(info);

  if (explicitFail || !ok) {
    return {
      success: false,
      messageId,
      error: info
        || (json?.validWhatsAppNumber === false ? 'Not a valid WhatsApp number' : null)
        || `WATI send failed (${status})`,
      response: json,
    };
  }

  const explicitSuccess = flag === true
    || json?.ok === true
    || String(flag || '').toLowerCase() === 'success'
    || Boolean(messageId);

  if (explicitSuccess) return { success: true, messageId, error: null, response: json };

  // 200 with no success marker and no id: ambiguous. Treat as sent but keep the
  // payload — the delivery webhook is what will confirm or fail it.
  return { success: true, messageId: null, error: null, response: json, ambiguous: true };
}

/** Send an approved template. Legal at any time, in or out of the 24h window. */
export async function sendTemplate(phone, templateName, parameters = [], broadcastName = templateName) {
  const digits = normalizePhone(phone);
  const result = await watiFetch(
    `/api/v1/sendTemplateMessage?whatsappNumber=${encodeURIComponent(digits)}`,
    { method: 'POST', body: { template_name: templateName, broadcast_name: broadcastName, parameters } },
  );
  return parseSendResult(result);
}

/** Free-form session message. ONLY legal inside the 24h customer-service window. */
export async function sendSessionMessage(phone, messageText) {
  const digits = normalizePhone(phone);
  const text = String(messageText).slice(0, 4090);
  const query = new URLSearchParams({ messageText: text });
  const result = await watiFetch(
    `/api/v1/sendSessionMessage/${encodeURIComponent(digits)}?${query.toString()}`,
    { method: 'POST' },
  );
  return parseSendResult(result);
}

export async function fetchApprovedTemplates() {
  const json = await watiRequest('/api/v1/getMessageTemplates?pageSize=100&pageNumber=1');
  return (json.messageTemplates || [])
    .filter((t) => String(t.status || '').toUpperCase() === 'APPROVED')
    .map((t) => ({
      id: t.id,
      name: t.elementName,
      category: t.category || '',
      language: t.language?.value || t.language?.text || 'en',
      body: typeof t.body === 'string' ? t.body : '',
      footer: typeof t.footer === 'string' ? t.footer : '',
      headerText: t.header?.text || '',
      // Number of {{n}} placeholders — the composer must supply this many params.
      placeholders: (String(t.body || '').match(/\{\{\s*\d+\s*\}\}/g) || []).length,
      buttons: Array.isArray(t.buttons)
        ? t.buttons.map((b, i) => ({
            index: i,
            type: b.type || '',
            text: b.parameter?.text || b.parameter?.url || b.parameter?.phoneNumber || `Button ${i + 1}`,
          }))
        : [],
    }));
}

/** Full contact pagination. Used by the nightly reconcile, never on a page render. */
export async function fetchAllContacts({ pageSize = 100, maxPages = 200 } = {}) {
  const contacts = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const json = await watiRequest(`/api/v1/getContacts?pageSize=${pageSize}&pageNumber=${page}`);
    const batch = json.contact_list || json.contactList || [];
    contacts.push(...batch);
    const total = Number(json.link?.total || json.total || contacts.length);
    if (!batch.length || contacts.length >= total) break;
  }
  return contacts;
}

/** WATI contact → the subset we mirror. Custom params are deliberately ignored. */
export function contactPhone(contact = {}) {
  return normalizePhone(contact.phone || contact.wAid || contact.waId || contact.rcsPhone || '');
}
