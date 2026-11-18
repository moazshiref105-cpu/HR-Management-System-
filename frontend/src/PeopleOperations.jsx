import { workQueueHash } from "./workQueues";

export function Lifecycle({ go }) {
  const stages = [["Onboarding", "new_hires", "New hires need employment data, hiring documents, and onboarding follow-up."], ["Probation", "probation_due", "Confirm the employee’s probation decision before the due date."], ["Contract renewal", "contracts_expiring", "Renew active contracts before the current term expires."], ["Offboarding", "missing_form_6", "Complete exit data and Form 6 for former employees."]];
  return <section className="section-view lifecycle-view"><header className="section-head"><div><h1>Employee Lifecycle</h1></div><button className="secondary" onClick={() => go("people")}>People Operations</button></header><div className="lifecycle-stages">{stages.map(([title, queue, text], index) => <article key={queue}><span>{index + 1}</span><div><h2>{title}</h2><p>{text}</p><button className="text-button" onClick={() => go(workQueueHash(queue))}>Open work queue →</button></div></article>)}</div></section>;
}
