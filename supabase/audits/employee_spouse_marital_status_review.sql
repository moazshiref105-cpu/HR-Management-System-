-- Read-only report for employees with a CURRENT spouse whose status is not the
-- canonical Married status. Former/corrected spouse records are intentionally
-- excluded because their employee status may correctly be divorced/widowed.
-- Returns only Employee Number, status, and spouse-record count.

select
  employee.employee_number,
  coalesce(marital_status.name, 'Unassigned') as current_marital_status,
  count(spouse.id)::integer as spouse_record_count
from public.employees as employee
join public.employee_wives as spouse
  on spouse.employee_id = employee.id
left join public.marital_statuses as marital_status
  on marital_status.id = employee.marital_status_id
where coalesce(marital_status.is_married_status, false) = false
  and spouse.relationship_status = 'current'
group by employee.employee_number, marital_status.name
order by employee.employee_number;
