import { requireAdminKey } from './_admin-auth.js';
import { readEmailCampaigns } from './_email-campaigns.js';
import { createClient } from '@supabase/supabase-js';

async function addFollowUpConversions(campaigns) {
  const followUps = campaigns.filter((campaign) => campaign.followUp?.sentAt && campaign.followUp?.campaignId);
  if (!followUps.length) return campaigns;
  try {
    const earliest = followUps.reduce((value, campaign) => (!value || campaign.followUp.sentAt < value ? campaign.followUp.sentAt : value), '');
    const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data, error } = await supabase.from('orders')
      .select('created_at, total_ex_vat, customers(email)')
      .gte('created_at', earliest);
    if (error) throw error;
    return campaigns.map((campaign) => {
      if (!campaign.followUp?.sentAt) return campaign;
      const recipients = new Set((campaign.followUp.recipientEmails || []).map((email) => String(email).trim().toLowerCase()));
      const orders = (data || []).filter((order) => recipients.has(String(order.customers?.email || '').trim().toLowerCase())
        && new Date(order.created_at) >= new Date(campaign.followUp.sentAt));
      return {
        ...campaign,
        followUp: {
          ...campaign.followUp,
          conversion: {
            orders: orders.length,
            customers: new Set(orders.map((order) => String(order.customers?.email || '').trim().toLowerCase())).size,
            revenueExVat: orders.reduce((sum, order) => sum + (Number(order.total_ex_vat) || 0), 0),
          },
        },
      };
    });
  } catch {
    return campaigns;
  }
}

export default async function handler(req, res) {
  if (!(await requireAdminKey(req, res))) return;
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    try {
      const campaigns = await addFollowUpConversions(await readEmailCampaigns());
      return res.status(200).json({ campaigns });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to load campaigns' });
    }
  }

  return res.status(405).end();
}
