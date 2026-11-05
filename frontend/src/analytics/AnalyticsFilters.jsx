import { Filter, X } from "lucide-react";
import { filterFields, formatDate } from "./analyticsUtils";

export function AnalyticsFilters({ state, lookups, onChange, onRange, onReset, expanded, setExpanded, error }) {
  const active = Object.entries(filterFields).filter(([key]) => state[key]);
  const label = (key) => filterFields[key]?.label || key;
  const value = (key, raw) => (lookups[filterFields[key]?.resource || key] || []).find((item) => String(item.id || item.value) === String(raw))?.name || raw;
  return <>
    <section className="analytics-command-bar" aria-label="Workforce analytics filters">
      <label>Period<select aria-label="Period" value={state.period} onChange={(e) => onRange(e.target.value)}><option value="month">This month</option><option value="last_month">Last month</option><option value="quarter">This quarter</option><option value="last_quarter">Last quarter</option><option value="year">Calendar year to date</option><option value="trailing_12">Trailing 12 months</option><option value="custom">Custom range</option></select></label>
      <label>Department<select value={state.department_id} onChange={(e) => onChange("department_id", e.target.value)}><option value="">All departments</option>{(lookups.departments || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Status<select value={state.employee_status} onChange={(e) => onChange("employee_status", e.target.value)}><option value="">All statuses</option>{(lookups.employee_status || []).map((item) => <option key={item.value || item.id} value={item.value || item.id}>{item.label || item.name}</option>)}</select></label>
      <button className="secondary analytics-more-button" type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><Filter size={15}/>{expanded ? "Hide filters" : "Advanced filters"}</button>
      <button className="text-button analytics-reset-button" type="button" onClick={onReset}>Reset filters</button>
      {(expanded || state.period === "custom") && <div className="analytics-command-more">
        {state.period === "custom" && <><label>From<input type="date" value={state.from} onChange={(e) => onChange("from", e.target.value)} /></label><label>To<input type="date" value={state.to} onChange={(e) => onChange("to", e.target.value)} /></label></>}
        {expanded && ["position_id", "gender", "employee_classification", "governorate_id"].map((key) => <label key={key}>{label(key)}<select value={state[key] || ""} onChange={(e) => onChange(key, e.target.value)}><option value="">All {label(key).toLowerCase()}</option>{(lookups[filterFields[key]?.resource || key] || []).map((item) => <option key={item.id || item.value} value={item.id || item.value}>{item.name || item.label}</option>)}</select></label>)}
      </div>}
    </section>
    <div className="analytics-active-filters" aria-label="Active filters">
      <button type="button" onClick={() => onRange("year")}>From {formatDate(state.from)} <X size={12}/></button><button type="button" onClick={() => onRange("year")}>To {formatDate(state.to)} <X size={12}/></button>
      {active.map(([key, raw]) => <button key={key} type="button" onClick={() => onChange(key, "")}>{label(key)}: {value(key, raw)} <X size={12}/></button>)}
    </div>
    {error && <p className="employee-notice danger" role="alert">{error}</p>}
  </>;
}
