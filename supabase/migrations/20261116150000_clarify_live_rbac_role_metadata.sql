-- Clarify existing role names and descriptions from their inspected grants.
-- This migration changes only roles.name and roles.description. Role IDs,
-- user_roles, and role_permissions remain untouched.
do $$
declare
  assignments_before bigint;
  permission_links_before bigint;
begin
  select count(*) into assignments_before from public.user_roles;
  select count(*) into permission_links_before from public.role_permissions;

  update public.roles r
  set name = case r.name
      when 'Live Verification Role 1787847885' then 'No Assigned Permissions (Inactive Legacy 1)'
      when 'Employees Live Verification 1787921427' then 'Employee Records Administrator'
      when 'RBAC Verify A 1787926210' then 'No Assigned Permissions (Inactive Legacy 2)'
      when 'RBAC Verify A 1787926283' then 'No Assigned Permissions (Inactive Legacy 3)'
      when 'RBAC Verify A Final' then 'Employee Viewer'
      when 'RBAC Verify B Final' then 'People & Social Insurance Viewer'
      when 'RBAC Verify C Final' then 'People Operations Viewer'
      when 'HMS Live RBAC Profile A' then 'No Assigned Permissions'
      when 'HMS Live RBAC Profile B' then 'Workforce Viewer'
      when 'HMS Live RBAC Profile C' then 'Workforce Viewer (Legacy Copy)'
    end,
    description = case r.name
      when 'Live Verification Role 1787847885' then 'Inactive role with no assigned permissions. It currently grants no access to HMS features.'
      when 'Employees Live Verification 1787921427' then 'Can add and manage employee records, update personal, work, and financial details, and view Social Insurance information.'
      when 'RBAC Verify A 1787926210' then 'Inactive role with no assigned permissions. It currently grants no access to HMS features.'
      when 'RBAC Verify A 1787926283' then 'Inactive role with no assigned permissions. It currently grants no access to HMS features.'
      when 'RBAC Verify A Final' then 'Can view employee records. Cannot create or update employee information.'
      when 'RBAC Verify B Final' then 'Can view employee records, personal and work information, and Social Insurance information.'
      when 'RBAC Verify C Final' then 'Can view employee records, personal information, and work information.'
      when 'HMS Live RBAC Profile A' then 'This active role currently grants no permissions and provides no access to HMS features.'
      when 'HMS Live RBAC Profile B' then 'Can view employee records and Workforce Analytics. Cannot create or update employee records.'
      when 'HMS Live RBAC Profile C' then 'Can view employee records and Workforce Analytics. This separate existing role has the same permissions as Workforce Viewer.'
    end
  where r.name in (
    'Live Verification Role 1787847885', 'Employees Live Verification 1787921427',
    'RBAC Verify A 1787926210', 'RBAC Verify A 1787926283', 'RBAC Verify A Final',
    'RBAC Verify B Final', 'RBAC Verify C Final', 'HMS Live RBAC Profile A',
    'HMS Live RBAC Profile B', 'HMS Live RBAC Profile C'
  );

  update public.roles
  set description = 'Access is determined by permissions assigned to this role. Contact an administrator for details.'
  where description is null or btrim(description) = '';

  if (select count(*) from public.user_roles) <> assignments_before then
    raise exception 'Role naming migration changed user-role assignments';
  end if;
  if (select count(*) from public.role_permissions) <> permission_links_before then
    raise exception 'Role naming migration changed permission assignments';
  end if;
end;
$$;
