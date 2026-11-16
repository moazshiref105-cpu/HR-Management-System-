-- The tracker RPC is additive. Refresh PostgREST's schema cache so the
-- existing API can resolve its named-parameter signature immediately.
notify pgrst, 'reload schema';
