import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const readMigration = (name) => readFileSync(`${repoRoot}/migrations/${name}`, 'utf8');

describe('database hardening migrations', () => {
  it('indexes all four previously unindexed foreign keys and schedules bounded retention', () => {
    const sql = readMigration('20260820234524_operational_retention_and_fk_indexes.sql');
    for (const column of ['analytics_events (customer_id)', 'order_workspace_customers (customer_id)',
      'order_workspace_promises (related_task_id)', 'whatsapp_contacts (last_outbound_broadcast)']) {
      expect(sql).toContain(column);
    }
    expect(sql).toContain("('analytics_events'::text, 90)");
    expect(sql).toContain("('customer_journey_events'::text, 90)");
    expect(sql).toContain("('security_rate_limits'::text, 7)");
    expect(sql).toMatch(/cron\.schedule/i);
    expect(sql).not.toContain('security_rate_limits_window_start_idx');
  });

  it('splits admin ALL policies without widening SELECT and pins WA search paths', () => {
    const sql = readMigration('20260820234525_rls_and_function_hardening.sql');
    expect(sql).toContain('drop policy if exists orders_admin');
    expect(sql).toContain('drop policy if exists products_admin_write');
    expect(sql.match(/create policy orders_admin_(insert|update|delete)/g)).toHaveLength(3);
    expect(sql.match(/create policy products_admin_(insert|update|delete)/g)).toHaveLength(3);
    expect(sql.match(/set search_path = ''/g)).toHaveLength(4);
    expect(sql).not.toMatch(/security definer/i);
  });
});
