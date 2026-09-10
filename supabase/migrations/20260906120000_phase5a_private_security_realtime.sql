-- Phase 5A: permit each authenticated user to receive only their own opaque
-- security-invalidation Broadcast topic. No public business table participates
-- in Realtime and browsers receive no permission or account-state data here.

drop policy if exists "hms_receive_own_security_invalidations" on realtime.messages;

create policy "hms_receive_own_security_invalidations"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and (select realtime.topic()) = ('user-security:' || (select auth.uid())::text)
);
