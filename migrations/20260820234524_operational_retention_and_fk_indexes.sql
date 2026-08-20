-- Index foreign-key joins and the timestamp columns used by retention cleanup.
create index if not exists analytics_events_customer_id_idx
  on public.analytics_events (customer_id);
create index if not exists order_workspace_customers_customer_id_idx
  on public.order_workspace_customers (customer_id);
create index if not exists order_workspace_promises_related_task_id_idx
  on public.order_workspace_promises (related_task_id);
create index if not exists whatsapp_contacts_last_outbound_broadcast_idx
  on public.whatsapp_contacts (last_outbound_broadcast);

create index if not exists analytics_events_created_at_idx
  on public.analytics_events (created_at);
create index if not exists customer_journey_events_created_at_idx
  on public.customer_journey_events (created_at);
create or replace function public.retention_window_days()
returns table (dataset text, retention_days integer)
language sql
immutable
security invoker
set search_path = ''
as $$
  values
    ('analytics_events'::text, 90),
    ('customer_journey_events'::text, 90),
    ('security_rate_limits'::text, 7);
$$;

revoke all on function public.retention_window_days() from public, anon, authenticated;

create or replace function private.purge_operational_history()
returns table (dataset text, deleted_rows bigint)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  analytics_days integer;
  journey_days integer;
  rate_limit_days integer;
  affected bigint;
begin
  select retention_days into strict analytics_days
  from public.retention_window_days() where dataset = 'analytics_events';
  delete from public.analytics_events
  where created_at < now() - make_interval(days => analytics_days);
  get diagnostics affected = row_count;
  return query select 'analytics_events'::text, affected;

  select retention_days into strict journey_days
  from public.retention_window_days() where dataset = 'customer_journey_events';
  delete from public.customer_journey_events
  where created_at < now() - make_interval(days => journey_days);
  get diagnostics affected = row_count;
  return query select 'customer_journey_events'::text, affected;

  select retention_days into strict rate_limit_days
  from public.retention_window_days() where dataset = 'security_rate_limits';
  delete from public.security_rate_limits
  where window_start < now() - make_interval(days => rate_limit_days);
  get diagnostics affected = row_count;
  return query select 'security_rate_limits'::text, affected;
end;
$$;

revoke all on function private.purge_operational_history() from public, anon, authenticated;

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

select cron.schedule(
  'purge-operational-history',
  '20 3 * * *',
  $cron$select * from private.purge_operational_history();$cron$
)
where not exists (
  select 1 from cron.job where jobname = 'purge-operational-history'
);
