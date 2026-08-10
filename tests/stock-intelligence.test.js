import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildStockIntelligence } from '../src/lib/stockIntelligence.js';

const now = new Date('2026-08-10T12:00:00.000Z');
const stock = (over = {}) => ({ sku: 'SKU1', title: 'Item one', category: 'Craft', available_stock: 5, updated_at: '2026-08-10T10:00:00.000Z', ...over });
const order = (over = {}) => ({ created_at: '2026-08-01T10:00:00.000Z', original_items: [{ productId: 'SKU1', qty: 30 }], final_items: [{ productId: 'SKU1', qty: 30 }], ...over });

describe('stock intelligence model', () => {
  it('calculates days of cover and low-stock risk from current stock and period demand', () => {
    const result = buildStockIntelligence({ stockRows: [stock()], orders: [order()], periodDays: 30, now });
    expect(result.lowStock).toHaveLength(1);
    expect(result.lowStock[0].daysCover).toBe(5);
    expect(result.summary.zeroStockWithDemand).toBe(0);
  });

  it('uses no-sales stock as an explicitly labelled proxy and excludes made-to-order from low-stock risk', () => {
    const result = buildStockIntelligence({
      stockRows: [stock({ sku: 'DORMANT', available_stock: 20 }), stock({ sku: 'SKU1', available_stock: 0, to_order: true })],
      orders: [order()], periodDays: 90, now,
    });
    expect(result.noSalesStock.map((row) => row.sku)).toContain('DORMANT');
    expect(result.lowStock).toHaveLength(0);
    expect(result.metricAvailability.deadStock.available).toBe(false);
    expect(result.metricAvailability.sellThrough.available).toBe(false);
  });

  it('labels original-to-final reductions as potential rather than confirmed unavailable demand', () => {
    const result = buildStockIntelligence({
      stockRows: [stock()],
      orders: [order({ final_items: [{ productId: 'SKU1', qty: 18 }] })],
      periodDays: 30, now,
    });
    expect(result.summary.potentialUnavailableUnits).toBe(12);
    expect(result.unavailableDemand[0].potentialUnavailableUnits).toBe(12);
    expect(result.metricAvailability.unavailableDemand.definition).toMatch(/potential signal/i);
  });

  it('ignores orders outside the selected lookback', () => {
    const result = buildStockIntelligence({
      stockRows: [stock()],
      orders: [order({ created_at: '2026-01-01T00:00:00.000Z' })],
      periodDays: 30, now,
    });
    expect(result.noSalesStock).toHaveLength(1);
    expect(result.lowStock).toHaveLength(0);
  });
});

describe('stock intelligence route and UI safety', () => {
  const api = fs.readFileSync(path.resolve(process.cwd(), 'api/stock-intelligence.js'), 'utf8');
  const component = fs.readFileSync(path.resolve(process.cwd(), 'src/components/StockIntelligencePanel.jsx'), 'utf8');

  it('protects a GET-only API and paginates both source reads', () => {
    expect(api).toContain('requireAdminKey');
    expect(api).toContain("req.method !== 'GET'");
    expect(api).toContain("from('website_stock')");
    expect(api).toContain("from('orders')");
    expect(api).toContain('.range(');
  });

  it('keeps the panel read-only and makes missing inputs visible', () => {
    expect(component).toContain("fetch(`/api/stock-intelligence?period=${period}`)");
    expect(component).not.toMatch(/method:\s*['\"](?:POST|PATCH|PUT|DELETE)/);
    expect(component).toContain('Metric guardrails');
    expect(component).toContain('sellThrough.reason');
    expect(component).toContain('Read-only');
  });
});
