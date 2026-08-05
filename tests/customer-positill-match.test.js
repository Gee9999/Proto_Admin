import { describe, expect, it } from 'vitest';
import { matchPositillCandidates, normalizeCompany, normalizePhone, scorePositillCandidate } from '../lib/customerPositillMatch.js';

describe('advisory Positill customer matching', () => {
  it('normalizes company punctuation and South African phone formats', () => {
    expect(normalizeCompany('A & B (Cape Town)')).toBe('a and b cape town');
    expect(normalizePhone('+27 21 461 5883')).toBe('0214615883');
  });

  it('gives highest confidence to an exact claimed customer code', () => {
    const result = scorePositillCandidate({ claimed_customer_code: ' ab1234 ' }, { account_code: 'AB1234', name: 'Other' });
    expect(result.confidence).toBe('high');
    expect(result.evidence[0].field).toBe('code');
  });

  it('combines exact email and company evidence', () => {
    const result = scorePositillCandidate({ email: 'BUYER@EXAMPLE.COM', business_name: 'Craft Shop' }, { email: 'buyer@example.com', name: 'Craft Shop' });
    expect(result.score).toBe(100);
    expect(result.evidence.map((item) => item.field)).toEqual(['email', 'company']);
  });

  it('marks equal non-code matches as ambiguous and never auto-approves', () => {
    const result = matchPositillCandidates({ email: 'buyer@example.com' }, [{ id: 'a', email: 'buyer@example.com' }, { id: 'b', email: 'buyer@example.com' }]);
    expect(result.ambiguous).toBe(true);
    expect(result.recommendation).toBe('manual_review');
  });

  it('keeps duplicate account-code matches ambiguous', () => {
    const result = matchPositillCandidates({ claimed_customer_code: 'FRIEND' }, [{ id: 'a', account_code: 'FRIEND' }, { id: 'b', account_code: 'FRIEND' }]);
    expect(result.ambiguous).toBe(true);
  });
});
