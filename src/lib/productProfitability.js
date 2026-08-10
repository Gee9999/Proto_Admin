const COST_FIELDS = [
  'cost_price',
  'average_cost',
  'avg_cost',
  'unit_cost',
  'last_cost',
  'landed_cost',
  'purchase_price',
  'buy_price',
];

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function orderItems(order) {
  const rows = order?.final_items || order?.original_items || order?.items || [];
  return Array.isArray(rows) ? rows : [];
}

export function itemSku(item) {
  return String(item?.productId || item?.sku || item?.code || '').trim();
}

export function itemQuantity(item) {
  const quantity = finiteNumber(item?.finalQty ?? item?.qty ?? item?.quantity);
  return quantity != null && quantity > 0 ? quantity : 0;
}

export function itemUnitRevenue(item) {
  const unitRevenue = finiteNumber(item?.unitPrice ?? item?.unit_price ?? item?.price ?? item?.sellPrice);
  return unitRevenue != null && unitRevenue >= 0 ? unitRevenue : null;
}

export function findProductCost(product) {
  if (!product) return { unitCost: null, sourceField: null };
  for (const sourceField of COST_FIELDS) {
    const unitCost = finiteNumber(product[sourceField]);
    if (unitCost != null && unitCost >= 0) return { unitCost, sourceField };
  }
  return { unitCost: null, sourceField: null };
}

export function buildProductProfitability({ orders = [], findProduct = () => null } = {}) {
  const rows = new Map();
  const usedCostFields = new Set();
  let totalOrderRevenue = 0;
  let productRevenue = 0;
  let coveredRevenue = 0;
  let coveredCost = 0;
  let units = 0;
  let pricedUnits = 0;
  let costedUnits = 0;

  for (const order of orders) {
    totalOrderRevenue += finiteNumber(order?.total_ex_vat) || 0;
    for (const item of orderItems(order)) {
      const quantity = itemQuantity(item);
      if (!quantity) continue;
      units += quantity;

      const sku = itemSku(item) || 'unknown';
      const name = String(item?.name || item?.title || sku);
      const unitRevenue = itemUnitRevenue(item);
      const lineRevenue = unitRevenue == null ? null : unitRevenue * quantity;
      const product = findProduct(sku, item);
      const { unitCost, sourceField } = findProductCost(product);
      const hasProfit = lineRevenue != null && unitCost != null;

      if (lineRevenue != null) {
        productRevenue += lineRevenue;
        pricedUnits += quantity;
      }
      if (hasProfit) {
        coveredRevenue += lineRevenue;
        coveredCost += unitCost * quantity;
        costedUnits += quantity;
        usedCostFields.add(sourceField);
      }

      const row = rows.get(sku) || {
        sku,
        name,
        units: 0,
        revenue: 0,
        revenueAvailable: false,
        costedUnits: 0,
        coveredRevenue: 0,
        cost: 0,
        grossProfit: null,
        marginPct: null,
        costSource: null,
      };
      row.units += quantity;
      if (lineRevenue != null) {
        row.revenue += lineRevenue;
        row.revenueAvailable = true;
      }
      if (hasProfit) {
        row.costedUnits += quantity;
        row.coveredRevenue += lineRevenue;
        row.cost += unitCost * quantity;
        row.grossProfit = row.coveredRevenue - row.cost;
        row.marginPct = row.coveredRevenue > 0 ? (row.grossProfit / row.coveredRevenue) * 100 : null;
        row.costSource = row.costSource && row.costSource !== sourceField ? 'multiple' : sourceField;
      }
      rows.set(sku, row);
    }
  }

  const grossProfit = coveredRevenue > 0 ? coveredRevenue - coveredCost : null;
  const marginPct = grossProfit != null && coveredRevenue > 0 ? (grossProfit / coveredRevenue) * 100 : null;
  const revenueCoveragePct = totalOrderRevenue > 0 ? (productRevenue / totalOrderRevenue) * 100 : null;
  const costCoveragePct = productRevenue > 0 ? (coveredRevenue / productRevenue) * 100 : null;

  return {
    summary: {
      totalOrders: orders.length,
      totalOrderRevenue,
      productRevenue,
      coveredRevenue,
      coveredCost: coveredRevenue > 0 ? coveredCost : null,
      grossProfit,
      marginPct,
      revenueCoveragePct,
      costCoveragePct,
      units,
      pricedUnits,
      costedUnits,
    },
    products: [...rows.values()].sort((a, b) => b.revenue - a.revenue || b.units - a.units),
    costAvailable: coveredRevenue > 0,
    costSourceFields: [...usedCostFields].sort(),
  };
}

export const supportedProductCostFields = COST_FIELDS;
