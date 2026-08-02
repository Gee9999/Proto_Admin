import { describe, expect, it } from 'vitest';
import { businessSearchUrl, traderVerificationSummary } from '../src/lib/traderVerification';

describe('trader application evidence summary', () => {
  it('treats genuine Proto purchase history as the strongest evidence', () => {
    const result = traderVerificationSummary({
      sales_last_12_months: 84600,
      invoice_count: 23,
      business_type: 'Retail store',
      website: 'https://example.co.za',
      email: 'buyer@example.co.za',
      phone: '0210000000',
    });
    expect(result.recommendation).toBe('Strong trader evidence');
    expect(result.evidence[0].label).toBe('Proto history found');
  });

  it('does not treat a missing social profile as a decline reason', () => {
    const result = traderVerificationSummary({ business_type: 'Market trader / spaza shop' });
    expect(result.recommendation).toBe('More information needed');
    expect(result.evidence).toContainEqual(expect.objectContaining({ detail: expect.stringContaining('not a reason to decline') }));
  });

  it('builds a staff research link from business and location', () => {
    expect(businessSearchUrl({ business_name: 'Cape Gifts', city: 'Cape Town' }))
      .toContain('Cape%20Gifts%20Cape%20Town');
  });
});
