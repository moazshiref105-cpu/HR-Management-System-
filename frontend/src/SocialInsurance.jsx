import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Pencil, RefreshCw } from "lucide-react";
import { socialInsuranceApi } from "./api";
import { Modal } from "./Modal";

const date = (value) => value
  ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(value.length === 10 ? `${value}T00:00:00` : value))
  : "Not entered";
const PRESETS = { form_1_insurance_status_text: "تم التأمين عليه", form_6_insurance_status_text: "تم الفصل" };
const auditSummary = (changes) => {
  const fields = Object.keys(changes?.created || changes || {});
  if (fields.some((field) => field.endsWith("social_insurance_number"))) return "Social Insurance Number changed";
  if (fields.some((field) => field.endsWith("insurance_status_text"))) return "Insurance status changed";
  if (fields.some((field) => field.includes("incoming_"))) return "Incoming details updated";
  if (fields.some((field) => field.endsWith("notes"))) return "Notes updated";
  if (fields.some((field) => field.startsWith("form_6_"))) return "Form 6 updated";
  if (fields.some((field) => field.startsWith("form_1_"))) return "Form 1 updated";
  return "Social Insurance record updated";
};
const routeParams = () => new URLSearchParams(location.hash.split("?")[1] || "");
const routeContext = () => routeParams().get("return_to") || "employees";
const viewType = (view) => view === "form_1_needs_attention" ? "form_1" : view === "form_6_needs_attention" ? "form_6" : "all";

