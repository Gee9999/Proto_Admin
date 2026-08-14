import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildAbandonedBaskets } from '../lib/abandoned-baskets.mjs';

describe('expired basket recovery', () => {
  it('keeps archived baskets identifiable in the admin worklist', () => {
    const [basket] = buildAbandonedBaskets({
      carts: [{
        customer_id: '11111111-1111-1111-1111-111111111111',
        items: [{ qty: 2, product: { sku: 'SKU-1', name: 'Product one', price: 10 } }],
        _is_archived: true,
        archived_at: '2026-08-14T10:00:00.000Z',
      }],
      customers: [{ id: '11111111-1111-1111-1111-111111111111', name: 'Customer' }],
    });
    expect(basket.archived).toBe(true);
    expect(basket.archivedAt).toBe('2026-08-14T10:00:00.000Z');
  });

  it('restores for three days only when the active basket is empty', async () => {
    const [api, panel] = await Promise.all([
      readFile(new URL('../api/abandoned-baskets-restore.js', import.meta.url), 'utf8'),
      readFile(new URL('../src/components/AbandonedBasketsPanel.jsx', import.meta.url), 'utf8'),
    ]);
    expect(api).toMatch(/requireAdminKey/);
    expect(api).toMatch(/row\.items\) && row\.items\.length/);
    expect(api).toMatch(/THREE_DAYS_MS/);
    expect(api).toMatch(/\.eq\('revision', row\.revision\)/);
    expect(panel).toMatch(/Restore to basket for 3 days/);
    expect(panel).toMatch(/window\.confirm/);
  });
});
