import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BadgeDollarSign,
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
import { authConfigured, supabase } from "./auth";
import { capabilitiesApi, employeesApi, invalidateCapabilitiesCache, setupApi } from "./api";
import { EmployeeDetail, EmployeeForm, EmployeesList } from "./Employees";
import { Dashboard } from "./Dashboard";

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
const labels = Object.fromEntries(groups.flatMap((g) => g.items));
const titleCase = (s) => labels[s] || s;
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
function SetupBreadcrumb({ group, current }) {
  return (
    <div className="page-navigation">
      <button
        className="back-to-setup"
        onClick={() => {
          location.hash = "";
        }}
      >
        <ArrowLeft size={15} />
        Back to SetUp
      </button>
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
    setError("");
    if (!email || !password) return setError("Enter your email and password.");
    if (!authConfigured)
      return setError(
        "Browser authentication is not configured. Add the safe VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY values.",
      );
    setBusy(true);
    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setBusy(false);
    if (authError)
      setError("Unable to sign in. Check your email and password.");
    else onSession(data.session);
  };
  return (
    <main className="login-page">
      <section className="login-panel">
        <img src={logo} alt="JUSHI" className="login-logo" />
        <div>
          <p className="eyebrow">HR MANAGEMENT SYSTEM</p>
          <h1>Welcome back</h1>
          <p className="muted">
            Sign in to manage your people, policies, and operations.
          </p>
        </div>
        <form onSubmit={submit} noValidate>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              aria-invalid={!!error}
              placeholder="you@company.com"
            />
          </label>
          <label>
            Password
            <span className="password-wrap">
              <input
                type={show ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="Enter your password"
              />
              <button type="button" onClick={() => setShow(!show)}>
                {show ? "Hide" : "Show"}
              </button>
            </span>
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary wide" disabled={busy}>
            {busy ? "Signing in…" : "Sign In"}
          </button>
        </form>
      </section>
      <footer>By Moaz Shiref</footer>
    </main>
  );
}

function Sidebar({ session, page, setPage, logout, isOpen, onOpen, close }) {
  const user = session.user;
  return (
    <>
      <button
        className="menu-button"
        onClick={onOpen}
        aria-label="Open navigation"
      >
        ☰
      </button>
      <aside className={`sidebar ${isOpen ? "open" : ""}`}>
        <div className="sidebar-top">
          <div className="brand-lockup">
            <img src={logo} alt="JUSHI" className="brand" />
            <div>
              <strong>JUSHI</strong>
              <p className="brand-caption">HR MANAGEMENT</p>
            </div>
          </div>
          <nav>
            <button className={`nav-item ${page === "dashboard" ? "selected" : ""}`} onClick={() => { setPage("dashboard"); close(); }}>
              <LayoutDashboard size={17} />
              <span>Dashboard</span>
            </button>
            <button
              className={`nav-item ${page.startsWith("employees") ? "selected" : ""}`}
              onClick={() => {
                setPage("employees");
                close();
              }}
            >
              <UsersRound size={17} />
              <span>Employees</span>
            </button>
            <button
              className={`nav-item ${page !== "dashboard" && !page.startsWith("employees") ? "selected" : ""}`}
              onClick={() => {
                setPage("home");
                close();
              }}
            >
              <Settings2 size={17} />
              <span>SetUp</span>
            </button>
          </nav>
        </div>
        <div className="side-bottom">
          <div className="current-user">
            <span className="avatar">
              {initials(user.user_metadata?.full_name || user.email)}
            </span>
            <div>
              <strong>{user.user_metadata?.full_name || user.email}</strong>
              <small>Super Admin</small>
            </div>
          </div>
          <button className="logout" onClick={logout}>
            <LogOut size={15} /> Logout
          </button>
          <p className="signature">By Moaz Shiref</p>
        </div>
      </aside>
      {isOpen && (
        <button
          className="scrim"
          aria-label="Close navigation"
          onClick={close}
        />
      )}
    </>
  );
}

function Confirm({ title, message, onConfirm, onClose, busy }) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        <h2 id="confirm-title">{title}</h2>
        <p>{message}</p>
        <div className="dialog-actions">
          <button className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="danger" onClick={onConfirm} disabled={busy}>
            {busy ? "Updating…" : "Deactivate"}
          </button>
        </div>
      </section>
    </div>
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
          <p>Manage the options HR teams use when creating and updating employee records.</p>
        </div>
        <button className="primary" onClick={() => setEditor({})}>
          + Add {titleCase(resource).replace(/s$/, "")}
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
            Add {titleCase(resource).replace(/s$/, "")}
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
  return (
    <Drawer
      title={`${record.id ? "Edit" : "Add"} ${titleCase(resource).replace(/s$/, "")}`}
      onClose={onClose}
    >
      <form
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
        <label>
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
        <button className="primary wide" disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </button>
      </form>
    </Drawer>
  );
}
function Drawer({ title, children, onClose }) {
  return (
    <div className="drawer-backdrop">
      <aside className="drawer" role="dialog" aria-modal="true">
        <header>
          <h2>{title}</h2>
          <button onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        {children}
      </aside>
    </div>
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
          <p>Manage who can access the HR Management System.</p>
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
      onCapabilitiesChanged();
      toast(isNew ? "User created." : "User details saved.", "success");
      done();
      onClose();
    } catch (e) {
      if (!isNew && e.status === 409 && e.code === "user_access_conflict") setConflict(true);
      else toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer title={isNew ? "Add User" : "Manage User"} onClose={onClose}>
      {conflict && <div className="employee-notice danger">This user’s access was updated by another administrator.<span className="notice-actions"><button type="button" className="secondary" disabled={busy} onClick={refreshLatest}>Refresh Latest Access</button><button type="button" className="text-button" disabled={busy} onClick={() => setConflict(false)}>Keep Editing</button></span></div>}
      <form onSubmit={save}>
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
        <fieldset>
          <legend>Assigned Roles</legend>
          {roles
            .filter((r) => r.is_active)
            .map((r) => (
              <label className="check" key={r.id}>
                <input
                  type="checkbox"
                  checked={form.role_ids.includes(r.id)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      role_ids: e.target.checked
                        ? [...form.role_ids, r.id]
                        : form.role_ids.filter((x) => x !== r.id),
                    })
                  }
                />
                {r.name}
              </label>
            ))}
        </fieldset>
        <button className="primary wide" disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </button>
      </form>
    </Drawer>
  );
}

