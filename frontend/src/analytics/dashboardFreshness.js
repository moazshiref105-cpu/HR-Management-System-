export const dashboardRequestKey = (filters, refreshSequence) => JSON.stringify([filters, refreshSequence]);
export const nextDashboardRefreshSequence = (sequence) => sequence + 1;

export function resolveDashboardRequestState(result, requestError, requestKey, requestLoading) {
  const resultIsCurrent = result?.key === requestKey;
  const data = resultIsCurrent ? result.data : null;
  const error = requestError?.key === requestKey ? requestError.message : "";
  return {
    data,
    error,
    loading: Boolean(requestLoading) || (!resultIsCurrent && !error),
  };
}
