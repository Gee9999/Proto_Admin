const DAY_MS = 24 * 60 * 60 * 1000;

function cleanKey(value) {
  return String(value || '').trim().toLowerCase();
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function orderItems(order, kind = 'effective') {
  if (kind === 'original') {
    const rows = order?.original_items || order?.items || [];
    return Array.isArray(rows) ? rows : [];
  }
  const rows = order?.final_items || order?.original_items || order?.items || [];
  return Array.isArray(rows) ? rows : [];
}

function lineKey(item) {
  return cleanKey(item?.productId || item?.product_id || item?.sku || item?.code);
}

function addLines(target, rows) {
  for (const item of rows) {
    const key = lineKey(item);
    const qty = Math.max(0, finiteNumber(item?.qty ?? item?.quantity));
    if (!key || !qty) continue;
    target.set(key, (target.get(key) || 0) + qty);
  }
}

function demandByKey(orders, kind) {
  const result = new Map();
  for (const order of orders) addLines(result, orderItems(order, kind));
  return result;
}

function readDemand(map, row) {
  const keys = [row.sku, row.barcode].map(cleanKey).filter(Boolean);
  return Math.max(0, ...keys.map((key) => map.get(key) || 0));
}

/**
 * Build stock intelligence from live catalogue stock and orders in one closed
 * lookback window. A true sell-through rate needs opening stock plus receipts;
 * this model deliberately reports that metric as unavailable.
 */
export function buildStockIntelligence({ stockRows = [], orders = [], periodDays = 90, now = new Date() } = {}) {
  const safePeriod = Math.max(1, finiteNumber(periodDays, 90));
  const cutoffMs = new Date(now).getTime() - safePeriod * DAY_MS;
  const periodOrders = orders.filter((order) => {
    const created = new Date(order?.created_at).getTime();
    return Number.isFinite(created) && created >= cutoffMs;
  });
  const effectiveDemand = demandByKey(periodOrders, 'effective');
  const originalDemand = demandByKey(periodOrders, 'original');

  const products = stockRows.map((row) => {
    const available = Math.max(0, finiteNumber(row.available_stock ?? row.stock_qty));
    const unitsSold = readDemand(effectiveDemand, row);
    const originalUnits = readDemand(originalDemand, row);
    const avgDailyUnits = unitsSold / safePeriod;
    const daysCover = avgDailyUnits > 0 ? available / avgDailyUnits : null;
    const potentialUnavailableUnits = Math.max(0, originalUnits - unitsSold);
    const madeToOrder = Boolean(row.to_order);
    const risk = !madeToOrder && unitsSold > 0 && (available <= 0 || daysCover <= 14);
    const noSalesStock = available > 0 && unitsSold === 0;

    return {
      sku: String(row.sku || '').trim(),
      barcode: String(row.barcode || '').trim(),
      title: String(row.title || row.sku || row.barcode || 'Unnamed product').trim(),
      category: String(row.category || 'Uncategorised').trim(),
      availableStock: available,
      unitsSold,
      avgDailyUnits,
      daysCover,
      potentialUnavailableUnits,
      madeToOrder,
      lowStockRisk: risk,
      noSalesStock,
      updatedAt: row.updated_at || null,
    };
  });

  const lowStock = products
    .filter((row) => row.lowStockRisk)
    .sort((a, b) => (a.daysCover ?? -1) - (b.daysCover ?? -1) || b.unitsSold - a.unitsSold);
  const noSalesStock = products
    .filter((row) => row.noSalesStock)
    .sort((a, b) => b.availableStock - a.availableStock);
  const unavailableDemand = products
    .filter((row) => row.potentialUnavailableUnits > 0)
    .sort((a, b) => b.potentialUnavailableUnits - a.potentialUnavailableUnits);
  const stockTimestamps = products.map((row) => new Date(row.updatedAt).getTime()).filter(Number.isFinite);

  return {
    periodDays: safePeriod,
    summary: {
      liveProducts: products.length,
      lowStockRiskProducts: lowStock.length,
      zeroStockWithDemand: lowStock.filter((row) => row.availableStock <= 0).length,
      noSalesStockProducts: noSalesStock.length,
      unitsOnNoSalesStock: noSalesStock.reduce((sum, row) => sum + row.availableStock, 0),
      potentialUnavailableUnits: unavailableDemand.reduce((sum, row) => sum + row.potentialUnavailableUnits, 0),
    },
    lowStock: lowStock.slice(0, 100),
    noSalesStock: noSalesStock.slice(0, 100),
    unavailableDemand: unavailableDemand.slice(0, 100),
    metricAvailability: {
      daysOfCover: {
        available: true,
        definition: `Current available stock divided by average daily ordered units over ${safePeriod} days.`,
      },
      deadStock: {
        available: false,
        proxyLabel: `No-sales stock (${safePeriod}d)`,
        reason: 'Receipt dates and inventory ageing are not available; products with stock and no orders in the period are shown as a proxy.',
      },
      sellThrough: {
        available: false,
        reason: 'Opening inventory and receipts by SKU are required for a defensible sell-through rate.',
      },
      unavailableDemand: {
        available: true,
        definition: 'Positive difference between original and final order quantities. This is a potential signal, not a confirmed stock-out reason.',
      },
    },
    source: {
      stock: 'website_stock available_stock (fallback: stock_qty)',
      demand: 'orders final_items (fallback: original_items/items)',
      grain: 'One row per live catalogue SKU',
      latestStockAt: stockTimestamps.length ? new Date(Math.max(...stockTimestamps)).toISOString() : null,
      generatedAt: new Date(now).toISOString(),
    },
  };
}

