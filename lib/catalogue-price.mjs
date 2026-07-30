function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

/**
 * Positill PRICE_A is SUPPOSED to be Proto's customer-facing VAT-inclusive
 * price, and for the established catalogue it is. It is passed through
 * unchanged — multiplying here would double-charge every correctly captured
 * product.
 *
 * But it is a data-entry convention, not a guarantee: the ranges imported in
 * July 2026 were captured with the EX-VAT price in this field (and in
 * products.sell_price), which put ~91 live products on the storefront at the
 * ex-VAT amount labelled "Incl. VAT". The prices were repaired in place;
 * looksLikeExVatPrice() below is the guard that stops a recurrence from
 * publishing silently.
 */
export function customerPriceFromPositill(priceIncludingVat) {
  return positiveNumber(priceIncludingVat) ?? 0;
}

const VAT_MULTIPLIER = 1.15; // South African VAT, 15%

/**
 * True when a price smells like the ex-VAT figure was captured where the
 * incl-VAT one belongs: the price itself is NOT on Proto's .00/.50 grid, but
 * multiplied by 1.15 it lands on it exactly. Every one of the 91 mispriced
 * products matched this (12.61→14.50, 43.04→49.50, 503.48→579.00) and no
 * correctly captured price does — a legitimate price already sits on the
 * grid, so the first clause excludes it. Integer-cent math avoids float
 * artefacts.
 */
export function looksLikeExVatPrice(value) {
  const price = positiveNumber(value);
  if (price == null) return false;
  const cents = Math.round(price * 100);
  if (cents % 50 === 0) return false;
  return Math.round(price * 100 * VAT_MULTIPLIER) % 50 === 0;
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
