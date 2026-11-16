import { useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeDollarSign,
  Bell,
  Building2,
  BriefcaseBusiness,
  ChevronRight,
  Clock3,
  FileText,
  FolderKanban,
  GraduationCap,
  HeartPulse,
  Landmark,
  LayoutDashboard,
  LogOut,
  MapPinned,
  Network,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  UserRoundCog,
  UsersRound,
} from "lucide-react";
import logo from "../assets/images/jushi-logo.png";
import { authConfigured, LOCAL_DEV_ACCESS_TOKEN, localDevAuthBypass, supabase } from "./auth";
import { capabilitiesApi, dashboardApi, employeesApi, invalidateCapabilitiesCache, invalidateDashboardData, invalidateEmployeeLookupCache, setupApi } from "./api";
import { DocumentsCompliance, EmployeeDetail, EmployeeForm, EmployeesList } from "./Employees";
import { ContractRenewals } from "./ContractRenewals";
import { SocialInsurance } from "./SocialInsurance";
import { workQueueDefinitions, workQueueHash } from "./workQueues";
import { Dashboard } from "./Dashboard";
import { DataQuality, Lifecycle } from "./PeopleOperations";
import { Modal } from "./Modal";
import roleMetadata from "../../shared/role-metadata.json";

const groups = [
  {
    title: "Access & Security",
    text: "Manage who can access HMS and what they can do.",
    items: [
      ["users", "Users"],
      ["roles", "Roles & Permissions"],
    ],
  },
  {
    title: "Organization",
    text: "Set up the company structure used in employee records.",
    items: [
      ["departments", "Departments"],
      ["teams", "Teams"],
      ["positions", "Positions"],
      ["projects", "Projects"],
      ["governorates", "Governorates"],
    ],
  },
  {
    title: "Employee Data",
    text: "Keep employee details accurate and consistent.",
    items: [
      ["religions", "Religions"],
      ["marital-statuses", "Marital Statuses"],
      ["diplomas", "Diplomas"],
      ["leaving-reasons", "Leaving Reasons"],
      ["license-types", "License Types"],
    ],
  },
  {
    title: "Work Configuration",
    text: "Manage work patterns and payment destinations.",
    items: [["shift-types", "Shift Types"], ["banks", "Banks"]],
  },
  {
    title: "Insurance Settings",
    text: "Manage eligibility and deduction rules.",
    items: [["insurance", "Open settings"]],
  },
];

const employeeLookupResources = new Set([
  "religions", "marital-statuses", "diplomas", "governorates", "departments",
  "shift-types", "teams", "positions", "projects", "banks", "leaving-reasons",
  "license-types",
]);
const dashboardFilterResources = new Set([
  "religions", "marital-statuses", "diplomas", "governorates", "departments",
  "shift-types", "teams", "positions", "projects", "banks", "leaving-reasons",
]);
const labels = Object.fromEntries(groups.flatMap((g) => g.items));
const titleCase = (s) => labels[s] || s;
const singularTitle = (resource) => ({
  "marital-statuses": "Marital Status",
  "leaving-reasons": "Leaving Reason",
  "license-types": "License Type",
  "shift-types": "Shift Type",
}[resource] || titleCase(resource).replace(/s$/, ""));
const initials = (name = "") =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0])
    .join("")
    .toUpperCase() || "U";
const itemIcons = {
  users: UsersRound,
  roles: ShieldCheck,
  departments: Building2,
  teams: Network,
  positions: BriefcaseBusiness,
  projects: FolderKanban,
  "shift-types": Clock3,
  religions: HeartPulse,
  "marital-statuses": UsersRound,
  diplomas: GraduationCap,
  governorates: MapPinned,
  banks: Landmark,
  "leaving-reasons": FileText,
  "license-types": FileText,
  insurance: SlidersHorizontal,
};
const landingSections = [
  {
    title: "Access & Security",
    items: [
      ["users", "Users", "Manage accounts and role assignments"],
      ["roles", "Roles & Permissions", "Manage what each role can access"],
    ],
  },
  {
    title: "Organization",
    items: [
      ["departments", "Departments"],
      ["teams", "Teams"],
      ["positions", "Positions"],
      ["projects", "Projects"],
      ["governorates", "Governorates"],
    ],
  },
  {
    title: "Employee Data",
    items: [
      ["religions", "Religions"],
      ["marital-statuses", "Marital Statuses"],
      ["diplomas", "Diplomas"],
      ["leaving-reasons", "Leaving Reasons"],
      ["license-types", "License Types"],
    ],
  },
  {
    title: "Work Configuration",
    items: [
      ["shift-types", "Shift Types", "Manage working patterns"],
      ["banks", "Banks", "Manage bank options for employees"],
    ],
  },
  {
    title: "Insurance",
    items: [["insurance", "Insurance Settings", "Manage eligibility and health settings"]],
  },
];

function Toast({ toast, clear }) {
  return toast ? (
    <div className={`toast ${toast.kind}`} role="status">
      {toast.message}
      <button onClick={clear} aria-label="Dismiss notification">
        ×
      </button>
    </div>
  ) : null;
}
function Status({ active }) {
  return (
    <span className={`badge ${active ? "active" : "inactive"}`}>
      {active ? "Active" : "Inactive"}
    </span>
  );
}
function LoadingRows() {
  return (
    <div className="loading-list">
      {[1, 2, 3, 4].map((x) => (
        <div className="skeleton" key={x} />
      ))}
    </div>
  );
}

const notificationMetricLabels = {
  medical_eligible: "Medical eligibility reached", life_eligible: "Life eligibility reached",
  contracts_expiring: "Contracts expiring", contracts_expired: "Contracts expired",
  identity_expiring: "Identity documents expiring", identity_expired: "Identity documents expired",
  licenses_expiring: "Licenses expiring", licenses_expired: "Licenses expired",
  missing_form_1: "Missing Form 1", missing_form_6: "Missing Form 6",
  due_soon: "Due soon", overdue: "Overdue",
};
const notificationMetricOrder = ["overdue", "contracts_expired", "identity_expired", "missing_form_1", "missing_form_6", "contracts_expiring", "identity_expiring", "licenses_expiring", "medical_eligible", "life_eligible", "due_soon"];

