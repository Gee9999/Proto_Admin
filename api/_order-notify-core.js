import { createClient } from '@supabase/supabase-js';
import { PROTO_URLS } from './_proto-urls.js';
import { sendBrevoTransactional } from './_brevo-email.js';
import { readOrderNotifyLog, writeOrderNotifyLog } from './_site-config.js';

export const NEW_ORDER_ALERT_EMAIL = process.env.NEW_ORDER_ALERT_EMAIL || 'online@proto.co.za';

function getPortalDbClient() {
  return createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function orderAmountExVat(order) {
  const total = Number(order?.total_ex_vat);
  if (Number.isFinite(total) && total > 0) return total;
  const items = (order?.final_items?.length ? order.final_items : null)
    || order?.original_items || order?.items || [];
  let sum = 0;
  for (const item of items) {
    const qty = Number(item?.qty ?? item?.quantity ?? 0);
    const price = Number(item?.unitPrice ?? item?.price ?? 0);
    if (Number.isFinite(qty) && Number.isFinite(price)) sum += qty * price;
  }
  return sum;
}

function formatRand(value) {
  return `R ${Number(value || 0).toFixed(2)}`;
}

async function sendNewOrderAlertEmail(order) {
  const customer = order.customers || {};
  const orderNo = order.order_number || order.id;
  const amount = formatRand(orderAmountExVat(order));
  const placedAt = order.created_at
    ? new Date(order.created_at).toLocaleString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';
  const items = (order.original_items || order.items || []);
  const itemRows = items.slice(0, 30).map((item) => `
    <tr>
      <td style="padding:4px 8px;border-bottom:1px solid #e5e7eb;">${esc(item?.name || item?.title || item?.sku || '')}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">${esc(item?.qty ?? item?.quantity ?? '')}</td>
    </tr>`).join('');

  const htmlContent = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;line-height:1.5;color:#111827;max-width:640px;margin:0 auto;padding:24px;">
  <h2 style="margin:0 0 8px;">New order ${esc(orderNo)}</h2>
  <p style="margin:0 0 16px;color:#374151;">
    <strong>${esc(customer.name || customer.business_name || 'Unknown customer')}</strong>
    ${customer.email ? ` · ${esc(customer.email)}` : ''}<br/>
    ${placedAt ? `Placed ${esc(placedAt)} · ` : ''}Total <strong>${esc(amount)}</strong> ex VAT
  </p>
  ${itemRows ? `<table style="border-collapse:collapse;width:100%;font-size:13px;"><tbody>${itemRows}</tbody></table>` : ''}
  ${items.length > 30 ? `<p style="font-size:12px;color:#6b7280;">+ ${items.length - 30} more line(s)</p>` : ''}
  <p style="margin:20px 0 0;">
    <a href="${PROTO_URLS.admin}" style="display:inline-block;background:#c40000;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:bold;">Open admin portal</a>
  </p>
</body></html>`;

  await sendBrevoTransactional({
    to: { email: NEW_ORDER_ALERT_EMAIL, name: 'Proto Trading Orders' },
    subject: `New order ${orderNo} — ${customer.name || customer.business_name || 'Unknown'} — ${amount}`,
    htmlContent,
    textContent: `New order ${orderNo} from ${customer.name || 'Unknown'} — total ${amount} ex VAT.`,
  });
}

/**
 * A new order counts as fully notified once the new-order email went out and
 * the team WhatsApp round completed without failures. When WhatsApp is not
 * possible at all (no WATI token / no team numbers), the email alone unblocks
 * the workflow so orders cannot deadlock on a config outage.
 */
export function isOrderNotifyComplete(log) {
  if (!log || (!log.found && log.sent == null)) {
    return { ok: false, reason: 'No new-order notification has been sent for this order yet' };
  }
  const emailOk = !!log.emailSent;
  const teamSize = Number(log.teamSize);
  const sentToWholeTeam = Number(log.sent) > 0
    && Number(log.failed || 0) === 0
    && (!Number.isFinite(teamSize) || teamSize <= 0 || Number(log.sent) >= teamSize);
  const whatsappOk = !!log.statusAdvanced
    || sentToWholeTeam
    || !!log.skippedNoToken
    || !!log.skippedNoTeam
    // WhatsApp isn't wired up on this install (no ORDER_NOTIFY_SECRET) — the
    // alert email alone is enough to release the order.
    || !!log.whatsappNotConfigured;
  if (!emailOk) {
    return { ok: false, reason: `The new-order email to ${NEW_ORDER_ALERT_EMAIL} has not been sent yet` };
  }
  if (!whatsappOk) {
    return { ok: false, reason: 'Not all team WhatsApp notifications were delivered' };
  }
  return { ok: true };
}

/**
 * Send the new-order email (once) and trigger the team WhatsApp round via the
 * main portal notify endpoint, which also advances the order to Handed Over
 * when every message lands.
 */
export async function notifyNewOrder(orderId) {
  const supabase = getPortalDbClient();
  const { data: order, error } = await supabase
    .from('orders')
    .select('*, customers(name, contact_name, email, business_name)')
    .eq('id', orderId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!order) return { ok: false, error: 'order_not_found' };

  const log = await readOrderNotifyLog(String(orderId));
  let emailSent = !!log?.emailSent;
  let emailError = null;
  if (!emailSent) {
    try {
      await sendNewOrderAlertEmail(order);
      emailSent = true;
    } catch (err) {
      emailError = err.message || 'email_failed';
    }
  }

  const secret = process.env.ORDER_NOTIFY_SECRET;
  if (!secret) {
    // No team-WhatsApp link configured. Record an email-only round so the
    // order can still leave "New" on the strength of the alert email, and the
    // dashboard shows an honest status instead of an empty log.
    await writeOrderNotifyLog(orderId, {
      found: true,
      emailSent,
      emailError,
      alertEmail: NEW_ORDER_ALERT_EMAIL,
      whatsappNotConfigured: true,
      sent: 0,
      failed: 0,
      teamSize: 0,
      at: new Date().toISOString(),
    }).catch(() => {});
    return {
      ok: emailSent,
      emailSent,
      emailError,
      whatsappNotConfigured: true,
      error: emailSent ? null : (emailError || 'email_failed'),
    };
  }

  try {
    const resp = await fetch(`${PROTO_URLS.site}/api/orders/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-order-notify-secret': secret,
      },
      body: JSON.stringify({ orderId, emailSent }),
    });
    const data = await resp.json().catch(() => ({}));
    return { httpStatus: resp.status, ...data, emailSent, emailError };
  } catch (err) {
    return { ok: false, emailSent, emailError, error: err.message || 'Order notification failed' };
  }
}
