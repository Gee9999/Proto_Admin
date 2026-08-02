/**
 * WhatsApp ledger access (migration 060).
 *
 * Every read the dashboard does comes from here, not from WATI. That is the
 * whole point of the design: "what did we last send this contact and did it
 * land" is a column we own, not a live API scrape of a contact attribute.
 */

import { createClient } from '@supabase/supabase-js';
import { normalizePhone } from './_phone.js';

/** WhatsApp's customer-service window: free-form replies only within 24h of their last message. */
export const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

export function portalDb() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export function sessionOpen(contact) {
  const expires = contact?.session_expires_at ? Date.parse(contact.session_expires_at) : 0;
  return Boolean(expires) && expires > Date.now();
}

export function sessionMsRemaining(contact) {
  const expires = contact?.session_expires_at ? Date.parse(contact.session_expires_at) : 0;
  return Math.max(0, expires - Date.now());
}

export async function getContact(db, phone) {
  const { data, error } = await db
    .from('whatsapp_contacts')
    .select('*')
    .eq('phone', normalizePhone(phone))
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

export async function ensureContact(db, phone, patch = {}) {
  const digits = normalizePhone(phone);
  if (!digits) throw new Error('Invalid phone number');
  const { data, error } = await db
    .from('whatsapp_contacts')
    .upsert({ phone: digits, ...patch }, { onConflict: 'phone' })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Record a message. The rollup trigger updates the contact + broadcast counters,
 * so callers never write those fields themselves.
 *
 * Idempotent on wa_message_id: a retried webhook returns the existing row
 * instead of creating a duplicate.
 */
export async function logMessage(db, {
  phone, direction, waMessageId = null, body = '', messageType = 'text',
  templateName = null, broadcastId = null, status, error = null, sentBy = null, raw = null,
}) {
  const digits = normalizePhone(phone);
  const row = {
    phone: digits,
    direction,
    wa_message_id: waMessageId,
    body,
    message_type: messageType,
    template_name: templateName,
    broadcast_id: broadcastId,
    status: status || (direction === 'in' ? 'received' : 'queued'),
    error,
    sent_by: sentBy,
    raw,
  };
  if (row.status === 'sent') row.sent_at = new Date().toISOString();
  if (row.status === 'failed') row.failed_at = new Date().toISOString();

  const { data, error: insErr } = await db
    .from('whatsapp_messages')
    .insert(row)
    .select()
    .single();

  if (insErr) {
    // 23505 = unique_violation on wa_message_id → this webhook is a replay.
    if (insErr.code === '23505' && waMessageId) {
      const { data: existing } = await db
        .from('whatsapp_messages')
        .select('*')
        .eq('wa_message_id', waMessageId)
        .maybeSingle();
      if (existing) return { message: existing, duplicate: true };
    }
    throw new Error(insErr.message);
  }
  return { message: data, duplicate: false };
}

/** Move an outbound message up the status ladder. Never demotes (see wa_apply_status). */
export async function applyStatus(db, waMessageId, status, at = new Date(), errorText = null) {
  const { data, error } = await db.rpc('wa_apply_status', {
    p_wa_message_id: waMessageId,
    p_status: status,
    p_at: new Date(at).toISOString(),
    p_error: errorText,
  });
  if (error) throw new Error(error.message);
  return data; // message id, or null when we don't know this message
}

/** Attach the WATI message id to a row we queued before the send returned. */
export async function attachWaMessageId(db, messageId, waMessageId) {
  if (!waMessageId) return;
  const { error } = await db
    .from('whatsapp_messages')
    .update({ wa_message_id: waMessageId })
    .eq('id', messageId)
    .is('wa_message_id', null);
  // A unique violation here means the webhook beat us to it — harmless.
  if (error && error.code !== '23505') throw new Error(error.message);
}

export async function markRead(db, phone) {
  const { error } = await db
    .from('whatsapp_contacts')
    .update({ unread_count: 0, updated_at: new Date().toISOString() })
    .eq('phone', normalizePhone(phone));
  if (error) throw new Error(error.message);
}

/**
 * Resolve the broadcast audience through the SQL function so the composer's
 * preview count and the worker's actual send list can never diverge.
 * Gate is customers.accept_whatsapp — mirrored onto the contact by wa-sync.
 */
export async function resolveAudience(db, { businessTypes = [], search = '' } = {}) {
  const { data, error } = await db.rpc('wa_broadcast_audience', {
    p_business_types: businessTypes.length ? businessTypes : null,
    p_search: search || null,
  });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function storeWebhookEvent(db, { eventKey, eventType, phone, payload }) {
  const { data, error } = await db
    .from('whatsapp_webhook_events')
    .insert({
      event_key: eventKey || null,
      event_type: eventType || null,
      phone: phone ? normalizePhone(phone) : null,
      payload,
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') return { id: null, duplicate: true };
    throw new Error(error.message);
  }
  return { id: data.id, duplicate: false };
}

export async function finishWebhookEvent(db, id, handlerError = null) {
  if (!id) return;
  await db
    .from('whatsapp_webhook_events')
    .update({ handled: !handlerError, handler_error: handlerError })
    .eq('id', id);
}
