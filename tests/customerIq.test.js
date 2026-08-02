import { describe, expect, it, vi } from 'vitest';
import { buildCustomerAnalysis, calculateGrowthPercent, classifyCustomerHealth, daysBetween } from '../src/lib/customerIq';

describe('Customer IQ phase 1 model', () => {
  it('calculates comparable year growth', () => {
    expect(calculateGrowthPercent(115, 100)).toBe(15);
    expect(calculateGrowthPercent(50, 0)).toBeNull();
  });

  it('calculates date intervals safely', () => {
    expect(daysBetween('2026-01-01', '2026-01-31')).toBe(30);
    expect(daysBetween('bad-date', '2026-01-31')).toBeNull();
  });

  it('classifies a growing customer with an explanation', () => {
    const result = classifyCustomerHealth({
      firstPurchase: '2020-01-01',
      invoiceCount: 12,
      spendThisYear: 120000,
      spendLastYear: 100000,
      daysSincePurchase: 10,
      averageDaysBetweenPurchases: 30,
    });
    expect(result.key).toBe('growing');
    expect(result.explanation).toContain('20%');
  });

  it('classifies a genuinely dormant customer ahead of growth status', () => {
    const result = classifyCustomerHealth({
      firstPurchase: '2020-01-01',
      invoiceCount: 12,
      spendThisYear: 120000,
      spendLastYear: 100000,
      daysSincePurchase: 190,
      averageDaysBetweenPurchases: 30,
    });
    expect(result.key).toBe('dormant');
  });

  it('returns a versioned, transparent analysis contract', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T08:00:00.000Z'));
    const analysis = buildCustomerAnalysis({
      customerCode: 'ABC123',
      customerName: 'ABC Gifts',
      firstPurchase: '2021-01-01',
      lastPurchase: '2026-07-20',
      spendThisYear: 1000,
      spendLastYear: 900,
      invoiceCount: 20,
      averageDaysBetweenPurchases: 25,
    });
    expect(analysis.contractVersion).toBe('customer-iq.v1');
    expect(analysis.metrics.customerCode).toBe('ABC123');
    expect(analysis.metrics.daysSincePurchase).toBe(13);
    expect(analysis.metrics.health.explanation).toBeTruthy();
    vi.useRealTimers();
  });
});
