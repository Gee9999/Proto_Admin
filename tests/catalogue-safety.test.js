import { describe, expect, it } from 'vitest';
import {
  cataloguePublicationBlockers,
  canonicalPublishValues,
  duplicateLiveCatalogueSku,
  evaluateCatalogueValues,
  isDoubleVatSignature,
} from '../lib/catalogue-safety.mjs';

describe('catalogue safety checks', () => {
  it('recognises a second VAT addition', () => {
    expect(isDoubleVatSignature(9.20, 8.00)).toBe(true);
    expect(evaluateCatalogueValues({
      websitePrice: 9.20,
      canonicalPrice: 8.00,
      websiteAvailable: 10,
      canonicalAvailable: 10,
    })[0].code).toBe('double_vat_signature');
  });

  it('does not mistake a correct VAT-inclusive price for double VAT', () => {
    expect(isDoubleVatSignature(49.50, 49.50)).toBe(false);
  });

  it('classifies small and major stock differences separately', () => {
    expect(evaluateCatalogueValues({
      websitePrice: 10,
      canonicalPrice: 10,
      websiteAvailable: 98,
      canonicalAvailable: 100,
    })[0].code).toBe('stock_mismatch');
    expect(evaluateCatalogueValues({
      websitePrice: 10,
      canonicalPrice: 10,
      websiteAvailable: 50,
      canonicalAvailable: 100,
    })[0].code).toBe('major_stock_mismatch');
  });

  it('uses the server-side synchronised product values during publication', () => {
    expect(canonicalPublishValues({
      product: { sell_price: 8, stock_qty: 100, available_stock: 90 },
      submitted: { price: 9.2, stockQty: 80, availableStock: 70 },
    })).toMatchObject({
      blocked: false,
      price: 8,
      stockQty: 100,
      availableStock: 90,
      corrections: ['double_vat_signature', 'major_stock_mismatch'],
    });
  });

  it('blocks a matched ERP product with a zero customer price', () => {
    expect(canonicalPublishValues({
      product: { sell_price: 0, stock_qty: 5 },
      submitted: { price: 10 },
    })).toMatchObject({ blocked: true, code: 'canonical_price_invalid' });
  });

  it('converts a loader ERP price once while preserving a valid website price', () => {
    expect(canonicalPublishValues({
      product: { sell_price: 25.65, stock_qty: 10, available_stock: 8 },
      submitted: { price: 25.65 },
      priceBasis: 'erp_ex_vat',
    })).toMatchObject({ price: 29.5, priceSource: 'products.sell_price_ex_vat_converted' });

    expect(canonicalPublishValues({
      product: { sell_price: 25.65, stock_qty: 10, available_stock: 8 },
      existing: { price: 29.5 },
      submitted: { price: 25.65 },
      priceBasis: 'erp_ex_vat',
    })).toMatchObject({ price: 29.5, priceSource: 'website_stock.price_incl_vat' });
  });

  it('falls back to ERP stock when available stock is genuinely absent', () => {
    expect(canonicalPublishValues({
      product: { sell_price: 10, stock_qty: 5, available_stock: null },
      submitted: { price: 10 },
    })).toMatchObject({ blocked: false, availableStock: 5 });
  });

  it('hard-blocks incomplete, unlinked, out-of-stock and duplicate catalogue publication', () => {
    const blockers = cataloguePublicationBlockers({
      row: { title: '', category: '', image_url_one: '' },
      product: null,
      duplicateLiveSku: 'LIVE-1',
    });
    expect(blockers.map((blocker) => blocker.code)).toEqual(expect.arrayContaining([
      'missing_erp_link',
      'invalid_price',
      'missing_title',
      'missing_category',
      'missing_image',
      'duplicate_live_barcode',
    ]));

    expect(canonicalPublishValues({
      product: { sell_price: 10, stock_qty: 0, available_stock: -1 },
      submitted: { price: 10 },
    })).toMatchObject({ blocked: true, code: 'canonical_stock_unavailable' });
    expect(canonicalPublishValues({ product: null, submitted: { price: 10 } }))
      .toMatchObject({ blocked: true, code: 'missing_erp_link' });
  });

  it('normalises live barcode identity before detecting a duplicate', () => {
    expect(duplicateLiveCatalogueSku(
      [{ sku: 'LIVE-1', barcode: ' 86-101 ' }, { sku: 'EDITING', barcode: '86101' }],
      '86101',
      'EDITING',
    )).toBe('LIVE-1');
  });
});
