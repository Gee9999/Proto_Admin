function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

/**
 * Positill PRICE_A is already Proto's customer-facing VAT-inclusive price.
 * Keep it unchanged: adding VAT here would double-charge the catalogue.
 */
export function customerPriceFromPositill(priceIncludingVat) {
  return positiveNumber(priceIncludingVat) ?? 0;
}

/**
 * Select the strongest available VAT-inclusive customer price:
 *   1. products.sell_price — Proto's synchronised customer price
 *   2. an established website_stock price
 *   3. raw Positill PRICE_A, already inclusive of VAT
 */
export function resolveLoaderCustomerPrice({
  productSellPrice,
  websitePrice,
  positillPrice,
} = {}) {
  const synchronisedPrice = positiveNumber(productSellPrice);
  if (synchronisedPrice != null) {
    return { price: synchronisedPrice, source: 'products.sell_price' };
  }

  const establishedWebsitePrice = positiveNumber(websitePrice);
  if (establishedWebsitePrice != null) {
    return { price: establishedWebsitePrice, source: 'website_stock.price' };
  }

  const positillCustomerPrice = customerPriceFromPositill(positillPrice);
  if (positillCustomerPrice > 0) {
    return { price: positillCustomerPrice, source: 'positill.price_a_incl_vat' };
  }

  return { price: 0, source: 'missing' };
}
