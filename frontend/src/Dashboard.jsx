import { useEffect, useMemo, useState } from "react";
import { BarChart3, ChevronRight, Filter, Search, X } from "lucide-react";
import { dashboardApi, setupApi } from "./api";

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
let bankAllowed = true;
const filterFields = new Proxy(
  {
    department_id: ["department", "Department"],
    team_id: ["team", "Team"],
    position_id: ["position", "Position"],
    project_id: ["project", "Project"],
    governorate_id: ["governorate", "Governorate"],
    gender: ["gender", "Gender"],
    employee_status: ["employee_status", "Employee Status"],
    employee_classification: ["classification", "Employee Classification"],
    marital_status_id: ["marital_status", "Marital Status"],
    religion_id: ["religion", "Religion"],
    diploma_id: ["diploma", "Diploma"],
    leaving_reason_id: ["leaving_reason", "Leaving Reason"],
    shift_type_id: ["shift_type", "Shift Type"],
    bank_id: ["bank", "Bank"],
  },
  {
    ownKeys: (target) =>
      bankAllowed
        ? Reflect.ownKeys(target)
        : Reflect.ownKeys(target).filter((key) => key !== "bank_id"),
    getOwnPropertyDescriptor: (target, key) =>
      Object.getOwnPropertyDescriptor(target, key),
  },
);
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
  const [data, setData] = useState(null);
  const [historyReady, setHistoryReady] = useState(false);
  const [showMoreFilters, setShowMoreFilters] = useState(false);
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
        bankAllowed = (next.dimensions || []).includes("bank");
        setOptions(next);
        setState((current) => ({
          ...current,
          metric: (next.metrics || []).includes(current.metric)
            ? current.metric
            : (next.metrics || [])[0] || "active_employees",
          dimension: (next.dimensions || []).includes(current.dimension)
            ? current.dimension
            : (next.dimensions || [])[0] || "department",
          bank_id: bankAllowed ? current.bank_id : "",
          page: 1,
        }));
      })
      .catch(() => {});
    Promise.all(Object.values(filterFields).map(([, resource]) => resource))
      .then(() =>
        Promise.all(
          [
            "departments",
            "teams",
            "positions",
            "projects",
            "governorates",
            "genders",
            "employee_statuses",
            "employee_classifications",
            "marital_statuses",
            "religions",
            "diplomas",
            "leaving_reasons",
            "shift_types",
            "banks",
          ].map((resource) =>
            setupApi
              .master(resource, token)
              .then((value) => [resource, value])
              .catch(() => [resource, []]),
          ),
        ),
      )
      .then((entries) => setLookups(Object.fromEntries(entries)));
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
    Promise.all([
      dashboardApi.summary(query, token),
      dashboardApi.analysis({ ...query, dimension: state.dimension }, token),
      dashboardApi.employees(
        { ...query, page: state.page || 1, page_size: 10 },
        token,
      ),
      dashboardApi.attention(query, token),
      state.metric === "new_hires" || state.metric === "resigned_employees"
        ? dashboardApi.trend({ ...query, metric: state.metric }, token)
        : Promise.resolve({ data: [] }),
      dashboardApi
        .trend({ ...query, metric: "new_hires" }, token)
        .catch(() => ({ data: [] })),
      dashboardApi
        .trend({ ...query, metric: "resigned_employees" }, token)
        .catch(() => ({ data: [] })),
      dashboardApi.analysis(
        { ...query, metric: "active_employees", dimension: "employee_status" },
        token,
      ),
      dashboardApi.analysis(
        { ...query, metric: "active_employees", dimension: "gender" },
        token,
      ),
      dashboardApi.analysis(
        { ...query, metric: state.metric, dimension: "department" },
        token,
      ),
      dashboardApi.analysis(
        { ...query, metric: state.metric, dimension: "position" },
        token,
      ),
      dashboardApi.analysis(
        { ...query, metric: state.metric, dimension: "leaving_reason" },
        token,
      ),
      dashboardApi.analysis(
        { ...query, metric: state.metric, dimension: "project" },
        token,
      ),
    ])
      .then(
        ([
          summary,
          analysis,
          employees,
          attention,
          trend,
          newHireTrend,
          resignTrend,
          status,
          gender,
          department,
          position,
          leavingReason,
          project,
        ]) =>
          setData({
            summary,
            analysis,
            employees,
            attention,
            trend,
            newHireTrend,
            resignTrend,
            status,
            gender,
            department,
            position,
            leavingReason,
            project,
          }),
      )
      .catch(() => setData({ error: true }));
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
  if (!data)
    return (
      <section className="section-view">
        <div className="loading-list">
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      </section>
    );
  if (data.error)
    return (
      <section className="section-view">
        <p className="employee-notice danger">
          Dashboard data could not be loaded.
        </p>
      </section>
    );
  const chips = Object.entries(query).filter(
    ([key]) => !["metric", "dimension", "from", "to"].includes(key),
  );
  const employeeRows = data.employees.rows || [];
  const chart = (title, items, clickable = true) => (
    <section className="analytics-card mini-chart">
      <p className="eyebrow">{title}</p>
      <div className="mini-bars">
        {(items || []).slice(0, 8).map((item) => (
          <button
            key={`${item.key}-${item.label}`}
            onClick={() => clickable && drillInto(item)}
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
      </div>
    </section>
  );
  return (
    <section className="section-view dashboard-view">
      <div className="dashboard-hero">
        <div>
          <p className="eyebrow">LIVE HR INTELLIGENCE</p>
          <h1>Workforce analytics</h1>
          <p>Explore the people and events behind every HR decision.</p>
        </div>
        <button className="secondary" onClick={clearDrill}>
          <X size={15} />
          Clear drill-down
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
        <label>
          Metric
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
          Group by
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
        <div className="quick-ranges">
          <button onClick={() => chooseRange("month")}>This Month</button>
          <button onClick={() => chooseRange("last_month")}>Last Month</button>
          <button onClick={() => chooseRange("quarter")}>This Quarter</button>
          <button onClick={() => chooseRange("year")}>This Year</button>
          <button onClick={() => chooseRange("last_year")}>Last Year</button>
        </div>
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
        <label>
          Search
          <span className="input-with-icon">
            <Search size={14} />
            <input
              value={state.search}
              placeholder="ID or name"
              onChange={(event) => update("search", event.target.value)}
            />
          </span>
        </label>
        <button className="secondary more-filters-toggle" onClick={() => setShowMoreFilters((visible) => !visible)}>{showMoreFilters ? "Hide" : "More"} Filters</button>
        {showMoreFilters && Object.entries(filterFields).filter(([key]) => key !== "bank_id" || dimensionList.includes("bank")).map(([key, [resource, label]]) => (
          <label key={key}>
            {label}
            <select
              value={state[key]}
              onChange={(event) => update(key, event.target.value)}
            >
              <option value="">All {label.toLowerCase()}s</option>
              {(lookups[`${resource}s`] || lookups[resource] || []).map(
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
            {key.replaceAll("_", " ")}: {value}
            <X size={12} />
          </button>
        ))}
        {chips.length + (state.from ? 1 : 0) + (state.to ? 1 : 0) > 0 && (
          <button className="clear-chip" onClick={clearAll}>
            Clear all
          </button>
        )}
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
        <section className="analytics-card primary-chart">
          <header>
            <div>
              <p className="eyebrow">PRIMARY ANALYSIS</p>
              <h2>
                {labels[state.metric] || state.metric} by{" "}
                {dimensions[state.dimension] || state.dimension}
              </h2>
            </div>
            <BarChart3 />
          </header>
          <div className="bar-chart">
            {(data.analysis.data || []).length ? (
              (data.analysis.data || []).map((item) => (
                <button
                  className="chart-bar"
                  key={`${item.key}-${item.label}`}
                  onClick={() => drillInto(item)}
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
              <p className="muted">No matching data in this context.</p>
            )}
          </div>
        </section>
        <section className="analytics-card attention">
          <header>
            <div>
              <p className="eyebrow">HR ATTENTION</p>
              <h2>Actionable signals</h2>
            </div>
          </header>
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
        {state.metric === "resigned_employees" ? (
          <>
            {chart("Employee status distribution", data.status?.data, false)}
            {chart("Resignations by leaving reason", data.leavingReason?.data)}
            {chart("Resignations by position", data.position?.data)}
            {chart("Top departments", data.department?.data)}
          </>
        ) : state.metric === "new_hires" ? (
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
      {(data.trend?.data?.length > 0 ||
        data.newHireTrend?.data?.length > 0) && (
        <section className="analytics-card trend-card">
          <p className="eyebrow">WORKFORCE MOVEMENT</p>
          <h2>New hires vs resignations</h2>
          <div className="trend-list">
            {(data.newHireTrend?.data || data.trend?.data || []).map(
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
      <section className="analytics-card employee-drill">
        <header>
          <div>
            <p className="eyebrow">EMPLOYEE DRILL-THROUGH</p>
            <h2>{data.employees.total} employees behind this analysis</h2>
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
                  {state.metric === "new_hires"
                    ? "Joining Date"
                    : state.metric === "resigned_employees"
                      ? "Leaving Date"
                      : state.metric === "missing_form_1"
                        ? "Contract Signing"
                        : "Expiration"}
                </th>
                <th> </th>
                {state.metric === "missing_form_1" && (
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
                      state.metric === "new_hires"
                        ? row.joining_date
                        : state.metric === "resigned_employees"
                          ? row.leaving_date
                          : state.metric === "missing_form_1"
                            ? row.contract_signing_date
                            : row.contract_expiration_date,
                    )}
                  </td>
                  {state.metric === "missing_form_1" && (
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
