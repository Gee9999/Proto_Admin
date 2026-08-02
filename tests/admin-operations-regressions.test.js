import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  emailCampaignFingerprint,
  findRecentDuplicateCampaign,
  normalizeEmailEventKey,
  RECENT_CAMPAIGN_WINDOW_MS,
} from '../api/_email-campaigns.js';
import { normalizeCampaignAnalytics } from '../src/lib/emailAnalytics.js';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const adminPage = read('../src/pages/AdminPage.jsx');
const commsPanel = read('../src/components/CommsPanel.jsx');
const emailModal = read('../src/components/CustomerEmailModal.jsx');
const analyticsPanel = read('../src/components/EmailAnalyticsPanel.jsx');
const campaignStore = read('../api/_email-campaigns.js');

describe('Operations admin regressions', () => {
  it('preserves the visible order list across Order Workspace and remembers the last actionable tab', () => {
    expect(adminPage).toContain('orderWorkspaceListSnapshotRef');
    expect(adminPage).toContain('snapshot?.key === currentKey');
    expect(adminPage).toContain("adm-orders-last-actionable-tab");
    expect(adminPage).toContain("if (orderTab === 'all') return");
  });

  it('renders loaded order-tab zeroes instead of hiding them', () => {
    expect(adminPage).toContain('orderTabCounts == null');
    expect(adminPage).toContain('{count != null && (');
    expect(adminPage).not.toContain('{count > 0 && (');
  });

  it('labels destructive customer actions and states the real approval consequences inline', () => {
    expect(adminPage).toContain('aria-label={`Delete trade request for');
    expect(adminPage).toContain('aria-label={`Delete approved customer');
    expect(adminPage).toContain('aria-label={`Remove ${row.name || row.email} from pre-registration`}');
    expect(adminPage).toContain('Approving grants portal access immediately and sends the welcome email.');
    expect(adminPage).toContain('portal access granted, but the welcome email failed');
  });

  it('shows the exact filtered audience count and disables a loading or empty audience', () => {
    expect(commsPanel).toContain('fetchCustomerEmailAudienceCount');
    expect(commsPanel).toContain("Email {audienceLabel} ({audienceCountLoading ? '…' : audienceCount ?? 0})");
    expect(commsPanel).toContain('disabled={audienceCountLoading || !audienceCount}');
    expect(commsPanel).toContain("Contacts{contactsLoaded ? ` (${total})` : ''}");
  });

  it('confirms the exact recipient count and guards an immediate double click', () => {
    expect(emailModal).toContain('liveSendLockRef.current) return');
    expect(emailModal).toContain('liveSendLockRef.current = true');
    expect(emailModal).toContain('Send this email to exactly ${audienceLabel}?');
    expect(emailModal).toContain('recipientCountLoading || !recipientCount');
  });

  it('detects an identical campaign only inside the five-minute warning window', () => {
    const content = {
      audience: 'all-approved', subject: 'Stock update', introText: 'New stock', businessTypes: ['Gift Shop'],
    };
    const fingerprint = emailCampaignFingerprint(content);
    expect(fingerprint).toBe(emailCampaignFingerprint({ ...content, subject: '  STOCK   UPDATE ' }));
    const now = Date.parse('2026-08-01T12:00:00Z');
    const campaign = { contentFingerprint: fingerprint, sent: 1, sentAt: new Date(now - 60_000).toISOString() };
    expect(findRecentDuplicateCampaign([campaign], fingerprint, { now })).toBe(campaign);
    expect(findRecentDuplicateCampaign([campaign], fingerprint, { now: now + RECENT_CAMPAIGN_WINDOW_MS })).toBeNull();
    expect(emailModal).toContain("err?.code !== 'duplicate_campaign'");
  });

  it('normalizes provider event aliases and deduplicates recipient events', () => {
    expect(normalizeEmailEventKey('delivered')).toBe('delivered');
    expect(normalizeEmailEventKey('hard-bounce')).toBe('bounced');
    expect(normalizeEmailEventKey('processed')).toBe('delivery_unknown');
    expect(campaignStore).toContain('const eventKey = `${key}|${recipientKey}`');
    expect(campaignStore).toContain('if (!alreadyCounted)');
    expect(campaignStore).toContain('!entry.recipientKeys.includes(recipientKey)');
  });

  it('caps recipient rates, classifies delivery unknown, and uses loading skeletons before data arrives', () => {
    const row = normalizeCampaignAnalytics({
      sent: 25,
      events: { delivered: 25, opened: 223, clicked: 145 },
    });
    expect(row).toMatchObject({ delivered: 25, deliveryUnknown: 0, openedUnique: 25, clickedUnique: 25, openRate: 100, clickRate: 100 });
    const unknown = normalizeCampaignAnalytics({ sent: 10, events: { delivered: 2, bounced: 1 } });
    expect(unknown.deliveryUnknown).toBe(7);
    expect(analyticsPanel).toContain('if (loading && campaigns.length === 0) return <EmailAnalyticsSkeleton />');
    expect(commsPanel).toContain('loading && rows.length === 0 && <ContactRowsSkeleton />');
  });
});