function NotificationCenter({ token }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    dashboardApi.executive({ granularity: "auto" }, token)
      .then((result) => {
        if (!active) return;
        setItems((result.attention || []).filter((item) => Number(item.count) > 0 && notificationMetricLabels[item.metric]).sort((a, b) => {
          const aIndex = notificationMetricOrder.indexOf(a.metric), bIndex = notificationMetricOrder.indexOf(b.metric);
          return (aIndex < 0 ? 999 : aIndex) - (bIndex < 0 ? 999 : bIndex);
        }));
      })
      .catch(() => { if (active) setItems([]); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);
  const openNotification = (item) => {
    location.hash = workQueueHash(item.metric);
    setOpen(false);
  };
  return <div className="notification-center">
    <button className="notification-trigger" aria-label={items.length ? `${items.length} workforce notifications` : "Notifications"} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((current) => !current)}>
      <Bell size={18} />{items.length > 0 && <span className="notification-count">{items.length > 9 ? "9+" : items.length}</span>}
    </button>
    {open && <section className="notification-popover" role="dialog" aria-label="Workforce notifications">
      <header><div><p>WORKFORCE ALERTS</p><h2>Notifications</h2></div><button onClick={() => setOpen(false)} aria-label="Close notifications">×</button></header>
      {loading ? <p className="notification-empty">Checking workforce alerts…</p> : items.length ? <div className="notification-list">{items.map((item) => <button key={item.metric} className={`notification-item severity-${item.severity?.toLowerCase() || "info"}`} onClick={() => openNotification(item)}><span className="notification-indicator" aria-hidden="true"/><span><strong>{notificationMetricLabels[item.metric] || item.label}</strong><small>{item.count} employee{Number(item.count) === 1 ? "" : "s"} to review</small></span><b>{item.count}</b></button>)}</div> : <p className="notification-empty">No workforce alerts need attention right now.</p>}
    </section>}
  </div>;
}
function SetupBreadcrumb({ group, current }) {
  return (
    <div className="page-navigation">
      <nav className="breadcrumb internal-breadcrumb" aria-label="Breadcrumb">
        <button
          onClick={() => {
            location.hash = "";
          }}
        >
          SetUp
        </button>
        <ChevronRight size={13} />
        <span>{group}</span>
        <ChevronRight size={13} />
        <strong>{current}</strong>
      </nav>
    </div>
  );
}

