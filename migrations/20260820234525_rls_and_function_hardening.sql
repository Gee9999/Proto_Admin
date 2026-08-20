-- Wrap auth.uid() as an initplan and avoid overlapping permissive SELECT
-- policies. The removed ALL policies' admin write access is preserved as
-- explicit INSERT, UPDATE, and DELETE policies. SELECT remains non-widening:
-- each existing SELECT policy already included the same private.is_admin()
-- predicate supplied by the overlapping ALL policy.

drop policy if exists customers_insert on public.customers;
create policy customers_insert on public.customers
  for insert
  with check (id = (select auth.uid()));

drop policy if exists customers_select on public.customers;
create policy customers_select on public.customers
  for select
  using (id = (select auth.uid()) or private.is_admin());

drop policy if exists orders_admin on public.orders;
create policy orders_admin_insert on public.orders
  for insert with check (private.is_admin());
create policy orders_admin_update on public.orders
  for update using (private.is_admin()) with check (private.is_admin());
create policy orders_admin_delete on public.orders
  for delete using (private.is_admin());

drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders
  for select
  using (customer_id = (select auth.uid()) or private.is_admin());

drop policy if exists products_admin_write on public.products;
create policy products_admin_insert on public.products
  for insert with check (private.is_admin());
create policy products_admin_update on public.products
  for update using (private.is_admin()) with check (private.is_admin());
create policy products_admin_delete on public.products
  for delete using (private.is_admin());

drop policy if exists products_select on public.products;
create policy products_select on public.products
  for select
  using (
    (
      not is_archived
      and exists (
        select 1
        from public.customers c
        where c.id = (select auth.uid()) and c.is_approved = true
      )
    )
    or private.is_admin()
  );

-- These functions are SECURITY INVOKER. Their bodies already schema-qualify
-- every relation and function, so an empty search path is safe and removes the
-- mutable-search-path warning without changing privileges.
alter function public.wa_status_rank(text) set search_path = '';
alter function public.wa_apply_status(text, text, timestamp with time zone, text) set search_path = '';
alter function public.wa_broadcast_audience(text[], text) set search_path = '';
alter function public.wa_sync_rollups() set search_path = '';
