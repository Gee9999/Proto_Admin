import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { countOrderTabs, normalizeOrderTabCounts } from '../lib/order-tab-counts.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

describe('order tab counts', () => {
  it('covers every tab and preserves paid/unpaid semantics', () => {
    const orders = [
      { status: 'pending' },
      { status: 'handed over' },
      { status: 'order in progress' },
      { status: 'order sent', confirmation_sent_at: null },
      { status: 'order sent', confirmation_sent_at: '2026-08-20T12:00:00Z' },
      { status: 'payment received' },
      { status: 'paid' },
    ];

    expect(countOrderTabs(orders)).toEqual({
      all: 7,
      new: 1,
      handed: 1,
      progress: 1,
      sent: 1,
      paid: 2,
      unpaid: 5,
    });
  });

  it('normalizes bigint-shaped RPC output for the API', () => {
    expect(normalizeOrderTabCounts({
      all_count: '36', new_count: '0', handed_count: '32', progress_count: '2',
      sent_count: '2', paid_count: '0', unpaid_count: '36',
    })).toEqual({ all: 36, new: 0, handed: 32, progress: 2, sent: 2, paid: 0, unpaid: 36 });
  });

  it('ships one filtered aggregate as a security-invoker migration', () => {
    const sql = readFileSync(`${repoRoot}/migrations/20260820234523_optimize_order_tab_counts.sql`, 'utf8');
    expect(sql).toMatch(/security invoker/i);
    expect(sql).not.toMatch(/security definer/i);
    expect(sql.match(/count\(\*\)/gi)).toHaveLength(7);
    expect(sql).toMatch(/orders_status_confirmation_sent_at_idx/i);
  });

  it('uses the RPC in the admin endpoint instead of eight count requests', () => {
    const source = readFileSync(`${repoRoot}/api/admin-orders.js`, 'utf8');
    expect(source).toContain("supabase.rpc('get_order_tab_counts')");
    expect(source).not.toContain('Promise.all([\n      supabase.from(\'orders\')');
  });
});
