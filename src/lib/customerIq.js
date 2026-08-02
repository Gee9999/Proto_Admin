const DAY_MS = 24 * 60 * 60 * 1000;

export const CUSTOMER_IQ_CONTRACT_VERSION = 'customer-iq.v1';

export function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function daysBetween(a, b) {
  const start = new Date(a);
  const end = new Date(b);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / DAY_MS));
}

export function classifyCustomerHealth(metrics = {}) {
  const current = safeNumber(metrics.spendThisYear);
  const previous = safeNumber(metrics.spendLastYear);
  const daysSincePurchase = safeNumber(metrics.daysSincePurchase, 9999);
  const averageInterval = safeNumber(metrics.averageDaysBetweenPurchases);

  if (!metrics.firstPurchase || safeNumber(metrics.invoiceCount) < 2) {
    return {
      key: 'insufficient_data',
      label: 'Insufficient data',
      tone: 'neutral',
      explanation: 'There is not enough reliable purchase history to classify this customer yet.',
    };
  }

  if (daysSincePurchase >= Math.max(120, averageInterval > 0 ? averageInterval * 3 : 120)) {
    return {
      key: 'dormant',
      label: 'Dormant',
      tone: 'danger',
      explanation: `No purchase has been recorded for ${daysSincePurchase} days.`,
    };
  }

  if (previous > 0) {
    const growth = ((current - previous) / previous) * 100;
    if (growth >= 15) {
      return {
        key: 'growing',
        label: 'Growing',
        tone: 'success',
        explanation: `Spend is up ${Math.round(growth)}% compared with the previous year.`,
      };
    }
    if (growth <= -15) {
      return {
        key: 'declining',
        label: 'Declining',
        tone: 'warning',
        explanation: `Spend is down ${Math.abs(Math.round(growth))}% compared with the previous year.`,
      };
    }
  }

  if (averageInterval > 0 && daysSincePurchase <= averageInterval * 1.25) {
    return {
      key: 'active',
      label: 'Active',
      tone: 'success',
      explanation: 'Recent purchasing is within the customer’s normal ordering rhythm.',
    };
  }

  return {
    key: 'stable',
    label: 'Stable',
    tone: 'neutral',
    explanation: 'Purchasing is broadly consistent with the available history.',
  };
}

export function calculateGrowthPercent(current, previous) {
  const now = safeNumber(current);
  const before = safeNumber(previous);
  if (before <= 0) return null;
  return ((now - before) / before) * 100;
}

export function buildCustomerAnalysis(input = {}) {
  const metrics = {
    customerCode: String(input.customerCode || input.customer_code || '').trim(),
    customerName: String(input.customerName || input.name || input.businessName || '').trim(),
    firstPurchase: input.firstPurchase || input.first_purchase || null,
    lastPurchase: input.lastPurchase || input.last_purchase || null,
    spendThisYear: safeNumber(input.spendThisYear ?? input.spend_this_year),
    spendLastYear: safeNumber(input.spendLastYear ?? input.spend_last_year),
    rolling12MonthSpend: safeNumber(input.rolling12MonthSpend ?? input.rolling_12_month_spend),
    lifetimeSpend: safeNumber(input.lifetimeSpend ?? input.lifetime_spend),
    invoiceCount: safeNumber(input.invoiceCount ?? input.invoice_count),
    averageOrderValue: safeNumber(input.averageOrderValue ?? input.average_order_value),
    largestOrderValue: safeNumber(input.largestOrderValue ?? input.largest_order_value),
    averageDaysBetweenPurchases: safeNumber(input.averageDaysBetweenPurchases ?? input.average_days_between_purchases),
    favouriteDepartments: Array.isArray(input.favouriteDepartments) ? input.favouriteDepartments : [],
    favouriteProducts: Array.isArray(input.favouriteProducts) ? input.favouriteProducts : [],
    monthlySpend: Array.isArray(input.monthlySpend) ? input.monthlySpend : [],
    timeline: Array.isArray(input.timeline) ? input.timeline : [],
    source: input.source || 'Fixture data',
    refreshedAt: input.refreshedAt || new Date().toISOString(),
    partial: Boolean(input.partial),
  };

  metrics.daysSincePurchase = metrics.lastPurchase
    ? daysBetween(metrics.lastPurchase, new Date().toISOString())
    : null;
  metrics.customerSinceYears = metrics.firstPurchase
    ? Math.max(0, Math.floor((Date.now() - new Date(metrics.firstPurchase).getTime()) / (365.25 * DAY_MS)))
    : null;
  metrics.growthPercent = calculateGrowthPercent(metrics.spendThisYear, metrics.spendLastYear);
  metrics.health = classifyCustomerHealth(metrics);

  return {
    contractVersion: CUSTOMER_IQ_CONTRACT_VERSION,
    metrics,
  };
}

export const customerIqFixture = buildCustomerAnalysis({
  customerCode: 'VICTOR73737',
  customerName: 'Victor Trading',
  firstPurchase: '2019-03-18T00:00:00.000Z',
  lastPurchase: '2026-07-10T00:00:00.000Z',
  spendThisYear: 184500,
  spendLastYear: 156200,
  rolling12MonthSpend: 241800,
  lifetimeSpend: 1039450,
  invoiceCount: 87,
  averageOrderValue: 11947.7,
  largestOrderValue: 68400,
  averageDaysBetweenPurchases: 31,
  favouriteDepartments: [
    { name: 'Jewellery Findings', share: 42, spend: 101556 },
    { name: 'Packaging', share: 24, spend: 58032 },
    { name: 'Stationery', share: 18, spend: 43524 },
    { name: 'Gifts', share: 10, spend: 24180 },
    { name: 'Leather', share: 6, spend: 14508 },
  ],
  favouriteProducts: [
    { sku: '861220001', name: 'CRYSTAL MIX', quantity: 620, lastPurchased: '2026-07-10' },
    { sku: '862150014', name: 'JEWELLERY FINDING SET', quantity: 410, lastPurchased: '2026-06-21' },
    { sku: 'PKG-0182', name: 'GIFT BAG MEDIUM', quantity: 350, lastPurchased: '2026-07-10' },
    { sku: 'STA-0048', name: 'ART MARKER SET', quantity: 180, lastPurchased: '2026-05-28' },
  ],
  monthlySpend: [
    { month: '2025-08', spend: 13400 }, { month: '2025-09', spend: 18200 },
    { month: '2025-10', spend: 22100 }, { month: '2025-11', spend: 29400 },
    { month: '2025-12', spend: 36100 }, { month: '2026-01', spend: 12600 },
    { month: '2026-02', spend: 18400 }, { month: '2026-03', spend: 21200 },
    { month: '2026-04', spend: 24700 }, { month: '2026-05', spend: 30600 },
    { month: '2026-06', spend: 34800 }, { month: '2026-07', spend: 42200 },
  ],
  timeline: [
    { date: '2019-03-18', label: 'First recorded purchase' },
    { date: '2021-08-01', label: 'Jewellery became the leading department' },
    { date: '2024-02-12', label: 'Annual spend passed R150 000' },
    { date: '2026-06-03', label: 'Registered for the new online store' },
  ],
  source: 'Preview fixture · SQL contract ready',
});
