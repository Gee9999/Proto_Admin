const SOUTH_AFRICAN_VAT_RATE = 0.15;

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

/**
 * Convert a raw Positill PRICE_A value to Proto's customer-facing price.
 *
 * Product Loader follows the same commercial rule as the established image
 * intake process: add 15% VAT, then round to the nearest R0.50.
 */
export function customerPriceFromPositill(priceExVat) {
  const exclusive = positiveNumber(priceExVat);
  if (exclusive == null) return 0;
  return Math.round((exclusive * (1 + SOUTH_AFRICAN_VAT_RATE) * 2) + Number.EPSILON) / 2;
}

/**
 * Select the strongest available customer-facing price without losing the raw
 * ERP evidence:
 *   1. products.sell_price — Proto's synchronised VAT-inclusive price
 *   2. an established website_stock price
 *   3. raw Positill PRICE_A converted to VAT-inclusive and rounded
 */
export function resolveLoaderCustomerPrice({
  productSellPrice,
  websitePrice,
  positillPriceExVat,
} = {}) {
  const synchronisedPrice = positiveNumber(productSellPrice);
  if (synchronisedPrice != null) {
    return { price: synchronisedPrice, source: 'products.sell_price' };
  }

  const establishedWebsitePrice = positiveNumber(websitePrice);
  if (establishedWebsitePrice != null) {
    return { price: establishedWebsitePrice, source: 'website_stock.price' };
  }

  const calculatedPrice = customerPriceFromPositill(positillPriceExVat);
  if (calculatedPrice > 0) {
    return { price: calculatedPrice, source: 'positill.price_a_vat_rounded' };
  }

  return { price: 0, source: 'missing' };
}