function Roles({ token, toast, onCapabilitiesChanged }) {
  const [roles, setRoles] = useState(null), [perms, setPerms] = useState([]), [selected, setSelected] = useState(null), [selectedIds, setSelectedIds] = useState(new Set()), [busy, setBusy] = useState(false), [showAdvanced, setShowAdvanced] = useState(false), [conflict, setConflict] = useState(false);
  const load = async (keepId) => {
    try {
      setRoles(null);
      const [nextRoles, nextPerms] = await Promise.all([setupApi.roles(token), setupApi.permissions(token)]);
      const next = nextRoles.find((role) => role.id === keepId) || nextRoles[0] || null;
      setRoles(nextRoles); setPerms(nextPerms); setSelected(next); setSelectedIds(new Set(next?.role_permissions?.map((item) => item.permission_id) || []));
    } catch (e) { setRoles([]); }
  };
  useEffect(() => { load(); }, [token]);
  const readable = (permission) => {
    const key = permission.permission_key;
    const map = {
      "employees.view": ["Employees", "View Employees"], "employees.create": ["Employees", "Add Employees"], "employees.edit": ["Employees", "Edit Employees"], "employees.delete": ["Employees", "Manage Employment Status"],
      "employees.personal.view": ["Employees · Personal Information", "View"], "employees.personal.edit": ["Employees · Personal Information", "Edit"],
      "employees.work.view": ["Employees · Work Information", "View"], "employees.work.edit": ["Employees · Work Information", "Edit"],
      "employees.insurance.view": ["Employees · Insurance", "View"], "employees.insurance.edit": ["Employees · Insurance", "Edit"],
      "employees.financial.view": ["Employees · Financial Information", "View"], "employees.financial.edit": ["Employees · Financial Information", "Edit"],
      "dashboard.view": ["Dashboard", "View Dashboard"],
      "setup.view": ["SetUp", "View Settings"], "setup.edit": ["SetUp", "Manage Settings"],
      "users.view": ["Users & Access", "View Users"], "users.create": ["Users & Access", "Add Users"], "users.edit": ["Users & Access", "Edit Users"], "users.deactivate": ["Users & Access", "Deactivate Users"],
      "roles.view": ["Users & Access", "View Roles & Permissions"], "roles.create": ["Users & Access", "Create Roles"], "roles.edit": ["Users & Access", "Manage Roles & Permissions"], "roles.delete": ["Users & Access", "Delete Roles"],
    };
    return map[key] || [permission.module.replaceAll(".", " · "), permission.description || permission.action.replaceAll("_", " ")];
  };
  const groups = perms.reduce((all, permission) => { const [group] = readable(permission); (all[group] ||= []).push(permission); return all; }, {});
  const toggle = (id) => setSelectedIds((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const setGroup = (items, enabled) => setSelectedIds((current) => { const next = new Set(current); items.forEach((item) => enabled ? next.add(item.id) : next.delete(item.id)); return next; });
  const save = async () => { if (!selected) return; setBusy(true); try { const result = await setupApi.rolePermissions(selected.id, [...selectedIds], selected.updated_at, token); setSelected((current) => current ? { ...current, updated_at: result.updated_at } : current); onCapabilitiesChanged(); toast("Permissions saved.", "success"); await load(selected.id); } catch (e) { if (e.status === 409 && e.code === "role_conflict") setConflict(true); else toast(e.message, "error"); } finally { setBusy(false); } };
  const usersFor = (role) => role.user_roles?.[0]?.count ?? 0;
  return <section className="section-view roles-view"><div className="section-head"><div><SetupBreadcrumb group="Access & Security" current="Roles & Permissions"/><h1>Roles & Permissions</h1><p>Choose what each role can see and do. Changes apply after you save.</p></div><button className="primary" onClick={async () => { const name = window.prompt("Role name"); if (!name) return; try { await setupApi.createRole({ name }, token); toast("Role created.", "success"); load(); } catch (e) { toast(e.message, "error"); } }}>+ Create Role</button></div><p className="employee-notice">Super Admin accounts have full system access independently of role permissions.</p>{!roles ? <LoadingRows /> : <div className="roles-layout"><aside className="role-list role-cards">{roles.map((role) => <button className={selected?.id === role.id ? "selected" : ""} key={role.id} onClick={() => { setSelected(role); setSelectedIds(new Set(role.role_permissions?.map((item) => item.permission_id) || [])); setConflict(false); }}><span><strong>{role.name}</strong><small>{role.description || "Custom access role"}</small></span><span><Status active={role.is_active}/><small>{usersFor(role)} assigned</small></span></button>)}</aside><div className="permissions">{selected ? <>{conflict && <div className="employee-notice danger">This role was updated by another administrator.<span className="notice-actions"><button className="secondary" disabled={busy} onClick={() => { setConflict(false); load(selected.id); }}>Refresh Latest Permissions</button><button className="text-button" disabled={busy} onClick={() => setConflict(false)}>Keep Current Selection</button></span></div>}<div className="role-detail"><div><p className="eyebrow">ROLE ACCESS</p><h2>{selected.name}</h2><p>{selected.description || "Select the access this role needs."}</p></div><div className="row-actions"><Status active={selected.is_active}/><button className="secondary" disabled={busy || !selected.is_active} onClick={() => setSelectedIds(new Set(perms.map((item) => item.id)))}>Select All</button><button className="secondary" disabled={busy || !selected.is_active} onClick={() => setSelectedIds(new Set())}>Clear All</button><button className="primary" disabled={busy || !selected.is_active} onClick={save}>{busy ? "Saving…" : "Save Permissions"}</button></div></div>{Object.entries(groups).map(([group, items]) => <section className="permission-group" key={group}><header><div><h3>{group}</h3><p>{items.length} access option{items.length === 1 ? "" : "s"}</p></div><button className="text-button" disabled={busy || !selected.is_active} onClick={() => setGroup(items, !items.every((item) => selectedIds.has(item.id)))}>{items.every((item) => selectedIds.has(item.id)) ? "Clear group" : "Select group"}</button></header>{items.map((item) => { const [, label] = readable(item); return <label className="permission" key={item.id}><input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggle(item.id)} disabled={busy || !selected.is_active}/><span>{label}</span><small>{item.description}</small></label>; })}</section>)}<section className="advanced-permissions"><button className="secondary" onClick={() => setShowAdvanced((value) => !value)}>{showAdvanced ? "Hide" : "Show"} Advanced Permissions</button>{showAdvanced && <div>{perms.map((item) => <code key={item.id}>{item.permission_key}</code>)}</div>}</section></> : <div className="empty"><h3>Select a role to manage its permissions.</h3></div>}</div></div>}</section>;
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
          <p>Set eligibility and comprehensive health deduction rules.</p>
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
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <span>Administration</span>
        <ChevronRight size={13} />
        <strong>SetUp</strong>
      </nav>
      <h1>SetUp</h1>
      <p className="intro">
        Manage HR configuration and access settings.
      </p>
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
    [nav, setNav] = useState(false),
    [toast, setToast] = useState(null),
    [capabilities, setCapabilities] = useState([]);
  const notify = (message, kind = "success") => setToast({ message, kind });
  const loadCapabilities = () => {
    capabilitiesApi.get(session.access_token).then(setCapabilities).catch(() => setCapabilities([]));
  };
  const refreshCapabilities = () => { invalidateCapabilitiesCache(); loadCapabilities(); };
  useEffect(() => {
    loadCapabilities();
  }, [session.access_token]);
  useEffect(() => {
    const onHash = () => setPage((location.hash.slice(1).split("?")[0]) || "home");
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);
  const go = (id) => (location.hash = id);
  const employeeParts = page.split("/");
  let content =
    page === "dashboard" ? (
      <Dashboard token={session.access_token} go={go} />
    ) : page === "employees" ? (
      <EmployeesList token={session.access_token} toast={notify} go={go} capabilities={capabilities} />
    ) : page === "employees/new" ? (
      <EmployeeForm token={session.access_token} toast={notify} go={go} capabilities={capabilities} />
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
    <div className="app-shell">
      <Sidebar
        session={session}
        page={page}
        setPage={(p) => {
          location.hash = p;
        }}
        logout={onLogout}
        isOpen={nav}
        onOpen={() => setNav(true)}
        close={() => setNav(false)}
      />
      <main className="main-content">
        <header className="topbar">
          <span>{page === "dashboard" ? "Dashboard" : page.startsWith("employees") ? "Employees" : "SetUp"}</span>
          <div className="top-avatar">{initials(session.user.email)}</div>
        </header>
        {content}
        <footer className="mobile-signature">By Moaz Shiref</footer>
      </main>
      <Toast toast={toast} clear={() => setToast(null)} />
    </div>
  );
}

function EmployeeEditorLoader({ id, token, toast, go, capabilities }) {
  const [employee, setEmployee] = useState(null);
  useEffect(() => {
    employeesApi.getEmployee(id, token).then(setEmployee).catch((e) => toast(e.message, "error"));
  }, [id, token]);
  return employee ? <EmployeeForm token={token} toast={toast} go={go} employee={employee} mode="edit" capabilities={capabilities} /> : <section className="section-view"><LoadingRows /></section>;
}

export default function App() {
  const [session, setSession] = useState(null);
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, s) => {
      if (!s) invalidateCapabilitiesCache();
      setSession(s);
    });
    return () => subscription.unsubscribe();
  }, []);
  return session ? (
    <AppShell session={session} onLogout={() => { invalidateCapabilitiesCache(); supabase.auth.signOut(); }} />
  ) : (
    <Login onSession={setSession} />
  );
}
