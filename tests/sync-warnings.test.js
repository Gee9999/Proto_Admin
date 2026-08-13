import { describe, expect, it } from 'vitest';
import { archivedRestoreValues, formatSyncWarning } from '../api/_ensure-product.js';

describe('formatSyncWarning', () => {
  it('formats a Supabase-style error object as "step: message"', () => {
    expect(formatSyncWarning('upsert_website_product_from_stock', { message: 'permission denied' }))
      .toBe('upsert_website_product_from_stock: permission denied');
  });

  it('accepts a plain string error', () => {
    expect(formatSyncWarning('sync_website_from_products', 'timeout'))
      .toBe('sync_website_from_products: timeout');
  });

  it('falls back to "unknown error" when the error carries no message', () => {
    expect(formatSyncWarning('sync_website_from_products', null))
      .toBe('sync_website_from_products: unknown error');
    expect(formatSyncWarning('sync_website_from_products', { message: '   ' }))
      .toBe('sync_website_from_products: unknown error');
  });
});

describe('archive Make Live pricing', () => {
  it('replaces a stale leather-bag archive price with verified live Positill pricing', () => {
    expect(archivedRestoreValues({
      price: 503.48,
      onhand: 7,
      available: 6,
    }, 'erp_sql')).toEqual({
      price: 579,
      stockQty: 7,
      availableStock: 6,
    });
  });

  it('uses the current live price rather than the historical archive value', () => {
    const historicalArchivePrice = 399;
    const restored = archivedRestoreValues({ price: 434.78, onhand: 2, available: 2 }, 'erp_sql');
    expect(restored.price).toBe(500);
    expect(restored.price).not.toBe(historicalArchivePrice);
  });

  it('blocks Make Live when only cached Positill data is available', () => {
    expect(() => archivedRestoreValues({ price: 503.48 }, 'stmast_cache'))
      .toThrow(/current Positill price could not be verified/i);
  });

  it('blocks Make Live when the verified price is invalid', () => {
    expect(() => archivedRestoreValues({ price: 0 }, 'erp_sql'))
      .toThrow(/zero or invalid price/i);
  });
});
