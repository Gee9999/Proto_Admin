import { requireAdminOrOrderToken } from './_admin-auth.js';
import { notifyNewOrder, resendInternalOrderEmail } from './_order-notify-core.js';

/**
 * Send the full new-order notification round for one order: the alert email
 * to the order team (once) plus the portal PDF/status round
 * notification API.
 */
export default async function handler(req, res) {
  const auth = await requireAdminOrOrderToken(req, res);
  if (!auth) return;
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).end();

  const orderId = String(req.body?.orderId || '').trim();
  if (!orderId) return res.status(400).json({ error: 'orderId is required' });
  const action = String(req.body?.action || 'send-missing').trim();

  if (action === 'resend-internal-email') {
    if (req.body?.confirm !== 'RESEND') {
      return res.status(400).json({ error: 'Explicit resend confirmation is required' });
    }
    try {
      const result = await resendInternalOrderEmail(orderId, {
        actorEmail: auth.user?.email || 'admin-key',
      });
      return res.status(200).json(result);
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Internal order email resend failed' });
    }
  }

  const result = await notifyNewOrder(orderId);
  const status = result.httpStatus && result.httpStatus >= 400 ? result.httpStatus : (result.error ? 500 : 200);
  return res.status(result.error && status < 400 ? 500 : status).json(result);
}
