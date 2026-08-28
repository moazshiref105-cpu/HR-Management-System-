import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, ChevronRight, Filter, Search, X } from "lucide-react";
import { dashboardApi } from "./api";

const labels = {
  total_employees: "Total Employees",
  active_employees: "Active Employees",
  resigned_employees: "Resigned Employees",
  inactive_employees: "Inactive Employees",
  new_hires: "New Hires",
  five_percent: "5% Employees",
  missing_form_1: "Missing Form 1",
  missing_form_6: "Missing Form 6",
  missing_bank: "Missing Bank",
  contracts_expiring: "Contracts Expiring",
  contracts_expired: "Contracts Expired",
  in_probation: "In Probation",
  probation_due: "Probation Due",
  identity_expiring: "Identity Expiring",
  identity_expired: "Identity Expired",
  licenses_expiring: "Licenses Expiring",
  licenses_expired: "Licenses Expired",
  medical_eligible: "Medical Eligible",
  medical_not_yet_eligible: "Medical Not Yet Eligible",
  life_eligible: "Life Eligible",
  comprehensive_health_participating: "Comprehensive Health Participating",
  open_notifications: "Open Notifications",
  due_soon: "Due Soon",
  overdue: "Overdue",
};
const dimensions = {
  department: "Department",
  team: "Team",
  position: "Position",
  project: "Project",
  governorate: "Governorate",
  employee_status: "Employee Status",
  gender: "Gender",
  marital_status: "Marital Status",
  religion: "Religion",
  diploma: "Diploma",
  classification: "Classification",
  leaving_reason: "Leaving Reason",
  shift_type: "Shift Type",
  bank: "Bank",
  comprehensive_health_participation: "Health Participation",
};
const filterFields = {
  department_id: { resource: "departments", label: "Department" },
  team_id: { resource: "teams", label: "Team" },
  position_id: { resource: "positions", label: "Position" },
  project_id: { resource: "projects", label: "Project" },
  governorate_id: { resource: "governorates", label: "Governorate" },
  gender: { resource: null, label: "Gender", controlled: true },
  employee_status: { resource: null, label: "Employee Status", controlled: true },
  employee_classification: { resource: null, label: "Employee Classification", controlled: true },
  marital_status_id: { resource: "marital-statuses", label: "Marital Status" },
  religion_id: { resource: "religions", label: "Religion" },
  diploma_id: { resource: "diplomas", label: "Diploma" },
  leaving_reason_id: { resource: "leaving-reasons", label: "Leaving Reason" },
  shift_type_id: { resource: "shift-types", label: "Shift Type" },
  bank_id: { resource: "banks", label: "Bank" },
};
const fallbackMetrics = [
  "total_employees",
  "active_employees",
  "resigned_employees",
  "new_hires",
  "missing_form_1",
  "contracts_expiring",
  "contracts_expired",
  "identity_expiring",
  "identity_expired",
];
const emptyDashboardData = {
  summary: { cards: [] },
  analysis: { data: [] },
  employees: { rows: [], total: 0, total_pages: 0 },
  attention: { items: [] },
};
const date = (value) =>
  value
    ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(
        new Date(`${value}T00:00:00`),
      )
    : "—";