export function SocialInsurance({ token, toast, go, capabilities = [] }) {
  const initial = useMemo(routeParams, []);
  const [view, setView] = useState(initial.get("view") || "all");
  const [formType, setFormType] = useState(initial.get("form_type") || viewType(initial.get("view") || "all"));
  const [employeeId, setEmployeeId] = useState(initial.get("employee_id") || "");
  const [returnTo, setReturnTo] = useState(initial.get("return_to") || "");
  const [search, setSearch] = useState(initial.get("search") || "");
  const [department, setDepartment] = useState(initial.get("department") || "");
  const [from, setFrom] = useState(initial.get("from") || "");
  const [to, setTo] = useState(initial.get("to") || "");
  const [caseFilter, setCaseFilter] = useState(initial.get("case") || "all");
  const [departments, setDepartments] = useState([]);
  const [leavingReasons, setLeavingReasons] = useState([]);
  const [optionsError, setOptionsError] = useState("");
  const [optionsRefresh, setOptionsRefresh] = useState(0);
  const [page, setPage] = useState(Number(initial.get("page") || 1));
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [pageSize] = useState(25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const canView = capabilities.includes("employees.documents.view");
  const canEdit = capabilities.includes("employees.documents.edit");

  const load = useCallback(async () => {
    if (from && to && from > to) {
      setLoading(false);
      setError("Start date must not be after end date.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await socialInsuranceApi.list({
        form_type: formType, view, case: caseFilter, search, department, from, to,
        employee_id: employeeId, page, page_size: pageSize,
      }, token);
      setRows(result.rows || []);
      setTotal(Number(result.total || 0));
    } catch (requestError) {
      setError(requestError.message || "Couldn’t load Social Insurance records.");
    } finally {
      setLoading(false);
    }
  }, [token, formType, view, caseFilter, search, department, from, to, employeeId, page, pageSize, refresh]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    let active = true;
    socialInsuranceApi.options(token)
      .then((result) => { if (active) { setDepartments(result.departments || []); setLeavingReasons(result.leaving_reasons || []); setOptionsError(""); } })
      .catch((requestError) => { if (active) { setDepartments([]); setLeavingReasons([]); setOptionsError(requestError.message || "Couldn’t load Social Insurance options."); } });
    return () => { active = false; };
  }, [token, optionsRefresh]);
  useEffect(() => {
    const syncRoute = () => {
      const params = routeParams();
      const nextView = params.get("view") || "all";
      setView(nextView);
      setFormType(params.get("form_type") || viewType(nextView));
      setEmployeeId(params.get("employee_id") || "");
      setReturnTo(params.get("return_to") || "");
      setCaseFilter(params.get("case") || "all");
    };
    addEventListener("hashchange", syncRoute);
    return () => removeEventListener("hashchange", syncRoute);
  }, []);
  useEffect(() => {
    const params = new URLSearchParams();
    if (view !== "all") params.set("view", view);
    if (formType !== viewType(view) && formType !== "all") params.set("form_type", formType);
    if (employeeId) params.set("employee_id", employeeId);
    if (search) params.set("search", search);
    if (department) params.set("department", department);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    params.set("case", caseFilter || "all");
    if (page > 1) params.set("page", String(page));
    if (returnTo) params.set("return_to", returnTo);
    history.replaceState(null, "", `#social-insurance${params.size ? `?${params}` : ""}`);
  }, [view, formType, employeeId, search, department, from, to, caseFilter, page, returnTo]);

  const openEditor = async (row) => {
    try {
      const [recordResult, auditResult] = await Promise.allSettled([
        socialInsuranceApi.get(row.employee_id, token),
        socialInsuranceApi.audit(row.employee_id, token),
      ]);
      const loaded = recordResult.status === "fulfilled" && recordResult.value?.employee_id ? recordResult.value : row;
      const record = row.employee_status === "resigned" ? {
        ...loaded,
        form_6_termination_reason: loaded.form_6_termination_reason || loaded.leaving_reason_name || "",
        form_6_social_insurance_number: loaded.form_6_social_insurance_number || loaded.form_1_social_insurance_number || "",
      } : loaded;
      const audit = auditResult.status === "fulfilled" ? auditResult.value : { rows: [] };
      setEditor({
        record: { ...record },
        audit: audit.rows || [],
        error: "",
        originalLeavingReasonId: loaded.leaving_reason_id || null,
        snapshotEditable: row.employee_status === "resigned" && !loaded.form_6_social_insurance_number && !loaded.form_1_social_insurance_number,
        snapshotWasCopied: row.employee_status === "resigned" && !loaded.form_6_social_insurance_number && Boolean(loaded.form_1_social_insurance_number),
        readOnly: !canEdit || !["active", "resigned"].includes(row.employee_status),
      });
    } catch (requestError) {
      setError(requestError.message || "Couldn’t open this record.");
    }
  };
  const save = async (event) => {
    event.preventDefault();
    try {
      const { record } = editor;
      const fields = record.employee_status === "resigned"
        ? ["form_6_termination_date", "form_6_termination_reason", "form_6_social_insurance_number", "form_6_incoming_number", "form_6_incoming_date", "form_6_insurance_status_text", "form_6_notes"]
        : ["form_1_installation_date", "form_1_social_insurance_number", "form_1_incoming_number", "form_1_incoming_date", "form_1_insurance_status_text", "form_1_notes"];
      const body = Object.fromEntries(fields.map((field) => [field, record[field] ?? ""]));
      if (record.employee_status === "resigned" && capabilities.includes("employees.edit")) {
        const selectedReason = leavingReasons.find((reason) => reason.name === record.form_6_termination_reason);
        if (selectedReason) {
          body.leaving_reason_id = selectedReason.id;
          body.expected_leaving_reason_id = editor.originalLeavingReasonId;
        }
      }
      await socialInsuranceApi.update(record.employee_id, { ...body, version: record.version }, token);
      setEditor(null);
      setRefresh((value) => value + 1);
      toast("Social Insurance record saved.", "success");
    } catch (requestError) {
      setEditor((current) => ({ ...current, error: requestError.message || "Couldn’t save this record." }));
    }
  };
  const update = (key, value) => setEditor((current) => ({ ...current, record: { ...current.record, [key]: value }, error: "" }));
  const changeView = (nextView, nextType = viewType(nextView)) => {
    setView(nextView);
    setFormType(nextType);
    setPage(1);
  };
  const changeCase = (value) => { setCaseFilter(value); setPage(1); };
  const clearEmployee = () => {
    setEmployeeId("");
    setReturnTo("");
    changeView("all", "all");
    go("social-insurance?view=all");
  };

  if (!canView) return <section className="section-view"><h1>Social Insurance</h1><div className="empty">You don’t have permission to view Social Insurance records.</div></section>;

  const showBothForms = formType === "all";
  const form1Rows = rows.filter((row) => row.employee_status === "active");
  const form6Rows = rows.filter((row) => row.employee_status === "resigned");

  return <section className="section-view social-insurance-view">
    <header className="section-head">
      <div><h1>Social Insurance</h1>{employeeId && <button className="text-button" onClick={() => go(routeContext())}><ArrowLeft size={14} /> Back to employee profile</button>}</div>
      <button className="secondary" onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={14} /> Refresh</button>
    </header>
    {employeeId && <div className="social-insurance-context"><span>Filtered to one employee</span><button className="text-button" onClick={clearEmployee}>View all Social Insurance</button></div>}
    <nav className="social-insurance-tabs" aria-label="Social Insurance views">
      {[["all", "All records", "all"], ["form_1", "Form 1", "all"], ["form_6", "Form 6", "all"], ["all", "Needs attention", "needs_attention"]].map(([type, label, nextView]) => {
        const selected = nextView === "needs_attention" ? view === "needs_attention" || view.endsWith("_needs_attention") : view === "all" && formType === type;
        return <button key={label} className={selected ? "selected" : ""} aria-pressed={selected} onClick={() => changeView(nextView, type)}>{label}</button>;
      })}
    </nav>
    <div className="social-insurance-filters">
      <input aria-label="Search employees" placeholder="Search employee name or number" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
      <select aria-label="Department" value={department} onChange={(event) => { setDepartment(event.target.value); setPage(1); }}><option value="">All departments</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <select aria-label="Case" value={caseFilter} onChange={(event) => changeCase(event.target.value)}><option value="all">All cases</option><option value="needs_attention">Needs attention</option><option value="complete">Complete</option></select>
      <label className="social-date-filter">From<input aria-label="Date from" type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} /></label>
      <label className="social-date-filter">To<input aria-label="Date to" type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} /></label>
      {from && to && from > to && <span className="form-error" role="alert">Start date must be before end date.</span>}
    </div>
    {error && <div className="employee-notice danger" role="alert">{error}<button className="secondary" onClick={() => setRefresh((value) => value + 1)}>Retry</button></div>}
    <div className="table-context" aria-live="polite">{loading ? "Loading Social Insurance…" : `Showing ${total} record${total === 1 ? "" : "s"}`}</div>
    {showBothForms ? (!loading && !error && rows.length === 0
      ? <div className="empty compact-empty">No Social Insurance records match these filters.</div>
      : <div className="social-insurance-all-sections">
        <FormTable title="Form 1 records" form="form_1" rows={form1Rows} loading={loading} error={error} canEdit={canEdit} onOpen={openEditor} />
        <FormTable title="Form 6 records" form="form_6" rows={form6Rows} loading={loading} error={error} canEdit={canEdit} onOpen={openEditor} />
      </div>) : <FormTable title={formType === "form_6" ? "Form 6 records" : "Form 1 records"} form={formType === "form_6" ? "form_6" : "form_1"} rows={formType === "form_6" ? form6Rows : form1Rows} loading={loading} error={error} canEdit={canEdit} onOpen={openEditor} emptyMessage="No Social Insurance records match these filters." />}
    {total > pageSize && <footer className="employee-pagination"><span>Page {page} · {total} records</span><div className="page-controls"><button className="secondary" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>Previous</button><button className="secondary" disabled={page * pageSize >= total || loading} onClick={() => setPage(page + 1)}>Next</button></div></footer>}
    {editor && <Editor editor={editor} update={update} leavingReasons={leavingReasons} canEditReason={capabilities.includes("employees.edit")} optionsError={optionsError} retryOptions={() => setOptionsRefresh((value) => value + 1)} onClose={() => setEditor(null)} onSave={save} />}
  </section>;
}

