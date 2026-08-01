import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isOrderTrashEnabled, normalizeOrderTrashReason } from '../lib/order-trash.mjs';

describe('recoverable order trash gate', () => {
  it('is disabled by default and only enables explicitly', () => {
    expect(isOrderTrashEnabled({})).toBe(false);
    expect(isOrderTrashEnabled({ ORDER_TRASH_ENABLED: 'false' })).toBe(false);
    expect(isOrderTrashEnabled({ ORDER_TRASH_ENABLED: 'true' })).toBe(true);
  });

  it('requires an auditable reason', () => {
    expect(() => normalizeOrderTrashReason('short')).toThrow(/at least 8/i);
    expect(normalizeOrderTrashReason('Duplicate test order')).toBe('Duplicate test order');
  });

  it('contains no bulk permanent order deletion path', () => {
    const source = fs.readFileSync(new URL('../api/admin-orders.js', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from\('orders'\)\.delete\(\)\.not\('id'/);
    expect(source).not.toMatch(/from\('orders'\)\.delete\(\)\.eq\('id'/);
    expect(source).toContain("rpc('trash_admin_order'");
  });

  it('keeps the draft trash table private and functions invoker-scoped', () => {
    const migration = fs.readFileSync(new URL('../migrations/056_recoverable_order_trash.sql', import.meta.url), 'utf8');
    expect(migration).toContain('enable row level security');
    expect(migration).toContain('revoke all on table public.admin_order_trash from anon, authenticated');
    expect(migration).toContain('security invoker');
    expect(migration).not.toContain('security definer');
  });
});
