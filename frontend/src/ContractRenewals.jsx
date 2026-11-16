import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Plus } from "lucide-react";
import { contractRenewalsApi, invalidateDashboardData } from "./api";
import { Modal } from "./Modal";

const statuses = [
  ["all", "All"],
  ["waiting_documents", "Waiting for documents"],
  ["waiting_contract", "Waiting for signed contract"],
  ["waiting_application", "Waiting for renewal application"],
  ["needs_review", "Needs review"],
  ["overdue", "Overdue follow-up"],
  ["complete", "Complete"],
];
const formatDate = (value) => value ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(`${value}T00:00:00`)) : "—";
const formatTimestamp = (value) => value ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "";
const monthValue = () => new Date().toISOString().slice(0, 7);

export function ContractRenewals({ token, toast, go, capabilities = [] }) {
  const params = useMemo(() => new URLSearchParams(location.hash.split("?")[1] || ""), []);
  const [lists, setLists] = useState([]);
  const [listId, setListId] = useState(() => params.get("list") || "");
  const [items, setItems] = useState([]);
  const [list, setList] = useState(null);
  const [pagination, setPagination] = useState(null);
  const [status, setStatus] = useState(() => params.get("status") || "all");
  const [search, setSearch] = useState(() => params.get("search") || "");
  const [page, setPage] = useState(() => Number(params.get("page") || 1));
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [reviewItem, setReviewItem] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const canManage = capabilities.includes("employees.work.edit");

  const loadLists = useCallback(async () => {
    try {
      const result = await contractRenewalsApi.lists(token);
      setLists(result);
      if (!listId && result[0]?.id) setListId(result[0].id);
    } catch (requestError) { setError(requestError.message); }
  }, [token, listId]);
  const loadItems = useCallback(async () => {
    if (!listId) return;
    setLoading(true); setError("");
    try {
      const result = await contractRenewalsApi.items(listId, { status, search, page, page_size: 25 }, token);
      setList(result.list); setItems(result.rows || []); setPagination(result); setSelected([]);
    } catch (requestError) { setError(requestError.message || "Couldn’t load renewal items."); }
    finally { setLoading(false); }
  }, [listId, status, search, page, token]);
  useEffect(() => { loadLists(); }, [loadLists]);
  useEffect(() => { loadItems(); }, [loadItems]);
  useEffect(() => {
    const next = new URLSearchParams();
    if (listId) next.set("list", listId); if (status !== "all") next.set("status", status); if (search) next.set("search", search); if (page > 1) next.set("page", String(page));
    const hash = `#contracts/renewals${next.size ? `?${next}` : ""}`;
    if (location.hash !== hash) history.replaceState(null, "", hash);
  }, [listId, status, search, page]);
  const updateStatus = (value) => { setStatus(value); setPage(1); };
  const toggle = (id) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const bulk = (receipt) => {
    if (selected.length) setConfirmation({ type: "bulk", receipt, itemIds: [...selected] });
  };
  const retryFinalization = (item) => setConfirmation({ type: "retry", itemIds: [item.id], item });
  const confirmAction = async () => {
    if (!confirmation) return;
    const action = confirmation;
    setConfirmation(null);
    setLoading(true);
    setError("");
    try {
      const receipt = action.type === "retry" ? "retry_finalization" : action.receipt;
      const result = await contractRenewalsApi.receipts(listId, { item_ids: action.itemIds, receipt }, token);
      invalidateDashboardData();
      toast(action.type === "retry" ? "Finalization retry finished. Review the item status." : `${result.items?.length || action.itemIds.length} renewal item${action.itemIds.length === 1 ? "" : "s"} updated.`, "success");
      await loadItems();
      if (action.type === "retry") setReviewItem(null);
    } catch (requestError) { setError(requestError.message || (action.type === "retry" ? "Couldn’t retry renewal finalization." : "Couldn’t update renewal receipts.")); }
    finally { setLoading(false); }
  };
  return <section className="section-view contract-renewals-view">
    <header className="section-head">
      <div><button className="text-button contract-back" onClick={() => go("employees?queue=contracts_expiring")}><ArrowLeft size={15}/> Employees / Work Queues</button><h1>Manage contracts</h1></div>
      {canManage && <button className="primary" onClick={() => setCreateOpen(true)}><Plus size={16}/> Create renewal list</button>}
    </header>
    {error && <div className="employee-notice danger">{error}<button className="secondary" onClick={loadItems}>Try again</button></div>}
    {!listId && !loading && <div className="empty"><h3>No renewal lists yet</h3>{canManage && <button className="primary" onClick={() => setCreateOpen(true)}>Create renewal list</button>}</div>}
    {listId && <>
      <div className="contract-list-bar"><label>Renewal list<select value={listId} onChange={(event) => { setListId(event.target.value); setPage(1); }}>{lists.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label><span>{list ? `${pagination?.total ?? 0} employees · due ${formatDate(list.due_period)}` : "Loading list…"}</span></div>
      <nav className="contract-status-tabs" aria-label="Renewal status">{statuses.map(([key, label]) => <button key={key} className={status === key ? "selected" : ""} onClick={() => updateStatus(key)}>{label}</button>)}</nav>
      <div className="contract-toolbar"><label className="search">⌕ <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search employees" /></label>{canManage && <div className="contract-bulk-actions"><button className="secondary" disabled={!selected.length || loading} onClick={() => bulk("signed_contract")}>Mark signed contracts received</button><button className="secondary" disabled={!selected.length || loading} onClick={() => bulk("renewal_application")}>Mark renewal applications received</button></div>}</div>
      <div className="employee-table-wrap">
        <table className="employee-table contract-renewal-table">
          <thead><tr><th>{canManage && <input aria-label="Select all visible" type="checkbox" checked={items.length > 0 && selected.length === items.length} onChange={(event) => setSelected(event.target.checked ? items.map((item) => item.id) : [])}/>}</th><th>Employee</th><th>Department</th><th>Due date</th><th>Contract</th><th>Renewal application</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>{items.map((item) => <tr key={item.id}>
            <td>{canManage && <input aria-label={`Select ${item.employee_name_en}`} type="checkbox" checked={selected.includes(item.id)} onChange={() => toggle(item.id)}/>}</td>
            <td className="employee-identity"><strong dir="auto">{item.employee_name_ar || item.employee_name_en}</strong><small>#{item.employee_number} · {item.employee_name_en}</small></td>
            <td>{item.department_name || "—"}<small className="code">{item.position_name || ""}</small></td>
            <td>{formatDate(item.original_due_date)}</td>
            <td>{item.signed_contract_received_at ? <span className="receipt received" title={`Received ${formatTimestamp(item.signed_contract_received_at)}`}><Check size={13}/> Received</span> : <span className="receipt">Missing</span>}</td>
            <td>{item.renewal_application_received_at ? <span className="receipt received" title={`Received ${formatTimestamp(item.renewal_application_received_at)}`}><Check size={13}/> Received</span> : <span className="receipt">Missing</span>}</td>
            <td><RenewalStatus item={item}/></td>
            <td><div className="renewal-row-actions"><button className="text-button" onClick={() => go(`employees/${item.employee_id}?section=contracts&return_to=${encodeURIComponent(location.hash.slice(1))}`)}>View</button>{canManage && item.status === "needs_review" && <button className="text-button" onClick={() => setReviewItem(item)}>Review</button>}</div></td>
          </tr>)}</tbody>
        </table>
        {!loading && !items.length && <div className="empty compact-empty"><h3>{status === "overdue" ? "No overdue follow-up" : "No renewal items found"}</h3></div>}
      </div>
      {pagination?.total_pages > 1 && <footer className="employee-pagination"><span>Page {pagination.page} of {pagination.total_pages}</span><div className="page-controls"><button className="secondary" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>Previous</button><button className="secondary" disabled={page >= pagination.total_pages || loading} onClick={() => setPage(page + 1)}>Next</button></div></footer>}
    </>}
    {createOpen && <CreateRenewalList token={token} toast={toast} onClose={() => setCreateOpen(false)} onCreated={async (id) => { setCreateOpen(false); setListId(id); await loadLists(); }} />}
    {reviewItem && <RenewalReviewDrawer item={reviewItem} busy={loading} onClose={() => setReviewItem(null)} onRetry={() => retryFinalization(reviewItem)} />}
    {confirmation && <Modal title={confirmation.type === "retry" ? "Retry renewal finalization?" : "Confirm receipt update"} size="small" onClose={() => setConfirmation(null)} canDismiss={!loading}>
      <p>{confirmation.type === "retry" ? `Retry finalization for ${confirmation.item.employee_name_en || confirmation.item.employee_number}?` : `Mark ${confirmation.itemIds.length} selected employee${confirmation.itemIds.length === 1 ? "" : "s"} as received?`}</p>
      <footer className="modal-actions"><button className="secondary" onClick={() => setConfirmation(null)} disabled={loading}>Cancel</button><button className="primary" onClick={confirmAction} disabled={loading}>{loading ? "Updating…" : confirmation.type === "retry" ? "Retry finalization" : "Mark received"}</button></footer>
    </Modal>}
  </section>;
}

function RenewalStatus({ item }) {
  const labels = { waiting_documents: "Both documents missing", waiting_contract: "Signed contract missing", waiting_application: "Renewal application missing", ready_to_finalize: "Ready to finalize", needs_review: "Needs review", complete: "Complete" };
  return <span className="renewal-status"><span className={`employee-badge renewal-${item.status}`}>{labels[item.status] || item.status}</span>{item.is_overdue && <span className="employee-badge renewal-overdue">Overdue</span>}</span>;
}

function RenewalReviewDrawer({ item, busy, onClose, onRetry }) {
  return <Modal title="Review renewal" size="small" onClose={onClose} className="renewal-review-modal">
    <div className="renewal-review-content"><strong dir="auto">{item.employee_name_ar || item.employee_name_en}</strong><p>{item.finalization_error_message || "Needs review — renewal could not be matched automatically."}</p></div>
    <footer className="modal-actions"><button className="secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="primary" onClick={onRetry} disabled={busy}>{busy ? "Retrying…" : "Retry finalization"}</button></footer>
  </Modal>;
}

function CreateRenewalList({ token, toast, onClose, onCreated }) {
  const [period, setPeriod] = useState(monthValue); const [name, setName] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const dirty = Boolean(name.trim() || period !== monthValue());
  const submit = async (event) => { event.preventDefault(); setBusy(true); setError(""); try { const result = await contractRenewalsApi.create({ due_period: `${period}-01`, name }, token); toast("Renewal list ready.", "success"); onCreated(result.id); } catch (requestError) { setError(requestError.message); } finally { setBusy(false); } };
  return <Modal title="Create renewal list" size="small" onClose={onClose} closeOnBackdrop={!dirty} canDismiss={!busy && !dirty}><form className="modal-grid" onSubmit={submit}><label>Renewal due month<input required type="month" value={period} onChange={(event) => setPeriod(event.target.value)} /></label><label>List name <small>(optional)</small><input value={name} onChange={(event) => setName(event.target.value)} placeholder="October 2026 Renewals" /></label>{error && <div className="employee-notice danger modal-full-width">{error}</div>}<footer className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>{busy ? "Creating…" : "Create list"}</button></footer></form></Modal>;
}
