import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CalendarClock,
  ChevronRight,
  CircleAlert,
  FilePlus2,
  HeartPulse,
  Pencil,
  Plus,
  RefreshCw,
  ShieldAlert,
  UserRoundPlus,
} from "lucide-react";
import {
  employeesApi,
  documentsApi,
  setupApi,
  employeeLookupApi,
  invalidateDashboardData,
  subscribeEmployeeLookupInvalidation,
  socialInsuranceApi,
  subscribeSocialInsuranceInvalidation,
} from "./api";
import { supabase } from "./auth";
import { Modal } from "./Modal";
import { workQueue } from "./workQueues";
import { DIRECTORY_DEFAULTS, EMPLOYEE_CLASSIFICATIONS, EMPLOYEE_STATUSES, employeeClassificationLabel, employeeStatusLabel, normalizeEmployeeClassification } from "./employeeContract";
import {
  currentDirectoryContext,
  editRouteFromProfile,
  profileDirectoryContext,
  profileRouteFromEditor,
  profileRouteFromDirectory,
} from "./employeeNavigation";

const resources = [
  "religions",
  "marital-statuses",
  "diplomas",
  "governorates",
  "departments",
  "shift-types",
  "teams",
  "positions",
  "projects",
  "banks",
  "leaving-reasons",
  "license-types",
];
const emptyForm = {
  gender: "male",
  arabic_full_name: "",
  english_full_name: "",
  identity_card_number: "",
  identity_card_expiration_date: "",
  date_of_birth: "",
  religion_id: "",
  marital_status_id: "",
  diploma_id: "",
  major: "",
  graduated_from: "",
  phone: "",
  governorate_id: "",
  address: "",
  employee_classification: "standard",
  department_id: "",
  shift_type_id: "",
  team_id: "",
  position_id: "",
  project_id: "",
  joining_date: "",
  contract_signing_date: "",
  social_insurance_active: false,
  social_insurance_comment: "",
  form_1_incoming_number: "",
  form_1_incoming_date: "",
  bank_id: "",
  bank_account_number: "",
};
const draftId = () =>
  typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const emptyFamily = () => ({ wives: [], children: [] });
const labels = {
  personal: "Personal",
  family: "Family",
  work: "Work",
  insurance: "Insurance",
  financial: "Financial",
  licenses: "Licenses",
  documents: "Documents & Compliance",
  contracts: "Contract History",
  notifications: "Notifications",
};
const date = (value) =>
  value
    ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(
        new Date(`${value}T00:00:00`),
      )
    : "—";
const timestampDate = (value) => value ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Africa/Cairo" }).format(new Date(value)) : "—";

const notificationCopy = {
  identity_card_expiry: { title: "Identity card expiry", category: "Identity documents", section: "personal" },
  license_expiry: { title: "License expiry", category: "Documents & compliance", section: "licenses" },
  form_1_deadline: { title: "Form 1 deadline", category: "Social insurance", section: "insurance" },
  medical_insurance_eligibility: { title: "Medical insurance", category: "Benefits", section: "insurance" },
  life_insurance_eligibility: { title: "Life insurance", category: "Benefits", section: "insurance" },
};
const referenceCopy = {
  "insurance.life": { title: "Life insurance", category: "Benefits", section: "insurance" },
  "insurance.medical": { title: "Medical insurance", category: "Benefits", section: "insurance" },
  "personal.identity_card_expiration_date": { title: "Identity card expiry", category: "Identity documents", section: "personal" },
};
const notificationMeta = (item) => referenceCopy[item.reference_key] || notificationCopy[item.notification_type] || { title: "Employee notification", category: "Employee record", section: "overview" };
const notificationDayDistance = (value) => {
  if (!value) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(`${value}T00:00:00`);
  return Math.round((due - today) / 86400000);
};
const reminderText = (days) => days === 0 ? "Due today" : days > 0 ? `Due in ${days} day${days === 1 ? "" : "s"}` : `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"}`;
const daysFromToday = (value) => {
  if (!value) return "—";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(`${value}T00:00:00`);
  const days = Math.ceil((target - today) / 86400000);
  return days < 0 ? `${Math.abs(days)} days overdue` : days === 0 ? "Due today" : `${days} days remaining`;
};
const employeeListHash = () => {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const queue = params.get("queue") || "";
  const status = params.get("status") || (queue ? "" : DIRECTORY_DEFAULTS.status);
  const requestedClassification = normalizeEmployeeClassification(params.get("classification") || DIRECTORY_DEFAULTS.classification);
  const classification = status === "resigned" || !["all", ...EMPLOYEE_CLASSIFICATIONS.map(({ value }) => value)].includes(requestedClassification) ? "all" : requestedClassification;
  return {
    search: params.get("search") || "", status, classification, department: params.get("department") || "", team: params.get("team") || "", position: params.get("position") || "", project: params.get("project") || "", governorate: params.get("governorate") || "", queue, from: params.get("from") || "", to: params.get("to") || "",
    page: Number(params.get("page") || 1), pageSize: Number(params.get("page_size") || 25), sort: params.get("sort") || "employee_number", direction: params.get("direction") || "asc",
  };
};
const isEmployeeDirectoryHash = () => /^#employees(?:\?|$)/.test(location.hash);
const option = (items, id) =>
  items?.find((item) => String(item.id) === String(id));
const clean = (form, includeFinancial = true) =>
  Object.fromEntries(
    Object.entries(form)
      .filter(
        ([key]) =>
          includeFinancial || !["bank_id", "bank_account_number"].includes(key),
      )
      .map(([key, value]) => [
        key,
        value === ""
          ? null
          : [
                "religion_id",
                "marital_status_id",
                "diploma_id",
                "governorate_id",
                "department_id",
                "shift_type_id",
                "team_id",
                "position_id",
                "project_id",
                "bank_id",
              ].includes(key) && value != null
            ? Number(value)
            : value,
      ]),
  );
const employeeFormValues = (employee) => ({
  ...emptyForm,
  ...employee.personal,
  ...employee.work,
  ...employee.insurance,
  ...employee.financial,
  bank_id: employee.financial?.bank?.id || "",
  employee_classification: normalizeEmployeeClassification(employee.employee_classification) || "standard",
});
const numericFormFields = new Set([
  "religion_id",
  "marital_status_id",
  "diploma_id",
  "governorate_id",
  "department_id",
  "shift_type_id",
  "team_id",
  "position_id",
  "project_id",
  "bank_id",
]);
const normalizeFormValue = (key, value) => {
  if (value == null || value === "") return null;
  if (numericFormFields.has(key)) return Number(value);
  return value;
};
const formSnapshot = (form) =>
  Object.keys(form)
    .sort()
    .map((key) => [key, normalizeFormValue(key, form[key])]);
const sameForm = (left, right) =>
  JSON.stringify(formSnapshot(left)) === JSON.stringify(formSnapshot(right));

function useEmployeeInvalidation(employeeId, token, onInvalidated) {
  const handler = useRef(onInvalidated);
  const refreshing = useRef(false);
  useEffect(() => {
    handler.current = onInvalidated;
  });
  useEffect(() => {
    if (!supabase || !employeeId || !token) return undefined;
    let active = true;
    let subscribed = false;
    const invalidate = () => {
      if (!active || refreshing.current) return;
      refreshing.current = true;
      Promise.resolve(handler.current?.()).finally(() => {
        refreshing.current = false;
      });
    };
    const channel = supabase
      .channel(`employee:${employeeId}`, { config: { private: true } })
      .on("broadcast", { event: "employee_invalidated" }, invalidate)
      .subscribe((status) => {
        if (!active || status !== "SUBSCRIBED") return;
        if (subscribed) invalidate();
        subscribed = true;
      });
    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [employeeId, token]);
}

function Badge({ status }) {
  const safeStatus = EMPLOYEE_STATUSES.includes(status) ? status : "unknown";
  return (
    <span className={`employee-badge ${safeStatus}`}>
      {employeeStatusLabel(status)}
    </span>
  );
}
function Notice({ children, kind = "info" }) {
  return (
    <div className={`employee-notice ${kind}`}>
      <CircleAlert size={16} />
      {children}
    </div>
  );
}
function Select({
  label,
  name,
  form,
  setForm,
  options,
  required,
  position,
  disabled,
}) {
  return (
    <label>
      {label}
      {required && <b className="required">*</b>}
      <select
        required={required}
        disabled={disabled}
        value={form[name] ?? ""}
        onChange={(e) => setForm({ ...form, [name]: e.target.value })}
      >
        <option value="">Select {label}</option>
        {(options || [])
          .filter((x) => x.is_active !== false)
          .map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
              {position ? ` · ${x.position_code}` : ""}
            </option>
          ))}
      </select>
    </label>
  );
}
function Field({
  label,
  name,
  form,
  setForm,
  type = "text",
  required,
  disabled,
  hint,
}) {
  return (
    <label>
      {label}
      {required && <b className="required">*</b>}
      <input
        type={type}
        required={required}
        disabled={disabled}
        value={form[name] ?? ""}
        onChange={(e) => setForm({ ...form, [name]: e.target.value })}
      />
      {hint && <small>{hint}</small>}
    </label>
  );
}
function Section({ title, subtitle, children }) {
  return (
    <section className="employee-form-section">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function useLookups(token, enabled = true) {
  const [lookups, setLookups] = useState(null);
  const [version, setVersion] = useState(0);
  useEffect(
    () =>
      subscribeEmployeeLookupInvalidation(() =>
        setVersion((current) => current + 1),
      ),
    [],
  );
  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    employeeLookupApi
      .get(token)
      .then((data) => {
        if (active) setLookups(data);
      })
      .catch(() => {
        if (active) setLookups({});
      });
    return () => {
      active = false;
    };
  }, [token, enabled, version]);
  return lookups;
}

