import { createClient } from '@supabase/supabase-js';
import { fetchCustomerAudience, fetchRecipientsByEmail, sendBroadcastBatch } from './_brevo-email.js';
import { appendEmailCampaign } from './_email-campaigns.js';
import { markCustomersEmailed } from './_customer-email-status.js';

export const VALID_EMAIL_AUDIENCE = new Set(['requests', 'regular', 'proto-active', 'all-portal', 'all-approved', 'selected']);

export function getPortalDbClient() {
  return createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

/**
 * Resolve the audience, send the personalized broadcast, and log the
 * campaign. Shared by the live send endpoint and the scheduled-send cron.
 */
export async function runEmailBroadcast({ audience, subject, introText = '', htmlBlock = '', businessTypes = [], importBatch = '', recipients: recipientEmails = null }) {
  const sb = getPortalDbClient();
  // Explicit recipient list ("Specific people") bypasses audience resolution.
  const useSelected = Array.isArray(recipientEmails) && recipientEmails.length > 0;
  const recipients = useSelected
    ? await fetchRecipientsByEmail(sb, recipientEmails.map((r) => (typeof r === 'string' ? r : r?.email)))
    : await fetchCustomerAudience(sb, audience, {
      businessTypes: Array.isArray(businessTypes) ? businessTypes : [],
      importBatch,
    });
  if (!recipients.length) {
    return {
      ok: false,
      sent: 0,
      failed: 0,
      total: 0,
      error: useSelected
        ? 'No valid email addresses in the list.'
        : 'No customers with valid email addresses in this audience.',
    };
  }

  const { sent, failed, errors, messageIds } = await sendBroadcastBatch(recipients, {
    subject,
    introText,
    htmlBlock,
  });

  try {
    await appendEmailCampaign({
      subject,
      audience,
      businessTypes: Array.isArray(businessTypes) ? businessTypes.filter(Boolean) : [],
      sentAt: new Date().toISOString(),
      recipientCount: recipients.length,
      sent,
      failed,
      messageIds: messageIds || [],
      events: {},
    });
  } catch (logErr) {
    console.error('runEmailBroadcast: campaign log failed:', logErr?.message || logErr);
  }

  // Stamp the per-customer "last email sent" status (best-effort, analytics only).
  try {
    await markCustomersEmailed(sb, recipients.map((r) => r.email), 'campaign');
  } catch { /* best effort */ }

  return { ok: failed === 0, total: recipients.length, sent, failed, errors };
}
