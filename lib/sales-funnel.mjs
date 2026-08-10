export const SALES_FUNNEL_PERIODS = Object.freeze([7, 30, 90]);

export function parseSalesFunnelPeriod(raw) {
  const value = Number.parseInt(raw, 10);
  return SALES_FUNNEL_PERIODS.includes(value) ? value : 30;
}

export function salesFunnelStartDate(periodDays, now = Date.now()) {
  return new Date(now - periodDays * 24 * 60 * 60 * 1000).toISOString();
}

function availableStage(key, label, value, source, detail) {
  return {
    key,
    label,
    value: Number(value || 0),
    available: true,
    source,
    detail,
  };
}

function unavailableStage(key, label, detail) {
  return {
    key,
    label,
    value: null,
    available: false,
    source: null,
    detail,
  };
}

/**
 * Creates a deliberately honest funnel. These values have different grains
 * (events, search rows and orders), so no cross-stage drop-off is inferred.
 */
export function buildSalesFunnelStages({ searches, productViews, carts, paidOrders }) {
  return [
    unavailableStage('visits', 'Visits', 'Website visit tracking is not connected yet.'),
    searches.available
      ? availableStage('searches', 'Searches', searches.count, 'search_analytics', 'Recorded search events.')
      : unavailableStage('searches', 'Searches', searches.reason || 'Search tracking is unavailable.'),
    productViews.available
      ? availableStage('product_views', 'Product views', productViews.count, 'analytics_events', 'Recorded product-view events.')
      : unavailableStage('product_views', 'Product views', productViews.reason || 'Product-view tracking is unavailable.'),
    carts.available
      ? availableStage('cart', 'Added to cart', carts.count, 'search_analytics', 'Searches that were followed by an add-to-cart event.')
      : unavailableStage('cart', 'Added to cart', carts.reason || 'Cart tracking is unavailable.'),
    unavailableStage('checkout', 'Checkout started', 'Checkout-start tracking is not connected yet.'),
    paidOrders.available
      ? availableStage('paid_orders', 'Paid orders', paidOrders.count, 'orders', 'Orders whose current status is Payment Received.')
      : unavailableStage('paid_orders', 'Paid orders', paidOrders.reason || 'Order data is unavailable.'),
  ];
}

export function measuredCoverage(stages) {
  const available = stages.filter((stage) => stage.available).length;
  return { available, total: stages.length };
}
