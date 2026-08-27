-- One-time, server-only bootstrap for the initial Super Admin.

create or replace function public.bootstrap_first_super_admin(
  p_auth_user_id uuid,
  p_full_name text,
  p_email text
)
returns public.users
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_auth_email text;
  v_user public.users;
begin
  if p_auth_user_id is null then
    raise exception 'Auth user ID is required';
  end if;

  if nullif(btrim(p_full_name), '') is null then
    raise exception 'Full name is required';
  end if;

  if nullif(btrim(p_email), '') is null then
    raise exception 'Email is required';
  end if;

  -- Serialize bootstrap attempts so two concurrent calls cannot create two Super Admins.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('hms.bootstrap_first_super_admin')
  );

  if exists (
    select 1
    from public.users
    where is_super_admin = true
  ) then
    raise exception 'A Super Admin already exists';
  end if;

  select email
  into v_auth_email
  from auth.users
  where id = p_auth_user_id;

  if v_auth_email is null then
    raise exception 'Auth user does not exist';
  end if;

  if lower(btrim(v_auth_email)) <> lower(btrim(p_email)) then
    raise exception 'Provided email does not match the Auth user';
  end if;

  insert into public.users (
    id,
    auth_user_id,
    full_name,
    email,
    is_active,
    is_super_admin
  )
  values (
    p_auth_user_id,
    p_auth_user_id,
    btrim(p_full_name),
    lower(btrim(p_email)),
    true,
    true
  )
  returning * into v_user;

  return v_user;
end;
$$;

revoke all on function public.bootstrap_first_super_admin(uuid, text, text) from public;
revoke all on function public.bootstrap_first_super_admin(uuid, text, text) from anon;
revoke all on function public.bootstrap_first_super_admin(uuid, text, text) from authenticated;
grant execute on function public.bootstrap_first_super_admin(uuid, text, text) to service_role;