const FORM_COLUMNS = {
  form_1: [
    ["form_1_installation_date", "Installation date", "date"],
    ["form_1_social_insurance_number", "Social Insurance Number"],
    ["form_1_incoming_number", "form_1_incoming_date", "Incoming", "incoming"],
    ["form_1_insurance_status_text", "Insurance status", "status"],
  ],
  form_6: [
    ["form_6_termination_date", "Termination date", "date"],
    ["form_6_termination_reason", "Termination reason", "reason"],
    ["form_6_social_insurance_number", "Social Insurance Number"],
    ["form_6_incoming_number", "form_6_incoming_date", "Incoming", "incoming"],
    ["form_6_insurance_status_text", "Insurance status", "status"],
  ],
};
const REQUIRED_FIELDS = {
  form_1: [
    ["form_1_installation_date", "Installation date"],
    ["form_1_social_insurance_number", "Social Insurance Number"],
    ["form_1_incoming_number", "Incoming number"],
    ["form_1_incoming_date", "Incoming date"],
    ["form_1_insurance_status_text", "Insurance status"],
  ],
  form_6: [
    ["form_6_termination_date", "Termination date"],
    ["form_6_termination_reason", "Termination reason"],
    ["form_6_social_insurance_number", "Social Insurance Number"],
    ["form_6_incoming_number", "Incoming number"],
    ["form_6_incoming_date", "Incoming date"],
    ["form_6_insurance_status_text", "Insurance status"],
  ],
};
const missingFields = (row, form) => REQUIRED_FIELDS[form].filter(([field]) => !String(row[field] ?? "").trim()).map(([, label]) => label);
const displayValue = (row, field, type) => {
  const value = row[field];
  if (value == null || value === "") return "Not entered";
  return type === "date" ? date(value) : value;
};

