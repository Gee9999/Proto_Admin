import { describe, expect, it } from 'vitest';
import {
  buildSalesFunnelStages,
  measuredCoverage,
  parseSalesFunnelPeriod,
  salesFunnelStartDate,
} from '../lib/sales-funnel.mjs';
import SalesFunnelAnalytics from '../src/components/SalesFunnelAnalytics.jsx';

describe('sales funnel analytics', () => {
  it('exports the dashboard component', () => {
    expect(typeof SalesFunnelAnalytics).toBe('function');
  });

  it('uses only supported periods', () => {
    expect(parseSalesFunnelPeriod('7')).toBe(7);
    expect(parseSalesFunnelPeriod('90')).toBe(90);
    expect(parseSalesFunnelPeriod('365')).toBe(30);
  });

  it('builds an exact UTC cutoff', () => {
    const now = Date.parse('2026-08-10T12:00:00.000Z');
    expect(salesFunnelStartDate(7, now)).toBe('2026-08-03T12:00:00.000Z');
  });

  it('labels untracked stages instead of inventing zero values', () => {
    const stages = buildSalesFunnelStages({
      searches: { available: true, count: 120 },
      productViews: { available: true, count: 80 },
      carts: { available: true, count: 15 },
      paidOrders: { available: true, count: 4 },
    });

    expect(stages.map((stage) => stage.key)).toEqual([
      'visits', 'searches', 'product_views', 'cart', 'checkout', 'paid_orders',
    ]);
    expect(stages.find((stage) => stage.key === 'visits')).toMatchObject({ available: false, value: null });
    expect(stages.find((stage) => stage.key === 'checkout')).toMatchObject({ available: false, value: null });
    expect(measuredCoverage(stages)).toEqual({ available: 4, total: 6 });
  });

  it('preserves source failures as unavailable rather than zero', () => {
    const stages = buildSalesFunnelStages({
      searches: { available: false, reason: 'table missing' },
      productViews: { available: true, count: 0 },
      carts: { available: false, reason: 'column missing' },
      paidOrders: { available: true, count: 0 },
    });

    expect(stages.find((stage) => stage.key === 'searches')).toMatchObject({ available: false, value: null, detail: 'table missing' });
    expect(stages.find((stage) => stage.key === 'product_views')).toMatchObject({ available: true, value: 0 });
  });
});