function Login({ onSession }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError("");
    if (!email || !password) return setError("Enter your email and password.");
    if (!authConfigured)
      return setError(
        "Browser authentication is not configured. Add the safe VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY values.",
      );
    setBusy(true);
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) setError("Unable to sign in. Check your email and password.");
      else onSession(data.session);
    } catch {
      setError("Unable to sign in. Check your email and password.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="login-page">
      <div className="workforce-visual" aria-hidden="true">
        <div className="visual-grid" />
        <div className="visual-orbit visual-orbit-one" />
        <div className="visual-orbit visual-orbit-two" />
        <svg className="visual-network" viewBox="0 0 800 900" preserveAspectRatio="none" focusable="false">
          <path d="M42 145C214 178 260 285 392 330S630 365 762 426M-28 510C135 435 230 476 334 550S578 735 836 655M114 870C213 718 267 640 392 626S611 505 702 260M112 145C189 305 173 403 112 510M392 330C440 443 429 534 392 626M702 260C670 409 708 540 762 655" />
          <circle cx="42" cy="145" r="3" /><circle cx="392" cy="330" r="4" /><circle cx="762" cy="426" r="3" /><circle cx="334" cy="550" r="3" /><circle cx="392" cy="626" r="4" /><circle cx="702" cy="260" r="3" /><circle cx="114" cy="870" r="3" />
        </svg>
        <div className="visual-node visual-node-main"><span /></div>
        <div className="visual-node visual-node-left"><span /></div>
        <div className="visual-node visual-node-right"><span /></div>
        <div className="visual-node visual-node-bottom"><span /></div>
      </div>
      <section className="login-brand-panel" aria-label="HR Management System">
        <div className="login-brand-content">
          <div className="login-brand-lockup">
            <span className="login-logo-frame">
              <img src={logo} alt="JUSHI" className="login-logo" />
            </span>
            <span>HR Management System</span>
          </div>
          <div className="login-brand-copy">
            <p className="eyebrow">ONE SECURE WORKSPACE</p>
            <h1>People operations, thoughtfully connected.</h1>
            <p>Bring employee records, daily operations, and workforce insight together in one trusted place.</p>
          </div>
          <div className="login-value-list">
            <span><b>01</b> People</span>
            <span><b>02</b> Operations</span>
            <span><b>03</b> Insights</span>
          </div>
        </div>
      </section>
      <section className="login-form-panel">
        <div className="login-form-shell">
          <div className="login-mobile-brand">
            <span className="login-logo-frame">
              <img src={logo} alt="JUSHI" className="login-logo" />
            </span>
            <span>HR Management System</span>
          </div>
          <div className="login-card">
            <div className="login-form-heading">
              <p className="eyebrow">HR MANAGEMENT SYSTEM</p>
              <h1>Welcome back</h1>
              <p className="login-supporting-copy">Sign in to continue to your workspace.</p>
            </div>
            <form onSubmit={submit} noValidate aria-busy={busy}>
              <label>
                Email
                <input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  aria-invalid={!!error}
                  aria-describedby={error ? "login-error" : undefined}
                  required
                  placeholder="you@company.com"
                />
              </label>
              <label>
                Password
                <span className="password-wrap">
                  <input
                    id="login-password"
                    type={show ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    aria-invalid={!!error}
                    aria-describedby={error ? "login-error" : undefined}
                    required
                    placeholder="Enter your password"
                  />
                  <button
                    type="button"
                    onClick={() => setShow(!show)}
                    aria-controls="login-password"
                    aria-label={show ? "Hide password" : "Show password"}
                    aria-pressed={show}
                  >
                    {show ? "Hide" : "Show"}
                  </button>
                </span>
              </label>
              {error && (
                <p id="login-error" className="form-error" role="alert">
                  {error}
                </p>
              )}
              <button className="primary wide login-submit" type="submit" disabled={busy}>
                {busy ? "Signing in…" : "Sign In"}
              </button>
            </form>
          </div>
        </div>
      </section>
    </main>
  );
}

function Sidebar({ session, page, routeHash, setPage, logout, activePanel, setActivePanel, isOpen, onOpen, close }) {
  const user = session.user;
  const railRef = useRef(null);
  const panelRef = useRef(null);
  const [openSetupGroup, setOpenSetupGroup] = useState("Organization");
  const [openPeopleGroup, setOpenPeopleGroup] = useState("");
  const peopleRoutes = ["people", "employees", "work-queues", "contracts", "lifecycle", "documents", "data-quality", "social-insurance"];
  const setupRoutes = [
    "home", "users", "roles", "insurance", "departments", "teams", "positions", "projects",
    "governorates", "religions", "marital-statuses", "diplomas", "leaving-reasons", "license-types",
    "shift-types", "banks",
  ];
  const isPeople = peopleRoutes.some((route) => page === route || page.startsWith(`${route}/`));
  const isDashboard = page === "dashboard" || page.startsWith("dashboard/");
  const isSetup = employeeLookupResources.has(page) || setupRoutes.some((route) => page === route || page.startsWith(`${route}/`));
  const routeParams = new URLSearchParams(routeHash.split("?")[1] || "");
  const dashboardView = routeParams.get("view") || "overview";
  const socialInsuranceView = routeParams.get("view") || "all";
  const returnTo = routeParams.get("return_to");
  const returnParams = new URLSearchParams((returnTo || "").split("?")[1] || "");
  const hasQueueContext = Boolean(routeParams.get("queue") || returnParams.get("queue"));
  const currentQueue = routeParams.get("queue") || returnParams.get("queue") || "";
  const activeModule = isDashboard ? "analytics" : isPeople ? "people" : isSetup ? "setup" : null;
  // Selection reflects the current route, not whichever module panel happens
  // to be open. This keeps People selected for employee/profile/work-queue
  // routes and prevents SetUp from appearing selected by mistake.
  const railActive = activeModule;
  const setupGroupForPage = page === "users" || page === "roles" ? "Access & Security" : page === "insurance" ? "Insurance" : ["religions", "marital-statuses", "diplomas", "leaving-reasons", "license-types", "shift-types", "banks"].includes(page) ? "Employee Reference Data" : "Organization";
  const togglePanel = (panel) => {
    setActivePanel((current) => current === panel ? null : panel);
    if (panel === "people" && !isPeople) setPage("employees");
  };
  const iconForRoute = (route) => ({
    dashboard: LayoutDashboard, employees: UsersRound, "work-queues": Clock3, "contracts/renewals": FileText, documents: FileText, "social-insurance": ShieldCheck,
    departments: Building2, teams: Network, positions: BriefcaseBusiness, projects: FolderKanban,
    governorates: MapPinned, religions: ShieldCheck, "marital-statuses": UsersRound, diplomas: GraduationCap,
    "leaving-reasons": SlidersHorizontal, "license-types": FileText, "shift-types": Clock3, banks: Landmark,
    users: UserRoundCog, roles: ShieldCheck, insurance: HeartPulse,
  }[route.split("?")[0]] || Settings2);
  useEffect(() => {
    if (activePanel === "setup") setOpenSetupGroup(setupGroupForPage);
  }, [activePanel, page]);
  useEffect(() => {
    if (!activePanel || isOpen) return undefined;
    const closeOnOutsidePointer = (event) => {
      if (railRef.current?.contains(event.target) || panelRef.current?.contains(event.target)) return;
      setActivePanel(null);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [activePanel, isOpen, setActivePanel]);
  const navigate = (route) => {
    setPage(route);
    if (isOpen) close();
  };
  const panelItem = (route, label, selected, description) => {
    const Icon = iconForRoute(route);
    return <button key={route} className={`navigation-panel-item${selected ? " selected" : ""}`} aria-current={selected ? "page" : undefined} onClick={() => navigate(route)}>
      <Icon size={16} aria-hidden="true" />
      <span><b>{label}</b>{description && <small>{description}</small>}</span>
    </button>;
  };
  const setupGroup = (title, routes) => (
    <section key={title} className={`navigation-panel-group${openSetupGroup === title ? " open" : ""}`}>
      <button type="button" className="navigation-panel-group-toggle" aria-expanded={openSetupGroup === title} onClick={() => setOpenSetupGroup((current) => current === title ? "" : title)}>
        <span>{title}</span><ChevronRight size={15} />
      </button>
      {openSetupGroup === title && <div className="navigation-panel-group-items">{routes}</div>}
    </section>
  );
  const queueGroups = [
    ["Employment lifecycle", [["in_probation", "Employees in probation"], ["probation_due", "Probation due"]]],
    ["Documents & administration", [["missing_bank", "Missing bank details"], ["due_soon", "Due soon"], ["overdue", "Overdue"]]],
    ["Benefits", [["medical_eligible", "Medical eligible"], ["life_eligible", "Life eligible"]]],
  ];
  return (
    <>
      <button
        className="menu-button"
        onClick={onOpen}
        aria-label="Open navigation"
      >
        ☰
      </button>
      <aside className="navigation-rail" ref={railRef} aria-label="Primary navigation">
        <div className="rail-brand"><img src={logo} alt="JUSHI" className="brand" /></div>
        <nav className="rail-nav">
          <button type="button" title="Workforce Analytics" aria-label="Workforce Analytics" aria-controls="module-navigation-panel" aria-expanded={activePanel === "analytics"} className={railActive === "analytics" ? "selected" : ""} onClick={() => togglePanel("analytics")}><LayoutDashboard size={19} /></button>
          <button type="button" title="People" aria-label="People" aria-controls="module-navigation-panel" aria-expanded={activePanel === "people"} className={railActive === "people" ? "selected" : ""} onClick={() => togglePanel("people")}><UsersRound size={19} /></button>
          <button type="button" title="SetUp" aria-label="SetUp" aria-controls="module-navigation-panel" aria-expanded={activePanel === "setup"} className={railActive === "setup" ? "selected" : ""} onClick={() => togglePanel("setup")}><Settings2 size={19} /></button>
        </nav>
        <div className="rail-bottom">
          <span className="avatar" title={user.user_metadata?.full_name || user.email}>{initials(user.user_metadata?.full_name || user.email)}</span>
          <button type="button" className="rail-logout" title="Logout" aria-label="Logout" onClick={logout}><LogOut size={18} /></button>
        </div>
      </aside>
      {activePanel && isOpen && <button className="navigation-dismiss mobile-open" aria-label="Close navigation panel" onClick={() => { setActivePanel(null); close(); }} />}
      <aside id="module-navigation-panel" ref={panelRef} className={`navigation-panel${activePanel ? " open" : ""}${isOpen ? " mobile-open" : ""}`} aria-hidden={!activePanel} aria-label={activePanel === "analytics" ? "Workforce Analytics navigation" : activePanel === "people" ? "People navigation" : "SetUp navigation"}>
        {activePanel === "analytics" && <>
          <header><div><p>Workspace</p><h2>Workforce Analytics</h2></div><button className="navigation-panel-close" onClick={() => { setActivePanel(null); close(); }} aria-label="Close navigation">×</button></header>
          <nav>{panelItem("dashboard?view=overview", "Overview", dashboardView === "overview")} {panelItem("dashboard?view=risks", "Operational Risks", dashboardView === "risks")} {panelItem("dashboard?view=explorer", "Workforce Explorer", dashboardView === "explorer")}</nav>
        </>}
        {activePanel === "people" && <>
          <header><div><p>Module</p><h2>People</h2></div><button className="navigation-panel-close" onClick={() => { setActivePanel(null); close(); }} aria-label="Close navigation">×</button></header>
          <nav className="people-panel-nav">
            {panelItem("employees", "Employees", (page === "employees" || page.startsWith("employees/")) && !hasQueueContext)}
            <section className={`navigation-panel-group${openPeopleGroup === "queues" || hasQueueContext || page.startsWith("contracts/") ? " open" : ""}`}>
              <button type="button" className="navigation-panel-group-toggle" aria-expanded={openPeopleGroup === "queues" || hasQueueContext || page.startsWith("contracts/")} onClick={() => setOpenPeopleGroup((current) => current === "queues" ? "" : "queues")}><span>Work Queues</span><ChevronRight size={15} /></button>
              {(openPeopleGroup === "queues" || hasQueueContext || page.startsWith("contracts/") || page === "social-insurance") && <div className="navigation-panel-group-items queue-panel-items">{panelItem("contracts/renewals", "Contracts", page === "contracts/renewals")}{panelItem("social-insurance?view=form_1_needs_attention", "Form 1 needs attention", page === "social-insurance" && socialInsuranceView === "form_1_needs_attention")}{panelItem("social-insurance?view=form_6_needs_attention", "Form 6 needs attention", page === "social-insurance" && socialInsuranceView === "form_6_needs_attention")}{panelItem("social-insurance?view=all", "All Social Insurance records", page === "social-insurance" && !socialInsuranceView.endsWith("_needs_attention"))}{queueGroups.map(([group, items]) => <div key={group} className="queue-panel-group"><p>{group}</p>{items.filter(([key]) => workQueueDefinitions[key]).map(([key, label]) => panelItem(workQueueHash(key), label, currentQueue === key))}</div>)}</div>}
            </section>
            {panelItem("documents", "Documents & Compliance", page === "documents")}
          </nav>
        </>}
        {activePanel === "setup" && <>
          <header><div><p>Configuration</p><h2>SetUp</h2></div><button className="navigation-panel-close" onClick={() => { setActivePanel(null); close(); }} aria-label="Close navigation">×</button></header>
          <nav className="navigation-panel-groups">
            {setupGroup("Organization", ["departments", "teams", "positions", "projects", "governorates"].map((route) => panelItem(route, titleCase(route), page === route)))}
            {setupGroup("Employee Reference Data", ["religions", "marital-statuses", "diplomas", "leaving-reasons", "license-types", "shift-types", "banks"].map((route) => panelItem(route, titleCase(route), page === route)))}
            {setupGroup("Access & Security", [panelItem("users", "Users", page === "users"), panelItem("roles", "Roles & Permissions", page === "roles")])}
            {setupGroup("Insurance", [panelItem("insurance", "Insurance Settings", page === "insurance")])}
          </nav>
        </>}
      </aside>
    </>
  );
}

function Confirm({ title, message, onConfirm, onClose, busy }) {
  return (
    <Modal title={title} onClose={onClose} size="small" className="confirm-modal">
        <p>{message}</p>
        <div className="modal-actions">
          <button className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="danger" onClick={onConfirm} disabled={busy}>
            {busy ? "Updating…" : "Deactivate"}
          </button>
        </div>
    </Modal>
  );
}

function MasterData({ resource, token, toast }) {
  const [records, setRecords] = useState(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("active");
  const [editor, setEditor] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    try {
      setRecords(null);
      setRecords(await setupApi.master(resource, token));
    } catch (e) {
      setRecords([]);
    }
  };
  useEffect(() => {
    load();
  }, [resource]);
  const filtered = useMemo(
    () =>
      (records || []).filter(
        (r) =>
          (filter === "all" ||
            String(r.is_active) === String(filter === "active")) &&
          r.name.toLowerCase().includes(search.toLowerCase()),
      ),
    [records, search, filter],
  );
  const masterGroup = [
    "departments",
    "teams",
    "positions",
    "projects",
    "shift-types",
  ].includes(resource)
    ? "Organization"
    : "Employee Master Data";
  const save = async (form) => {
    setBusy(true);
    try {
      const body = {
        name: form.name.trim(),
        description: form.description?.trim() || null,
      };
      if (resource === "positions")
        body.position_code = form.position_code?.trim();
      if (resource === "governorates")
        body.participates_in_comprehensive_health_insurance =
          !!form.participates;
      if (editor?.id)
        await setupApi.patchMaster(resource, editor.id, body, token);
      else await setupApi.createMaster(resource, body, token);
      if (employeeLookupResources.has(resource)) invalidateEmployeeLookupCache();
      if (dashboardFilterResources.has(resource)) invalidateDashboardData({ filterOptions: true });
      toast(`${titleCase(resource)} saved.`, "success");
      setEditor(null);
      load();
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  const changeStatus = async (isActive = false) => {
    setBusy(true);
    try {
      await setupApi.masterStatus(resource, confirm.id, isActive, token);
      if (employeeLookupResources.has(resource)) invalidateEmployeeLookupCache();
      if (dashboardFilterResources.has(resource)) invalidateDashboardData({ filterOptions: true });
      toast(
        `${confirm.name} is now ${isActive ? "active" : "inactive"}.`,
        "success",
      );
      setConfirm(null);
      load();
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="section-view">
      <div className="section-head">
        <div>
          <SetupBreadcrumb group={masterGroup} current={titleCase(resource)} />
          <h1>{titleCase(resource)}</h1>
        </div>
        <button className="primary" onClick={() => setEditor({})}>
          + Add {singularTitle(resource)}
        </button>
      </div>
      <div className="toolbar">
        <label className="search">
          ⌕{" "}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${titleCase(resource).toLowerCase()}...`}
          />
        </label>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter by status"
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All records</option>
        </select>
      </div>
      {!records ? (
        <LoadingRows />
      ) : filtered.length === 0 ? (
        <div className="empty">
          <h3>No {titleCase(resource).toLowerCase()} have been added yet.</h3>
          <button className="primary" onClick={() => setEditor({})}>
            Add {singularTitle(resource)}
          </button>
        </div>
      ) : (
        <div className="data-list">
          {filtered.map((r) => (
            <article className="data-row" key={r.id}>
              <div>
                <strong>{r.name}</strong>
                {resource === "positions" && (
                  <span className="code">{r.position_code}</span>
                )}
                {r.description && <p>{r.description}</p>}
                {resource === "governorates" && (
                  <p className="participation">
                    {r.participates_in_comprehensive_health_insurance
                      ? "Participates in comprehensive health insurance"
                      : "Does not participate in comprehensive health insurance"}
                  </p>
                )}
              </div>
              <Status active={r.is_active} />
              <div className="row-actions">
                <button className="text-button" onClick={() => setEditor(r)}>
                  Edit
                </button>
                {r.is_active && (
                  <button
                    className="text-button danger-text"
                    onClick={() => setConfirm(r)}
                  >
                    Deactivate
                  </button>
                )}
                {!r.is_active && (
                  <button
                    className="text-button"
                    onClick={() => {
                      setBusy(true);
                      setupApi
                        .masterStatus(resource, r.id, true, token)
                        .then(() => {
                          toast(`${r.name} is now active.`, "success");
                          load();
                        })
                        .catch((e) => toast(e.message, "error"))
                        .finally(() => setBusy(false));
                    }}
                  >
                    Activate
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {editor && (
        <MasterEditor
          resource={resource}
          record={editor}
          onClose={() => setEditor(null)}
          onSave={save}
          busy={busy}
        />
      )}{" "}
      {confirm && (
        <Confirm
          title={`Deactivate ${confirm.name}?`}
          message="This record will remain available in history but cannot be selected for new records."
          onConfirm={changeStatus}
          onClose={() => setConfirm(null)}
          busy={busy}
        />
      )}
    </section>
  );
}

function MasterEditor({ resource, record, onSave, onClose, busy }) {
  const [form, setForm] = useState({
    name: record.name || "",
    description: record.description || "",
    position_code: record.position_code || "",
    participates:
      record.participates_in_comprehensive_health_insurance || false,
  });
  const dirty = form.name !== (record.name || "") || form.description !== (record.description || "") || form.position_code !== (record.position_code || "") || form.participates !== Boolean(record.participates_in_comprehensive_health_insurance || false);
  return (
    <Modal
      title={`${record.id ? "Edit" : "Add"} ${singularTitle(resource)}`}
      onClose={onClose}
      size="small"
      closeOnBackdrop={!dirty}
      canDismiss={!dirty && !busy}
    >
      <form className="modal-grid"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(form);
        }}
      >
        <label>
          Name
          <input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        {resource === "positions" && (
          <label>
            Position Code
            <input
              required
              value={form.position_code}
              onChange={(e) =>
                setForm({ ...form, position_code: e.target.value })
              }
            />
          </label>
        )}
        <label className="modal-full-width">
          Description
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </label>
        {resource === "governorates" && (
          <label className="check">
            <input
              type="checkbox"
              checked={form.participates}
              onChange={(e) =>
                setForm({ ...form, participates: e.target.checked })
              }
            />{" "}
            Participates in comprehensive health insurance
          </label>
        )}
        <footer className="modal-actions">
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

function Users({ token, toast, onCapabilitiesChanged }) {
  const [users, setUsers] = useState(null);
  const [roles, setRoles] = useState([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("active");
  const [editor, setEditor] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    try {
      setUsers(null);
      const [u, r] = await Promise.all([
        setupApi.users(token),
        setupApi.roles(token),
      ]);
      setUsers(u);
      setRoles(r);
    } catch (e) {
      setUsers([]);
    }
  };
  useEffect(() => {
    load();
  }, []);
  const shown = (users || []).filter(
    (u) =>
      (filter === "all" || u.is_active === (filter === "active")) &&
      `${u.full_name} ${u.email}`.toLowerCase().includes(search.toLowerCase()),
  );
  const deactivate = async () => {
    setBusy(true);
    try {
      await setupApi.userStatus(confirm.id, false, confirm.updated_at, token);
      onCapabilitiesChanged();
      toast("User deactivated.", "success");
      setConfirm(null);
      load();
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="section-view">
      <div className="section-head">
        <div>
          <SetupBreadcrumb group="User Management" current="Users" />
          <h1>Users</h1>
        </div>
        <button className="primary" onClick={() => setEditor({ role_ids: [] })}>
          + Add User
        </button>
      </div>
      <div className="toolbar">
        <label className="search">
          ⌕{" "}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search users"
          />
        </label>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All users</option>
        </select>
      </div>
      {!users ? (
        <LoadingRows />
      ) : (
        <div className="data-list">
          {shown.map((u) => (
            <article className="user-row" key={u.id}>
              <span className="avatar">{initials(u.full_name)}</span>
              <div className="identity">
                <strong>
                  {u.full_name}
                  {u.is_super_admin && <em>Super Admin</em>}
                </strong>
                <p>{u.email}</p>
              </div>
              <div className="role-chips">
                {u.user_roles?.map((x) => (
                  <span key={x.role_id}>{x.roles?.name}</span>
                )) || "—"}
              </div>
              <Status active={u.is_active} />
              <div className="row-actions">
                <button className="text-button" onClick={() => setEditor(u)}>
                  Manage
                </button>
                {u.is_active && !u.is_super_admin && (
                  <button
                    className="text-button danger-text"
                    onClick={() => setConfirm(u)}
                  >
                    Deactivate
                  </button>
                )}
                {!u.is_active && (
                  <button
                    className="text-button"
                    onClick={() => {
                      setBusy(true);
                      setupApi
                        .userStatus(u.id, true, u.updated_at, token)
                        .then(() => {
                          onCapabilitiesChanged();
                          toast("User activated.", "success");
                          load();
                        })
                        .catch((e) => toast(e.message, "error"))
                        .finally(() => setBusy(false));
                    }}
                  >
                    Activate
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {editor && (
        <UserEditor
          user={editor}
          roles={roles}
          token={token}
          toast={toast}
          onClose={() => setEditor(null)}
          done={load}
          onCapabilitiesChanged={onCapabilitiesChanged}
        />
      )}{" "}
      {confirm && (
        <Confirm
          title={`Deactivate ${confirm.full_name}?`}
          message="They will no longer be able to access the system."
          onConfirm={deactivate}
          onClose={() => setConfirm(null)}
          busy={busy}
        />
      )}
    </section>
  );
}

function UserEditor({ user, roles, token, toast, onClose, done, onCapabilitiesChanged }) {
  const isNew = !user.id;
  const [form, setForm] = useState({
    full_name: user.full_name || "",
    email: user.email || "",
    phone: user.phone || "",
    password: "",
    role_ids: user.role_ids || user.user_roles?.map((x) => x.role_id) || [],
  });
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(user.updated_at || null);
  const [conflict, setConflict] = useState(false);
  const initialRoleIds = user.role_ids || user.user_roles?.map((x) => x.role_id) || [];
  const dirty = form.full_name !== (user.full_name || "") || form.email !== (user.email || "") || form.phone !== (user.phone || "") || form.password !== "" || JSON.stringify([...form.role_ids].sort()) !== JSON.stringify([...initialRoleIds].sort());
  const refreshLatest = async () => {
    setBusy(true);
    try {
      const latest = (await setupApi.users(token)).find((item) => item.id === user.id);
      if (!latest) throw new Error("User no longer exists.");
      setForm({ ...form, full_name: latest.full_name || "", phone: latest.phone || "", role_ids: latest.user_roles?.map((x) => x.role_id) || [] });
      setVersion(latest.updated_at);
      setConflict(false);
      done();
    } catch (e) { toast(e.message, "error"); } finally { setBusy(false); }
  };
  const save = async (e) => {
    e.preventDefault();
    if (isNew && form.password.length < 12)
      return toast("Initial password must be at least 12 characters.", "error");
    setBusy(true);
    try {
      if (isNew) await setupApi.createUser(form, token);
      else {
        let currentVersion = version;
        if (form.full_name !== user.full_name || form.phone !== (user.phone || "")) {
          const updated = await setupApi.patchUser(user.id, { full_name: form.full_name, phone: form.phone }, currentVersion, token);
          currentVersion = updated.updated_at;
          setVersion(currentVersion);
        }
        const result = await setupApi.userRoles(user.id, form.role_ids, currentVersion, token);
        setVersion(result.updated_at);
      }
      if (!isNew) onCapabilitiesChanged();
      toast(isNew ? "User created." : "User details saved.", "success");
      done();
      onClose();
    } catch (e) {
      if (!isNew && e.status === 409 && e.code === "user_access_conflict") setConflict(true);
      else if (isNew && e.code === "user_email_conflict") toast("A user with this email already exists.", "error");
      else if (isNew && e.code === "user_provisioning_reconciliation_required") toast("User creation could not be completed safely. Administrator review is required.", "error");
      else if (isNew && e.code === "user_provisioning_failed") toast("User provisioning could not be completed.", "error");
      else toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={isNew ? "Add User" : "Manage User"} size="medium" onClose={onClose} closeOnBackdrop={!dirty} canDismiss={!dirty && !busy}>
      {conflict && <div className="employee-notice danger">This user’s access was updated by another administrator.<span className="notice-actions"><button type="button" className="secondary" disabled={busy} onClick={refreshLatest}>Refresh Latest Access</button><button type="button" className="text-button" disabled={busy} onClick={() => setConflict(false)}>Keep Editing</button></span></div>}
      <form className="modal-grid" onSubmit={save}>
        <label>
          Full Name
          <input
            required
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
          />
        </label>
        <label>
          Email
          <input
            type="email"
            required
            disabled={!isNew}
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          {!isNew && (
            <small>Email updates require a verified-email workflow.</small>
          )}
        </label>
        <label>
          Phone
          <input
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </label>
        {isNew && (
          <label>
            Temporary Password
            <input
              type="password"
              minLength="12"
              required
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            <small>Use at least 12 characters.</small>
          </label>
        )}
        {user?.is_super_admin ? <section className="role-assignment modal-full-width" aria-label="Super Admin access"><div className="role-assignment-head"><h3>Super Admin</h3><p>This account has unrestricted HMS access. A normal role is not required.</p></div></section> : <section className="role-assignment modal-full-width" aria-labelledby="assigned-roles-title">
          <div className="role-assignment-head">
            <h3 id="assigned-roles-title">Assigned roles</h3>
            <p>Roles determine the areas of HMS this user can access.</p>
          </div>
          {roles
            .map((r) => (
              <label className="role-choice" key={r.id}>
                <input
                  type="checkbox"
                  checked={form.role_ids.includes(r.id)}
                  disabled={!r.is_active}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      role_ids: e.target.checked
                        ? [...form.role_ids, r.id]
                        : form.role_ids.filter((x) => x !== r.id),
                    })
                  }
                />
                <span><strong>{r.name} · {r.is_active ? "Active" : "Inactive"}</strong><small>{r.description || "This role has no description yet."}</small><small>{(r.role_permissions || []).length} permissions · {[...new Set((r.role_permissions || []).map((x) => roleMetadata.permissionGroups[x.permissions?.module] || roleMetadata.permissionGroups[x.permissions?.module?.split(".")[0]]).filter(Boolean))].join(", ") || "No assigned permissions"}</small><small className="role-selected-state">{form.role_ids.includes(r.id) ? "Selected" : "Not selected"}</small></span>
              </label>
            ))}
        </section>}
        <footer className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button></footer>
      </form>
    </Modal>
  );
}

function Roles({ token, toast, onCapabilitiesChanged }) {
  const [roles, setRoles] = useState(null), [perms, setPerms] = useState([]), [selected, setSelected] = useState(null), [selectedIds, setSelectedIds] = useState(new Set()), [originalIds, setOriginalIds] = useState(new Set()), [busy, setBusy] = useState(false), [search, setSearch] = useState(""), [filter, setFilter] = useState("all"), [conflict, setConflict] = useState(false), [createOpen, setCreateOpen] = useState(false);
  const load = async (keepId) => {
    try {
      setRoles(null);
      const [nextRoles, nextPerms] = await Promise.all([setupApi.roles(token), setupApi.permissions(token)]);
      const next = nextRoles.find((role) => role.id === keepId) || null;
      setRoles(nextRoles); setPerms(nextPerms);
      if (next) openRole(next);
    } catch (e) { setRoles([]); }
  };
  useEffect(() => { load(); }, [token]);
  const readable = (permission) => {
    const key = permission.permission_key;
    const module = permission.module;
    const group = roleMetadata.permissionGroups[module] || roleMetadata.permissionGroups[module.split(".")[0]] || "Other access";
    const label = roleMetadata.permissionLabels[key] || permission.description || "Additional access permission";
    return [group, label];
  };
  const groups = perms.reduce((all, permission) => { const [group] = readable(permission); (all[group] ||= []).push(permission); return all; }, {});
  const toggle = (id) => setSelectedIds((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const setGroup = (items, enabled) => setSelectedIds((current) => { const next = new Set(current); items.forEach((item) => enabled ? next.add(item.id) : next.delete(item.id)); return next; });
  const openRole = (role) => { const ids = new Set(role.role_permissions?.map((item) => item.permission_id) || []); setSelected(role); setSelectedIds(ids); setOriginalIds(new Set(ids)); setConflict(false); };
  const save = async () => { if (!selected) return; setBusy(true); try { const result = await setupApi.rolePermissions(selected.id, [...selectedIds], selected.updated_at, token); setSelected((current) => current ? { ...current, updated_at: result.updated_at } : current); setOriginalIds(new Set(selectedIds)); onCapabilitiesChanged(); toast("Permissions updated", "success"); await load(selected.id); } catch (e) { if (e.status === 409 && e.code === "role_conflict") setConflict(true); else toast(e.message, "error"); } finally { setBusy(false); } };
  const usersFor = (role) => role.user_roles?.[0]?.count ?? 0;
  const permissionCount = (role) => role.role_permissions?.length ?? 0;
  const accessAreas = (role) => [...new Set((role.role_permissions || []).map((item) => {
    const module = item.permissions?.module || "";
    return roleMetadata.permissionGroups[module] || roleMetadata.permissionGroups[module.split(".")[0]];
  }).filter(Boolean))];
  const toggleRoleStatus = async (role) => {
    const action = role.is_active ? "deactivate" : "activate";
    if (!window.confirm(`Are you sure you want to ${action} ${role.name}?${role.is_active ? " Users assigned to this role will lose its permissions." : ""}`)) return;
    try { await setupApi.roleStatus(role.id, !role.is_active, role.updated_at, token); toast(`Role ${action}d.`, "success"); await load(role.id); }
    catch (error) { toast(error.message, "error"); }
  };
  const changes = [...selectedIds].filter((id) => !originalIds.has(id)).length + [...originalIds].filter((id) => !selectedIds.has(id)).length;
  const shown = (roles || []).filter((role) => (filter === "all" || (filter === "active" ? role.is_active : !role.is_active)) && `${role.name} ${role.description || ""}`.toLowerCase().includes(search.toLowerCase()));
  if (selected) return <Modal title={selected.name} description={selected.description || "Manage access to HMS."} onClose={() => { setSelected(null); setConflict(false); }} closeOnBackdrop={changes === 0} canDismiss={changes === 0 && !busy} size="large" className="role-permissions-modal"><section className="role-workspace-content">{conflict && <div className="employee-notice danger">This role was updated by another administrator.<span className="notice-actions"><button className="secondary" disabled={busy} onClick={() => { setConflict(false); load(selected.id); }}>Refresh latest permissions</button><button className="text-button" disabled={busy} onClick={() => setConflict(false)}>Keep editing</button></span></div>}<header className="role-workspace-header"><div><span className="table-muted">Role access</span></div><div><Status active={selected.is_active}/><span className="role-assigned">{usersFor(selected)} assigned user{usersFor(selected) === 1 ? "" : "s"}</span></div></header><div className="role-page-actions"><span>Manage access by business area.</span><div><button className="secondary" disabled={busy || !selected.is_active} onClick={() => setSelectedIds(new Set(perms.map((item) => item.id)))}>Select all permissions</button><button className="text-button" disabled={busy || !selected.is_active} onClick={() => setSelectedIds(new Set())}>Clear all</button></div></div><div className="permission-groups">{Object.entries(groups).map(([group, items]) => <section className="permission-group" key={group}><header><div><h2>{group}</h2><p>{items.length} permission{items.length === 1 ? "" : "s"}</p></div><div><button className="text-button" disabled={busy || !selected.is_active} onClick={() => setGroup(items, true)}>Select all</button><button className="text-button" disabled={busy || !selected.is_active} onClick={() => setGroup(items, false)}>Clear</button></div></header>{items.map((item) => { const [, label] = readable(item); return <label className="permission" key={item.id}><input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggle(item.id)} disabled={busy || !selected.is_active}/><span>{label}</span>{item.description && item.description.toLowerCase() !== label.toLowerCase() && <small>{item.description}</small>}</label>; })}</section>)}</div>{changes > 0 && <div className="unsaved-role-bar"><strong>{changes} unsaved change{changes === 1 ? "" : "s"}</strong><div><button className="secondary" disabled={busy} onClick={() => setSelectedIds(new Set(originalIds))}>Cancel</button><button className="primary" disabled={busy || !selected.is_active} onClick={save}>{busy ? "Saving…" : "Save changes"}</button></div></div>}</section></Modal>;
  return <><section className="section-view roles-view"><div className="section-head"><div><h1>Roles & Permissions</h1><p>Manage what each role can access across HMS.</p></div><button className="primary" onClick={() => setCreateOpen(true)}>+ Create Role</button></div><div className="toolbar roles-toolbar"><label className="search">⌕ <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search roles" /></label><select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">All roles</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>{!roles ? <LoadingRows /> : shown.length ? <div className="role-table-wrap"><table className="role-table"><thead><tr><th>Role</th><th>Description</th><th>Permissions</th><th>Assigned users</th><th>Status</th><th>Actions</th></tr></thead><tbody>{shown.map((role) => <tr key={role.id}><td><strong>{role.name}</strong></td><td>{role.description || "This role has no description yet."}</td><td>{permissionCount(role)}<small className="role-area-summary">{accessAreas(role).join(", ") || "No assigned permissions"}</small></td><td>{usersFor(role)}</td><td><Status active={role.is_active}/></td><td><button className="text-button" onClick={() => openRole(role)}>Edit permissions</button><button className="text-button" onClick={() => toggleRoleStatus(role)}>{role.is_active ? "Deactivate" : "Activate"}</button></td></tr>)}</tbody></table></div> : <div className="empty"><h3>{search ? "No roles match your search." : "No roles yet"}</h3><p>{search ? "Try changing your search or status filter." : "Create a role to define access for your team."}</p></div>}<p className="role-super-admin-note"><strong>Super Admin</strong> accounts have unrestricted HMS access independently of normal role permissions.</p></section>{createOpen && <RoleCreateModal token={token} toast={toast} onClose={() => setCreateOpen(false)} onCreated={load} />}</>;
}

function RoleCreateModal({ token, toast, onClose, onCreated }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await setupApi.createRole({ name: name.trim(), description: description.trim() }, token);
      toast("Role created.", "success");
      await onCreated();
      onClose();
    } catch (requestError) {
      setError(requestError.message || "Role could not be created.");
    } finally {
      setBusy(false);
    }
  };
  return <Modal title="Create role" size="small" onClose={onClose} closeOnBackdrop={!name.trim() && !description.trim()} canDismiss={!busy && !name.trim() && !description.trim()}>
    <form onSubmit={submit}>
      <label>Role name<input autoFocus required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>Description<textarea required maxLength={500} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Explain what users with this role can access." /></label>
      {error && <div className="employee-notice danger" role="alert">{error}</div>}
      <footer className="modal-actions"><button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="primary" disabled={busy}>{busy ? "Creating…" : "Create role"}</button></footer>
    </form>
  </Modal>;
}

function Insurance({ token, toast }) {
  const [settings, setSettings] = useState(null),
    [draft, setDraft] = useState({}),
    [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false);
  const load = async () => {
    try {
      setSettings(await setupApi.insurance(token));
    } catch (e) {
      setSettings([]);
    }
  };
  useEffect(() => {
    load();
  }, []);
  const changed = Object.keys(draft).length > 0;
  const hasInvalidValue = Object.values(draft).some(
    (value) => value === "" || !Number.isFinite(Number(value)) || Number(value) < 0,
  );
  const save = async () => {
    if (hasInvalidValue) {
      toast("Insurance values must be numbers greater than or equal to 0.", "error");
      return;
    }
    setBusy(true);
    try {
      await Promise.all(
        Object.entries(draft).map(([key, value]) =>
          setupApi.patchInsurance(
            key,
            { value: Number(value), is_active: true },
            token,
          ),
        ),
      );
      invalidateDashboardData();
      toast("Insurance settings saved.", "success");
      setDraft({});
      setEditing(false);
      load();
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  const copy = {
    medical_insurance_eligibility_months: [
      "Medical Insurance Eligibility",
      "months",
      "Coverage begins after this period.",
    ],
    life_insurance_eligibility_months: [
      "Life Insurance Eligibility",
      "months",
      "0 means coverage begins on the joining date.",
    ],
    comprehensive_health_employee_deduction_percent: [
      "Base Employee Deduction",
      "%",
      "Applied to the employee contribution.",
    ],
    comprehensive_health_non_working_wife_deduction_percent: [
      "Non-working Wife Deduction",
      "%",
      "Applied when a spouse is covered.",
    ],
    comprehensive_health_child_deduction_percent: [
      "Child Deduction",
      "%",
      "Applied per covered child.",
    ],
  };
  return (
    <section className="section-view">
      <div className="section-head">
        <div>
          <SetupBreadcrumb group="Organization" current="Insurance Settings" />
          <h1>Insurance Settings</h1>
        </div>
        <div className="row-actions">
          {editing && (
            <button
              className="secondary"
              onClick={() => {
                setDraft({});
                setEditing(false);
              }}
            >
              Cancel
            </button>
          )}
          <button
            className="primary"
            disabled={editing && (!changed || hasInvalidValue || busy)}
            onClick={editing ? save : () => setEditing(true)}
          >
            {editing ? (busy ? "Saving…" : "Save Changes") : "Edit Settings"}
          </button>
        </div>
      </div>
      {!settings ? (
        <LoadingRows />
      ) : (
        <div className="settings-grid">
          {settings.map((s) => {
            const [title, unit, help] = copy[s.setting_key] || [
              s.setting_key,
              "",
              "",
            ];
            const value = draft[s.setting_key] ?? s.value;
            return (
              <article className="setting-card" key={s.setting_key}>
                <p className="eyebrow">
                  {unit === "%" ? "COMPREHENSIVE HEALTH" : "INSURANCE"}
                </p>
                <h2>{title}</h2>
                <p>{help}</p>
                <label>
                  <input
                    type="number"
                    min="0"
                    value={value}
                    disabled={!editing}
                    onChange={(e) =>
                      setDraft({ ...draft, [s.setting_key]: e.target.value })
                    }
                  />
                  <span>{unit}</span>
                </label>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Home({ go }) {
  return (
    <section className="home premium-home">
      <header className="section-head setup-page-head">
        <div>
          <h1>SetUp</h1>
        </div>
      </header>
      <div className="setup-layout">
        <div className="setup-sections">
          {landingSections.map((section) => (
            <section className="landing-section" key={section.title}>
              <h2>{section.title}</h2>
              <div className="landing-rows">
                {section.items.map(([id, label, description]) => {
                  const Icon = itemIcons[id];
                  return (
                    <button
                      key={id}
                      className="landing-row"
                      onClick={() => go(id)}
                    >
                      <span className="row-icon">
                        <Icon size={17} />
                      </span>
                      <span>
                        <strong>{label}</strong>
                        {description && <small>{description}</small>}
                      </span>
                      <ChevronRight className="row-chevron" size={17} />
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}

function AppShell({ session, onLogout }) {
  const [page, setPage] = useState(() => (location.hash.slice(1).split("?")[0]) || "home"),
    [routeHash, setRouteHash] = useState(() => location.hash),
    [nav, setNav] = useState(false),
    [activePanel, setActivePanel] = useState(null),
    [toast, setToast] = useState(null),
    [capabilities, setCapabilities] = useState([]);
  const securityRefreshQueued = useRef(false);
  const notify = (message, kind = "success") => setToast({ message, kind });
  const loadCapabilities = () => {
    capabilitiesApi.get(session.access_token).then(setCapabilities).catch(() => setCapabilities([]));
  };
  const refreshCapabilities = () => { invalidateCapabilitiesCache(); loadCapabilities(); };
  useEffect(() => {
    loadCapabilities();
  }, [session.access_token]);
  useEffect(() => {
    if (!supabase || !session.user?.id) return undefined;
    let active = true;
    let subscribed = false;
    const refreshSecurityState = () => {
      if (securityRefreshQueued.current) return;
      securityRefreshQueued.current = true;
      queueMicrotask(() => {
        securityRefreshQueued.current = false;
        if (!active) return;
        invalidateCapabilitiesCache();
        capabilitiesApi.get(session.access_token).then(setCapabilities).catch((error) => {
          setCapabilities([]);
          if (error?.status === 403) onLogout();
        });
      });
    };
    const channel = supabase
      .channel(`user-security:${session.user.id}`, { config: { private: true } })
      .on("broadcast", { event: "security_invalidated" }, refreshSecurityState)
      .subscribe((status) => {
        if (!active || status !== "SUBSCRIBED") return;
        if (subscribed) refreshSecurityState();
        subscribed = true;
      });
    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [session.access_token, session.user?.id, onLogout]);
  useEffect(() => {
    const onHash = () => {
      setPage((location.hash.slice(1).split("?")[0]) || "home");
      // Query-only hash changes (for example queue switches) must also update
      // the module panel's active row, even when the pathname stays `employees`.
      setRouteHash(location.hash);
    };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      setActivePanel(null);
      setNav(false);
    };
    addEventListener("keydown", closeOnEscape);
    return () => removeEventListener("keydown", closeOnEscape);
  }, []);
  const go = (id) => (location.hash = id);
  const moduleContext = page === "dashboard"
    ? ["Workspace", "Workforce intelligence"]
    : page.startsWith("employees") || page.startsWith("contracts") || ["people", "documents", "social-insurance", "work-queues", "lifecycle", "data-quality"].includes(page)
      ? ["Workspace", "People operations"]
      : ["Workspace", "Organization settings"];
  const employeeParts = page.split("/");
  let content =
    page === "dashboard" ? (
      <Dashboard token={session.access_token} go={go} />
    ) : page === "people" ? (
      <EmployeesList token={session.access_token} toast={notify} go={go} capabilities={capabilities} />
    )
    : page === "work-queues" ? <WorkQueuesRedirect go={go} />
    : page === "contracts/renewals" ? <ContractRenewals token={session.access_token} toast={notify} go={go} capabilities={capabilities} />
    : page === "lifecycle" ? <Lifecycle go={go} />
    : page === "data-quality" ? <DataQuality go={go} />
    : page === "employees" ? (
      <EmployeesList token={session.access_token} toast={notify} go={go} capabilities={capabilities} />
    ) : page === "employees/new" ? (
      <EmployeeForm token={session.access_token} toast={notify} go={go} capabilities={capabilities} />
    ) : page === "documents" ? (
      <DocumentsCompliance token={session.access_token} toast={notify} go={go} capabilities={capabilities} />
    ) : page === "social-insurance" ? (
      <SocialInsurance token={session.access_token} toast={notify} go={go} capabilities={capabilities} />
    ) : employeeParts[0] === "employees" && employeeParts[2] === "edit" ? (
      <EmployeeEditorLoader id={employeeParts[1]} token={session.access_token} toast={notify} go={go} capabilities={capabilities} />
    ) : employeeParts[0] === "employees" && employeeParts[1] ? (
      <EmployeeDetail id={employeeParts[1]} token={session.access_token} toast={notify} go={go} capabilities={capabilities} />
    ) :
    page === "users" ? (
      <Users token={session.access_token} toast={notify} onCapabilitiesChanged={refreshCapabilities} />
    ) : page === "roles" ? (
      <Roles token={session.access_token} toast={notify} onCapabilitiesChanged={refreshCapabilities} />
    ) : page === "insurance" ? (
      <Insurance token={session.access_token} toast={notify} />
    ) : page === "home" ? (
      <Home go={go} />
    ) : (
      <MasterData resource={page} token={session.access_token} toast={notify} />
    );
  return (
    <div className={`app-shell${activePanel ? " navigation-open" : ""}`}>
      <Sidebar
        session={session}
        page={page}
        routeHash={routeHash}
        setPage={(p) => {
          location.hash = p;
        }}
        logout={onLogout}
        isOpen={nav}
        onOpen={() => { setNav(true); setActivePanel((current) => current || (page.startsWith("dashboard") ? "analytics" : page.startsWith("employees") || ["people", "work-queues", "documents", "social-insurance", "lifecycle", "data-quality"].includes(page) ? "people" : "setup")); }}
        close={() => setNav(false)}
        activePanel={activePanel}
        setActivePanel={setActivePanel}
      />
      <main className="main-content">
        <header className="topbar">
          <div className="topbar-context">
            <small>{moduleContext[0]}</small>
            <span>{moduleContext[1]}</span>
          </div>
          <div className="topbar-actions">
            <NotificationCenter token={session.access_token} />
            <div className="topbar-user" aria-label="Current user">
              <div>
                <strong>{session.user.user_metadata?.full_name || session.user.email}</strong>
                <small>Signed in</small>
              </div>
              <div className="top-avatar">{initials(session.user.email)}</div>
            </div>
          </div>
        </header>
        {content}
      </main>
      <Toast toast={toast} clear={() => setToast(null)} />
    </div>
  );
}

function WorkQueuesRedirect({ go }) {
  useEffect(() => { go(workQueueHash("contracts_expiring")); }, [go]);
  return <section className="section-view"><div className="loading-list"><div className="skeleton" /></div></section>;
}

function EmployeeEditorLoader({ id, token, toast, go, capabilities }) {
  const [employee, setEmployee] = useState(null);
  useEffect(() => {
    employeesApi.getEmployee(id, token).then(setEmployee).catch((e) => toast(e.message, "error"));
  }, [id, token]);
  return employee ? <EmployeeForm token={token} toast={toast} go={go} employee={employee} mode="edit" capabilities={capabilities} /> : <section className="section-view"><LoadingRows /></section>;
}

export default function App() {
  const devSession = useMemo(() => ({
    access_token: LOCAL_DEV_ACCESS_TOKEN,
    user: {
      id: null,
      email: "local-dev@hms.test",
      user_metadata: { full_name: "Local Development" },
    },
  }), []);
  const [session, setSession] = useState(() => localDevAuthBypass ? devSession : null);
  useEffect(() => {
    if (localDevAuthBypass) return undefined;
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, s) => {
    if (!s) {
      invalidateCapabilitiesCache();
      invalidateEmployeeLookupCache();
    }
      setSession(s);
    });
    return () => subscription.unsubscribe();
  }, []);
  return session ? (
    <AppShell session={session} onLogout={() => {
      if (localDevAuthBypass) return;
      invalidateCapabilitiesCache();
      invalidateEmployeeLookupCache();
      supabase.auth.signOut();
    }} />
  ) : (
    <Login onSession={setSession} />
  );
}
