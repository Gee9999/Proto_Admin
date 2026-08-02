export type CustomerHealthKey = 'growing' | 'active' | 'stable' | 'declining' | 'dormant' | 'insufficient_data';

export interface CustomerHealth {
  key: CustomerHealthKey;
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  explanation: string;
}

export interface CustomerIqAnalysis {
  contractVersion: 'customer-iq.v1';
  metrics: {
    customerCode: string;
    customerName: string;
    firstPurchase: string | null;
    lastPurchase: string | null;
    customerSinceYears: number | null;
    daysSincePurchase: number | null;
    spendThisYear: number;
    spendLastYear: number;
    rolling12MonthSpend: number;
    lifetimeSpend: number;
    growthPercent: number | null;
    invoiceCount: number;
    averageOrderValue: number;
    largestOrderValue: number;
    averageDaysBetweenPurchases: number;
    favouriteDepartments: Array<{ name: string; share: number; spend?: number }>;
    favouriteProducts: Array<{ sku: string; name: string; quantity: number; lastPurchased?: string }>;
    monthlySpend: Array<{ month: string; spend: number }>;
    timeline: Array<{ date: string; label: string }>;
    health: CustomerHealth;
    source: string;
    refreshedAt: string;
    partial: boolean;
  };
}
