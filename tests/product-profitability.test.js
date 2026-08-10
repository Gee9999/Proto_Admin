import { describe, expect, it } from 'vitest';
import ProductProfitabilityDashboard from '../src/components/ProductProfitabilityDashboard';
import { buildProductProfitability, findProductCost } from '../src/lib/productProfitability';

describe('product profitability', () => {
  it('exports a loadable dashboard component', () => {
    expect(typeof ProductProfitabilityDashboard).toBe('function');
  });

  it('reconciles revenue and calculates profit only for cost-covered lines', () => {
    const products = new Map([
      ['A', { sku: 'A', cost_price: 6 }],
      ['B', { sku: 'B' }],
    ]);
    const result = buildProductProfitability({
      orders: [{
        total_ex_vat: 50,
        final_items: [
          { code: 'A', name: 'Alpha', qty: 2, unitPrice: 10 },
          { code: 'B', name: 'Beta', qty: 1, unitPrice: 30 },
        ],
      }],
      findProduct: (sku) => products.get(sku),
    });

    expect(result.summary.totalOrderRevenue).toBe(50);
    expect(result.summary.productRevenue).toBe(50);
    expect(result.summary.coveredRevenue).toBe(20);
    expect(result.summary.grossProfit).toBe(8);
    expect(result.summary.marginPct).toBe(40);
    expect(result.summary.costCoveragePct).toBe(40);
    expect(result.products.find((row) => row.sku === 'B').grossProfit).toBeNull();
  });

  it('marks gross profit and margin unavailable when no cost exists', () => {
    const result = buildProductProfitability({
      orders: [{ total_ex_vat: 25, items: [{ code: 'A', qty: 1, price: 25 }] }],
    });

    expect(result.costAvailable).toBe(false);
    expect(result.summary.grossProfit).toBeNull();
    expect(result.summary.marginPct).toBeNull();
    expect(result.summary.coveredCost).toBeNull();
  });

  it('accepts a zero ERP cost as real data and reports its source', () => {
    expect(findProductCost({ last_cost: 0 })).toEqual({ unitCost: 0, sourceField: 'last_cost' });
  });

  it('uses final fulfilled items rather than original items', () => {
    const result = buildProductProfitability({
      orders: [{
        total_ex_vat: 12,
        original_items: [{ code: 'OLD', qty: 4, price: 3 }],
        final_items: [{ code: 'NEW', finalQty: 2, unitPrice: 6 }],
      }],
    });
    expect(result.products).toHaveLength(1);
    expect(result.products[0]).toMatchObject({ sku: 'NEW', units: 2, revenue: 12 });
  });
});
