-- DRAFT / EXPLICIT RELEASE GATE
-- Do not apply without a separately approved database migration and rollback check.
-- Application code remains disabled unless ORDER_TRASH_ENABLED=true.

begin;

create table if not exists public.admin_order_trash (
  id uuid primary key default gen_random_uuid(),
  order_id text not null,
  order_snapshot jsonb not null,
  deleted_at timestamptz not null default now(),
  deleted_by text not null,
  deletion_reason text not null check (char_length(deletion_reason) between 8 and 500),
  restored_at timestamptz,
  restored_by text
);

create unique index if not exists admin_order_trash_active_order_idx
  on public.admin_order_trash (order_id)
  where restored_at is null;

create index if not exists admin_order_trash_deleted_at_idx
  on public.admin_order_trash (deleted_at desc);

alter table public.admin_order_trash enable row level security;
revoke all on table public.admin_order_trash from anon, authenticated;
grant select, insert, update on table public.admin_order_trash to service_role;

create or replace function public.trash_admin_order(
  p_order_id text,
  p_actor text,
  p_reason text
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_snapshot jsonb;
  v_trash_id uuid;
begin
  if char_length(trim(coalesce(p_reason, ''))) not between 8 and 500 then
    raise exception 'A deletion reason of 8 to 500 characters is required';
  end if;

  select to_jsonb(o) into v_snapshot
  from public.orders o
  where o.id::text = p_order_id
  for update;

  if v_snapshot is null then
    raise exception 'Order not found';
  end if;

  insert into public.admin_order_trash (order_id, order_snapshot, deleted_by, deletion_reason)
  values (p_order_id, v_snapshot, coalesce(nullif(trim(p_actor), ''), 'unknown-admin'), trim(p_reason))
  returning id into v_trash_id;

  delete from public.orders where id::text = p_order_id;
  return v_trash_id;
end;
$$;

create or replace function public.restore_admin_order(
  p_trash_id text,
  p_actor text
) returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order_id text;
  v_snapshot jsonb;
begin
  select order_id, order_snapshot into v_order_id, v_snapshot
  from public.admin_order_trash
  where id::text = p_trash_id and restored_at is null
  for update;

  if v_snapshot is null then
    raise exception 'Recoverable order not found';
  end if;

  if exists (select 1 from public.orders where id::text = v_order_id) then
    raise exception 'An active order with this id already exists';
  end if;

  insert into public.orders
  select * from jsonb_populate_record(null::public.orders, v_snapshot);

  update public.admin_order_trash
  set restored_at = now(), restored_by = coalesce(nullif(trim(p_actor), ''), 'unknown-admin')
  where id::text = p_trash_id;

  return v_order_id;
end;
$$;

revoke all on function public.trash_admin_order(text, text, text) from public, anon, authenticated;
revoke all on function public.restore_admin_order(text, text) from public, anon, authenticated;
grant execute on function public.trash_admin_order(text, text, text) to service_role;
grant execute on function public.restore_admin_order(text, text) to service_role;

commit;
