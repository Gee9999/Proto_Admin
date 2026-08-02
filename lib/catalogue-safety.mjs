import { resolveLoaderCustomerPrice } from './catalogue-price.mjs';

export const CATALOGUE_SAFETY_DEFAULTS = Object.freeze({
  priceTolerance: 0.02,
  stockAbsoluteTolerance: 5,
  stockPercentTolerance: 0.20,
  staleAfterHours: 6,
});

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeCatalogueIdentity(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function duplicateLiveCatalogueSku(rows, barcode, excludeSku = '') {
  const identity = normalizeCatalogueIdentity(barcode);
  const excluded = String(excludeSku || '').trim().toUpperCase();
  if (!identity) return '';
  const duplicate = (rows || []).find((row) => (
    String(row?.sku || '').trim().toUpperCase() !== excluded
    && normalizeCatalogueIdentity(row?.barcode) === identity
  ));
  return String(duplicate?.sku || '').trim();
}

export function cataloguePublicationBlockers({
  row = {},
  product = null,
  duplicateLiveSku = '',
} = {}) {
  const blockers = [];
  const price = finite(product?.sell_price ?? row.price ?? row.sell_price);
  const available = finite(product?.available_stock ?? product?.stock_qty);
  const hasImage = [
    row.image_url_one,
    row.image_url_two,
    row.image_url_three,
    row.image_url_four,
    row.image,
  ].some((value) => String(value || '').trim());

  if (!product) blockers.push({ code: 'missing_erp_link', message: 'Publishing blocked because this product is not linked to a verified ERP product.' });
  if (price == null || price <= 0) blockers.push({ code: 'invalid_price', message: 'Publishing blocked because the verified customer price is zero or invalid.' });
  if (product && (available == null || available <= 0)) blockers.push({ code: 'erp_stock_unavailable', message: 'Publishing blocked because verified ERP available stock is zero or negative.' });
  if (!String(row.title || row.name || '').trim()) blockers.push({ code: 'missing_title', message: 'Publishing blocked because a customer-facing title is required.' });
  if (!String(row.category || row.categoryId || '').trim()) blockers.push({ code: 'missing_category', message: 'Publishing blocked because a category is required.' });
  if (!hasImage) blockers.push({ code: 'missing_image', message: 'Publishing blocked because at least one product image is required.' });
  if (String(duplicateLiveSku || '').trim()) {
    blockers.push({
      code: 'duplicate_live_barcode',
      message: `Publishing blocked because this ERP barcode is already live as ${String(duplicateLiveSku).trim()}.`,
    });
  }
  return blockers;
}

export function isDoubleVatSignature(candidate, canonical, tolerance = 0.02) {
  const actual = finite(candidate);
  const expected = finite(canonical);
  if (actual == null || expected == null || expected <= 0) return false;
  return Math.abs(actual - (expected * 1.15)) <= tolerance
    && Math.abs(actual - expected) > tolerance;
}

export function evaluateCatalogueValues({
  websitePrice,
  canonicalPrice,
  websiteAvailable,
  canonicalAvailable,
  matched = true,
}, options = {}) {
  const rules = { ...CATALOGUE_SAFETY_DEFAULTS, ...options };
  const issues = [];
  const currentPrice = finite(websitePrice);
  const sourcePrice = finite(canonicalPrice);
  const currentStock = finite(websiteAvailable);
  const sourceStock = finite(canonicalAvailable);

  if (!matched) {
    issues.push({ code: 'unmatched_product', severity: 'warning' });
  }
  if (currentPrice == null || currentPrice <= 0) {
    issues.push({ code: 'zero_or_invalid_price', severity: 'critical' });
  } else if (sourcePrice != null && sourcePrice > 0
    && Math.abs(currentPrice - sourcePrice) > rules.priceTolerance) {
    issues.push({
      code: isDoubleVatSignature(currentPrice, sourcePrice, rules.priceTolerance)
        ? 'double_vat_signature'
        : 'price_mismatch',
      severity: 'critical',
      difference: currentPrice - sourcePrice,
    });
  }

  if (matched && sourceStock != null && currentStock != null) {
    const difference = Math.abs(currentStock - sourceStock);
    const tolerance = Math.max(
      rules.stockAbsoluteTolerance,
      Math.abs(sourceStock) * rules.stockPercentTolerance,
    );
    if (difference > tolerance) {
      issues.push({
        code: 'major_stock_mismatch',
        severity: 'critical',
        difference: currentStock - sourceStock,
      });
    } else if (difference > 0) {
      issues.push({
        code: 'stock_mismatch',
        severity: 'warning',
        difference: currentStock - sourceStock,
      });
    }
  }

  return issues;
}

export function canonicalPublishValues({
  product,
  existing,
  submitted = {},
  priceBasis = 'vat_inclusive',
}) {
  if (!product) {
    return {
      blocked: true,
      code: 'missing_erp_link',
      message: 'Publishing blocked because this product is not linked to a verified ERP product.',
    };
  }
  const canonicalPrice = finite(product?.sell_price);
  if (canonicalPrice == null || canonicalPrice <= 0) {
    return {
      blocked: true,
      code: 'canonical_price_invalid',
      message: 'Publishing blocked because the synchronised ERP customer price is zero or invalid.',
    };
  }

  const canonicalAvailable = finite(product.available_stock) ?? finite(product.stock_qty);
  if (canonicalAvailable == null || canonicalAvailable <= 0) {
    return {
      blocked: true,
      code: 'canonical_stock_unavailable',
      message: 'Publishing blocked because verified ERP available stock is zero or negative.',
    };
  }

  const loaderPrice = priceBasis === 'erp_ex_vat'
    ? resolveLoaderCustomerPrice({
      productSellPrice: canonicalPrice,
      websitePrice: existing?.price,
    })
    : { price: canonicalPrice, source: 'products.sell_price_incl_vat' };

  return {
    blocked: false,
    price: loaderPrice.price,
    priceSource: loaderPrice.source,
    stockQty: finite(product.stock_qty) ?? canonicalAvailable,
    availableStock: canonicalAvailable,
    corrections: evaluateCatalogueValues({
      websitePrice: submitted.price,
      canonicalPrice: loaderPrice.price,
      websiteAvailable: submitted.availableStock,
      canonicalAvailable,
    }).map((issue) => issue.code),
  };
}