export function EmployeesList({ token, go, toast, capabilities = [] }) {
  const [records, setRecords] = useState(null);
  const [recordResignation, setRecordResignation] = useState(false);
  const lookup = useLookups(token, !!records || recordResignation);
  const [filters, setFilters] = useState(employeeListHash);
  const [pagination, setPagination] = useState(null);
  const [error, setError] = useState("");
  const [requestKey, setRequestKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  // Initialise from the hash so a shared URL never briefly requests the full
  // directory before its server-side search condition is applied.
  const [debouncedSearch, setDebouncedSearch] = useState(() => employeeListHash().search);
  const requestId = useRef(0);
  const requestController = useRef(null);
  const queue = workQueue(filters.queue);
  useEffect(() => {
    // A profile URL also carries a `return_to` directory context. Do not let
    // this still-mounted list rewrite that profile route before AppShell swaps
    // the view, otherwise a queue-to-profile transition loses its source.
    const sync = () => {
      if (isEmployeeDirectoryHash()) setFilters(employeeListHash());
    };
    addEventListener("hashchange", sync); addEventListener("popstate", sync);
    return () => { removeEventListener("hashchange", sync); removeEventListener("popstate", sync); };
  }, []);
  useEffect(() => {
    if (!isEmployeeDirectoryHash()) return;
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      const queryKey = key === "pageSize" ? "page_size" : key;
      if (value !== "" && value != null && !(key === "page" && Number(value) === 1) && !(key === "pageSize" && Number(value) === 25) && !(key === "sort" && value === "employee_number") && !(key === "direction" && value === "asc")) params.set(queryKey, String(value));
    });
    const next = `#employees${params.toString() ? `?${params}` : ""}`;
    if (location.hash !== next) history.replaceState(null, "", next);
  }, [JSON.stringify(filters)]);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(filters.search), 320);
    return () => clearTimeout(timer);
  }, [filters.search]);
  useEffect(() => {
    const controller = new AbortController();
    const id = ++requestId.current;
    requestController.current?.abort();
    requestController.current = controller;
    setLoading(true);
    setError("");
    employeesApi
      .listEmployees(
        { ...filters, search: debouncedSearch },
        token,
        controller.signal,
      )
      .then((result) => {
        if (id !== requestId.current) return;
        setRecords(result.data || []);
        setPagination(result.pagination);
      })
      .catch((e) => {
        if (e.name === "AbortError" || id !== requestId.current) return;
        if (!records) setRecords([]);
        setError("Unable to load employees. Please try again.");
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });
    return () => controller.abort();
  }, [
    token,
    debouncedSearch,
    filters.status,
    filters.classification,
    filters.department,
    filters.team,
    filters.position,
    filters.project,
    filters.governorate,
    filters.queue,
    filters.from,
    filters.to,
    filters.page,
    filters.pageSize,
    filters.sort,
    filters.direction,
    requestKey,
  ]);
  const update = (key, value) => setFilters((current) => ({
    ...current,
    [key]: value,
    ...(key === "status" && value === "resigned" ? { classification: "all" } : {}),
    page: 1,
  }));
  const setPage = (page) => setFilters((current) => ({ ...current, page }));
  const lookupKey = {
    department: "departments",
    team: "teams",
    position: "positions",
    project: "projects",
    governorate: "governorates",
  };
  const select = (key, title) => (
    <select
      aria-label={title}
      value={filters[key] || ""}
      onChange={(e) => update(key, e.target.value)}
    >
      <option value="">All {title}</option>
      {lookup?.[lookupKey[key]]
        ?.filter((x) => x.is_active)
        .map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
    </select>
  );
  const filterLabel = (key, value) => {
    if (key === "status") return `Status: ${employeeStatusLabel(value)}`;
    if (key === "classification") return `Classification: ${employeeClassificationLabel(value)}`;
    if (key === "from") return `From: ${date(value)}`;
    if (key === "to") return `To: ${date(value)}`;
    const item = lookup?.[lookupKey[key]]?.find((entry) => String(entry.id) === String(value));
    const titles = { department: "Department", team: "Team", position: "Position", project: "Project", governorate: "Governorate" };
    return `${titles[key] || key.replace(/_/g, " ")}: ${item?.name || value}`;
  };
  const activeFilters = Object.entries(filters).filter(
    ([key, value]) =>
      !["search", "page", "pageSize", "sort", "direction", "queue"].includes(key) &&
      value && !(key === "classification" && value === "all") && !(key === "status" && !queue && value === DIRECTORY_DEFAULTS.status),
  );
  const total = pagination?.total ?? 0;
  const start =
    total === 0 ? 0 : (pagination.page - 1) * pagination.page_size + 1;
  const end = Math.min(start + (records?.length || 0) - 1, total);
  const pageNumbers = pagination
    ? [
        ...new Set(
          [
            1,
            pagination.page - 1,
            pagination.page,
            pagination.page + 1,
            pagination.total_pages,
          ].filter((page) => page >= 1 && page <= pagination.total_pages),
        ),
      ]
    : [];
  const resetFilters = () =>
    setFilters({
      search: "",
      status: filters.queue ? "" : DIRECTORY_DEFAULTS.status,
      classification: "all",
      department: "",
      team: "",
      position: "",
      project: "",
      governorate: "", queue: filters.queue, from: filters.queue ? filters.from : "", to: filters.queue ? filters.to : "",
      page: 1,
      pageSize: filters.pageSize,
      sort: "employee_number",
      direction: "asc",
    });
  const clearQueue = () => {
    location.hash = "employees";
  };
  const queueColumns = queue?.columns || [];
  const queueDateLabel = queue?.dateLabel || "Relevant date";
  const queueScope = [filters.from && `From ${date(filters.from)}`, filters.to && `To ${date(filters.to)}`]
    .filter(Boolean)
    .join(" · ") || "Current queue rules";
  return (
    <section className="section-view employees-view">
      {queue ? (
        <header className="work-queue-header">
          <div className="work-queue-heading">
            <span className="work-queue-kicker">People / Work Queues</span>
            <h1>{queue.title}</h1>
            <p>{queue.subtitle}</p>
          </div>
          <div className="work-queue-actions">
            {(["contracts_expiring", "contracts_expired"].includes(filters.queue) && capabilities.includes("employees.work.edit")) && (
              <button className="secondary" onClick={() => go("contracts/renewals")}>
                Manage contracts
              </button>
            )}
            <button className="text-button queue-back" onClick={clearQueue}>
              <ArrowLeft size={15} /> Back to all employees
            </button>
          </div>
          <dl className="work-queue-scope" aria-label="Queue scope">
            <div><dt>Affected employees</dt><dd>{pagination?.total ?? "—"}</dd></div>
            <div><dt>Active scope</dt><dd>{queueScope}</dd></div>
            <div><dt>Results shown</dt><dd>{records?.length ?? "—"} on this page</dd></div>
          </dl>
        </header>
      ) : (
        <div className="section-head">
          <div>
            <h1>
              Employees{" "}
              <small className="page-count" aria-label={`${pagination?.total ?? "Unknown"} employees`}>
                {pagination?.total ?? "—"}
              </small>
            </h1>
          </div>
          <div className="employee-header-actions">
            {capabilities.includes("employees.edit") && (
              <button className="danger-outline" onClick={() => setRecordResignation(true)}>
                Record resignation
              </button>
            )}
            {capabilities.includes("employees.create") && (
              <button className="primary" onClick={() => go("employees/new")}>
                <Plus size={17} /> Add Employee
              </button>
            )}
          </div>
        </div>
      )}
      {!queue && <div className="employee-summary">
        <article>
          <span>{queue ? "Employees in this queue" : "Matching employees"}</span>
          <strong>{pagination?.total ?? "—"}</strong>
          <small>{queue ? "Server-filtered work queue" : "Across the current server filters"}</small>
        </article>
        <article>
          <span>Visible on this page</span>
          <strong>{records?.length ?? "—"}</strong>
          <small>Current page only</small>
        </article>
        <article>
          <span>Employee number</span>
          <strong>Automatic</strong>
          <small>Generated by HMS</small>
        </article>
      </div>}
      <div className="employee-filters">
        <label className="search">
          ⌕{" "}
          <input
            value={filters.search}
            onChange={(e) => update("search", e.target.value)}
            placeholder="Search employees by ID or name..."
          />
        </label>
        {select("department", "Departments")}
        <select aria-label="Employee status" value={filters.status} onChange={(e) => update("status", e.target.value)}>
          {queue && <option value="">All statuses</option>}
          {EMPLOYEE_STATUSES.map((status) => <option key={status} value={status}>{employeeStatusLabel(status)}</option>)}
        </select>
        {filters.status !== "resigned" && <select aria-label="Employee classification" value={filters.classification} onChange={(e) => update("classification", e.target.value)}>
          <option value="all">All classifications</option>
          {EMPLOYEE_CLASSIFICATIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
        </select>}
        <button
          className="secondary"
          aria-expanded={showMoreFilters}
          onClick={() => setShowMoreFilters((value) => !value)}
        >
          {showMoreFilters ? "Hide" : "More"} Filters
        </button>
        {showMoreFilters && (
          <div className="employee-more-filters">
            <select aria-label="Sort employees" value={filters.sort} onChange={(e) => update("sort", e.target.value)}>
              <option value="employee_number">Employee number</option>
              <option value="joining_date">Joining date</option>
              <option value="full_name_ar">Arabic name</option>
              <option value="full_name_en">English name</option>
              <option value="employee_status">Status</option>
            </select>
            <select aria-label="Sort direction" value={filters.direction} onChange={(e) => update("direction", e.target.value)}>
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
            {select("team", "Teams")}
            {select("position", "Positions")}
            {select("project", "Projects")}
            {select("governorate", "Governorates")}
            {queue && <label className="toolbar-field">From<input type="date" value={filters.from} onChange={(event) => update("from", event.target.value)} /></label>}
            {queue && <label className="toolbar-field">To<input type="date" value={filters.to} onChange={(event) => update("to", event.target.value)} /></label>}
          </div>
        )}
      </div>
      {activeFilters.length > 0 && (
        <div className="filter-chips">
          {activeFilters.map(([key, value]) => (
            <button key={key} onClick={() => update(key, "")}>
              {filterLabel(key, value)} ×
            </button>
          ))}
          <button className="clear-chip" onClick={resetFilters}>
            Clear all
          </button>
        </div>
      )}
      {error && <Notice kind="danger">{error}<span className="notice-actions"><button className="secondary" onClick={() => setRequestKey((value) => value + 1)}>Try again</button></span></Notice>}
      {!records ? (
        <div className="loading-list">
          {[1, 2, 3, 4].map((x) => (
            <div className="skeleton" key={x} />
          ))}
        </div>
      ) : error ? null : records.length === 0 ? (
        <div className="empty">
          <h3>No employees found</h3>
          <p>Try changing or clearing your filters.</p>
          <button className="secondary" onClick={resetFilters}>
            Clear filters
          </button>
        </div>
      ) : (
        <>
          <div
            className={`employee-table-wrap${loading ? " is-refreshing" : ""}`}
          >
            <div className="table-context">
              <span>
                Showing {start}–{end} of {total}
              </span>
              {loading && (
                <span className="dashboard-updating">Updating results…</span>
              )}
            </div>
            <table className="employee-table">
              <thead>
                <tr>
                  {[
                    "Employee",
                    "Department",
                    "Position",
                    "Status",
                    queue ? queueDateLabel : "Joining Date",
                    ...(queueColumns.includes("days") ? ["Timing"] : []),
                    "",
                  ].map((x) => (
                    <th key={x}>{x}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map((x) => (
                  <tr key={x.id}>
                    <td className="employee-identity">
                      <strong dir="rtl">{x.arabic_full_name}</strong>
                      <small>{x.english_full_name} · #{x.employee_number}</small>
                    </td>
                    <td className="employee-organization">{x.department?.name || "—"}</td>
                    <td className="employee-position">
                      {x.position?.name || "—"}
                      {x.position?.position_code && <small className="code">{x.position.position_code}</small>}
                    </td>
                    <td>
                      <Badge status={x.employee_status} />
                    </td>
                    <td className="queue-relevant-date">{queue ? (x.queue_date ? date(x.queue_date) : "—") : date(x.joining_date)}{queueColumns.includes("item") && <small>{x.queue_item || "—"}</small>}</td>
                    {queueColumns.includes("days") && <td><small className={x.queue_date && new Date(`${x.queue_date}T00:00:00`) < new Date() ? "deadline-overdue" : "deadline-upcoming"}>{daysFromToday(x.queue_date)}</small></td>}
                    <td>
                      <button
                        className="text-button"
                        aria-label={`View ${x.english_full_name || x.arabic_full_name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          go(profileRouteFromDirectory(x.id, currentDirectoryContext()));
                        }}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <footer
            className="employee-pagination"
            aria-label="Employee pagination"
          >
            <div>
              <label>
                Rows per page{" "}
                <select
                  aria-label="Rows per page"
                  value={filters.pageSize}
                  onChange={(e) => update("pageSize", Number(e.target.value))}
                >
                  {[25, 50, 100].map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="page-controls">
              <button
                className="secondary"
                onClick={() => setPage(pagination.page - 1)}
                disabled={loading || !pagination.has_previous}
              >
                Previous
              </button>
              <span className="mobile-page">
                Page {pagination.page} of {pagination.total_pages}
              </span>
              <span className="desktop-pages">
                {pageNumbers.map((page, index) => (
                  <span key={page}>
                    {index > 0 && page > pageNumbers[index - 1] + 1 && <i>…</i>}
                    <button
                      className={page === pagination.page ? "selected" : ""}
                      aria-label={`Page ${page}`}
                      aria-current={
                        page === pagination.page ? "page" : undefined
                      }
                      onClick={() => setPage(page)}
                      disabled={loading}
                    >
                      {page}
                    </button>
                  </span>
                ))}
              </span>
              <button
                className="secondary"
                onClick={() => setPage(pagination.page + 1)}
                disabled={loading || !pagination.has_next}
              >
                Next
              </button>
              <button
                className="secondary last-page"
                onClick={() => setPage(pagination.total_pages)}
                disabled={loading || !pagination.has_next}
              >
                Last
              </button>
            </div>
          </footer>
        </>
      )}
      {recordResignation && (
        <RecordResignationDrawer
          token={token}
          toast={toast}
          reasons={lookup?.["leaving-reasons"] || []}
          onClose={() => setRecordResignation(false)}
          onSuccess={() => {
            setRecordResignation(false);
            setRequestKey((value) => value + 1);
          }}
        />
      )}
    </section>
  );
}

export function EmployeeForm({
  token,
  go,
  toast,
  employee: source,
  mode = "create",
  capabilities = [],
}) {
  const lookup = useLookups(token);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(() =>
    source ? employeeFormValues(source) : emptyForm,
  );
  const [baseline, setBaseline] = useState(() =>
    source ? employeeFormValues(source) : emptyForm,
  );
  const [version, setVersion] = useState(() => source?.updated_at || null);
  const [family, setFamily] = useState(() =>
    source
      ? {
          wives: source.family?.wives || [],
          children: source.family?.children || [],
        }
      : emptyFamily(),
  );
  const [occConflict, setOccConflict] = useState(false);
  const [stale, setStale] = useState(false);
  const [pendingLeave, setPendingLeave] = useState(null);
  const steps = [
    "Personal",
    "Family",
    "Work",
    "Insurance",
    "Financial",
    "Review",
  ];
  const selectedPosition = option(lookup?.positions, form.position_id);
  const married = /married/i.test(
    option(lookup?.["marital-statuses"], form.marital_status_id)?.name || "",
  );
  const financialEditable = capabilities.includes("employees.financial.edit");
  const refreshLatest = useCallback(async () => {
    if (!source) return;
    setBusy(true);
    try {
      const latest = await employeesApi.getEmployee(source.id, token);
      const next = employeeFormValues(latest);
      setForm(next);
      setBaseline(next);
      setVersion(latest.updated_at);
      setOccConflict(false);
      setStale(false);
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }, [source, token, toast]);
  const dirty =
    !sameForm(form, baseline) ||
    (!source && (family.wives.length > 0 || family.children.length > 0));
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  useEffect(() => {
    if (!dirty) return undefined;
    const warnBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    addEventListener("beforeunload", warnBeforeUnload);
    return () => removeEventListener("beforeunload", warnBeforeUnload);
  }, [dirty]);
  const leaveForm = (target) => {
    if (dirty) setPendingLeave(target);
    else go(target);
  };
  useEmployeeInvalidation(
    source?.id,
    token,
    useCallback(async () => {
      if (dirtyRef.current) {
        setStale(true);
        return;
      }
      await refreshLatest();
    }, [refreshLatest]),
  );
  const validateStep = (index) => {
    if (index === 0) {
      if (!form.arabic_full_name.trim() || !form.english_full_name.trim()) {
        toast("Arabic and English full names are required.", "error");
        return false;
      }
      if (!/^\d{14}$/.test(form.identity_card_number)) {
        toast("Identity card number must be exactly 14 digits.", "error");
        return false;
      }
      if (!/^\d{11}$/.test(form.phone)) {
        toast("Phone must be exactly 11 digits.", "error");
        return false;
      }
    }
    if (index === 1 && !source) {
      for (const wife of family.wives) {
        if (!wife.wife_name.trim() || !/^\d{14}$/.test(wife.identity_card_number)) {
          toast("Each spouse needs a name and a 14-digit identity card number.", "error");
          return false;
        }
      }
      for (const child of family.children) {
        if (!child.child_name.trim() || !/^\d{14}$/.test(child.identity_card_number)) {
          toast("Each child needs a name and a 14-digit identity card number.", "error");
          return false;
        }
      }
    }
    if (index === 2) {
      if (!form.department_id || !form.shift_type_id || !form.position_id || !form.joining_date || !form.contract_signing_date) {
        toast("Complete all required work information before continuing.", "error");
        return false;
      }
      if (form.contract_signing_date < form.joining_date) {
        toast("Contract signing date cannot be before joining date.", "error");
        return false;
      }
    }
    return true;
  };
  const save = async () => {
    for (const index of [0, 1, 2]) if (!validateStep(index)) return setStep(index);
    if (!/^\d{14}$/.test(form.identity_card_number))
      return toast("Identity card number must be exactly 14 digits.", "error");
    if (!/^\d{11}$/.test(form.phone))
      return toast("Phone must be exactly 11 digits.", "error");
    setBusy(true);
    try {
      const body = clean(form, financialEditable);
      const result = source
        ? await employeesApi.updateEmployee(
            source.id,
            { ...body, expected_updated_at: version },
            token,
          )
        : await employeesApi.createEmployee({ ...body, family }, token);
      invalidateDashboardData();
      if (source) {
        setVersion(result.updated_at);
        setBaseline(form);
        setStale(false);
        setOccConflict(false);
        toast("Employee updated.", "success");
      } else {
        toast("Employee created.", "success");
        go(profileRouteFromDirectory(result.id, currentDirectoryContext()));
      }
    } catch (e) {
      if (source && e.status === 409 && e.code === "employee_conflict")
        setOccConflict(true);
      else toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  if (!lookup)
    return (
      <section className="section-view">
        <div className="loading-list">
          <div className="skeleton" />
        </div>
      </section>
    );
  if (!capabilities.includes(source ? "employees.edit" : "employees.create"))
    return (
      <section className="section-view">
        <Notice kind="danger">
          You are not authorized to {source ? "edit" : "create"} employees.
        </Notice>
      </section>
    );
  return (
    <>
    <Modal
      title={source ? "Edit Employee" : "Add Employee"}
      size="large"
      onClose={() => leaveForm(source ? profileRouteFromEditor(source.id) : currentDirectoryContext())}
      closeOnBackdrop={!dirty}
      canDismiss={!busy}
      className="employee-form-modal"
    >
    <section className="employee-form-modal-content">
      {stale && dirty && (
        <Notice kind="warning">
          Employee data changed on the server while you were editing.
          <span className="notice-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={refreshLatest}
            >
              Refresh Latest
            </button>
          </span>
        </Notice>
      )}
      {occConflict && (
        <Notice kind="danger">
          Another user updated this employee after you opened it. Your unsaved
          changes are still here.
          <span className="notice-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={refreshLatest}
            >
              Refresh Latest Data
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => setOccConflict(false)}
            >
              Keep Editing
            </button>
          </span>
        </Notice>
      )}
      <div className="employee-steps">
        {steps.map((x, i) => (
          <button
            key={x}
            className={i === step ? "current" : i < step ? "done" : ""}
            onClick={() => {
              if (i <= step || validateStep(step)) setStep(i);
            }}
          >
            <span>{i + 1}</span>
            {x}
          </button>
        ))}
      </div>
      <div className="employee-form-card">
        {step === 0 && (
          <Section
            title="Personal Information"
            subtitle="Employee number is created automatically when you save."
          >
            <div className="field-grid">
              <Field
                label="Arabic Full Name"
                name="arabic_full_name"
                form={form}
                setForm={setForm}
                required
              />
              <Field
                label="English Full Name"
                name="english_full_name"
                form={form}
                setForm={setForm}
                required
              />
              <label>
                Gender<b className="required">*</b>
                <select
                  value={form.gender}
                  onChange={(e) => setForm({ ...form, gender: e.target.value })}
                >
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </label>
              <Field
                label="Identity Card Number"
                name="identity_card_number"
                form={form}
                setForm={setForm}
                required
                hint="14 digits"
              />
              <Field
                label="Identity Card Expiration Date"
                name="identity_card_expiration_date"
                form={form}
                setForm={setForm}
                type="date"
                required
              />
              <Field
                label="Date of Birth"
                name="date_of_birth"
                form={form}
                setForm={setForm}
                type="date"
                required
              />
              <Select
                label="Religion"
                name="religion_id"
                form={form}
                setForm={setForm}
                options={lookup.religions}
                required
              />
              <Select
                label="Marital Status"
                name="marital_status_id"
                form={form}
                setForm={setForm}
                options={lookup["marital-statuses"]}
                required
              />
              <Select
                label="Diploma"
                name="diploma_id"
                form={form}
                setForm={setForm}
                options={lookup.diplomas}
              />
              <Field label="Major" name="major" form={form} setForm={setForm} />
              <Field
                label="Graduated From"
                name="graduated_from"
                form={form}
                setForm={setForm}
              />
              <Field
                label="Phone"
                name="phone"
                form={form}
                setForm={setForm}
                required
                hint="11 digits"
              />
              <Select
                label="Governorate"
                name="governorate_id"
                form={form}
                setForm={setForm}
                options={lookup.governorates}
                required
              />
              <Field
                label="Address"
                name="address"
                form={form}
                setForm={setForm}
              />
              <label>
                Employee Classification
                <select
                  value={form.employee_classification}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      employee_classification: e.target.value,
                    })
                  }
                >
                  <option value="standard">Standard</option>
                  <option value="5_percent">5%</option>
                </select>
              </label>
            </div>
          </Section>
        )}
        {step === 1 && (
          <Section
            title="Family"
            subtitle={source ? "Manage existing family records from the employee profile." : "Add the family records that belong to this employee now. Everything is saved together."}
          >
            {source ? <Notice>Family records are managed from the employee profile so each change remains independently auditable.</Notice> : <DraftFamilyEditor family={family} setFamily={setFamily} married={married} />}
          </Section>
        )}
        {step === 2 && (
          <Section
            title="Work Information"
            subtitle="HMS calculates contract expiration and probation after you save."
          >
            <div className="field-grid">
              <Select
                label="Department"
                name="department_id"
                form={form}
                setForm={setForm}
                options={lookup.departments}
                required
              />
              <Select
                label="Shift Type"
                name="shift_type_id"
                form={form}
                setForm={setForm}
                options={lookup["shift-types"]}
                required
              />
              <Select
                label="Team"
                name="team_id"
                form={form}
                setForm={setForm}
                options={lookup.teams}
              />
              <Select
                label="Position"
                name="position_id"
                form={form}
                setForm={setForm}
                options={lookup.positions}
                position
                required
              />
              <label>
                Position Code
                <input
                  disabled
                  value={selectedPosition?.position_code || "Select a position"}
                />
              </label>
              <Select
                label="Project"
                name="project_id"
                form={form}
                setForm={setForm}
                options={lookup.projects}
              />
              <Field
                label="Joining Date"
                name="joining_date"
                form={form}
                setForm={setForm}
                type="date"
                required
              />
              <Field
                label="Contract Signing Date"
                name="contract_signing_date"
                form={form}
                setForm={setForm}
                type="date"
                required
              />
            </div>
          </Section>
        )}
        {step === 3 && (
          <Section
            title="Insurance"
            subtitle="Eligibility and deadlines are calculated by HMS after you save."
          >
            <div className="field-grid">
              <label className="check">
                <input
                  type="checkbox"
                  checked={!!form.social_insurance_active}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      social_insurance_active: e.target.checked,
                    })
                  }
                />
                Social Insurance Active
              </label>
              <Field
                label="Form 1 Incoming Number"
                name="form_1_incoming_number"
                form={form}
                setForm={setForm}
              />
              <Field
                label="Form 1 Incoming Date"
                name="form_1_incoming_date"
                form={form}
                setForm={setForm}
                type="date"
              />
              <label className="field-span">
                Social Insurance Comment
                <textarea
                  value={form.social_insurance_comment || ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      social_insurance_comment: e.target.value,
                    })
                  }
                />
              </label>
            </div>
          </Section>
        )}
        {step === 4 && (
          <Section
            title="Financial"
            subtitle="Choose the employee’s bank and account number when available."
          >
            <div className="field-grid">
              <Select
                label="Bank"
                name="bank_id"
                form={form}
                setForm={setForm}
                options={lookup.banks}
                disabled={!financialEditable}
              />
              <Field
                label="Bank Account Number"
                name="bank_account_number"
                form={form}
                setForm={setForm}
                disabled={!financialEditable}
              />
            </div>
          </Section>
        )}
        {step === 5 && (
          <Section
            title="Review Employee"
            subtitle="HMS checks the record and calculates employee dates when you create it."
          >
            <div className="review-grid">
              <Info label="Employee Number" value="Generated automatically" />
              <Info label="Arabic Name" value={form.arabic_full_name} />
              <Info label="English Name" value={form.english_full_name} />
              <Info label="Department" value={option(lookup.departments, form.department_id)?.name} />
              <Info
                label="Position"
                value={
                  selectedPosition
                    ? `${selectedPosition.name} · ${selectedPosition.position_code}`
                    : "Not selected"
                }
              />
              <Info label="Joining Date" value={date(form.joining_date)} />
              <Info label="Contract Signing" value={date(form.contract_signing_date)} />
              <Info label="Family records" value={source ? "Managed on profile" : `${family.wives.length} spouse(s) · ${family.children.length} child(ren)`} />
              <Info
                label="Insurance calculations"
                value="Available after save"
              />
            </div>
          </Section>
        )}
        <div className="form-navigation">
          <div className="form-navigation-start">
            <button
              className="secondary"
              disabled={step === 0}
              onClick={() => setStep(step - 1)}
            >
              Back
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => leaveForm(source ? profileRouteFromEditor(source.id) : currentDirectoryContext())}
            >
              Cancel
            </button>
          </div>
          {step < steps.length - 1 ? (
            <button className="primary" onClick={() => validateStep(step) && setStep(step + 1)}>
              Continue <ChevronRight size={16} />
            </button>
          ) : (
            <button className="primary" disabled={busy} onClick={save}>
              {busy ? "Saving…" : source ? "Save Changes" : "Create Employee"}
            </button>
          )}
        </div>
      </div>
    </section>
    </Modal>
    {pendingLeave && <Modal title="Discard unsaved changes?" size="small" onClose={() => setPendingLeave(null)}>
      <p>Your employee changes have not been saved.</p>
      <footer className="modal-actions"><button type="button" className="secondary" onClick={() => setPendingLeave(null)}>Keep editing</button><button type="button" className="danger" onClick={() => go(pendingLeave)}>Leave without saving</button></footer>
    </Modal>}
    </>
  );
}

function DraftFamilyEditor({ family, setFamily, married }) {
  const update = (group, clientId, patch) => setFamily((current) => ({ ...current, [group]: current[group].map((record) => record.client_id === clientId ? { ...record, ...patch } : record) }));
  const remove = (group, clientId) => setFamily((current) => ({
    ...current,
    [group]: current[group].filter((record) => record.client_id !== clientId),
    children: group === "wives" ? current.children.map((child) => child.wife_client_id === clientId ? { ...child, wife_client_id: "" } : child) : current.children.filter((record) => record.client_id !== clientId),
  }));
  return (
    <div className="draft-family-editor">
      {!married && <Notice>Family records are optional. If marital status changes later, they can still be added from the profile.</Notice>}
      <div className="draft-family-head"><div><h3>Spouses</h3><p>Add only records that are ready to be saved.</p></div><button type="button" className="secondary" onClick={() => setFamily((current) => ({ ...current, wives: [...current.wives, { client_id: draftId(), wife_name: "", identity_card_number: "", is_working: false }] }))}><Plus size={15} /> Add spouse</button></div>
      {family.wives.length === 0 ? <p className="family-empty">No spouse records added.</p> : family.wives.map((wife, index) => <div className="draft-family-card" key={wife.client_id}><div className="draft-family-card-head"><strong>Spouse {index + 1}</strong><button type="button" className="text-button" onClick={() => remove("wives", wife.client_id)}>Remove</button></div><div className="field-grid"><label>Full name<input value={wife.wife_name} onChange={(event) => update("wives", wife.client_id, { wife_name: event.target.value })} /></label><label>Identity card number<input inputMode="numeric" value={wife.identity_card_number} onChange={(event) => update("wives", wife.client_id, { identity_card_number: event.target.value })} /></label><label className="check"><input type="checkbox" checked={!!wife.is_working} onChange={(event) => update("wives", wife.client_id, { is_working: event.target.checked })} /> Is working</label></div></div>)}
      <div className="draft-family-head"><div><h3>Children</h3><p>Link a child to a spouse when applicable.</p></div><button type="button" className="secondary" onClick={() => setFamily((current) => ({ ...current, children: [...current.children, { client_id: draftId(), child_name: "", identity_card_number: "", wife_client_id: "" }] }))}><Plus size={15} /> Add child</button></div>
      {family.children.length === 0 ? <p className="family-empty">No child records added.</p> : family.children.map((child, index) => <div className="draft-family-card" key={child.client_id}><div className="draft-family-card-head"><strong>Child {index + 1}</strong><button type="button" className="text-button" onClick={() => remove("children", child.client_id)}>Remove</button></div><div className="field-grid"><label>Full name<input value={child.child_name} onChange={(event) => update("children", child.client_id, { child_name: event.target.value })} /></label><label>Identity card number<input inputMode="numeric" value={child.identity_card_number} onChange={(event) => update("children", child.client_id, { identity_card_number: event.target.value })} /></label><label>Related spouse<select value={child.wife_client_id || ""} onChange={(event) => update("children", child.client_id, { wife_client_id: event.target.value })}><option value="">Not specified</option>{family.wives.map((wife, wifeIndex) => <option key={wife.client_id} value={wife.client_id}>{wife.wife_name || `Spouse ${wifeIndex + 1}`}</option>)}</select></label></div></div>)}
    </div>
  );
}

function Info({ label, value }) {
  return (
    <article className="info-row">
      <span>{label}</span>
      <strong>{value || "—"}</strong>
    </article>
  );
}

function ContractHistoryRecord({ title, signingDate, expirationDate, renewedOn, current = false }) {
  const expired = expirationDate && expirationDate < new Date().toISOString().slice(0, 10);
  const status = current ? (expired ? "Expired" : "Current") : "Previous";
  return (
    <article className="contract-history-record">
      <header>
        <h3>{title}</h3>
        <span className={expired ? "contract-status contract-status-expired" : "contract-status"}>{status}</span>
      </header>
      <dl>
        <div className="contract-period">
          <dt>Contract period</dt>
          <dd>
            <span><small>Start date</small><strong>{date(signingDate)}</strong></span>
            <span><small>Expiration date</small><strong>{date(expirationDate)}</strong></span>
          </dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{status}</dd>
        </div>
        <div>
          <dt>Renewed on</dt>
          <dd>{date(renewedOn)}</dd>
        </div>
      </dl>
    </article>
  );
}

function EmployeeNotificationList({ notifications, onAction }) {
  const grouped = Object.values((notifications || []).reduce((groups, item) => {
    const key = [item.notification_type, item.source_id ?? "employee", item.due_date].join("|");
    if (!groups[key]) groups[key] = { ...item, reminders: [] };
    groups[key].reminders.push(item.reminder_threshold_days);
    groups[key].states = [...(groups[key].states || []), item.status];
    return groups;
  }, {})).sort((left, right) => String(left.due_date || "").localeCompare(String(right.due_date || "")));
  if (!grouped.length) return <div className="notification-empty">No open notifications for this employee.</div>;
  return <div className="employee-notification-list" role="list">
    {grouped.map((item) => {
      const meta = notificationMeta(item);
      const days = notificationDayDistance(item.due_date);
      const complete = item.states.every((state) => ["resolved", "dismissed"].includes(state));
      const status = complete
        ? { label: "Completed", className: "completed" }
        : days !== null && days < 0
          ? { label: "Overdue", className: "overdue" }
          : days !== null && days <= 7
            ? { label: "Due soon", className: "due-soon" }
            : { label: "Open", className: "open" };
      const reminders = [...new Set(item.reminders)].sort((left, right) => right - left).map(reminderText).join(" · ");
      return <article className="employee-notification-row" role="listitem" key={[item.notification_type, item.source_id, item.due_date].join("|")}>
        <div className="notification-event"><strong>{meta.title}</strong><span>{meta.category}</span></div>
        <div><small>Due date</small><span>{date(item.due_date)}</span></div>
        <div><small>Reminders</small><span>{reminders || "—"}</span></div>
        <div><small>Status</small><span className={`notification-status ${status.className}`}>{status.label}</span></div>
        <div className="notification-action"><button className="text-button" onClick={() => onAction(meta.section)}>View details</button></div>
      </article>;
    })}
  </div>;
}

function SpouseLifecycleList({ records = [], canEdit, lifecycleAvailable, edit, lifecycle }) {
  const stateLabel = (record) => ({ current: "Current", former: "Former", void: "Corrected record" }[record.relationship_status || "current"]);
  return (
    <section className="employee-spouse-list">
      <header className="employee-spouse-list-head"><h3>Spouses</h3><span>{records.length}</span></header>
      {canEdit && !lifecycleAvailable && <Notice kind="warning">End and correction actions will be available after the spouse lifecycle migration is reviewed and applied.</Notice>}
      {records.length === 0 ? <p className="family-empty">No spouse records added.</p> : records.map((record) => {
        const state = record.relationship_status || "current";
        return <article className={`employee-spouse-card spouse-${state}`} key={record.id}>
          <div className="employee-spouse-card-main">
            <div className="employee-spouse-card-title"><strong>{record.wife_name}</strong><span className={`spouse-state-badge spouse-badge-${state}`}>{stateLabel(record)}</span></div>
            <span>{record.identity_card_number}</span>
            <small>{record.is_working ? "Working" : "Non-working"}</small>
            {state === "former" && <small>Marriage ended {date(record.relationship_end_date)} · {record.marriage_end_reason === "death" ? "Death" : "Divorce"}</small>}
            {state === "void" && <small>Correction reason: {record.correction_reason}</small>}
            {(record.lifecycle_events || []).length > 0 && <details className="spouse-history"><summary>View history ({record.lifecycle_events.length})</summary><ol>{record.lifecycle_events.map((event) => <li key={event.id}><strong>{event.action === "marriage_ended" ? "Marriage ended" : "Record corrected"}</strong><span>{event.effective_date ? date(event.effective_date) : timestampDate(event.occurred_at)} · {event.actor?.full_name || "HMS user"}</span><small>{event.reason_text}</small></li>)}</ol></details>}
          </div>
          {canEdit && state !== "void" && <div className="employee-spouse-actions">
            <button type="button" className="text-button" onClick={() => edit(record)}>Edit details</button>
            {lifecycleAvailable && state === "current" && <button type="button" className="text-button" onClick={() => lifecycle(record, "end")}>End marriage</button>}
            {lifecycleAvailable && <button type="button" className="text-button spouse-correction-action" onClick={() => lifecycle(record, "correct")}>Correct erroneous record</button>}
          </div>}
        </article>;
      })}
    </section>
  );
}

function SpouseLifecycleDialog({ action, spouse, currentCount, statuses, busy, error, needsResultingStatus, onClose, onSubmit }) {
  const [effectiveDate, setEffectiveDate] = useState(() => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}-${parts.find((part) => part.type === "day")?.value}`;
  });
  const [reason, setReason] = useState("");
  const [resultingStatusId, setResultingStatusId] = useState("");
  const state = spouse.relationship_status || "current";
  const needsStatus = needsResultingStatus || ((action === "end" || (action === "correct" && state === "current")) && currentCount === 1);
  const options = statuses.filter((status) => status.is_married_status !== true);
  const isEnd = action === "end";
  const requiredMarker = reason === "divorce" ? "is_divorced_status" : reason === "death" ? "is_widowed_status" : null;
  const markedStatuses = requiredMarker ? statuses.filter((status) => status[requiredMarker] === true) : [];
  const reasonStatus = markedStatuses.length === 1 && markedStatuses[0].is_active === true && markedStatuses[0].is_married_status !== true ? markedStatuses[0] : null;
  const statusSetupError = markedStatuses.length > 1
    ? "More than one active marital status has this system marker. Ask a Setup Administrator to resolve the duplicate marker before continuing."
    : markedStatuses.length === 1 && markedStatuses[0].is_active !== true
      ? "The required canonical marital status is inactive. Ask a Setup Administrator to activate it before continuing."
      : markedStatuses.length === 1 && markedStatuses[0].is_married_status === true
        ? "The canonical status marker is invalid. Ask a Setup Administrator to review the marital status setup."
        : "No single active canonical marital status is available. It may be missing, inactive, or ambiguously marked. Ask a Setup Administrator to review the spouse lifecycle status setup.";
  const title = isEnd ? "End marriage" : "Correct erroneous spouse record";
  return <Modal title={title} size="small" onClose={onClose} canDismiss={!busy} closeOnBackdrop={!busy}>
      <form className="modal-grid spouse-lifecycle-form" onSubmit={(event) => {
      event.preventDefault();
        onSubmit({ expected_updated_at: spouse.updated_at, ...(isEnd ? { effective_date: effectiveDate, reason } : { reason: reason.trim() }), resulting_marital_status_id: needsStatus ? (isEnd ? reasonStatus?.id || null : resultingStatusId) : null });
    }}>
      <Notice kind={isEnd ? "warning" : "danger"}>{isEnd ? "The spouse will remain in the employee’s history, and any children will stay linked to this record." : "This record will be marked as a correction and retained. It will not be deleted, so child links remain intact."}</Notice>
      {isEnd ? <>
        <label>Effective date<input type="date" required value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} /></label>
        <label>Reason<select required value={reason} onChange={(event) => { setReason(event.target.value); setResultingStatusId(""); }}><option value="">Choose a reason</option><option value="divorce">Divorce</option><option value="death">Death</option></select></label>
      </> : <label>Correction reason<textarea required maxLength={2000} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain why this spouse record is erroneous or duplicated." /></label>}
      {needsStatus && isEnd && reason && (reasonStatus ? <div className="spouse-resulting-status"><span>Employee’s resulting marital status</span><strong>{reasonStatus.name}</strong><small>{reason === "divorce" ? "Divorce requires the canonical Divorced status." : "Death requires the canonical Widowed status."} This is the last current spouse record; confirm to apply it.</small></div> : <Notice kind="danger">{statusSetupError} Confirmation is disabled until the status is available and uniquely marked.</Notice>)}
      {needsStatus && !isEnd && <label>Employee’s resulting marital status<select required value={resultingStatusId} onChange={(event) => setResultingStatusId(event.target.value)}><option value="">Choose a status</option>{options.map((status) => <option key={status.id} value={status.id}>{status.name}</option>)}</select><small>This correction is independent of divorce or death. Choose the resulting status explicitly.</small></label>}
      {error && <Notice kind="danger">{error}</Notice>}
      <footer className="modal-actions"><button type="button" className="secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="primary" disabled={busy || (needsStatus && (isEnd ? !reasonStatus : !resultingStatusId))}>{busy ? "Saving…" : isEnd ? "Confirm marriage end" : "Confirm correction"}</button></footer>
    </form>
  </Modal>;
}

function FamilyEditor({
  type,
  item,
  wives,
  onClose,
  save,
  conflict,
  refreshLatest,
  keepEditing,
}) {
  const initialForm = item || (type === "wife"
    ? { wife_name: "", identity_card_number: "", is_working: false }
    : { child_name: "", identity_card_number: "", wife_id: "" });
  const [form, setForm] = useState(
    initialForm,
  );
  const dirty = Object.keys(initialForm).some((key) => (form[key] ?? "") !== (initialForm[key] ?? ""));
  const title = `${item?.id ? "Edit" : "Add"} ${type === "wife" ? "Spouse" : "Child"}`;
  const refresh = async () => {
    const latest = await refreshLatest(type, item.id);
    if (latest) setForm(latest);
  };
  return (
    <Modal title={title} size="small" onClose={onClose} closeOnBackdrop={!dirty} canDismiss={!dirty}>
      {conflict && (
        <Notice kind="danger">
          This record was updated by another user.
          <span className="notice-actions">
            <button type="button" className="secondary" onClick={refresh}>
              Refresh Latest Data
            </button>
            <button type="button" className="text-button" onClick={keepEditing}>
              Keep Editing
            </button>
          </span>
        </Notice>
      )}
      <form className="modal-grid"
        onSubmit={(e) => {
          e.preventDefault();
          if (!/^\d{14}$/.test(form.identity_card_number)) return;
          save({
            ...form,
            wife_id: form.wife_id || null,
            ...(item ? { expected_updated_at: item.updated_at } : {}),
          });
        }}
      >
        <Field
          label={type === "wife" ? "Spouse Name" : "Child Name"}
          name={type === "wife" ? "wife_name" : "child_name"}
          form={form}
          setForm={setForm}
          required
        />
        <Field
          label="Identity Card Number"
          name="identity_card_number"
          form={form}
          setForm={setForm}
          required
          hint="14 digits"
        />
        {type === "wife" ? (
          <label className="check">
            <input
              type="checkbox"
              checked={!!form.is_working}
              onChange={(e) =>
                setForm({ ...form, is_working: e.target.checked })
              }
            />
            Is working
          </label>
        ) : (
          <label>
            Related Spouse (optional)
            <select
              value={form.wife_id || ""}
              onChange={(e) => setForm({ ...form, wife_id: e.target.value })}
            >
              <option value="">Not specified</option>
              {wives.map((wife) => (
                <option key={wife.id} value={wife.id}>
                  {wife.wife_name}
                </option>
              ))}
            </select>
          </label>
        )}
        <footer className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary">Save</button></footer>
      </form>
    </Modal>
  );
}

export function EmployeeDetail({ id, token, go, toast, capabilities = [] }) {
  const [employee, setEmployee] = useState(null);
  const [socialInsurance, setSocialInsurance] = useState(null);
  const [socialInsuranceError, setSocialInsuranceError] = useState("");
  const requestId = useRef(0);
  const lookup = useLookups(token, !!employee);
  const profileSection = () =>
    new URLSearchParams(location.hash.split("?")[1] || "").get("section") ||
    "overview";
  const [tab, setTab] = useState(profileSection);
  const [editor, setEditor] = useState(null);
  const [spouseLifecycle, setSpouseLifecycle] = useState(null);
  const [resign, setResign] = useState(false);
  const [busy, setBusy] = useState(false);
  const directoryReturn = profileDirectoryContext();
  const returnQueue = workQueue(new URLSearchParams(directoryReturn.split("?")[1] || "").get("queue"));
  const load = useCallback(
    (clear = true) => {
      const currentRequest = ++requestId.current;
      if (clear) setEmployee(null);
      return employeesApi
        .getEmployee(id, token)
        .then((result) => {
          if (currentRequest === requestId.current) setEmployee(result);
        })
        .catch((e) => {
          if (clear && currentRequest === requestId.current)
            toast(e.message, "error");
        });
    },
    [id, token, toast],
  );
  useEffect(() => {
    load();
    return () => {
      requestId.current += 1;
    };
  }, [load]);
  useEffect(() => {
    if (!capabilities.includes("employees.documents.view")) return;
    let active = true;
    const refreshSocialInsurance = () => socialInsuranceApi.get(id, token).then((record) => { if (active) { setSocialInsurance(record); setSocialInsuranceError(""); } }).catch((e) => { if (active) setSocialInsuranceError(e.message || "Couldn’t load Social Insurance summary."); });
    refreshSocialInsurance();
    const unsubscribe = subscribeSocialInsuranceInvalidation((employeeId) => { if (employeeId === id) refreshSocialInsurance(); });
    return () => { active = false; unsubscribe(); };
  }, [id, token, capabilities]);
  useEffect(() => {
    const syncSection = () => setTab(profileSection());
    addEventListener("hashchange", syncSection);
    return () => removeEventListener("hashchange", syncSection);
  }, []);
  useEmployeeInvalidation(
    id,
    token,
    useCallback(() => {
      load(false);
      if (capabilities.includes("employees.documents.view")) {
        socialInsuranceApi.get(id, token).then(setSocialInsurance).catch((error) => setSocialInsuranceError(error.message || "Couldn’t refresh Social Insurance."));
      }
    }, [load, id, token, capabilities]),
  );
  if (!employee)
    return (
      <section className="section-view">
        <div className="loading-list">
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      </section>
    );
  const can = {
    personal: !!employee.personal,
    family: !!employee.family,
    work: !!employee.work,
    insurance: !!employee.insurance,
    financial: !!employee.financial,
    documents: capabilities.includes("employees.documents.view"),
  };
  const canEditPersonal = capabilities.includes("employees.personal.edit");
  const tabs = [
    "overview",
    ...Object.keys(can).filter((x) => can[x]),
    ...(employee.licenses ? ["licenses", "contracts", "notifications"] : []),
    ...(can.documents ? ["documents"] : []),
  ];
  const refresh = async () => {
    try {
      await employeesApi.refreshEmployeeNotifications(id, token);
      load();
      toast("Notifications refreshed.", "success");
    } catch (e) {
      toast(e.message, "error");
    }
  };
  const refreshNested = async (type, recordId) => {
    const latest = await employeesApi.getEmployee(id, token);
    setEmployee(latest);
    const records =
      type === "license"
        ? latest.licenses
        : latest.family?.[type === "wife" ? "wives" : "children"];
    const item = records?.find((record) => record.id === recordId);
    if (item) setEditor({ type, item });
    return item;
  };
  const nestedSave = async (type, item, body) => {
    setBusy(true);
    try {
      if (type === "wife")
        item
          ? await employeesApi.updateWife(id, item.id, body, token)
          : await employeesApi.addWife(id, body, token);
      else
        item
          ? await employeesApi.updateChild(id, item.id, body, token)
          : await employeesApi.addChild(id, body, token);
      setEditor(null);
      load();
      toast("Family record saved.", "success");
    } catch (e) {
      if (item && e.status === 409) setEditor({ ...editor, conflict: true });
      else toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  const saveSpouseLifecycle = async (action, spouse, body) => {
    setBusy(true);
    try {
      if (action === "end") await employeesApi.endWifeMarriage(id, spouse.id, body, token);
      else await employeesApi.correctWifeRecord(id, spouse.id, body, token);
      setSpouseLifecycle(null);
      await load(false);
      toast(action === "end" ? "Marriage end recorded. The spouse record and child links remain in history." : "Spouse record marked as an audited correction. The record and child links remain in history.", "success");
    } catch (error) {
      if (error.code === "employee_spouse_resulting_status_required") setSpouseLifecycle((current) => ({ ...current, needsResultingStatus: true, error: error.message }));
      else if (error.status === 409) {
        setSpouseLifecycle(null);
        await load(false);
        toast(error.message || "This spouse record changed. Review the refreshed profile and try again.", "error");
      } else setSpouseLifecycle((current) => ({ ...current, error: error.message || "The spouse update could not be saved." }));
    } finally {
      setBusy(false);
    }
  };
  const calculated = employee.calculated || {};
  const insurance = employee.insurance || {};
  const comp =
    calculated.comprehensive_health_deduction || insurance.comprehensive_health;
  const contractHistory = [...(employee.contract_history || [])].sort((left, right) =>
    String(right.renewal_signing_date || "").localeCompare(String(left.renewal_signing_date || "")),
  );
  const latestRenewal = contractHistory[0] || null;
  const profileGroups = [
    { label: "Overview", items: ["overview"] },
    { label: "Personal", items: tabs.filter((item) => ["personal", "family"].includes(item)) },
    { label: "Employment", items: tabs.filter((item) => ["work", "contracts", "notifications"].includes(item)) },
    { label: "Benefits & records", items: tabs.filter((item) => ["financial", "insurance", "licenses", "documents"].includes(item)) },
  ].filter((group) => group.items.length);
  const activeGroup = profileGroups.find((group) => group.items.includes(tab)) || profileGroups[0];
  const tabLabel = (item) => (item === "overview" ? "Overview" : labels[item]);
  const selectTab = (next) => {
    const params = new URLSearchParams(location.hash.split("?")[1] || "");
    if (next === "overview") params.delete("section");
    else params.set("section", next);
    const suffix = params.toString();
    location.hash = `employees/${id}${suffix ? `?${suffix}` : ""}`;
  };
  return (
    <section className="section-view employees-view employee-profile-view">
      <div className="employee-profile-layout">
        <aside className="employee-context-panel">
          <button className="back-to-setup" onClick={() => go(directoryReturn)}>
            <ArrowLeft size={15} />
            {returnQueue ? `Back to ${returnQueue.title}` : "All employees"}
          </button>
          <div className="employee-context-identity">
            <span className="employee-monogram">{employee.employee_number}</span>
            <h1 dir="auto">{employee.personal?.arabic_full_name || "Employee"}</h1>
            <p>{employee.personal?.english_full_name}</p>
            <div className="profile-meta">
              <Badge status={employee.employee_status} />
            </div>
          </div>
          <dl className="employee-context-summary">
            <div><dt>Position</dt><dd>{employee.work?.position?.name || "—"}</dd></div>
            <div><dt>Department</dt><dd>{employee.work?.department?.name || "—"}</dd></div>
            <div><dt>Employee ID</dt><dd>#{employee.employee_number}</dd></div>
            <div><dt>Joined</dt><dd>{date(employee.work?.joining_date)}</dd></div>
          </dl>
          <nav className="employee-context-nav" aria-label="Employee navigation">
            <p>Employee navigation</p>
            {profileGroups.map((group) => (
              <button
                key={group.label}
                className={activeGroup.label === group.label ? "selected" : ""}
                onClick={() => selectTab(group.items[0])}
              >
                <span>{group.label}</span>
                <small>{group.items.length > 1 ? `${group.items.length} sections` : "View section"}</small>
              </button>
            ))}
          </nav>
        </aside>
        <div className="employee-profile-main">
          <header className="employee-profile-header">
            <div>
              <h2>{tabLabel(tab)}</h2>
            </div>
            <div className="profile-actions">
            {capabilities.includes("employees.edit") && (
              <button
                className="primary"
                onClick={() => go(editRouteFromProfile(id))}
              >
                <Pencil size={15} />
                Edit Employee
              </button>
            )}
            {employee.employee_status === "active" &&
              capabilities.includes("employees.edit") && (
                <button
                  className="text-button danger-text"
                  onClick={() => setResign(true)}
                >
                  Record resignation
                </button>
              )}
            </div>
          </header>
          {activeGroup.items.length > 1 && (
            <nav className="profile-tabs employee-secondary-tabs" aria-label={`${activeGroup.label} sections`}>
              {activeGroup.items.map((item) => (
                <button key={item} className={tab === item ? "selected" : ""} onClick={() => selectTab(item)}>
                  {tabLabel(item)}
                </button>
              ))}
            </nav>
          )}
      {tab === "overview" && (
        <div>
          <div className="overview-grid">
            <Info label="Employee ID" value={`#${employee.employee_number}`} />
            <Info label="Status" value={employeeStatusLabel(employee.employee_status)} />
            <Info label="Position" value={employee.work?.position?.name} />
            <Info label="Department" value={employee.work?.department?.name} />
            <Info
              label="Joining Date"
              value={date(employee.work?.joining_date)}
            />
            <Info
              label="Contract Expiration"
              value={date(calculated.contract_expiration_date)}
            />
            <Info
              label="Probation Due"
              value={date(calculated.probation_due_date)}
            />
            <Info
              label="Medical Eligibility"
              value={
                calculated.medical_insurance?.is_eligible
                  ? "Eligible"
                  : date(calculated.medical_insurance?.eligibility_date)
              }
            />
            <Info
              label="Life Eligibility"
              value={
                calculated.life_insurance?.is_eligible
                  ? "Eligible"
                  : date(calculated.life_insurance?.eligibility_date)
              }
            />
          </div>
          {capabilities.includes("employees.documents.view") && <section className="profile-social-insurance">
            <header><h2>Social Insurance</h2><button className="secondary" onClick={() => { const params = new URLSearchParams(location.hash.split("?")[1] || ""); params.set("employee_id", id); params.set("return_to", location.hash.slice(1)); go(`social-insurance?${params}`); }}>Manage Social Insurance</button></header>
            {socialInsuranceError ? <div className="employee-notice danger">{socialInsuranceError}<button className="text-button" onClick={() => socialInsuranceApi.get(id, token).then(setSocialInsurance).catch((e)=>setSocialInsuranceError(e.message))}>Retry</button></div> : !socialInsurance ? <p className="muted">Loading Social Insurance…</p> : <div className="profile-social-insurance-grid">
              {employee.employee_status === "active" ? <>
                <Info label="Installation date · تاريخ التثبيت" value={date(socialInsurance.form_1_installation_date)} />
                <Info label="Social Insurance Number" value={socialInsurance.form_1_social_insurance_number || "—"} />
                <Info label="Incoming number / date" value={[socialInsurance.form_1_incoming_number, date(socialInsurance.form_1_incoming_date)].filter((value) => value && value !== "—").join(" · ") || "—"} />
                <Info label="Insurance status" value={socialInsurance.form_1_insurance_status_text || "—"} />
                <Info label="Notes" value={socialInsurance.form_1_notes || "—"} />
              </> : employee.employee_status === "resigned" ? <>
                <Info label="Termination date · تاريخ الفصل" value={date(socialInsurance.form_6_termination_date)} />
                <Info label="Termination reason · سبب الفصل" value={socialInsurance.form_6_termination_reason || "—"} />
                <Info label="Social Insurance Number" value={socialInsurance.form_6_social_insurance_number || "—"} />
                <Info label="Incoming number / date" value={[socialInsurance.form_6_incoming_number, date(socialInsurance.form_6_incoming_date)].filter((value) => value && value !== "—").join(" · ") || "—"} />
                <Info label="Insurance status" value={socialInsurance.form_6_insurance_status_text || "—"} />
                <Info label="Notes" value={socialInsurance.form_6_notes || "—"} />
              </> : <p className="muted">Social Insurance forms are available for active or resigned employees.</p>}
            </div>}
          </section>}
          {employee.notifications?.length > 0 && (
            <Notice kind="warning">
              {employee.notifications.length} backend-generated notification
              {employee.notifications.length === 1 ? "" : "s"} need attention.
            </Notice>
          )}
        </div>
      )}
      {tab === "personal" && (
        <DetailSection title="Personal information">
          <div className="detail-grid">
            {[
              ["Arabic Full Name", employee.personal.arabic_full_name],
              ["English Full Name", employee.personal.english_full_name],
              ["Gender", employee.personal.gender],
              ["Identity Card", employee.personal.identity_card_number],
              [
                "Identity Expiration",
                date(employee.personal.identity_card_expiration_date),
              ],
              ["Age", calculated.age],
              ["Phone", employee.personal.phone],
              ["Religion", employee.personal.religion?.name],
              ["Marital Status", employee.personal.marital_status?.name],
              ["Diploma", employee.personal.diploma?.name],
              ["Governorate", employee.personal.governorate?.name],
              [
                "Classification",
                employeeClassificationLabel(employee.employee_classification),
              ],
              ["Address", employee.personal.address],
            ].map(([a, b]) => (
              <Info key={a} label={a} value={b} />
            ))}
          </div>
        </DetailSection>
      )}
      {tab === "family" && (
        <DetailSection
          title="Family"
          action={canEditPersonal ? (
            <button
              className="secondary"
              onClick={() => setEditor({ type: "wife" })}
            >
              <UserRoundPlus size={15} />
              Add Spouse
            </button>
          ) : null}
        >
          <div className="family-columns">
            <SpouseLifecycleList
              records={employee.family.wives}
              canEdit={canEditPersonal}
              lifecycleAvailable={employee.family.lifecycle_available !== false}
              edit={(item) => setEditor({ type: "wife", item })}
              lifecycle={(item, action) => setSpouseLifecycle({ spouse: item, action })}
            />
            <RecordList
              title="Children"
              records={employee.family.children}
              fields={(x) => (
                <>
                  <strong>{x.child_name}</strong>
                  <span>{x.identity_card_number}</span>
                  <small>
                    {employee.family.wives.find((w) => w.id === x.wife_id)
                      ?.wife_name || "No wife linked"}
                  </small>
                </>
              )}
              edit={canEditPersonal ? (item) => setEditor({ type: "child", item }) : undefined}
              action={canEditPersonal ? (
                <button
                  className="text-button"
                  onClick={() => setEditor({ type: "child" })}
                >
                  + Add Child
                </button>
              ) : null}
            />
          </div>
        </DetailSection>
      )}
      {tab === "work" && (
        <DetailSection title="Work information">
          <div className="detail-grid">
            {[
              ["Department", employee.work.department?.name],
              ["Shift Type", employee.work.shift_type?.name],
              ["Team", employee.work.team?.name],
              ["Position", employee.work.position?.name],
              ["Position Code", employee.work.position?.position_code],
              ["Project", employee.work.project?.name],
              ["Joining Date", date(employee.work.joining_date)],
              ["Contract Signing", date(employee.work.contract_signing_date)],
              [
                "Contract Expiration",
                date(employee.work.contract_expiration_date),
              ],
              ["Probation Due", date(employee.work.probation_due_date)],
            ].map(([a, b]) => (
              <Info key={a} label={a} value={b} />
            ))}
          </div>
        </DetailSection>
      )}
      {tab === "insurance" && (
        <DetailSection title="Insurance & eligibility">
          <div className="detail-grid">
            <Info
              label="Form 1 Deadline"
              value={date(insurance.form_1_deadline_date)}
            />
            <Info
              label={`Medical (${calculated.medical_insurance?.configured_eligibility_months} months)`}
              value={`${date(calculated.medical_insurance?.eligibility_date)} · ${calculated.medical_insurance?.is_eligible ? "Eligible" : "Not eligible"}`}
            />
            <Info
              label={`Life (${calculated.life_insurance?.configured_eligibility_months} months)`}
              value={`${date(calculated.life_insurance?.eligibility_date)} · ${calculated.life_insurance?.is_eligible ? "Eligible" : "Not eligible"}`}
            />
          </div>
          {comp && (
            <div className="deduction-card">
              <div>
                <p className="eyebrow">COMPREHENSIVE HEALTH</p>
                <h3>Backend-calculated deduction</h3>
                <p>
                  Governorate participates:{" "}
                  <strong>
                    {comp.governorate_participates ? "Yes" : "No"}
                  </strong>
                </p>
              </div>
              <strong className="deduction-total">{comp.total_percent}%</strong>
              <div className="deduction-lines">
                <span>
                  Base Employee <b>{comp.base_percent}%</b>
                </span>
                <span>
                  Non-working Wives{" "}
                  <b>
                    {comp.non_working_wife_count} × {comp.wife_percent_each}% ={" "}
                    {comp.wife_total_percent}%
                  </b>
                </span>
                <span>
                  Children{" "}
                  <b>
                    {comp.child_count} × {comp.child_percent_each}% ={" "}
                    {comp.child_total_percent}%
                  </b>
                </span>
              </div>
            </div>
          )}
        </DetailSection>
      )}
      {tab === "financial" && (
        <DetailSection title="Financial">
          <div className="detail-grid">
            <Info label="Bank" value={employee.financial.bank?.name} />
            <Info
              label="Bank Account Number"
              value={employee.financial.bank_account_number}
            />
            <Info
              label="Employee Classification"
              value={
                employeeClassificationLabel(employee.employee_classification)
              }
            />
          </div>
        </DetailSection>
      )}
      {tab === "licenses" && (
        <DetailSection
          title="Licenses"
          action={
            capabilities.includes("employees.insurance.edit") && (
              <button
                className="secondary"
                onClick={() => setEditor({ type: "license" })}
              >
                <FilePlus2 size={15} />
                Add License
              </button>
            )
          }
        >
          <RecordList
            title=""
            records={employee.licenses}
            fields={(x) => (
              <>
                <strong>{x.license_type?.name}</strong>
                <span>
                  Released {date(x.release_date)} · Expires{" "}
                  {date(x.expiry_date)}
                </span>
              </>
            )}
            edit={
              capabilities.includes("employees.insurance.edit")
                ? (item) => setEditor({ type: "license", item })
                : undefined
            }
          />
        </DetailSection>
      )}
      {tab === "documents" && (
        <EmployeeDocuments
          employeeId={id}
          token={token}
          toast={toast}
          canEdit={capabilities.includes("employees.documents.edit")}
          canReview={capabilities.includes("employees.documents.review")}
        />
      )}
      {tab === "contracts" && (
        <DetailSection title="Contract History">
          <div className="contract-history-grid">
            <ContractHistoryRecord
              title="Current contract"
              signingDate={latestRenewal?.renewal_signing_date || employee.work?.contract_signing_date}
              expirationDate={latestRenewal?.renewal_expiration_date || employee.work?.contract_expiration_date}
              renewedOn={latestRenewal?.renewal_signing_date || employee.work?.contract_signing_date}
              current
            />
            {latestRenewal ? (
              <ContractHistoryRecord
                title="Previous contract"
                signingDate={latestRenewal.previous_contract_signing_date}
                expirationDate={latestRenewal.previous_contract_expiration_date}
                renewedOn={latestRenewal.previous_contract_signing_date}
              />
            ) : (
              <article className="contract-history-record contract-history-empty">
                <h3>Previous contract</h3>
                <p>No previous contract recorded.</p>
              </article>
            )}
          </div>
        </DetailSection>
      )}
      {tab === "notifications" && (
        <DetailSection
          title="Employee Notifications"
          action={
            <button className="secondary" onClick={refresh}>
              <RefreshCw size={15} />
              Refresh
            </button>
          }
        >
          <EmployeeNotificationList
            notifications={employee.notifications}
            onAction={(section) => selectTab(section)}
          />
        </DetailSection>
      )}
      {editor?.type === "wife" || editor?.type === "child" ? (
        <FamilyEditor
          type={editor.type}
          item={editor.item}
          wives={employee.family?.wives || []}
          conflict={editor.conflict}
          refreshLatest={refreshNested}
          keepEditing={() => setEditor({ ...editor, conflict: false })}
          onClose={() => setEditor(null)}
          save={(body) => nestedSave(editor.type, editor.item, body)}
        />
      ) : null}
      {spouseLifecycle && (
        <SpouseLifecycleDialog
          action={spouseLifecycle.action}
          spouse={spouseLifecycle.spouse}
          currentCount={(employee.family?.wives || []).filter((wife) => (wife.relationship_status || "current") === "current").length}
          statuses={lookup?.["marital-statuses"] || []}
          busy={busy}
          error={spouseLifecycle.error}
          needsResultingStatus={spouseLifecycle.needsResultingStatus}
          onClose={() => setSpouseLifecycle(null)}
          onSubmit={(body) => saveSpouseLifecycle(spouseLifecycle.action, spouseLifecycle.spouse, body)}
        />
      )}
      {editor?.type === "license" && (
        <LicenseEditor
          item={editor.item}
          types={lookup?.["license-types"] || []}
          conflict={editor.conflict}
          refreshLatest={refreshNested}
          keepEditing={() => setEditor({ ...editor, conflict: false })}
          onClose={() => setEditor(null)}
          save={async (body) => {
            setBusy(true);
            try {
              editor.item
                ? await employeesApi.updateLicense(
                    id,
                    editor.item.id,
                    body,
                    token,
                  )
                : await employeesApi.addLicense(id, body, token);
              invalidateDashboardData();
              setEditor(null);
              load();
              toast("License saved.", "success");
            } catch (e) {
              if (editor.item && e.status === 409)
                setEditor({ ...editor, conflict: true });
              else toast(e.message, "error");
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
      {resign && (
        <RecordResignationDrawer
          employeeId={id}
          employee={employee}
          token={token}
          toast={toast}
          reasons={lookup?.["leaving-reasons"] || []}
          onClose={() => setResign(false)}
          onSuccess={() => {
            setResign(false);
            load(false);
          }}
        />
      )}
        </div>
      </div>
    </section>
  );
}
function DetailSection({ title, action, children }) {
  return (
    <section className="detail-section">
      <header>
        <div>
          <h2>{title}</h2>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}
function RecordList({ title, records, fields, edit, action }) {
  return (
    <section className="record-list">
      <header>
        {title && <h3>{title}</h3>}
        {action}
      </header>
      {records?.length ? (
        records.map((item) => (
          <article key={item.id}>
            <div>{fields(item)}</div>
            {edit && (
              <button className="text-button" onClick={() => edit(item)}>
                Edit
              </button>
            )}
          </article>
        ))
      ) : (
        <p className="muted">No records added yet.</p>
      )}
    </section>
  );
}

function EmployeeDocuments({ employeeId, token, toast, canEdit, canReview }) {
  const [items, setItems] = useState(null);
  const [types, setTypes] = useState([]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rejectingDoc, setRejectingDoc] = useState(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const load = useCallback(async () => {
    try {
      const [result, documentTypes] = await Promise.all([
        documentsApi.list({ employee_id: employeeId, page: 1, page_size: 100 }, token),
        documentsApi.types(token),
      ]);
      setItems(result.data || []);
      setTypes(documentTypes || []);
    } catch (error) {
      setItems([]);
      toast(error.message, "error");
    }
  }, [employeeId, token, toast]);
  useEffect(() => { load(); }, [load]);
  const updateStatus = async (documentId, status, rejection = undefined) => {
    if (status === "rejected" && !rejection) {
      setRejectingDoc(documentId);
      setRejectionReason("");
      return;
    }
    setBusy(true);
    try {
      await documentsApi.update(documentId, { status, ...(rejection ? { rejection_reason: rejection } : {}) }, token);
      await load();
      setRejectingDoc(null);
      toast(`Document marked ${status}.`, "success");
    } catch (error) { toast(error.message, "error"); }
    finally { setBusy(false); }
  };
  return (
    <DetailSection
      title="Documents & Compliance"
      action={canEdit && <button className="secondary" onClick={() => setAdding(true)}><FilePlus2 size={15} /> Add document</button>}
    >
      <p className="section-description">Track hiring papers, identity documents, government forms, and their review or expiry status. Files are kept in private storage.</p>
      {!items ? <DocumentLoadingRows /> : items.length === 0 ? (
        <div className="empty compact-empty"><h3>No documents recorded</h3><p>Add the first hiring paper or compliance record for this employee.</p></div>
      ) : (
        <div className="document-records">
          {items.map((item) => (
            <article className="document-record" key={item.id}>
              <div>
                <p className="eyebrow">{item.document_type?.category || "document"}</p>
                <strong>{item.document_type?.name || "Document"}</strong>
                <span>{item.reference_number ? `Reference ${item.reference_number}` : "No reference number"}</span>
              </div>
              <div className="document-record-meta">
                <span className={`document-status ${item.status}`}>{item.status.replaceAll("_", " ")}</span>
                <span>{item.expires_on ? `Expires ${date(item.expires_on)}` : item.issued_on ? `Issued ${date(item.issued_on)}` : "No dated validity"}</span>
                <small>{item.original_file_name ? `File attached · ${item.original_file_name}` : "No file attached"}</small>
              </div>
              {canReview && !["verified", "waived"].includes(item.status) && (
                <div className="document-record-actions">
                  <button className="text-button" disabled={busy} onClick={() => updateStatus(item.id, "verified")}>Verify</button>
                  <button className="text-button danger-text" disabled={busy} onClick={() => updateStatus(item.id, "rejected")}>Reject</button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {adding && <DocumentEditor employeeId={employeeId} token={token} types={types} busy={busy} setBusy={setBusy} onClose={() => setAdding(false)} onSaved={async () => { setAdding(false); await load(); }} toast={toast} />}
      {rejectingDoc && <Modal title="Reject document" size="small" onClose={() => !busy && setRejectingDoc(null)} closeOnBackdrop={!rejectionReason.trim()} canDismiss={!busy && !rejectionReason.trim()}>
        <form onSubmit={(event) => { event.preventDefault(); if (rejectionReason.trim()) updateStatus(rejectingDoc, "rejected", rejectionReason.trim()); }}>
          <label>Reason for rejection<textarea required maxLength={1000} rows="4" value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} /></label>
          <footer className="modal-actions"><button type="button" className="secondary" disabled={busy} onClick={() => setRejectingDoc(null)}>Cancel</button><button className="danger" disabled={busy || !rejectionReason.trim()}>{busy ? "Saving…" : "Reject document"}</button></footer>
        </form>
      </Modal>}
    </DetailSection>
  );
}

export function DocumentsCompliance({ token, toast, go, capabilities = [] }) {
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState("open");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const canView = capabilities.includes("employees.documents.view");
  const canReview = capabilities.includes("employees.documents.review");
  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      setError(null);
      setResult([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const options = { page: 1, page_size: 100 };
      if (status !== "open") options.status = status;
      const response = await documentsApi.list(options, token);
      const rows = response.data || [];
      setResult(status === "open" ? rows.filter((item) => !["verified", "waived"].includes(item.status)) : rows);
    } catch (requestError) {
      setResult(null);
      setError(requestError);
      toast(requestError.message || "Documents could not be loaded.", "error");
    } finally { setLoading(false); }
  }, [canView, status, token, toast]);
  useEffect(() => { load(); }, [load]);
  return <section className="section-view documents-compliance-view">
    <div className="section-head">
      <div><h1>Documents & Compliance</h1></div>
    </div>
    {!canView ? <div className="empty" role="status"><h3>Documents access is restricted</h3><p>You do not have permission to view employee document records.</p></div> : <>
    <div className="toolbar documents-toolbar">
      <label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="open">Needs attention</option><option value="received">Received</option><option value="under_review">Under review</option><option value="verified">Verified</option><option value="rejected">Rejected</option><option value="expired">Expired</option><option value="waived">Waived</option></select></label>
      <span>{loading ? "Loading documents…" : result ? `${result.length} document${result.length === 1 ? "" : "s"}` : "Documents unavailable"}</span>
    </div>
    {loading ? <DocumentLoadingRows /> : error ? <div className="empty" role="alert"><h3>Couldn’t load documents</h3><p>{error.message || "Try again to load employee document records."}</p><button className="secondary" onClick={load}>Retry</button></div> : result.length === 0 ? <div className="empty"><h3>No documents in this view</h3><p>Records will appear here as teams collect and review employee documents.</p></div> : <div className="document-register">
      {result.map((item) => <article key={item.id} className="document-register-row">
        <div><strong>{item.document_type?.name || "Document"}</strong><span>{item.document_type?.category || "Other"}</span></div>
        <div><strong dir="auto">{item.employee?.arabic_full_name || item.employee?.english_full_name || "Employee"}</strong><span>#{item.employee?.employee_number || "—"}</span></div>
        <div><span className={`document-status ${item.status}`}>{item.status.replaceAll("_", " ")}</span><small>{item.expires_on ? `Expires ${date(item.expires_on)}` : "No expiry"}</small></div>
        <div className="document-register-actions"><button className="text-button" onClick={() => go(`employees/${item.employee_id}?section=documents`)}>Open employee</button>{canReview && item.status !== "verified" && <button className="text-button" onClick={async () => { try { await documentsApi.update(item.id, { status: "verified" }, token); await load(); toast("Document verified.", "success"); } catch (error) { toast(error.message, "error"); } }}>Verify</button>}</div>
      </article>)}
    </div>}
    </>}
  </section>;
}

function DocumentLoadingRows() {
  return <div className="loading-list" aria-label="Loading documents" aria-live="polite">{[1, 2, 3, 4].map((item) => <div className="skeleton" key={item} />)}</div>;
}

function DocumentEditor({ employeeId, token, types, busy, setBusy, onClose, onSaved, toast }) {
  const [form, setForm] = useState({ document_type_id: "", reference_number: "", issued_on: "", expires_on: "", notes: "", file: null });
  const dirty = Boolean(form.document_type_id || form.reference_number || form.issued_on || form.expires_on || form.notes || form.file);
  const selectedType = types.find((item) => String(item.id) === String(form.document_type_id));
  const save = async (event) => {
    event.preventDefault();
    if (!form.document_type_id) return toast("Choose a document type.", "error");
    if (selectedType?.requires_expiry && !form.expires_on) return toast("This document needs an expiry date.", "error");
    setBusy(true);
    let uploadedPath = null;
    try {
      if (form.file) {
        if (!supabase) throw new Error("File upload is unavailable until Supabase browser authentication is configured.");
        const extension = form.file.name.includes(".") ? form.file.name.split(".").pop().replace(/[^a-zA-Z0-9]/g, "") : "bin";
        const objectId = draftId();
        uploadedPath = `employees/${employeeId}/${objectId}/${objectId}.${extension || "bin"}`;
        const { error } = await supabase.storage.from("employee-documents").upload(uploadedPath, form.file, { upsert: false, contentType: form.file.type });
        if (error) throw error;
      }
      await documentsApi.create({
        employee_id: employeeId,
        document_type_id: Number(form.document_type_id),
        status: "received",
        reference_number: form.reference_number,
        issued_on: form.issued_on,
        expires_on: form.expires_on,
        notes: form.notes,
        ...(form.file ? { original_file_name: form.file.name, content_type: form.file.type, file_size_bytes: form.file.size, storage_path: uploadedPath } : {}),
      }, token);
      toast("Document recorded.", "success");
      await onSaved();
    } catch (error) {
      if (uploadedPath && supabase) await supabase.storage.from("employee-documents").remove([uploadedPath]);
      toast(error.message || "Document could not be saved.", "error");
    } finally { setBusy(false); }
  };
  return <Modal title="Add document" size="medium" onClose={onClose} closeOnBackdrop={!dirty} canDismiss={!busy && !dirty}>
    <form className="modal-grid" onSubmit={save}>
      <label>Document type<select required value={form.document_type_id} onChange={(event) => setForm({ ...form, document_type_id: event.target.value })}><option value="">Choose document type</option>{types.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Reference number<input value={form.reference_number} onChange={(event) => setForm({ ...form, reference_number: event.target.value })} /></label>
      <label>Issued on<input type="date" value={form.issued_on} onChange={(event) => setForm({ ...form, issued_on: event.target.value })} /></label>
      <label>Expires on {selectedType?.requires_expiry ? <b aria-label="Required">*</b> : ""}<input required={selectedType?.requires_expiry} type="date" value={form.expires_on} onChange={(event) => setForm({ ...form, expires_on: event.target.value })} /></label>
      <label className="modal-full-width">Private file <input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(event) => setForm({ ...form, file: event.target.files?.[0] || null })} /><small>PDF, JPG, or PNG; maximum 10 MB.</small></label>
      <label className="modal-full-width">Notes<textarea rows="3" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
      <footer className="modal-actions"><button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="primary" disabled={busy}>{busy ? "Saving…" : "Record document"}</button></footer>
    </form>
  </Modal>;
}
function LicenseEditor({
  item,
  types,
  onClose,
  save,
  conflict,
  refreshLatest,
  keepEditing,
}) {
  const initialForm = item
    ? { license_type_id: item.license_type_id, release_date: item.release_date, expiry_date: item.expiry_date }
    : { license_type_id: "", release_date: "", expiry_date: "" };
  const [form, setForm] = useState(
    initialForm,
  );
  const dirty = Object.keys(initialForm).some((key) => (form[key] ?? "") !== (initialForm[key] ?? ""));
  const refresh = async () => {
    const latest = await refreshLatest("license", item.id);
    if (latest)
      setForm({
        license_type_id: latest.license_type_id,
        release_date: latest.release_date,
        expiry_date: latest.expiry_date,
      });
  };
  return (
    <Modal title={`${item ? "Edit" : "Add"} License`} size="small" onClose={onClose} closeOnBackdrop={!dirty} canDismiss={!dirty}>
      {conflict && (
        <Notice kind="danger">
          This record was updated by another user.
          <span className="notice-actions">
            <button type="button" className="secondary" onClick={refresh}>
              Refresh Latest Data
            </button>
            <button type="button" className="text-button" onClick={keepEditing}>
              Keep Editing
            </button>
          </span>
        </Notice>
      )}
      <form className="modal-grid"
        onSubmit={(e) => {
          e.preventDefault();
          if (form.expiry_date < form.release_date) return;
          save({
            ...form,
            license_type_id: Number(form.license_type_id),
            ...(item ? { expected_updated_at: item.updated_at } : {}),
          });
        }}
      >
        <Select
          label="License Type"
          name="license_type_id"
          form={form}
          setForm={setForm}
          options={types}
          required
        />
        <Field
          label="Release Date"
          name="release_date"
          form={form}
          setForm={setForm}
          type="date"
          required
        />
        <Field
          label="Expiry Date"
          name="expiry_date"
          form={form}
          setForm={setForm}
          type="date"
          required
          hint="Must be on or after release date"
        />
        <footer className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary">Save License</button></footer>
      </form>
    </Modal>
  );
}
export function RecordResignationDrawer({
  employeeId,
  employee: initialEmployee,
  token,
  toast,
  reasons,
  onClose,
  onSuccess,
}) {
  const [form, setForm] = useState({
    employee_status: "resigned",
    leaving_date: "",
    leaving_reason_id: "",
    leaving_comment: "",
    annual_days_settled: "",
    form_6_incoming_number: "",
    form_6_incoming_date: "",
    form_6_reason: "",
  });
  const [search, setSearch] = useState("");
  const [matches, setMatches] = useState([]);
  const [selectedId, setSelectedId] = useState(employeeId || "");
  const [employee, setEmployee] = useState(initialEmployee || null);
  const [searching, setSearching] = useState(false);
  const [loadingEmployee, setLoadingEmployee] = useState(!!employeeId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [searchAttempt, setSearchAttempt] = useState(0);
  const searchRequest = useRef(0);
  const dirty = Boolean(form.leaving_date || form.leaving_reason_id || form.leaving_comment || form.annual_days_settled || form.form_6_incoming_number || form.form_6_incoming_date || form.form_6_reason);

  useEffect(() => {
    if (employeeId) return undefined;
    const term = search.trim();
    if (!term) {
      searchRequest.current += 1;
      setMatches([]);
      setError("");
      return undefined;
    }
    const controller = new AbortController();
    const request = ++searchRequest.current;
    const timer = setTimeout(() => {
      setSearching(true);
      employeesApi
        .listEmployees({ search: term, status: "active", page: 1, pageSize: 25 }, token, controller.signal)
        .then((result) => {
          if (request === searchRequest.current) setMatches(result.data || []);
        })
        .catch((requestError) => {
          if (requestError.name !== "AbortError" && request === searchRequest.current) {
            setMatches([]);
            setError(requestError.message || "Unable to search active employees. Please try again.");
          }
        })
        .finally(() => {
          if (request === searchRequest.current) setSearching(false);
        });
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [employeeId, search, token, searchAttempt]);

  useEffect(() => {
    if (!selectedId) return undefined;
    let active = true;
    setLoadingEmployee(true);
    setError("");
    employeesApi
      .getEmployee(selectedId, token)
      .then((result) => {
        if (active) setEmployee(result);
      })
      .catch((requestError) => {
        if (active) {
          setEmployee(null);
          setError(requestError.message || "Unable to load the current employee record.");
        }
      })
      .finally(() => active && setLoadingEmployee(false));
    return () => { active = false; };
  }, [selectedId, token]);

  const identity = employee
    ? {
        name: employee.personal?.arabic_full_name || employee.personal?.english_full_name || "Employee",
        english: employee.personal?.english_full_name,
        number: employee.employee_number,
        department: employee.work?.department?.name,
        position: employee.work?.position?.name,
      }
    : null;
  const chooseEmployee = (candidate) => {
    setSelectedId(candidate.id);
    setLoadingEmployee(true);
    setError("");
    setSearch(candidate.arabic_full_name || candidate.english_full_name || `Employee #${candidate.employee_number}`);
    setMatches([]);
  };
  const submit = async (event) => {
    event.preventDefault();
    if (!employee || employee.employee_status !== "active") {
      setError("Choose an active employee before recording a resignation.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await employeesApi.updateEmployeeStatus(
        employee.id,
        {
          ...form,
          employee_status: "resigned",
          leaving_reason_id: Number(form.leaving_reason_id),
          annual_days_settled: form.annual_days_settled === "" ? null : Number(form.annual_days_settled),
          expected_updated_at: employee.updated_at,
        },
        token,
      );
      invalidateDashboardData();
      toast("Resignation recorded.", "success");
      onSuccess?.();
    } catch (requestError) {
      if (requestError.status === 409 && requestError.code === "employee_conflict") {
        setError("Another user updated this employee. Reopen the record and try again.");
      } else {
        setError(requestError.message || "Unable to record the resignation.");
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Record resignation" size="medium" onClose={onClose} closeOnBackdrop={!dirty} canDismiss={!busy && !dirty}>
      <form className="modal-grid" onSubmit={submit}>
        {!employeeId && (
          <label className="resignation-employee-search modal-full-width">
            Employee <b className="required">*</b>
            <input
              autoFocus
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setSelectedId("");
                setEmployee(null);
                setError("");
              }}
              placeholder="Search active employees by ID or name"
              aria-describedby="resignation-search-help"
            />
            <small id="resignation-search-help">Only active employees can be selected.</small>
            {searching && <small>Searching…</small>}
            {matches.length > 0 && !selectedId && (
              <div className="resignation-search-results" role="listbox" aria-label="Active employee results">
                {matches.map((candidate) => (
                  <button type="button" key={candidate.id} role="option" onClick={() => chooseEmployee(candidate)}>
                    <span dir="auto">{candidate.arabic_full_name || candidate.english_full_name}</span>
                    <small>#{candidate.employee_number} · {candidate.department?.name || "No department"}{candidate.position?.name ? ` · ${candidate.position.name}` : ""}</small>
                  </button>
                ))}
              </div>
            )}
          </label>
        )}
        {(identity || loadingEmployee) && (
          <div className="resignation-employee-summary modal-full-width" aria-live="polite">
            {loadingEmployee ? "Loading current employee record…" : <>
              <strong dir="auto">{identity.name}</strong>
              <small>{identity.english && identity.english !== identity.name ? `${identity.english} · ` : ""}#{identity.number}{identity.department ? ` · ${identity.department}` : ""}{identity.position ? ` · ${identity.position}` : ""}</small>
            </>}
          </div>
        )}
        {error && <div className="employee-notice danger modal-full-width" role="alert">{error}{!employee && search.trim() && <span className="notice-actions"><button className="secondary" type="button" onClick={() => setSearchAttempt((attempt) => attempt + 1)}>Try again</button></span>}</div>}
        <Field
          label="Leaving Date"
          name="leaving_date"
          form={form}
          setForm={setForm}
          type="date"
          required
        />
        <Select
          label="Leaving Reason"
          name="leaving_reason_id"
          form={form}
          setForm={setForm}
          options={reasons}
          required
        />
        <label className="modal-full-width">
          Leaving Comment
          <textarea
            value={form.leaving_comment}
            onChange={(e) =>
              setForm({ ...form, leaving_comment: e.target.value })
            }
          />
        </label>
        <button className="text-button resignation-details-toggle modal-full-width" type="button" onClick={() => setShowDetails((value) => !value)} aria-expanded={showDetails}>
          {showDetails ? "Hide additional exit details" : "Additional exit details"}
        </button>
        {showDetails && <div className="resignation-additional-details modal-grid modal-full-width">
          <Field label="Annual Days Settled" name="annual_days_settled" form={form} setForm={setForm} type="number" />
          <Field label="Form 6 Incoming Number" name="form_6_incoming_number" form={form} setForm={setForm} />
          <Field label="Form 6 Incoming Date" name="form_6_incoming_date" form={form} setForm={setForm} type="date" />
          <label className="modal-full-width">
            Form 6 Reason
            <textarea value={form.form_6_reason} onChange={(e) => setForm({ ...form, form_6_reason: e.target.value })} />
          </label>
        </div>}
        <footer className="modal-actions">
          <button className="secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="danger" disabled={busy || loadingEmployee || !employee}>
            {busy ? "Recording…" : "Record resignation"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
