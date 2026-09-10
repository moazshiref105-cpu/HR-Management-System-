-- Resolve all effective capabilities in one service-role RPC.  This preserves
-- the precedence used by user_has_permission without a request per permission.

create function public.get_user_capabilities(p_user_id uuid)
returns table(permission_key text)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select distinct p.permission_key
  from public.permissions p
  join public.users u on u.id = p_user_id
  where u.is_active = true
    and (
      u.is_super_admin = true
      or (
        not exists (
          select 1
          from public.user_permissions up
          join public.permissions denied on denied.id = up.permission_id
          where up.user_id = u.id
            and denied.permission_key = p.permission_key
            and up.effect = 'deny'
        )
        and (
          exists (
            select 1
            from public.user_permissions up
            join public.permissions allowed on allowed.id = up.permission_id
            where up.user_id = u.id
              and allowed.permission_key = p.permission_key
              and up.effect = 'allow'
          )
          or exists (
            select 1
            from public.user_roles ur
            join public.roles r on r.id = ur.role_id and r.is_active = true
            join public.role_permissions rp on rp.role_id = r.id
            where ur.user_id = u.id
              and rp.permission_id = p.id
          )
        )
      )
    )
  order by p.permission_key;
$$;

revoke all on function public.get_user_capabilities(uuid) from public;
revoke all on function public.get_user_capabilities(uuid) from anon;
revoke all on function public.get_user_capabilities(uuid) from authenticated;
grant execute on function public.get_user_capabilities(uuid) to service_role;
