-- Replace eight independent order count scans with one RLS-preserving aggregate.
create or replace function public.get_order_tab_counts()
returns table (
  all_count bigint,
  new_count bigint,
  handed_count bigint,
  progress_count bigint,
  sent_count bigint,
  paid_count bigint,
  unpaid_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    count(*) as all_count,
    count(*) filter (where status = 'pending') as new_count,
    count(*) filter (where status = 'handed over') as handed_count,
    count(*) filter (where status = 'order in progress') as progress_count,
    count(*) filter (
      where status = 'order sent' and confirmation_sent_at is null
    ) as sent_count,
    count(*) filter (
      where status = 'payment received'
         or (status = 'order sent' and confirmation_sent_at is not null)
    ) as paid_count,
    count(*) filter (
      where status not in ('payment received', 'paid')
    ) as unpaid_count
  from public.orders;
$$;

revoke all on function public.get_order_tab_counts() from public, anon, authenticated;
grant execute on function public.get_order_tab_counts() to service_role;

create index if not exists orders_status_confirmation_sent_at_idx
  on public.orders (status, confirmation_sent_at);
