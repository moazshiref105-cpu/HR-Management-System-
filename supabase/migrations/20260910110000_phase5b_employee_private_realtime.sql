-- Phase 5B: opaque private employee-detail invalidation topics only.
create function public.can_receive_employee_invalidations(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select p_topic ~ '^employee:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and exists (
      select 1 from public.users u
      where u.auth_user_id = auth.uid()
        and u.is_active = true
        and public.user_has_permission(u.id, 'employees.view')
    );
$$;
revoke all on function public.can_receive_employee_invalidations(text) from public;
revoke all on function public.can_receive_employee_invalidations(text) from anon;
grant execute on function public.can_receive_employee_invalidations(text) to authenticated;

drop policy if exists "hms_receive_employee_invalidations" on realtime.messages;
create policy "hms_receive_employee_invalidations"
on realtime.messages for select to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and public.can_receive_employee_invalidations((select realtime.topic()))
);
