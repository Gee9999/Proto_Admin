import { describe, expect, it } from 'vitest';
import { buildApolloRecommendations, recommendationSummary } from '../src/lib/apolloRecommendations';

describe('Apollo advisory recommendations', () => {
  it('flags repeated no-result searches', () => {
    const rows = buildApolloRecommendations({ search: { zeroResultTerms: [{ normalized_search_term: 'paint', search_count: 12 }] }, orders: {} });
    expect(rows[0].id).toBe('zero-result:paint');
    expect(rows[0].priority).toBe('high');
    expect(rows[0].advisory).toBe(true);
  });

  it('finds viewed products with no ordered equivalent', () => {
    const rows = buildApolloRecommendations({ orders: { topViewedProducts: [{ label: 'Bead kit', views: 9 }], topOrderedProducts: [] } });
    expect(rows.some((row) => row.id === 'viewed-not-ordered:bead kit')).toBe(true);
  });

  it('does not recommend outbound actions or mutations', () => {
    const rows = buildApolloRecommendations({ search: { zeroResultTerms: [{ normalized_search_term: 'x', search_count: 3 }] } });
    expect(rows[0].action).toMatch(/review/i);
    expect(JSON.stringify(rows)).not.toMatch(/send|delete|update|apply/i);
  });

  it('flags low online engagement among approved customers', () => {
    const rows = buildApolloRecommendations({ orders: { summary: { totalApprovedCustomers: 100, customersWhoOrdered: 10 } } });
    expect(rows.some((row) => row.id === 'customer-engagement:inactive')).toBe(true);
    expect(recommendationSummary(rows).medium).toBeGreaterThan(0);
  });
});
