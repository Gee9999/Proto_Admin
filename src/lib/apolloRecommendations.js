/**
 * Deterministic, read-only signals for the Apollo advisory panel.
 * This deliberately returns recommendations, never mutations or outbound actions.
 */
function key(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function itemKey(item) {
  return key(item?.code || item?.id || item?.label || item?.name);
}

function recommendation({ id, priority, title, detail, evidence, action }) {
  return { id, priority, title, detail, evidence, action, advisory: true };
}

export function buildApolloRecommendations({ search, orders } = {}) {
  const result = [];
  const zeroResults = search?.zeroResultTerms || [];
  const viewedProducts = orders?.topViewedProducts || [];
  const orderedProducts = orders?.topOrderedProducts || [];
  const viewedCategories = orders?.topViewedCategories || [];
  const orderedCategories = orders?.topOrderedCategories || [];

  zeroResults.filter((row) => Number(row.search_count || row.searches || 0) >= 3).slice(0, 5).forEach((row) => {
    const count = Number(row.search_count || row.searches || 0);
    const term = row.normalized_search_term || row.search_term || 'this term';
    result.push(recommendation({
      id: `zero-result:${key(term)}`,
      priority: count >= 10 ? 'high' : 'medium',
      title: `Review the “${term}” search gap`,
      detail: `${count} searches returned no products. This may be a synonym, category, spelling, or catalogue-availability gap.`,
      evidence: `${count} no-result searches`,
      action: 'Review synonym, category mapping, and stock visibility',
    }));
  });

  const orderedKeys = new Set(orderedProducts.map(itemKey));
  viewedProducts.filter((row) => Number(row.views || 0) >= 5 && !orderedKeys.has(itemKey(row))).slice(0, 5).forEach((row) => {
    result.push(recommendation({
      id: `viewed-not-ordered:${itemKey(row)}`,
      priority: Number(row.views) >= 15 ? 'high' : 'medium',
      title: `${row.label || row.name || 'Product'} is being viewed but not ordered`,
      detail: 'Customers are showing interest without a recorded order. Check price, pack size, stock, images, and product detail clarity.',
      evidence: `${Number(row.views)} tracked views`,
      action: 'Review product page and stock before promoting',
    }));
  });

  const viewedKeys = new Set(viewedProducts.map(itemKey));
  orderedProducts.filter((row) => Number(row.qty || 0) > 0 && !viewedKeys.has(itemKey(row))).slice(0, 5).forEach((row) => {
    result.push(recommendation({
      id: `ordered-not-viewed:${itemKey(row)}`,
      priority: 'low',
      title: `${row.name || row.label || row.code || 'An ordered product'} has no tracked views`,
      detail: 'It is selling, but the view event is absent or customers are finding it through another route. Treat this as an instrumentation or discoverability check.',
      evidence: `${Number(row.qty)} units ordered`,
      action: 'Check view tracking and search/category discoverability',
    }));
  });

  const orderedCategoryKeys = new Set(orderedCategories.map((row) => key(row.label)));
  viewedCategories.filter((row) => Number(row.views || 0) >= 5 && !orderedCategoryKeys.has(key(row.label))).slice(0, 3).forEach((row) => {
    result.push(recommendation({
      id: `category-gap:${key(row.label)}`,
      priority: Number(row.views) >= 20 ? 'high' : 'medium',
      title: `${row.label || 'A category'} attracts views without orders`,
      detail: 'The category may need better merchandising, clearer subcategories, stronger availability, or a price review.',
      evidence: `${Number(row.views)} tracked category views`,
      action: 'Review category layout, stock coverage, and pricing',
    }));
  });

  const summary = orders?.summary || {};
  const approved = Number(summary.totalApprovedCustomers || 0);
  const ordering = Number(summary.customersWhoOrdered || 0);
  if (approved >= 10 && ordering / approved < 0.25) {
    result.push(recommendation({
      id: 'customer-engagement:inactive',
      priority: 'medium',
      title: 'Most approved customers have not ordered online',
      detail: 'The online funnel is reaching only a small share of approved trade customers in this period. Investigate onboarding, catalogue confidence, and reactivation opportunities.',
      evidence: `${ordering} of ${approved} approved customers ordered online`,
      action: 'Review onboarding and prepare a staff-reviewed reactivation list',
    }));
  }

  if (!result.length) {
    result.push(recommendation({
      id: 'healthy-signals',
      priority: 'low',
      title: 'No urgent analytics gaps detected',
      detail: 'The current period does not contain enough evidence for an actionable recommendation.',
      evidence: 'Read-only analytics review',
      action: 'Keep monitoring as more searches, views, and orders arrive',
    }));
  }

  const rank = { high: 0, medium: 1, low: 2 };
  return result.sort((a, b) => rank[a.priority] - rank[b.priority]);
}

export function recommendationSummary(recommendations) {
  return recommendations.reduce((out, row) => {
    out[row.priority] = (out[row.priority] || 0) + 1;
    return out;
  }, { high: 0, medium: 0, low: 0 });
}