function FormTable({ title, form, rows, loading, error, canEdit, onOpen, emptyMessage = "No records in this section." }) {
  const columns = FORM_COLUMNS[form];
  const completion = (row) => {
    const missing = missingFields(row, form);
    const needsAttention = Boolean(row.needs_attention);
    return <span className="social-completion">
      <span className={`social-record-state${needsAttention ? " needs-attention" : ""}`}>{needsAttention ? "Needs attention" : "Complete"}</span>
      {needsAttention && <small>{missing.length ? `Missing ${missing.length} field${missing.length === 1 ? "" : "s"}` : "Details need review"}</small>}
    </span>;
  };
  const employee = (row) => <span className="social-employee-cell">
    <strong dir="auto">{row.arabic_full_name || row.english_full_name || "Not entered"}</strong>
    {row.arabic_full_name && row.english_full_name && <small dir="auto">{row.english_full_name}</small>}
    <small>#{row.employee_number ?? "Not entered"}</small>
  </span>;
  const action = (row) => <button className="text-button social-row-action" onClick={() => onOpen(row)}>{canEdit && ["active", "resigned"].includes(row.employee_status) ? <><Pencil size={14} /> Edit</> : "View"}</button>;
  const cell = (row, column) => {
    const [field, label, type, pairedType] = column;
    if (pairedType === "incoming") return <td data-label={type} key={field} className="social-paired-cell"><strong>{displayValue(row, field)}</strong><small>{displayValue(row, label, "date")}</small></td>;
    const value = displayValue(row, field, type);
    return <td data-label={label} key={field} className={type === "reason" ? "social-long-value" : undefined} dir={type === "status" ? "auto" : undefined}>{value}</td>;
  };
  return <section className="social-form-table-section" aria-labelledby={`${form}-records-title`}>
    <h2 id={`${form}-records-title`}>{title}</h2>
    <div className="employee-table-wrap social-insurance-table-wrap">
      <table className={`employee-table social-insurance-table ${form}`}>
        <thead><tr><th>Employee</th><th>Department</th>{columns.map((column) => <th key={column[0]}>{column[3] === "incoming" ? column[2] : column[1]}</th>)}<th>Case</th><th>Action</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.employee_id}>
          <td data-label="Employee" className="social-employee-column">{employee(row)}</td>
          <td data-label="Department">{row.department_name || "Not entered"}</td>
          {columns.map((column) => cell(row, column))}
          <td data-label="Case">{completion(row)}</td>
          <td data-label="Action">{action(row)}</td>
        </tr>)}</tbody>
      </table>
      {!loading && !error && rows.length === 0 && <div className="empty compact-empty">{emptyMessage}</div>}
    </div>
  </section>;
}

