# Employee spouse lifecycle

Migration `20261118180000_add_employee_spouse_lifecycle.sql` adds retained spouse states (`current`, `former`, and `void`), append-only lifecycle events, canonical Divorced/Widowed lookup markers, and the end/correction database RPCs. Review and apply it through the normal HMS migration process before enabling the profile actions. It has not been applied to the linked database as part of this change. Existing spouse rows receive the database default `current`; the migration does not guess which historical rows may already be former, so those records need an explicit HR review.

Spouse rows are never deleted by these workflows. Ending a marriage requires an effective date and divorce/death reason. If other current spouse records remain, the employee remains Married and no resulting status is accepted. If the last current spouse ends, divorce requires the active canonical status marked `is_divorced_status`; death requires the active canonical status marked `is_widowed_status`. Missing, inactive, ambiguous, invalid, or mismatched markers abort the transaction, rolling back the spouse state and audit event as well as any employee change. The profile presents only the status valid for the selected reason. Correcting an erroneous record remains separate: it requires a reason and explicit resulting status when correcting the last current spouse, without applying the divorce/death mapping. Children retain their existing `wife_id` relationship.

The employee profile uses `employees.personal.edit` for end/correction actions. The PHP API calls transaction-safe RPCs with the spouse's `updated_at`; concurrent changes return a conflict. The database audit records the actor, occurrence time, effective date when applicable, reason, and state transition. Direct lifecycle-field edits are rejected by the state guard. Ordinary spouse import remains a current-record upsert and does not expose lifecycle fields; spouse exports can include lifecycle state and reason fields subject to personal-data view permission.

## Read-only checks

Run `supabase/audits/employee_spouse_marital_status_review.sql` after the lifecycle migration. It returns only Employee Number, current marital status, and current-spouse count for employees who have a current spouse but are not marked Married. Former and corrected spouse records are excluded by design.

To review lifecycle actions without displaying spouse or employee identity data, use:

```sql
select e.employee_number, h.action, h.occurred_at, h.effective_date,
       h.reason_code, h.reason_text, h.previous_state, h.new_state
from public.employee_wife_lifecycle_events h
join public.employees e on e.id = h.employee_id
order by h.occurred_at desc, h.id desc;
```

The prior applied migration's employee-status backfill remains intact. This lifecycle migration does not rewrite existing spouse/child rows or employee statuses.
