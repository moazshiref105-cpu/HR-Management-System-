-- Phase 3B: optimistic concurrency for access-configuration replacement.
-- This migration is intentionally prepared locally only; it has not been applied.

-- The changed parameter lists would otherwise leave the legacy overloads callable.
drop function if exists public.replace_setup_role_permissions(bigint, bigint[]);
drop function if exists public.replace_setup_user_roles(uuid, bigint[], uuid);

create function public.replace_setup_role_permissions(
  p_role_id bigint,
  p_permission_ids bigint[],
  p_expected_updated_at timestamptz
)
returns timestamptz
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_permission_ids bigint[];
  v_current_updated_at timestamptz;
  v_new_updated_at timestamptz;
begin
  if p_expected_updated_at is null then
    raise exception 'HMS_INVALID_VERSION';
  end if;

  select r.updated_at into v_current_updated_at
  from public.roles r
  where r.id = p_role_id
  for update;

  if not found then
    raise exception 'HMS_ROLE_NOT_FOUND';
  end if;
  if v_current_updated_at <> p_expected_updated_at then
    raise exception 'HMS_ROLE_CONFLICT';
  end if;

  select array_agg(distinct permission_id order by permission_id)
  into v_permission_ids
  from unnest(coalesce(p_permission_ids, '{}'::bigint[])) as permissions(permission_id);

  if coalesce(cardinality(v_permission_ids), 0) <> (
    select count(*) from public.permissions p where p.id = any(coalesce(v_permission_ids, '{}'::bigint[]))
  ) then
    raise exception 'Permissions do not exist';
  end if;

  delete from public.role_permissions rp where rp.role_id = p_role_id;
  insert into public.role_permissions (role_id, permission_id)
  select p_role_id, permission_id
  from unnest(coalesce(v_permission_ids, '{}'::bigint[])) as permissions(permission_id);

  update public.roles r set updated_at = now() where r.id = p_role_id returning r.updated_at into v_new_updated_at;
  return v_new_updated_at;
end;
$$;

create function public.replace_setup_user_roles(
  p_user_id uuid,
  p_role_ids bigint[],
  p_created_by uuid,
  p_expected_updated_at timestamptz
)
returns timestamptz
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_role_ids bigint[];
  v_current_updated_at timestamptz;
  v_new_updated_at timestamptz;
begin
  if p_expected_updated_at is null then
    raise exception 'HMS_INVALID_VERSION';
  end if;

  select u.updated_at into v_current_updated_at
  from public.users u
  where u.id = p_user_id
  for update;

  if not found then
    raise exception 'HMS_USER_NOT_FOUND';
  end if;
  if v_current_updated_at <> p_expected_updated_at then
    raise exception 'HMS_USER_ACCESS_CONFLICT';
  end if;
  if p_created_by is null or not exists (select 1 from public.users a where a.id = p_created_by and a.is_active = true) then
    raise exception 'Active actor user is required';
  end if;

  select array_agg(distinct role_id order by role_id)
  into v_role_ids
  from unnest(coalesce(p_role_ids, '{}'::bigint[])) as roles(role_id);

  if coalesce(cardinality(v_role_ids), 0) <> (
    select count(*) from public.roles r where r.id = any(coalesce(v_role_ids, '{}'::bigint[])) and r.is_active = true
  ) then
    raise exception 'Roles must exist and be active';
  end if;

  delete from public.user_roles ur where ur.user_id = p_user_id;
  insert into public.user_roles (user_id, role_id, created_by)
  select p_user_id, role_id, p_created_by
  from unnest(coalesce(v_role_ids, '{}'::bigint[])) as roles(role_id);

  update public.users u set updated_at = now() where u.id = p_user_id returning u.updated_at into v_new_updated_at;
  return v_new_updated_at;
end;
$$;

revoke all on function public.replace_setup_role_permissions(bigint, bigint[], timestamptz) from public, anon, authenticated;
grant execute on function public.replace_setup_role_permissions(bigint, bigint[], timestamptz) to service_role;
revoke all on function public.replace_setup_user_roles(uuid, bigint[], uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.replace_setup_user_roles(uuid, bigint[], uuid, timestamptz) to service_role;
