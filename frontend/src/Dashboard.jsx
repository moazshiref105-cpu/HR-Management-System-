import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { dashboardApi } from "./api";
import { workQueueHash } from "./workQueues";
import { metricLabels } from "./analyticsMetrics";
import { AnalyticsViewNav } from "./analytics/AnalyticsViewNav";
import { AnalyticsFilters } from "./analytics/AnalyticsFilters";
import { AnalyticsOverview } from "./analytics/AnalyticsOverview";
import { OperationalRisks } from "./analytics/OperationalRisks";
import { WorkforceExplorer } from "./analytics/WorkforceExplorer";
import { dashboardRequestKey, nextDashboardRefreshSequence, resolveDashboardRequestState } from "./analytics/dashboardFreshness";
import { currentYearRange, filterFields, formatDate, rangeFor } from "./analytics/analyticsUtils";

const parse = () => {
  const q = new URLSearchParams(location.hash.split("?")[1] || "");
  const period = q.get("period") || "year";
  const range = period === "custom" ? { from: q.get("from") || currentYearRange().from, to: q.get("to") || currentYearRange().to } : rangeFor(period);
  const state = {
    view: ["overview", "risks", "explorer"].includes(q.get("view")) ? q.get("view") : "overview",
    period,
    from: q.get("from") || range.from,
    to: q.get("to") || range.to,
    metric: q.get("metric") || "active_employees",
    dimension: q.get("dimension") || "department",
    search: q.get("search") || "",
    granularity: q.get("granularity") || "auto",
  };
  Object.keys(filterFields).forEach((key) => { state[key] = q.get(key) || ""; });
  return state;
};

function DashboardRequestState({ loading, error, onRetry }) {
  if (error) return <section className="analytics-request-state is-error" role="alert">
    <strong>Couldn’t load current Dashboard data</strong><span>{error}</span>
    <button type="button" className="secondary" onClick={onRetry}>Retry request</button>
  </section>;
  if (loading) return <section className="analytics-request-state" role="status" aria-live="polite">
    <span className="analytics-request-spinner" aria-hidden="true"/><strong>Loading current Dashboard data</strong><span>Fetching fresh results for the selected filters…</span>
  </section>;
  return null;
}

export function Dashboard({ token, go }) {
  const [state, setState] = useState(parse);
  const [lookups, setLookups] = useState({});
  const [options, setOptions] = useState({ metrics: ["total_employees", "active_employees", "new_hires", "resigned_employees"], dimensions: ["department", "team", "position", "employee_status"] });
  const [result, setResult] = useState(null);
  const [requestError, setRequestError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshSequence, setRefreshSequence] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const stateKey = JSON.stringify(state);
  const requestKey = dashboardRequestKey(state, refreshSequence);
  const query = useMemo(() => Object.fromEntries(Object.entries(state).filter(([key, value]) => !["view", "period", "metric", "dimension", "granularity"].includes(key) && value)), [stateKey]);
  const requestState = resolveDashboardRequestState(result, requestError, requestKey, loading);
  const currentData = requestState.data;

  useEffect(() => {
    const onHash = () => location.hash.startsWith("#dashboard") && setState(parse());
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    let active = true;
    dashboardApi.options(token).then((next) => {
      if (!active) return;
      setOptions(next);
      setLookups((current) => ({ ...current, ...(next.filter_options || {}) }));
    }).catch(() => {});
    dashboardApi.filterOptions(token).then((next) => {
      if (active) setLookups((current) => ({ ...current, ...next }));
    }).catch(() => {});
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    const params = new URLSearchParams({ ...query, view: state.view, period: state.period, from: state.from, to: state.to, metric: state.metric, dimension: state.dimension, granularity: state.granularity });
    const next = `#dashboard?${params}`;
    if (location.hash !== next) history.replaceState(null, "", next);
  }, [stateKey]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setRequestError(null);
    const request = state.view === "explorer"
      ? dashboardApi.overview({ ...query, from: state.from, to: state.to, metric: state.metric, dimension: state.dimension, page: 1, page_size: 10 }, token)
      : dashboardApi.executive({ ...query, from: state.from, to: state.to, granularity: state.granularity }, token);
    request
      .then((data) => { if (active) setResult({ key: requestKey, data }); })
      .catch((error) => {
        if (active) {
          setResult(null);
          setRequestError({ key: requestKey, message: error?.message || "The Dashboard request failed. Try again." });
        }
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, requestKey, stateKey]);

  const update = (key, value) => setState((current) => ({ ...current, [key]: value }));
  const setRange = (period) => {
    if (period === "custom") return update("period", "custom");
    const range = rangeFor(period);
    setState((current) => ({ ...current, period, ...range }));
  };
  const reset = () => setState((current) => ({ ...parse(), view: current.view }));
  const setView = (view) => update("view", view);
  const refreshData = () => setRefreshSequence(nextDashboardRefreshSequence);
  const queue = (metric) => go(workQueueHash(metric, { from: state.from, to: state.to, ...Object.fromEntries(Object.entries(query).filter(([key]) => key !== "search")) }));
  const drill = (item) => {
    const filter = item.filter_key || (state.dimension === "employee_status" ? "employee_status" : `${state.dimension}_id`);
    setState((current) => ({ ...current, [filter]: String(item.key), search: "" }));
  };
  const periodLabel = `${formatDate(state.from)} – ${formatDate(state.to)}`;
  return <section className="section-view dashboard-view workforce-analytics workforce-analytics-rebuild">
    <header className="analytics-rebuild-header">
      <div><h1>Workforce Analytics</h1><p>{periodLabel} · {state.department_id ? "Filtered department" : "All departments"} · workforce health and movement</p></div>
      <div className="analytics-header-actions">
        {requestState.loading && <span className="analytics-refreshing">Fetching fresh data</span>}
        <button type="button" className="analytics-refresh-button" onClick={refreshData} disabled={requestState.loading} aria-busy={requestState.loading}><RefreshCw size={15} className={requestState.loading ? "is-spinning" : ""}/>{requestState.loading ? "Refreshing…" : "Refresh data"}</button>
      </div>
    </header>
    <AnalyticsViewNav value={state.view} onChange={setView}/>
    <AnalyticsFilters state={state} lookups={lookups} onChange={update} onRange={setRange} onReset={reset} expanded={expanded} setExpanded={setExpanded} error=""/>
    {requestState.error || requestState.loading ? <DashboardRequestState loading={requestState.loading} error={requestState.error} onRetry={refreshData}/> : null}
    {!requestState.error && !requestState.loading && state.view === "overview" && currentData && <AnalyticsOverview executive={currentData} labels={metricLabels} granularity={state.granularity} onGranularity={(value) => update("granularity", value)} onDirectory={go} onQueue={queue} onPeriod={(from, to) => setState((current) => ({ ...current, period: "custom", from: from || current.from, to: to || current.to }))}/>}
    {!requestState.error && !requestState.loading && state.view === "risks" && currentData && <OperationalRisks items={currentData.attention || []} onQueue={queue}/>}
    {!requestState.error && !requestState.loading && state.view === "explorer" && currentData && <WorkforceExplorer state={state} labels={metricLabels} metrics={options.metrics || []} dimensions={options.dimensions || []} data={currentData} loading={false} onChange={update} onDrill={drill}/>}
  </section>;
}
