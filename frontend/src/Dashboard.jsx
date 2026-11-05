import { useEffect, useMemo, useState } from "react";
import { dashboardApi } from "./api";
import { workQueueHash } from "./workQueues";
import { metricLabels } from "./analyticsMetrics";
import { AnalyticsViewNav } from "./analytics/AnalyticsViewNav";
import { AnalyticsFilters } from "./analytics/AnalyticsFilters";
import { AnalyticsOverview } from "./analytics/AnalyticsOverview";
import { OperationalRisks } from "./analytics/OperationalRisks";
import { WorkforceExplorer } from "./analytics/WorkforceExplorer";
import { currentYearRange, filterFields, formatDate, rangeFor } from "./analytics/analyticsUtils";

const emptyExecutive = { kpis: {}, movement: [], departments: [], attention: [], comparison: { kpis: {} } };
const emptyExplorer = { analysis: { data: [] }, employees: { rows: [], total: 0 } };
const parse = () => { const q = new URLSearchParams(location.hash.split("?")[1] || ""); const period = q.get("period") || "year"; const range = period === "custom" ? { from: q.get("from") || currentYearRange().from, to: q.get("to") || currentYearRange().to } : rangeFor(period); const state = { view: ["overview", "risks", "explorer"].includes(q.get("view")) ? q.get("view") : "overview", period, from: q.get("from") || range.from, to: q.get("to") || range.to, metric: q.get("metric") || "active_employees", dimension: q.get("dimension") || "department", search: q.get("search") || "", granularity: q.get("granularity") || "auto" }; Object.keys(filterFields).forEach((key) => { state[key] = q.get(key) || ""; }); return state; };

export function Dashboard({ token, go }) {
  const [state, setState] = useState(parse); const [lookups, setLookups] = useState({}); const [options, setOptions] = useState({ metrics: ["total_employees", "active_employees", "new_hires", "resigned_employees"], dimensions: ["department", "team", "position", "employee_status"] }); const [executive, setExecutive] = useState(emptyExecutive); const [explorer, setExplorer] = useState(emptyExplorer); const [loading, setLoading] = useState(true); const [explorerLoading, setExplorerLoading] = useState(false); const [error, setError] = useState(""); const [expanded, setExpanded] = useState(false);
  const stateKey = JSON.stringify(state);
  const query = useMemo(() => Object.fromEntries(Object.entries(state).filter(([key, value]) => !["view", "period", "metric", "dimension", "granularity"].includes(key) && value)), [stateKey]);
  useEffect(() => { const onHash = () => location.hash.startsWith("#dashboard") && setState(parse()); addEventListener("hashchange", onHash); return () => removeEventListener("hashchange", onHash); }, []);
  useEffect(() => { dashboardApi.options(token).then((next) => { setOptions(next); setLookups((current) => ({ ...current, ...(next.filter_options || {}) })); }).catch(() => {}); dashboardApi.filterOptions(token).then((next) => setLookups((current) => ({ ...current, ...next }))).catch(() => {}); }, [token]);
  useEffect(() => { const params = new URLSearchParams({ ...query, view: state.view, period: state.period, from: state.from, to: state.to, metric: state.metric, dimension: state.dimension, granularity: state.granularity }); const next = `#dashboard?${params}`; if (location.hash !== next) history.replaceState(null, "", next); }, [stateKey]);
  useEffect(() => { let live = true; setLoading(true); setError(""); dashboardApi.executive({ ...query, from: state.from, to: state.to, granularity: state.granularity }, token).then((data) => live && setExecutive(data)).catch((err) => live && setError(err?.message || "Couldn’t load workforce analytics. Try again.")).finally(() => live && setLoading(false)); return () => { live = false; }; }, [token, stateKey]);
  useEffect(() => { if (state.view !== "explorer") return undefined; let live = true; setExplorerLoading(true); dashboardApi.overview({ ...query, from: state.from, to: state.to, metric: state.metric, dimension: state.dimension, page: 1, page_size: 10 }, token).then((data) => live && setExplorer(data)).catch((err) => live && setError(err?.message || "Couldn’t load workforce explorer. Try again.")).finally(() => live && setExplorerLoading(false)); return () => { live = false; }; }, [token, stateKey]);
  const update = (key, value) => setState((current) => ({ ...current, [key]: value }));
  const setRange = (period) => { if (period === "custom") return update("period", "custom"); const range = rangeFor(period); setState((current) => ({ ...current, period, ...range })); };
  const reset = () => setState((current) => ({ ...parse(), view: current.view }));
  const setView = (view) => update("view", view);
  const queue = (metric) => go(workQueueHash(metric, { from: state.from, to: state.to, ...Object.fromEntries(Object.entries(query).filter(([key]) => key !== "search")) }));
  const drill = (item) => { const filter = item.filter_key || (state.dimension === "employee_status" ? "employee_status" : `${state.dimension}_id`); setState((current) => ({ ...current, [filter]: String(item.key), search: "" })); };
  const periodLabel = `${formatDate(state.from)} – ${formatDate(state.to)}`;
  return <section className="section-view dashboard-view workforce-analytics workforce-analytics-rebuild"><header className="analytics-rebuild-header"><div><h1>Workforce Analytics</h1><p>{periodLabel} · {state.department_id ? "Filtered department" : "All departments"} · workforce health and movement</p></div>{loading && <span className="analytics-refreshing">Refreshing data</span>}</header><AnalyticsViewNav value={state.view} onChange={setView}/><AnalyticsFilters state={state} lookups={lookups} onChange={update} onRange={setRange} onReset={reset} expanded={expanded} setExpanded={setExpanded} error={error}/>{state.view === "overview" && <AnalyticsOverview executive={executive} labels={metricLabels} granularity={state.granularity} onGranularity={(value) => update("granularity", value)} onDirectory={go} onQueue={queue} onPeriod={(from, to) => setState((current) => ({ ...current, period: "custom", from: from || current.from, to: to || current.to }))}/>} {state.view === "risks" && <OperationalRisks items={executive.attention || []} onQueue={queue}/>} {state.view === "explorer" && <WorkforceExplorer state={state} labels={metricLabels} metrics={options.metrics || []} dimensions={options.dimensions || []} data={explorer} loading={explorerLoading} onChange={update} onDrill={drill}/>}</section>;
}
