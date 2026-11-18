import { useEffect, useState } from "react";
import { hiringPlansApi } from "./api";
import { Modal } from "./Modal";

const emptyPlan = { project_id: "", department_id: "", position_id: "", planned_count: "0" };
const scopeName = (row) => `${row.project?.name || "Project"} · ${row.department?.name || "Department"} · ${row.position?.name || "Position"}`;
const count = (value) => new Intl.NumberFormat().format(Number(value || 0));

function Pager({ pagination, onPage, busy }) {
  if (!pagination || pagination.total_pages <= 1) return null;
  return <nav className="employee-pagination" aria-label="Staffing pages">
    <button className="secondary" disabled={busy || !pagination.has_previous} onClick={() => onPage(pagination.page - 1)}>Previous</button>
    <span>Page {pagination.page} of {pagination.total_pages}</span>
    <button className="secondary" disabled={busy || !pagination.has_next} onClick={() => onPage(pagination.page + 1)}>Next</button>
  </nav>;
}

export function HiringPlanSetup({ token, toast, canEdit }) {
  const [options, setOptions] = useState(null);
  const [plans, setPlans] = useState(null);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setError("");
    try {
      const [refs, rows] = await Promise.all([hiringPlansApi.options(token), hiringPlansApi.list(token)]);
      setOptions(refs);
      setPlans(rows || []);
    } catch (e) {
      setError(e.message || "Unable to load hiring plans.");
      setPlans([]);
    }
  };
  useEffect(() => { load(); }, [token]);
  const save = async (event) => {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const body = {
      project_id: Number(form.get("project_id")),
      department_id: Number(form.get("department_id")),
      position_id: Number(form.get("position_id")),
      planned_count: Number(form.get("planned_count")),
    };
    setBusy(true);
    try {
      if (editor.id) await hiringPlansApi.update(editor.id, body, token);
      else await hiringPlansApi.create(body, token);
      toast("Hiring plan saved.", "success");
      setEditor(null);
      await load();
    } catch (e) {
      toast(e.message || "Unable to save hiring plan.", "error");
    } finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await hiringPlansApi.remove(confirm.id, token);
      toast("Hiring plan removed.", "success");
      setConfirm(null);
      await load();
    } catch (e) { toast(e.message || "Unable to remove hiring plan.", "error"); }
    finally { setBusy(false); }
  };
  return <section className="section-view hiring-plan-view">
    <header className="section-head"><div><h1>Hiring Plan</h1><p>Set planned headcount for each project, department, and position.</p></div>
      {canEdit && <button className="primary" onClick={() => setEditor({ ...emptyPlan })}>+ Add plan</button>}
    </header>
    {error && <p className="form-error" role="alert">{error}</p>}
    {plans === null ? <div className="loading-list"><div className="skeleton" /></div> : plans.length === 0 ? <div className="empty"><h3>No hiring plans configured</h3><p>Add a project, department, and position with its planned headcount.</p>{canEdit && <button className="primary" onClick={() => setEditor({ ...emptyPlan })}>Add first plan</button>}</div> :
      <div className="data-list">{plans.map((plan) => <article className="data-row hiring-plan-row" key={plan.id}>
        <div className="hiring-plan-scope"><strong>{plan.project?.name} · {plan.department?.name} · {plan.position?.name}</strong><small>{plan.position?.position_code || "Position"}</small></div>
        <span className="hiring-plan-count"><small>Planned headcount</small><strong>{count(plan.planned_count)}</strong></span>
        {canEdit && <div className="row-actions"><button className="text-button" onClick={() => setEditor({ ...plan, ...{ project_id: String(plan.project_id), department_id: String(plan.department_id), position_id: String(plan.position_id), planned_count: String(plan.planned_count) } })}>Edit</button><button className="text-button danger-text" onClick={() => setConfirm(plan)}>Remove</button></div>}
      </article>)}</div>}
    {editor && options && <Modal title={`${editor.id ? "Edit" : "Add"} hiring plan`} onClose={() => setEditor(null)} size="small">
      <form className="modal-grid" onSubmit={save}>
        <label>Project<select name="project_id" required defaultValue={editor.project_id}><option value="" disabled>Select a project</option>{options.projects.map((x) => <option value={x.id} key={x.id}>{x.name}</option>)}</select></label>
        <label>Department<select name="department_id" required defaultValue={editor.department_id}><option value="" disabled>Select a department</option>{options.departments.map((x) => <option value={x.id} key={x.id}>{x.name}</option>)}</select></label>
        <label className="modal-full-width">Position<select name="position_id" required defaultValue={editor.position_id}><option value="" disabled>Select a position</option>{options.positions.map((x) => <option value={x.id} key={x.id}>{x.name}{x.position_code ? ` · ${x.position_code}` : ""}</option>)}</select></label>
        <label className="modal-full-width">Planned employee count<input type="number" name="planned_count" min="0" step="1" required defaultValue={editor.planned_count} /></label>
        <footer className="modal-actions"><button type="button" className="secondary" onClick={() => setEditor(null)} disabled={busy}>Cancel</button><button className="primary" disabled={busy}>{busy ? "Saving…" : "Save plan"}</button></footer>
      </form>
    </Modal>}
    {confirm && <Modal title="Remove this hiring plan?" onClose={() => setConfirm(null)} size="small"><p>This will remove the plan for {scopeName(confirm)}. Employee records will not be changed.</p><footer className="modal-actions"><button className="secondary" onClick={() => setConfirm(null)} disabled={busy}>Keep plan</button><button className="danger" onClick={remove} disabled={busy}>{busy ? "Removing…" : "Remove plan"}</button></footer></Modal>}
  </section>;
}

