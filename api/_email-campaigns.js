import { randomUUID } from 'crypto';
import { readSiteConfigJson } from './_site-config.js';
import { mutateSiteConfigJson } from './_site-config-mutate.js';

export const CAMPAIGNS_FILE = 'email-campaigns.json';
const EMPTY_STORE = { campaigns: [] };
export const FOLLOW_UP_DELAY_MS = 7 * 24 * 60 * 60 * 1000;

function emailList(values) {
  return [...new Set((values || []).map((email) => String(email || '').trim().toLowerCase()).filter(Boolean))];
}

export async function appendEmailCampaign(entry) {
  const campaign = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    ...entry,
  };
  return mutateSiteConfigJson(CAMPAIGNS_FILE, EMPTY_STORE, (store) => {
    const campaigns = Array.isArray(store?.campaigns) ? [...store.campaigns] : [];
    campaigns.unshift(campaign);
    return { store: { campaigns }, campaign };
  });
}

/** Server-side follow-up guardrail. The browser may display this state, but it
 * cannot choose a different audience or bypass the seven-day / once-only rule. */
export async function getCampaignFollowUpEligibility(campaignId, now = new Date()) {
  const campaigns = await readEmailCampaigns();
  const campaign = campaigns.find((row) => row.id === campaignId);
  if (!campaign) return { ok: false, error: 'Original campaign was not found.' };
  if (campaign.followUp?.sentAt) return { ok: false, error: 'A follow-up was already sent for this campaign.' };
  const sentAt = new Date(campaign.sentAt || campaign.createdAt || 0);
  const readyAt = new Date(sentAt.getTime() + FOLLOW_UP_DELAY_MS);
  if (Number.isNaN(sentAt.getTime()) || now < readyAt) {
    return { ok: false, error: `Follow-up becomes available on ${readyAt.toLocaleString('en-ZA')}.`, readyAt: readyAt.toISOString() };
  }
  const opened = emailList(campaign.eventEmails?.opened);
  const clicked = emailList(campaign.eventEmails?.clicked);
  const excluded = emailList([
    ...(campaign.eventEmails?.bounced || []),
    ...(campaign.eventEmails?.unsubscribed || []),
    ...(campaign.eventEmails?.complained || []),
  ]);
  const engagedOrExcluded = new Set([...opened, ...clicked, ...excluded]);
  const sentFollowUps = new Set(campaigns.filter((row) => row.followUpOf).flatMap((row) => emailList(row.recipientEmails)));
  const emails = emailList(campaign.recipientEmails).filter((email) => !engagedOrExcluded.has(email) && !sentFollowUps.has(email));
  return { ok: true, campaign, emails, readyAt: readyAt.toISOString() };
}

export async function markCampaignFollowUp(campaignId, { campaignId: followUpCampaignId, sentAt, recipientEmails }) {
  return mutateSiteConfigJson(CAMPAIGNS_FILE, EMPTY_STORE, (store) => {
    const campaigns = Array.isArray(store?.campaigns) ? store.campaigns.map((row) => ({ ...row })) : [];
    const original = campaigns.find((row) => row.id === campaignId);
    if (!original || original.followUp?.sentAt) return { abort: true };
    original.followUp = {
      campaignId: followUpCampaignId,
      sentAt,
      recipientCount: emailList(recipientEmails).length,
      recipientEmails: emailList(recipientEmails),
    };
    return { store: { campaigns } };
  });
}

// Per-event recipient lists are capped so a huge campaign can't grow the
// store without bound; 2000 covers a full 1000-recipient send with headroom.
const EVENT_EMAILS_CAP = 2000;
const LINK_KEYS_CAP = 300;

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
      const key = normalizeEventKey(event);
      campaign.events[key] = (campaign.events[key] || 0) + 1;
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
          const entry = existing || { count: 0, emails: [] };
          entry.count += 1;
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

function normalizeEventKey(event) {
  const raw = String(event || '').trim().toLowerCase();
  if (raw.includes('deliver')) return 'delivered';
  if (raw.includes('open')) return 'opened';
  if (raw.includes('click')) return 'clicked';
  if (raw.includes('bounce')) return 'bounced';
  if (raw.includes('spam') || raw.includes('complaint')) return 'complained';
  if (raw.includes('unsub')) return 'unsubscribed';
  return raw || 'unknown';
}

export async function readEmailCampaigns() {
  const store = await readSiteConfigJson(CAMPAIGNS_FILE, EMPTY_STORE);
  return Array.isArray(store?.campaigns) ? store.campaigns : [];
}
