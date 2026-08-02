import { createHash, randomUUID } from 'crypto';
import { readSiteConfigJson } from './_site-config.js';
import { mutateSiteConfigJson } from './_site-config-mutate.js';

export const CAMPAIGNS_FILE = 'email-campaigns.json';
const EMPTY_STORE = { campaigns: [] };

export async function appendEmailCampaign(entry) {
  return mutateSiteConfigJson(CAMPAIGNS_FILE, EMPTY_STORE, (store) => {
    const campaigns = Array.isArray(store?.campaigns) ? [...store.campaigns] : [];
    campaigns.unshift({
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      ...entry,
    });
    return { store: { campaigns } };
  });
}

// Per-event recipient lists are capped so a huge campaign can't grow the
// store without bound; 2000 covers a full 1000-recipient send with headroom.
const EVENT_EMAILS_CAP = 2000;
const LINK_KEYS_CAP = 300;
const EVENT_KEYS_CAP = 10_000;

export const RECENT_CAMPAIGN_WINDOW_MS = 5 * 60 * 1000;

function normalizedCampaignValue(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Stable signature used to stop an accidental repeat of the same live send. */
export function emailCampaignFingerprint({
  audience, subject, introText = '', htmlBlock = '', businessTypes = [], recipients = [],
} = {}) {
  const payload = {
    audience: normalizedCampaignValue(audience),
    subject: normalizedCampaignValue(subject),
    introText: normalizedCampaignValue(introText),
    htmlBlock: normalizedCampaignValue(htmlBlock),
    businessTypes: [...new Set((businessTypes || []).map(normalizedCampaignValue).filter(Boolean))].sort(),
    recipients: [...new Set((recipients || []).map(normalizedCampaignValue).filter(Boolean))].sort(),
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function findRecentDuplicateCampaign(campaigns, fingerprint, {
  now = Date.now(), windowMs = RECENT_CAMPAIGN_WINDOW_MS,
} = {}) {
  if (!fingerprint) return null;
  return (campaigns || []).find((campaign) => {
    if (campaign?.contentFingerprint !== fingerprint) return false;
    if (Number(campaign.sent || 0) <= 0) return false;
    const sentAt = new Date(campaign.sentAt || campaign.createdAt || 0).getTime();
    return Number.isFinite(sentAt) && now - sentAt >= 0 && now - sentAt < windowMs;
  }) || null;
}

export function normalizeEmailEventKey(event) {
  const raw = String(event || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (raw.includes('deliver')) return 'delivered';
  if (raw.includes('open')) return 'opened';
  if (raw.includes('click')) return 'clicked';
  if (raw.includes('bounce') || raw.includes('blocked') || raw.includes('invalid') || raw.includes('reject') || raw === 'error') return 'bounced';
  if (raw.includes('spam') || raw.includes('complaint')) return 'complained';
  if (raw.includes('unsub')) return 'unsubscribed';
  if (raw === 'request' || raw === 'sent' || raw === 'processed' || raw === 'deferred') return 'delivery_unknown';
  return raw || 'unknown';
}

export async function recordEmailWebhookEvent({ messageId, event, email, link, meta = {} }) {
  if (!messageId || !event) return null;
  return mutateSiteConfigJson(CAMPAIGNS_FILE, EMPTY_STORE, (store) => {
    const campaigns = Array.isArray(store?.campaigns) ? store.campaigns.map((c) => ({ ...c })) : [];
    let matched = false;
    for (const campaign of campaigns) {
      const ids = campaign.messageIds || [];
      if (!ids.includes(messageId)) continue;
      matched = true;
      campaign.events = campaign.events || {};
      const key = normalizeEmailEventKey(event);
      // Brevo can repeat the same webhook (and a person can open/click several
      // times). Operational reporting is recipient-based, so each recipient is
      // counted once per status. If an address is absent, the per-recipient
      // message id is the stable fallback.
      const recipientKey = String(email || messageId).trim().toLowerCase();
      const eventKey = `${key}|${recipientKey}`;
      campaign.eventKeys = Array.isArray(campaign.eventKeys) ? campaign.eventKeys : [];
      const alreadyCounted = campaign.eventKeys.includes(eventKey);
      if (!alreadyCounted) {
        campaign.events[key] = (campaign.events[key] || 0) + 1;
        if (campaign.eventKeys.length < EVENT_KEYS_CAP) campaign.eventKeys.push(eventKey);
      }
      campaign.lastEventAt = new Date().toISOString();
      if (email && !campaign.eventEmails) campaign.eventEmails = {};
      if (email) {
        campaign.eventEmails[key] = campaign.eventEmails[key] || [];
        if (!campaign.eventEmails[key].includes(email)
          && campaign.eventEmails[key].length < EVENT_EMAILS_CAP) {
          campaign.eventEmails[key].push(email);
        }
      }
      // Which link was clicked, by whom. Cap distinct link keys too — some
      // campaigns use per-recipient tracking URLs, which would otherwise grow
      // clickedLinks without bound.
      if (key === 'clicked' && link) {
        campaign.clickedLinks = campaign.clickedLinks || {};
        const existing = campaign.clickedLinks[link];
        if (existing || Object.keys(campaign.clickedLinks).length < LINK_KEYS_CAP) {
          const entry = existing || { count: 0, emails: [], recipientKeys: [] };
          entry.recipientKeys = Array.isArray(entry.recipientKeys) ? entry.recipientKeys : [];
          if (!entry.recipientKeys.includes(recipientKey)) {
            entry.count += 1;
            if (entry.recipientKeys.length < EVENT_EMAILS_CAP) entry.recipientKeys.push(recipientKey);
          }
          if (email && !entry.emails.includes(email) && entry.emails.length < EVENT_EMAILS_CAP) {
            entry.emails.push(email);
          }
          campaign.clickedLinks[link] = entry;
        }
      }
      if (meta.subject && !campaign.subject) campaign.subject = meta.subject;
    }
    if (!matched) return { abort: true };
    return { store: { campaigns } };
  });
}

export async function readEmailCampaigns() {
  const store = await readSiteConfigJson(CAMPAIGNS_FILE, EMPTY_STORE);
  return Array.isArray(store?.campaigns) ? store.campaigns : [];
}