function Editor({ editor, update, leavingReasons, canEditReason, optionsError, retryOptions, onClose, onSave }) {
  const { record, audit, error, readOnly } = editor;
  const employeeStatus = record.employee_status;
  const isForm1 = employeeStatus === "active";
  const prefix = isForm1 ? "form_1" : "form_6";
  const statusKey = `${prefix}_insurance_status_text`;
  const preset = PRESETS[statusKey];
  const [customStatus, setCustomStatus] = useState(Boolean(record[statusKey] && record[statusKey] !== preset));
  const [snapshotEditable, setSnapshotEditable] = useState(Boolean(editor.snapshotEditable));
  const [historyExpanded, setHistoryExpanded] = useState(false);
  useEffect(() => setCustomStatus(Boolean(record[statusKey] && record[statusKey] !== preset)), [record.employee_id, statusKey, preset]);
  useEffect(() => setSnapshotEditable(Boolean(editor.snapshotEditable)), [record.employee_id, editor.snapshotEditable]);
  const configuredReason = leavingReasons.some((reason) => reason.name === record.form_6_termination_reason);
  const reasonIsOther = Boolean(record.form_6_termination_reason) && !configuredReason;
  const [otherReasonSelected, setOtherReasonSelected] = useState(reasonIsOther);
  const missing = missingFields(record, prefix);
  const statusControl = <div className="social-status-control modal-full-width">
    <label>Insurance status<select disabled={readOnly} value={customStatus ? "__custom" : record[statusKey] || ""} onChange={(event) => {
      if (event.target.value === "__custom") { setCustomStatus(true); update(statusKey, ""); }
      else { setCustomStatus(false); update(statusKey, event.target.value); }
    }}><option value="">Choose status</option><option value={preset}>{preset}</option><option value="__custom">Custom value</option></select></label>
    {customStatus && <label>Custom insurance status<input disabled={readOnly} value={record[statusKey] || ""} onChange={(event) => update(statusKey, event.target.value)} /></label>}
  </div>;
  const input = (key, label, type = "text", props = {}) => <label>{label}<input disabled={readOnly} type={type} value={record[key] ?? ""} onChange={(event) => update(key, event.target.value)} {...props} /></label>;
  const textarea = (key, label) => <label className="modal-full-width">{label}<textarea disabled={readOnly} value={record[key] ?? ""} onChange={(event) => update(key, event.target.value)} /></label>;
  const name = record.arabic_full_name || record.english_full_name || "Employee";
  const latestAudit = audit[0];

  return <Modal title="Manage Social Insurance" size="medium" description={`${name} · #${record.employee_number}${record.department_name ? ` · ${record.department_name}` : ""}`} onClose={onClose} className="social-insurance-modal">
    <form onSubmit={onSave}>
      {isForm1 ? <section className="social-form-section">
        <h3>Form 1</h3>
        {input("form_1_installation_date", "Installation date · تاريخ التثبيت", "date")}
        {input("form_1_social_insurance_number", "Social Insurance Number")}
        {input("form_1_incoming_number", "Incoming number")}
        {input("form_1_incoming_date", "Incoming date", "date")}
        {statusControl}
        {textarea("form_1_notes", "Notes")}
        <div className={`social-missing-summary ${missing.length ? "needs-attention" : "complete"} modal-full-width`} role="status"><strong>{missing.length ? `Needs attention · ${missing.length} missing field${missing.length === 1 ? "" : "s"}` : "Complete"}</strong>{missing.length > 0 && <ul>{missing.map((field) => <li key={field}>{field}</li>)}</ul>}</div>
      </section> : <section className="social-form-section">
        <h3>Form 6</h3>
        {input("form_6_termination_date", "Termination date · تاريخ الفصل", "date")}
        <label>Leaving reason · سبب الفصل<select disabled={readOnly || !canEditReason} value={reasonIsOther || otherReasonSelected ? "__other" : String(record.leaving_reason_id || leavingReasons.find((reason) => reason.name === record.form_6_termination_reason)?.id || "")} onChange={(event) => {
          if (event.target.value === "__other") { setOtherReasonSelected(true); update("leaving_reason_id", editor.originalLeavingReasonId || ""); update("form_6_termination_reason", ""); }
          else { const selected = leavingReasons.find((reason) => String(reason.id) === event.target.value); setOtherReasonSelected(false); update("leaving_reason_id", selected?.id || ""); update("form_6_termination_reason", selected?.name || ""); }
        }}><option value="">Choose a leaving reason</option>{leavingReasons.map((reason) => <option key={reason.id} value={String(reason.id)}>{reason.name}</option>)}<option value="__other">Other</option></select></label>
        {(reasonIsOther || otherReasonSelected || (!record.form_6_termination_reason && !leavingReasons.length)) && <label>Other leaving reason<input disabled={readOnly || !canEditReason} value={record.form_6_termination_reason || ""} maxLength={1000} onChange={(event) => update("form_6_termination_reason", event.target.value)} /></label>}
        {optionsError && <div className="employee-notice danger" role="alert">Leaving reasons could not be loaded. <button type="button" className="text-button" onClick={retryOptions}>Retry</button></div>}
        <label>Social Insurance Number snapshot<input disabled={readOnly} readOnly={!snapshotEditable} value={record.form_6_social_insurance_number || ""} placeholder={!record.form_1_social_insurance_number ? "Not available from Form 1" : "Copied from Form 1"} onChange={(event) => update("form_6_social_insurance_number", event.target.value)} /></label>
        {record.form_6_social_insurance_number && !snapshotEditable && <small className="social-snapshot-note">{editor.snapshotWasCopied ? "Copied from Form 1 as a snapshot." : "Saved historical snapshot."} {!readOnly && <button type="button" className="text-button" onClick={() => setSnapshotEditable(true)}>Correct snapshot</button>}</small>}
        {!record.form_1_social_insurance_number && !record.form_6_social_insurance_number && <small className="social-snapshot-note">Not available from Form 1. Enter a number if one is available.</small>}
        {input("form_6_incoming_number", "Incoming number")}
        {input("form_6_incoming_date", "Incoming date", "date")}
        {statusControl}
        {textarea("form_6_notes", "Notes")}
        <div className={`social-missing-summary ${missing.length ? "needs-attention" : "complete"} modal-full-width`} role="status"><strong>{missing.length ? `Needs attention · ${missing.length} missing field${missing.length === 1 ? "" : "s"}` : "Complete"}</strong>{missing.length > 0 && <ul>{missing.map((field) => <li key={field}>{field}</li>)}</ul>}</div>
      </section>}
      <section className="social-form-section social-record-history modal-full-width" aria-labelledby="social-record-history-title">
        <h3 id="social-record-history-title">Record history</h3>
        {!audit.length ? <p className="muted">No changes recorded.</p> : <>
          <div className="social-history-latest"><strong>{auditSummary(latestAudit?.changes)}</strong><small>{date(latestAudit?.changed_at)}{latestAudit?.actor?.full_name ? ` · Updated by ${latestAudit.actor.full_name}` : ""}</small></div>
          <button type="button" className="text-button social-history-toggle" aria-expanded={historyExpanded} onClick={() => setHistoryExpanded((expanded) => !expanded)}>{historyExpanded ? "Hide full history" : "View full history"}</button>
          {historyExpanded && <div className="social-audit-history" role="region" aria-label="Full Social Insurance record history">{audit.map((item) => <article className="social-audit-row" key={item.id}><strong>{auditSummary(item.changes)}</strong><small>{date(item.changed_at)}{item.actor?.full_name ? ` · Updated by ${item.actor.full_name}` : ""}</small></article>)}</div>}
        </>}
      </section>
      {error && <div className="employee-notice danger modal-full-width" role="alert">{error}</div>}
      <footer className="modal-actions"><button type="button" className="secondary" onClick={onClose}>{readOnly ? "Close" : "Cancel"}</button>{!readOnly && <button className="primary">Save changes</button>}</footer>
    </form>
  </Modal>;
}
