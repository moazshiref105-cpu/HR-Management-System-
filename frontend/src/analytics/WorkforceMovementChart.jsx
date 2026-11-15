import { useMemo, useState } from "react";

export function WorkforceMovementChart({ items = [], onSelect }) {
  const [activeIndex, setActiveIndex] = useState(null);
  const width = 760, height = 292, pad = { top: 22, right: 24, bottom: 48, left: 42 };
  const max = Math.max(...items.flatMap((row) => [Number(row.new_hires) || 0, Number(row.resignations) || 0]), 1);
  const x = (index) => pad.left + (index * (width - pad.left - pad.right)) / Math.max(items.length - 1, 1);
  const y = (value) => height - pad.bottom - ((Number(value) || 0) / max) * (height - pad.top - pad.bottom);
  const baseline = height - pad.bottom;
  const line = (key) => items.map((row, index) => `${index ? "L" : "M"}${x(index)},${y(row[key])}`).join(" ");
  const area = (key) => `${line(key)} L${x(items.length - 1)},${baseline} L${x(0)},${baseline} Z`;
  const active = activeIndex == null ? null : items[activeIndex];
  const ticks = useMemo(() => [0, .25, .5, .75, 1].map((step) => Math.round(max * step)), [max]);
  if (!items.length) return <p className="analytics-empty-copy">No hiring or resignation activity for this selection.</p>;
  const select = (index) => { setActiveIndex(index); onSelect?.(items[index]); };
  return <div className="movement-visual" onMouseLeave={() => setActiveIndex(null)}>
    <div className="movement-legend"><span><i className="legend-hiring" />New hires</span><span><i className="legend-resignation" />Resignations</span><small>Hover a period to inspect its movement</small></div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Interactive hiring and resignation trend. Each period can be opened with the keyboard.">
      <title>Workforce movement</title><defs><linearGradient id="hiring-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#179b78" stopOpacity=".20" /><stop offset="1" stopColor="#179b78" stopOpacity="0" /></linearGradient><linearGradient id="resignation-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#d77845" stopOpacity=".15" /><stop offset="1" stopColor="#d77845" stopOpacity="0" /></linearGradient></defs>
      {ticks.map((tick) => <g key={tick}><line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} className="movement-grid" /><text x={pad.left - 9} y={y(tick) + 3} textAnchor="end" className="movement-y-label">{tick}</text></g>)}
      <path d={area("new_hires")} className="movement-area hiring-area" /><path d={area("resignations")} className="movement-area resignation-area" /><path d={line("new_hires")} className="movement-line hiring-line" /><path d={line("resignations")} className="movement-line resignation-line" />
      {active && <line x1={x(activeIndex)} x2={x(activeIndex)} y1={pad.top} y2={baseline} className="movement-focus-line" />}
      {items.map((row, index) => { const left = index === 0 ? pad.left : (x(index - 1) + x(index)) / 2, right = index === items.length - 1 ? width - pad.right : (x(index) + x(index + 1)) / 2, isActive = index === activeIndex; return <g key={row.period} role="button" tabIndex={0} aria-label={`${row.period}: ${row.new_hires} new hires, ${row.resignations} resignations`} onMouseEnter={() => setActiveIndex(index)} onFocus={() => setActiveIndex(index)} onClick={() => select(index)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(index); } }} className={`movement-point-group${isActive ? " active" : ""}`}><rect x={left} y={pad.top} width={right - left} height={baseline - pad.top} className="movement-hit-area" /><circle cx={x(index)} cy={y(row.new_hires)} r={isActive ? "5.5" : "4"} className="movement-point hiring-point" /><circle cx={x(index)} cy={y(row.resignations)} r={isActive ? "5.5" : "4"} className="movement-point resignation-point" /><text x={x(index)} y={height - 17} textAnchor="middle">{row.period}</text></g>; })}
    </svg>
    {active && <div className="movement-tooltip movement-tooltip-live" style={{ "--tooltip-x": `${(x(activeIndex) / width) * 100}%` }}><strong>{active.period}</strong><span><i className="tooltip-hiring" />New hires <b>{active.new_hires}</b></span><span><i className="tooltip-resignation" />Resignations <b>{active.resignations}</b></span><span className="tooltip-net">Net movement <b>{(Number(active.new_hires) || 0) - (Number(active.resignations) || 0) >= 0 ? "+" : ""}{(Number(active.new_hires) || 0) - (Number(active.resignations) || 0)}</b></span></div>}
  </div>;
}
