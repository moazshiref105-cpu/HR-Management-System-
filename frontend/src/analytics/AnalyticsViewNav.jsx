export function AnalyticsViewNav({ value, onChange }) {
  const views = [["overview", "Executive overview"], ["risks", "Operational risks"], ["explorer", "Workforce explorer"]];
  return <nav className="analytics-view-nav" aria-label="Workforce Analytics views">
    {views.map(([key, label]) => <button key={key} type="button" className={value === key ? "selected" : ""} aria-current={value === key ? "page" : undefined} onClick={() => onChange(key)}>{label}</button>)}
  </nav>;
}
