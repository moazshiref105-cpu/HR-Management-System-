-- Phase 3C: atomically provision the application user after Supabase Auth succeeds.
-- This migration is prepared locally only and must be reviewed before remote application.

create function public.provision_setup_user(
  p_auth_user_id uuid,
  p_email text,
  p_full_name text,
  p_phone text,
  p_role_ids bigint[],
  p_created_by uuid
)
returns table (
  id uuid,
  auth_user_id uuid,
  email text,
  full_name text,
  phone text,
  is_active boolean,
  is_super_admin boolean,
  updated_at timestamptz,
  role_ids bigint[]
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_role_ids bigint[];
  v_user public.users;
  v_auth_email text;
begin
  if p_auth_user_id is null then
    raise exception 'HMS_PROVISIONING_INVALID_AUTH_USER';
  end if;
  if nullif(btrim(p_email), '') is null or nullif(btrim(p_full_name), '') is null then
    raise exception 'HMS_PROVISIONING_INVALID_INPUT';
  end if;
  if p_created_by is null or not exists (
    select 1 from public.users a where a.id = p_created_by and a.is_active = true
  ) then
    raise exception 'HMS_PROVISIONING_INVALID_ACTOR';
  end if;

  select au.email into v_auth_email
  from auth.users au
  where au.id = p_auth_user_id;
  if v_auth_email is null or lower(btrim(v_auth_email)) <> lower(btrim(p_email)) then
    raise exception 'HMS_PROVISIONING_AUTH_MISMATCH';
  end if;

  if exists (select 1 from public.users u where lower(btrim(u.email)) = lower(btrim(p_email))) then
    raise exception 'HMS_APPLICATION_EMAIL_CONFLICT';
  end if;

  select array_agg(distinct role_id order by role_id)
  into v_role_ids
  from unnest(coalesce(p_role_ids, '{}'::bigint[])) as roles(role_id);
  if coalesce(cardinality(v_role_ids), 0) <> (
    select count(*) from public.roles r
    where r.id = any(coalesce(v_role_ids, '{}'::bigint[])) and r.is_active = true
  ) then
    raise exception 'HMS_PROVISIONING_INVALID_ROLES';
  end if;

  insert into public.users (id, auth_user_id, full_name, email, phone, is_active, is_super_admin, created_by)
  values (p_auth_user_id, p_auth_user_id, btrim(p_full_name), lower(btrim(p_email)), p_phone, true, false, p_created_by)
  returning * into v_user;

  insert into public.user_roles (user_id, role_id, created_by)
  select v_user.id, role_id, p_created_by
  from unnest(coalesce(v_role_ids, '{}'::bigint[])) as roles(role_id);

  return query
  select v_user.id, v_user.auth_user_id, v_user.email, v_user.full_name, v_user.phone,
         v_user.is_active, v_user.is_super_admin, v_user.updated_at, v_role_ids;
end;
$$;

revoke all on function public.provision_setup_user(uuid, text, text, text, bigint[], uuid) from public, anon, authenticated;
grant execute on function public.provision_setup_user(uuid, text, text, text, bigint[], uuid) to service_role;
