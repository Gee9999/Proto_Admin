function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}
function uniqueRecipientCount(campaign, key, fallback = 0) {
  const addresses = campaign?.eventEmails?.[key];
  if (Array.isArray(addresses) && addresses.length) return new Set(addresses.map((email) => String(email).toLowerCase())).size;
  return Number(fallback || 0);
}

/**
 * Convert provider webhook totals into recipient-level campaign analytics.
 * "Delivered" only means a confirmed delivery event; accepted sends without
 * that evidence stay visibly classified as delivery unknown.
 */
export function normalizeCampaignAnalytics(campaign = {}) {
  const events = campaign.events || {};
  const sent = Math.max(0, Number(campaign.sent || campaign.recipientCount || 0));
  const delivered = Math.min(sent, uniqueRecipientCount(campaign, 'delivered', events.delivered));
  const openedUnique = Math.min(sent, uniqueRecipientCount(campaign, 'opened', events.opened));
  const clickedUnique = Math.min(sent, uniqueRecipientCount(campaign, 'clicked', events.clicked));
  const bounced = Math.min(sent, uniqueRecipientCount(campaign, 'bounced', events.bounced));
  const complained = Math.min(sent, uniqueRecipientCount(campaign, 'complained', events.complained));
  const unsubscribed = Math.min(sent, uniqueRecipientCount(campaign, 'unsubscribed', events.unsubscribed));
  const deliveryUnknown = Math.max(0, sent - Math.min(sent, delivered + bounced));

  return {
    ...campaign,
    sent,
    delivered,
    deliveryUnknown,
    openedUnique,
    clickedUnique,
    bounced,
    complained,
    unsubscribed,
    deliveryRate: Math.min(100, pct(delivered, sent)),
    openRate: Math.min(100, pct(openedUnique, sent)),
    clickRate: Math.min(100, pct(clickedUnique, sent)),
    bounceRate: Math.min(100, pct(bounced, sent)),
  };
}
