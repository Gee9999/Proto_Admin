import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(new URL('../src/components/AnalyticsControlCentre.jsx', import.meta.url), 'utf8');
const hub = fs.readFileSync(new URL('../src/components/AnalyticsHub.jsx', import.meta.url), 'utf8');

describe('analytics control centre', () => {
  it('loads order, search and Apollo readiness data together', () => {
    expect(source).toContain('/api/order-analytics?period=${period}');
    expect(source).toContain('/api/search-analytics-dashboard?period=${period}');
    expect(source).toContain('/api/apollo-intelligence');
  });

  it('surfaces actionable opportunity queues', () => {
    expect(source).toContain('High interest, no order signal');
    expect(source).toContain('Search problems to fix');
    expect(source).toContain('Customer feedback');
  });

  it('makes the control centre the default analytics view', () => {
    expect(hub).toContain("useState('control')");
    expect(hub).toContain('Control Centre');
  });
});
