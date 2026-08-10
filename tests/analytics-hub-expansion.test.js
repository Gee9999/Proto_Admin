import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('expanded Analytics hub', () => {
  const hub = fs.readFileSync(path.resolve(process.cwd(), 'src/components/AnalyticsHub.jsx'), 'utf8');

  it('exposes the three decision dashboards', () => {
    for (const label of ['Sales Funnel', 'Product Profitability', 'Stock Intelligence']) {
      expect(hub).toContain(label);
    }
  });

  it('lazy-loads every new dashboard', () => {
    expect(hub).toContain("import('./SalesFunnelAnalytics')");
    expect(hub).toContain("import('./ProductProfitabilityDashboard')");
    expect(hub).toContain("import('./StockIntelligencePanel')");
  });
});
