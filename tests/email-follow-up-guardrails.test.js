import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const campaigns = fs.readFileSync(new URL('../api/_email-campaigns.js', import.meta.url), 'utf8');
const broadcast = fs.readFileSync(new URL('../api/_send-email-broadcast.js', import.meta.url), 'utf8');
const analytics = fs.readFileSync(new URL('../src/components/EmailAnalyticsPanel.jsx', import.meta.url), 'utf8');

describe('email follow-up guardrails', () => {
  it('enforces a seven-day and once-only follow-up policy on the server', () => {
    expect(campaigns).toContain('FOLLOW_UP_DELAY_MS');
    expect(campaigns).toContain('A follow-up was already sent for this campaign.');
    expect(broadcast).toContain('getCampaignFollowUpEligibility');
    expect(broadcast).toContain('markCampaignFollowUp');
  });

  it('shows the wait state and conversion result in analytics', () => {
    expect(analytics).toContain('Follow-up conversion:');
    expect(analytics).toContain('Available from');
    expect(analytics).toContain('followUpOf: campaign.id');
  });
});
