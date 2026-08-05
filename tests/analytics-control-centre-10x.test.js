import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(new URL('../src/components/AnalyticsControlCentre.jsx', import.meta.url), 'utf8');

describe('analytics control centre 10x workflow', () => {
  it('provides separate decision tabs', () => {
    expect(source).toContain('Product opportunities');
    expect(source).toContain('Search problems');
    expect(source).toContain('Apollo intelligence');
    expect(source).toContain('Feedback');
  });

  it('loads feedback and exact identifiers for opportunity matching', () => {
    expect(source).toContain('/api/analytics-feedback');
    expect(source).toContain('row.id');
    expect(source).toContain('SKU / ID');
  });
});