const deadlineStatus = (value) => {
  if (!value) return "—";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${value}T00:00:00`);
  const days = Math.ceil((due - today) / 86400000);
  return days < 0 ? "Overdue" : days <= 30 ? "Due Soon" : "Upcoming";
};
const parseHash = () => {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const drill = [];
  for (let i = 0; params.get(`drill${i}_dimension`); i += 1)
    drill.push({
      dimension: params.get(`drill${i}_dimension`),
      key: params.get(`drill${i}_key`),
      label: params.get(`drill${i}_label`),
      filter_key: params.get(`drill${i}_filter`),
    });
  const state = {
    metric: params.get("metric") || "active_employees",
    dimension: params.get("dimension") || "department",
    from: params.get("from") || "",
    to: params.get("to") || "",
    search: params.get("search") || "",
    page: Number(params.get("page") || 1),
    drill,
  };
  Object.keys(filterFields).forEach((k) => {
    state[k] = params.get(k) || "";
  });
  return state;
};

export function Dashboard({ token, go }) {
  const [state, setState] = useState(parseHash);
  const [options, setOptions] = useState({
    metrics: fallbackMetrics,
    dimensions: Object.keys(dimensions),
  });
  const [lookups, setLookups] = useState({});
  const [data, setData] = useState(emptyDashboardData);
  const [historyReady, setHistoryReady] = useState(false);
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [coreLoading, setCoreLoading] = useState(true);
  const [secondaryLoading, setSecondaryLoading] = useState(false);
  const [secondaryMetric, setSecondaryMetric] = useState(null);
  const [loadError, setLoadError] = useState("");
  const lookupLoaded = useRef(false);
  const requestId = useRef(0);
  const drill = state.drill || [];
  const query = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(state).filter(
          ([k, v]) => k !== "drill" && k !== "page" && v !== "",
        ),
      ),
    [state],
  );

  useEffect(() => {
    dashboardApi
      .options(token)
      .then((next) => {
        setOptions(next);
        setLookups((current) => ({ ...current, ...(next.filter_options || {}) }));
        setState((current) => {
          const metric = (next.metrics || []).includes(current.metric)
            ? current.metric
            : (next.metrics || [])[0] || "active_employees";
          const dimension = (next.dimensions || []).includes(current.dimension)
            ? current.dimension
            : (next.dimensions || [])[0] || "department";
          const bank_id = (next.dimensions || []).includes("bank") ? current.bank_id : "";
          if (metric === current.metric && dimension === current.dimension && bank_id === current.bank_id) return current;
          return { ...current, metric, dimension, bank_id, page: 1 };
        });
      })
      .catch(() => {});
    const onPop = () => {
      if (location.hash.startsWith("#dashboard")) setState(parseHash());
    };
    addEventListener("popstate", onPop);
    addEventListener("hashchange", onPop);
    setHistoryReady(true);
    return () => {
      removeEventListener("popstate", onPop);
      removeEventListener("hashchange", onPop);
    };
  }, [token]);

  useEffect(() => {
    if (lookupLoaded.current) return;
    lookupLoaded.current = true;
    dashboardApi
      .filterOptions(token)
      .then((next) => setLookups((current) => ({ ...current, ...next })))
      .catch(() => { lookupLoaded.current = false; });
  }, [showMoreFilters, token]);

  useEffect(() => {
    if (!historyReady || !location.hash.startsWith("#dashboard")) return;
    const params = new URLSearchParams({ ...query, page: state.page || 1 });
    drill.forEach((item, index) => {
      params.set(`drill${index}_dimension`, item.dimension);
      params.set(`drill${index}_key`, item.key);
      params.set(`drill${index}_label`, item.label);
      params.set(`drill${index}_filter`, item.filter_key);
    });
    const next = `#dashboard?${params}`;
    if (location.hash !== next) {
      history.pushState(null, "", next);
    }
  }, [query, state.page, drill, historyReady]);

  useEffect(() => {
    if (!historyReady) return;
    const id = ++requestId.current;
    const params = { ...query, dimension: state.dimension, page: state.page || 1, page_size: 10 };
    setCoreLoading(true);
    setSecondaryLoading(true);
    setLoadError("");
    dashboardApi
      .overview(params, token)
      .then((core) => {
        if (id !== requestId.current) return;
        setData((current) => ({ ...current, ...core }));
        setCoreLoading(false);
        return dashboardApi.secondary(params, token)
          .then((secondary) => {
            if (id === requestId.current) {
              setData((current) => ({ ...current, ...secondary }));
              setSecondaryMetric(params.metric);
            }
          })
          .catch(() => {});
      })
      .catch(() => {
        if (id === requestId.current) {
          setCoreLoading(false);
          setSecondaryLoading(false);
          setLoadError("Dashboard data could not be loaded.");
        }
      })
      .finally(() => {
        if (id === requestId.current) setSecondaryLoading(false);
      });
  }, [
    token,
    JSON.stringify(query),
    state.dimension,
    state.metric,
    state.page,
    JSON.stringify(drill),
    historyReady,
  ]);

  const update = (key, value) =>
    setState((current) => ({
      ...current,
      [key]: value,
      page: 1,
      ...(key === "metric" ? { drill: [] } : {}),
    }));
  const clearAll = () =>
    setState((current) => ({
      ...current,
      from: "",
      to: "",
      search: "",
      page: 1,
      drill: [],
      ...Object.fromEntries(Object.keys(filterFields).map((key) => [key, ""])),
    }));
  const clearDrill = () =>
    setState((current) => ({
      ...current,
      drill: [],
      page: 1,
      ...Object.fromEntries(drill.map((item) => [item.filter_key, ""])),
    }));
  const chooseRange = (range) => {
    const today = new Date();
    let from = new Date(today);
    let to = new Date(today);
    if (range === "month") {
      from = new Date(today.getFullYear(), today.getMonth(), 1);
    }
    if (range === "last_month") {
      from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      to = new Date(today.getFullYear(), today.getMonth(), 0);
    }
    if (range === "quarter") {
      from = new Date(
        today.getFullYear(),
        Math.floor(today.getMonth() / 3) * 3,
        1,
      );
    }
    if (range === "year") {
      from = new Date(today.getFullYear(), 0, 1);
    }
    if (range === "last_year") {
      from = new Date(today.getFullYear() - 1, 0, 1);
      to = new Date(today.getFullYear() - 1, 11, 31);
    }
    setState((current) => ({
      ...current,
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      page: 1,
    }));
  };
  const drillInto = (item) => {
    if (item.key == null || item.key === "none") return;
    const filter = item.filter_key || `${state.dimension}_id`;
    const next =
      state.metric === "resigned_employees" && state.dimension === "department"
        ? "leaving_reason"
        : state.metric === "new_hires" && state.dimension === "department"
          ? "position"
          : state.dimension === "department"
            ? "team"
            : state.dimension === "team"
              ? "position"
              : "employee_status";
    setState((current) => ({
      ...current,
      [filter]: String(item.key),
      dimension: next,
      drill: [
        ...(current.drill || []),
        {
          dimension: current.dimension,
          key: item.key,
          label: item.label,
          filter_key: filter,
        },
      ],
      page: 1,
    }));
  };
  const backToDrill = (index) => setState((current) => {
    const keep = drill.slice(0, index + 1);
    const clear = Object.fromEntries(drill.slice(index + 1).map((item) => [item.filter_key, ""]));
    const base = keep.at(-1)?.dimension;
    const next = current.metric === "resigned_employees" && base === "department" ? "leaving_reason" : current.metric === "new_hires" && base === "department" ? "position" : base === "department" ? "team" : base === "team" ? "position" : "employee_status";
    return { ...current, ...clear, drill: keep, dimension: next, page: 1 };
  });
  const metricList = (options.metrics || fallbackMetrics).filter(
    (key) => labels[key],
  );
  const dimensionList = (options.dimensions || Object.keys(dimensions)).filter(
    (key) => dimensions[key],
  );
  const max = Math.max(
    ...(data?.analysis?.data || []).map((row) => row.count),
    1,
  );
  const hasCoreData = (data.summary.cards || []).length > 0;
  const coreRefreshing = coreLoading && hasCoreData;
  const displayedMetric = data.analysis?.metric || state.metric;
  const displayedDimension = data.analysis?.dimension || state.dimension;
  const displayedSecondaryMetric = secondaryMetric || displayedMetric;
  const chips = Object.entries(query).filter(
    ([key]) => !["metric", "dimension", "from", "to"].includes(key),
  );
  const filterLabel = (key) => filterFields[key]?.label || dimensions[key] || key.replaceAll("_", " ");
  const employeeRows = data.employees.rows || [];
  const chart = (title, items, clickable = true) => (
    <section className={`analytics-card mini-chart${secondaryLoading && (items || []).length ? " is-refreshing" : ""}`}>
      <div className="mini-chart-head">
        <p className="eyebrow">{title}</p>
        {secondaryLoading && (items || []).length > 0 && <span className="dashboard-updating">Updating…</span>}
      </div>
      {secondaryLoading && !(items || []).length ? <p className="muted">Loading breakdown…</p> : <div className="mini-bars">
        {(items || []).slice(0, 8).map((item) => (
          <button
            key={`${item.key}-${item.label}`}
            onClick={clickable && !secondaryLoading ? () => drillInto(item) : undefined}
          >
            <span
              style={{
                width: `${Math.max(8, (item.count / Math.max(...(items || []).map((x) => x.count), 1)) * 100)}%`,
              }}
            />
            <b>{item.label}</b>
            <strong>{item.count}</strong>
          </button>
        ))}
      </div>}
    </section>
  );
  return (
    <section className="section-view dashboard-view">
      <div className="dashboard-hero">
        <div>
          <p className="eyebrow">HR OVERVIEW</p>
          <h1>Dashboard</h1>
          <p>Workforce overview and HR actions requiring attention.</p>
        </div>
        <button className="secondary" onClick={clearDrill}>
          <X size={15} />
          Clear Selection
        </button>
      </div>
      <div className="analytics-path">
        <button onClick={clearDrill}>Dashboard</button>
        <ChevronRight size={14} />
        <strong>{labels[state.metric] || state.metric}</strong>
        {drill.map((item, index) => (
          <span className="path-item" key={`${item.key}-${index}`}>
            <ChevronRight size={14} />
            <button
              onClick={() => backToDrill(index)}
            >
              {item.label}
            </button>
          </span>
        ))}
      </div>
      <div className="dashboard-filters">
        <Filter size={17} />
        <div className="quick-ranges dashboard-period">
          <span>Period</span>
          <button onClick={() => chooseRange("month")}>This Month</button>
          <button onClick={() => chooseRange("last_month")}>Last Month</button>
          <button onClick={() => chooseRange("quarter")}>This Quarter</button>
          <button onClick={() => chooseRange("year")}>This Year</button>
        </div>
        <label>
          Department
          <select value={state.department_id} onChange={(event) => update("department_id", event.target.value)}>
            <option value="">All departments</option>
            {(lookups.departments || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label>
          Search
          <span className="input-with-icon">
            <Search size={14} />
            <input
              value={state.search}
              placeholder="Search employee ID or name..."
              onChange={(event) => update("search", event.target.value)}
            />
          </span>
        </label>
        <button className="secondary more-filters-toggle" onClick={() => setShowAdvanced((visible) => !visible)}>{showAdvanced ? "Hide" : "Advanced"} Analysis</button>
        {showAdvanced && <>
        <label>
          Analyze
          <select
            value={state.metric}
            onChange={(event) => update("metric", event.target.value)}
          >
            {metricList.map((key) => (
              <option key={key} value={key}>
                {labels[key]}
              </option>
            ))}
          </select>
        </label>
        <label>
          View by
          <select
            value={state.dimension}
            onChange={(event) => update("dimension", event.target.value)}
          >
            {dimensionList.map((key) => (
              <option key={key} value={key}>
                {dimensions[key]}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input
            type="date"
            value={state.from}
            onChange={(event) => update("from", event.target.value)}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={state.to}
            onChange={(event) => update("to", event.target.value)}
          />
        </label>
        <button className="secondary" onClick={() => chooseRange("last_year")}>Last Year</button>
        </>}
        <button className="secondary more-filters-toggle" onClick={() => setShowMoreFilters((visible) => !visible)}>{showMoreFilters ? "Hide" : "More"} Filters</button>
        {showMoreFilters && Object.entries(filterFields).filter(([key]) => key !== "department_id" && (key !== "bank_id" || dimensionList.includes("bank"))).map(([key, field]) => (
          <label key={key}>
            {field.label}
            <select
              value={state[key]}
              onChange={(event) => update(key, event.target.value)}
            >
              <option value="">All {field.label.toLowerCase()}s</option>
              {(lookups[field.resource || key] || []).map(
                (item) => (
                  <option
                    key={item.id || item.value}
                    value={item.id || item.value}
                  >
                    {item.name || item.label || item.value}
                  </option>
                ),
              )}
            </select>
          </label>
        ))}
      </div>
      {loadError && <p className="employee-notice danger">{loadError}</p>}
      <div className="filter-chips">
        {state.from && (
          <button onClick={() => update("from", "")}>
            {state.from}
            <X size={12} />
          </button>
        )}
        {state.to && (
          <button onClick={() => update("to", "")}>
            {state.to}
            <X size={12} />
          </button>
        )}
        {chips.map(([key, value]) => (
          <button key={key} onClick={() => update(key, "")}>
            {filterLabel(key)}: {value}
            <X size={12} />
          </button>
        ))}
        {chips.length + (state.from ? 1 : 0) + (state.to ? 1 : 0) > 0 && (
          <button className="clear-chip" onClick={clearAll}>
            Clear all
          </button>
        )}
      </div>
      <div className="dashboard-presets" aria-label="Common HR views">
        {[['active_employees', 'Workforce Overview'], ['new_hires', 'New Hires'], ['resigned_employees', 'Resignations'], ['contracts_expiring', 'Contracts & Expirations'], ['missing_form_1', 'Missing HR Documents'], ['medical_eligible', 'Insurance Eligibility']].filter(([metric]) => metricList.includes(metric)).map(([metric, label]) => (
          <button key={metric} className={state.metric === metric ? "selected" : ""} onClick={() => setState((current) => ({ ...current, metric, dimension: "department", drill: [], page: 1 }))}>{label}</button>
        ))}
      </div>
      <div className="dashboard-kpis">
        {(data.summary.cards || []).map((card) => (
          <button
            key={card.metric}
            className={state.metric === card.metric ? "selected" : ""}
            onClick={() => update("metric", card.metric)}
          >
            <span>{labels[card.metric] || card.label}</span>
            <strong>{card.count}</strong>
            <small>Current context</small>
          </button>
        ))}
      </div>
      {drill.length > 0 && (
        <label className="next-dimension">
          Break selected data down by
          <select
            value={state.dimension}
            onChange={(event) => update("dimension", event.target.value)}
          >
            {dimensionList.map((key) => (
              <option key={key} value={key}>
                {dimensions[key]}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="dashboard-grid">
        <section className={`analytics-card primary-chart${coreRefreshing ? " is-refreshing" : ""}`}>
          <header>
            <div>
              <p className="eyebrow">WORKFORCE VIEW</p>
              <h2>
                {labels[displayedMetric] || displayedMetric} by{" "}
                {dimensions[displayedDimension] || displayedDimension}
              </h2>
            </div>
            <div className="dashboard-card-actions">
              {coreRefreshing && <span className="dashboard-updating">Updating analysis…</span>}
              <BarChart3 />
            </div>
          </header>
          <div className="bar-chart">
            {(data.analysis.data || []).length ? (
              (data.analysis.data || []).map((item) => (
                <button
                  className="chart-bar"
                  key={`${item.key}-${item.label}`}
                  onClick={!coreLoading ? () => drillInto(item) : undefined}
                  aria-label={`Drill into ${item.label}, ${item.count}`}
                >
                  <span className="bar-value">{item.count}</span>
                  <span className="bar-track">
                    <i
                      style={{
                        height: `${Math.max(8, (item.count / max) * 100)}%`,
                      }}
                    />
                  </span>
                  <span>{item.label}</span>
                </button>
              ))
            ) : (
              <p className="muted">{coreLoading ? "Loading results…" : "No employees match this selection. Try changing the period or filters."}</p>
            )}
          </div>
        </section>
        <section className={`analytics-card attention${coreRefreshing ? " is-refreshing" : ""}`}>
          <header>
            <div>
              <p className="eyebrow">HR ATTENTION</p>
              <h2>Actionable signals</h2>
            </div>
          </header>
          {coreLoading && !(data.attention.items || []).length && <p className="muted">Loading attention signals…</p>}
          {coreRefreshing && <span className="dashboard-updating">Updating…</span>}
          {(data.attention.items || []).map((item) => (
            <button
              key={item.metric}
              onClick={() => update("metric", item.metric)}
            >
              <span>{item.label}</span>
              <strong>{item.count}</strong>
            </button>
          ))}
        </section>
      </div>
      <div className="secondary-analytics">
        {displayedSecondaryMetric === "resigned_employees" ? (
          <>
            {chart("Employee status distribution", data.status?.data, false)}
            {chart("Resignations by leaving reason", data.leavingReason?.data)}
            {chart("Resignations by position", data.position?.data)}
            {chart("Top departments", data.department?.data)}
          </>
        ) : displayedSecondaryMetric === "new_hires" ? (
          <>
            {chart("Employee status distribution", data.status?.data, false)}
            {chart("New hires by position", data.position?.data)}
            {chart("New hires by project", data.project?.data)}
            {chart("New hires by department", data.department?.data)}
          </>
        ) : (
          <>
            {chart("Employee status distribution", data.status?.data, false)}
            {chart("Employees by department", data.department?.data)}
            {chart("Gender distribution", data.gender?.data, false)}
          </>
        )}
      </div>
      {(data.newHireTrend?.data?.length > 0 || data.resignTrend?.data?.length > 0) && (
        <section className="analytics-card trend-card">
          <p className="eyebrow">WORKFORCE MOVEMENT</p>
          <h2>New hires vs resignations</h2>
          <div className="trend-list">
            {(data.newHireTrend?.data || []).map(
              (item, index) => (
                <span key={item.period}>
                  <b>{item.period}</b>
                  <strong>Hires {item.count}</strong>
                  <small>
                    Resignations{" "}
                    {(data.resignTrend?.data || [])[index]?.count || 0}
                  </small>
                </span>
              ),
            )}
          </div>
        </section>
      )}
      <section className={`analytics-card employee-drill${coreRefreshing ? " is-refreshing" : ""}`}>
        <header>
          <div>
            <p className="eyebrow">EMPLOYEES</p>
            <h2>{!hasCoreData && coreLoading ? "Loading employees…" : `${data.employees.total} employees in this view`}</h2>
            {coreRefreshing && <span className="dashboard-updating">Updating results…</span>}
          </div>
        </header>
        <div className="employee-table-wrap">
          <table className="employee-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Arabic Name</th>
                <th>English Name</th>
                <th>Status</th>
                <th>Department</th>
                <th>Position</th>
                <th>
                  {displayedMetric === "new_hires"
                    ? "Joining Date"
                    : displayedMetric === "resigned_employees"
                      ? "Leaving Date"
                      : displayedMetric === "missing_form_1"
                        ? "Contract Signing"
                        : "Expiration"}
                </th>
                <th> </th>
                {displayedMetric === "missing_form_1" && (
                  <>
                    <th>Form 1 Deadline</th>
                    <th>Deadline Status</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {employeeRows.map((row) => (
                  <tr key={row.id} tabIndex="0" onClick={() => window.location.assign(`/#employees/${row.id}`)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") window.location.assign(`/#employees/${row.id}`); }}>
                  <td>#{row.employee_number}</td>
                  <td dir="rtl">{row.arabic_full_name}</td>
                  <td>
                    <strong>{row.english_full_name}</strong>
                  </td>
                  <td>{row.employee_status}</td>
                  <td>{row.department_name || "—"}</td>
                  <td>{row.position_name || "—"}</td>
                  <td>
                    {date(
                      displayedMetric === "new_hires"
                        ? row.joining_date
                        : displayedMetric === "resigned_employees"
                          ? row.leaving_date
                          : displayedMetric === "missing_form_1"
                            ? row.contract_signing_date
                            : row.contract_expiration_date,
                    )}
                  </td>
                  {displayedMetric === "missing_form_1" && (
                    <>
                      <td>{date(row.form_1_deadline)}</td>
                      <td>
                        <span
                          className={`deadline-${deadlineStatus(row.form_1_deadline).toLowerCase().replace(" ", "-")}`}
                        >
                          {deadlineStatus(row.form_1_deadline)}
                        </span>
                      </td>
                    </>
                  )}
                  <td><button className="text-button" onClick={(event) => { event.stopPropagation(); window.location.assign(`/#employees/${row.id}`); }}>View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.employees.total_pages > 1 && (
          <div className="pagination">
            <button
              disabled={state.page <= 1}
              onClick={() =>
                setState((current) => ({ ...current, page: current.page - 1 }))
              }
            >
              Previous
            </button>
            <span>
              Page {state.page} of {data.employees.total_pages}
            </span>
            <button
              disabled={state.page >= data.employees.total_pages}
              onClick={() =>
                setState((current) => ({ ...current, page: current.page + 1 }))
              }
            >
              Next
            </button>
          </div>
        )}
      </section>
    </section>
  );
}