export function ProjectStaffingQueue({ token, toast, go, canManage, canViewEmployees }) {
  const [options, setOptions] = useState(null);
  const [filters, setFilters] = useState({ project: "", department: "", position: "", status: "", search: "", page: 1, page_size: 25 });
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(null);
  const [employees, setEmployees] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [review, setReview] = useState(null);
  const [reviewSearch, setReviewSearch] = useState("");
  const [reviewPage, setReviewPage] = useState(1);
  const [reviewBusy, setReviewBusy] = useState(false);
  useEffect(() => { hiringPlansApi.staffingOptions(token).then(setOptions).catch((e) => setError(e.message)); }, [token]);
  useEffect(() => { const timer = setTimeout(() => setDebouncedSearch(filters.search), 300); return () => clearTimeout(timer); }, [filters.search]);
  const load = async () => {
    setLoading(true); setError("");
    try { setResult(await hiringPlansApi.staffing({ ...filters, search: debouncedSearch }, token)); }
    catch (e) { setError(e.message || "Unable to load project staffing."); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [token, filters.project, filters.department, filters.position, filters.status, filters.page, filters.page_size, debouncedSearch]);
  const loadReview = async (page = reviewPage, search = reviewSearch) => {
    setReviewBusy(true);
    try { setReview(await hiringPlansApi.review(page, 25, search, token)); setReviewPage(page); }
    catch (e) { toast(e.message || "Unable to load employee assignment review.", "error"); }
    finally { setReviewBusy(false); }
  };
  useEffect(() => { if (!reviewOpen) return; const timer = setTimeout(() => loadReview(1, reviewSearch), 300); return () => clearTimeout(timer); }, [reviewOpen, reviewSearch, token]);
  const openDetail = async (plan) => {
    setDetail(plan); setEmployees(null);
    try { setEmployees(await hiringPlansApi.employees(plan.id, 1, 25, token)); }
    catch (e) { toast(e.message || "Unable to load employees for this plan.", "error"); }
  };
  const changeEmployeePage = async (page) => {
    setEmployees(null);
    try { setEmployees(await hiringPlansApi.employees(detail.id, page, 25, token)); }
    catch (e) { toast(e.message || "Unable to load employees.", "error"); }
  };
  const update = (key, value) => setFilters((old) => ({ ...old, [key]: value, page: 1 }));
  const totals = result?.totals || { planned: 0, actual: 0, vacant: 0, excess: 0 };
  const statusLabel = { complete: "Complete", under_plan: "Under plan", over_plan: "Over plan" };
  const reviewCount = Number(result?.assignment_review_count || 0);
  const reviewRows = review?.rows || [];
  const employeeRows = employees?.rows || [];
  return <section className="section-view staffing-view">
    <header className="section-head"><div><h1>Project Staffing</h1><p>Compare active employees with configured hiring plans. Active standard and 5% employees are included; resigned employees are excluded.</p></div>{canManage && <button className="secondary" onClick={() => go("hiring-plans")}>Manage Hiring Plan</button>}</header>
    <div className="staffing-totals" aria-live="polite">{[["Planned", totals.planned], ["Actual", totals.actual], ["Vacant", totals.vacant], ["Excess", totals.excess]].map(([label, value]) => <article key={label}><small>{label}</small><strong>{count(value)}</strong></article>)}</div>
    <div className="toolbar staffing-filters">
      <label className="search">⌕ <input value={filters.search} onChange={(e) => update("search", e.target.value)} placeholder="Search project, department, or position" /></label>
      <select aria-label="Filter by project" value={filters.project} onChange={(e) => update("project", e.target.value)}><option value="">All projects</option>{options?.projects?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      <select aria-label="Filter by department" value={filters.department} onChange={(e) => update("department", e.target.value)}><option value="">All departments</option>{options?.departments?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      <select aria-label="Filter by position" value={filters.position} onChange={(e) => update("position", e.target.value)}><option value="">All positions</option>{options?.positions?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      <select aria-label="Filter by staffing status" value={filters.status} onChange={(e) => update("status", e.target.value)}><option value="">All statuses</option><option value="complete">Complete</option><option value="under_plan">Under plan</option><option value="over_plan">Over plan</option></select>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {loading && !result ? <div className="loading-list"><div className="skeleton" /></div> : result?.rows?.length ? <div className="table-wrap staffing-table-wrap"><table className="employee-table staffing-table"><thead><tr><th>Project</th><th>Department</th><th>Position</th><th>Planned</th><th>Actual</th><th>Difference</th><th>Status</th><th>Employees</th></tr></thead><tbody>{result.rows.map((row) => <tr key={row.id}><td>{row.project_name}</td><td>{row.department_name}</td><td>{row.position_name}</td><td>{count(row.planned_count)}</td><td>{count(row.actual_count)}</td><td className={Number(row.difference) < 0 ? "staffing-negative" : Number(row.difference) > 0 ? "staffing-positive" : ""}>{Number(row.difference) > 0 ? "+" : ""}{count(row.difference)}</td><td><span className={`staffing-badge ${row.status}`}>{statusLabel[row.status]}</span></td><td><button className="text-button" onClick={() => openDetail(row)}>View {count(row.actual_count)}</button></td></tr>)}</tbody></table></div> : !error ? <div className="empty"><h3>No planned staffing matches these filters</h3><p>Plans with zero active employees remain visible when they match your filters.</p></div> : null}
    {result && <Pager pagination={result.pagination} onPage={(page) => update("page", page)} busy={loading} />}
    <section className="assignment-review"><header><div><h2>Employee assignment review</h2><p>{reviewCount ? `${count(reviewCount)} active employee${reviewCount === 1 ? "" : "s"} have missing, inactive, or unplanned assignments.` : "All active employees match active organization records and a configured plan."}</p></div><button className="secondary" onClick={() => setReviewOpen(!reviewOpen)}>{reviewOpen ? "Hide review" : "Review assignments"}</button></header>
      {reviewOpen && <><label className="search review-search">⌕ <input value={reviewSearch} onChange={(e) => setReviewSearch(e.target.value)} placeholder="Search employee name or number" /></label>{!review ? <div className="loading-list"><div className="skeleton" /></div> : reviewRows.length ? <div className="table-wrap staffing-table-wrap"><table className="employee-table"><thead><tr><th>Employee</th><th>Project</th><th>Department</th><th>Position</th><th>Assignment issue</th></tr></thead><tbody>{reviewRows.map((row) => <tr key={row.id}><td>{canViewEmployees ? <button className="text-button" onClick={() => go(`employees/${row.id}`)}>{row.employee_number} · {row.english_full_name || row.arabic_full_name}</button> : <>{row.employee_number} · {row.english_full_name || row.arabic_full_name}</>}</td><td>{row.project_name || "—"}</td><td>{row.department_name || "—"}</td><td>{row.position_name || "—"}</td><td>{row.assignment_issues?.join(", ")}</td></tr>)}</tbody></table></div> : <div className="empty">No active employees have missing, inactive, or unplanned assignments.</div>}<Pager pagination={review?.pagination} onPage={(page) => loadReview(page)} busy={reviewBusy} /></>}
    </section>
    {detail && <Modal title="Employees counted for this plan" onClose={() => { setDetail(null); setEmployees(null); }} size="large"><p className="staffing-detail-scope">{detail.project_name} · {detail.department_name} · {detail.position_name}</p>{employees === null ? <div className="loading-list"><div className="skeleton" /></div> : employeeRows.length ? <div className="staffing-employee-list">{employeeRows.map((employee) => <article key={employee.id}><span>{canViewEmployees ? <button className="text-button" onClick={() => go(`employees/${employee.id}`)}>{employee.employee_number} · {employee.english_full_name || employee.arabic_full_name}</button> : `${employee.employee_number} · ${employee.english_full_name || employee.arabic_full_name}`}</span><small>{employee.employee_classification === "five_percent" ? "5%" : "Standard"} · Joined {employee.joining_date}</small></article>)}</div> : <div className="empty">No active employees are assigned to this plan.</div>}<Pager pagination={employees?.pagination} onPage={changeEmployeePage} busy={employees === null} /></Modal>}
  </section>;
}
