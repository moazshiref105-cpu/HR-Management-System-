import { useMemo, useState } from "react";

const number = (value) => Math.max(0, Number(value) || 0);

export function WorkforceMovementChart({ items = [], onSelect }) {
  const [activeIndex, setActiveIndex] = useState(null);
  const chart = useMemo(() => {
    const width = Math.max(720, items.length * 74 + 84);
    const height = 250;
    const pad = { top: 22, right: 22, bottom: 46, left: 42 };
    const maximum = Math.max(...items.flatMap((row) => [number(row.new_hires), number(row.resignations)]), 1);
    const scaleMax = Math.max(1, Math.ceil(maximum / 4) * 4);
    const plotHeight = height - pad.top - pad.bottom;
    const step = (width - pad.left - pad.right) / Math.max(items.length, 1);
    const barWidth = Math.min(18, Math.max(7, step * 0.22));
    return { width, height, pad, maximum: scaleMax, plotHeight, step, barWidth };
  }, [items]);
  const { width, height, pad, maximum, plotHeight, step, barWidth } = chart;
  const baseline = height - pad.bottom;
  const y = (value) => baseline - (number(value) / maximum) * plotHeight;
  const selected = activeIndex == null ? null : items[activeIndex];
  const ticks = useMemo(() => Array.from({ length: 5 }, (_, index) => Math.round((maximum * index) / 4)), [maximum]);
  if (!items.length) return <div className="movement-chart-empty"><strong>No movement in this period</strong><span>There are no hires or resignations to show for the selected dates.</span></div>;

  const select = (index) => { setActiveIndex(index); onSelect?.(items[index]); };
  return <div className="movement-chart" onMouseLeave={(event) => { if (!event.currentTarget.contains(document.activeElement)) setActiveIndex(null); }}>
    <div className="movement-chart-legend" aria-label="Chart series">
      <span><i className="movement-legend-hire" aria-hidden="true"/>Hires</span>
      <span><i className="movement-legend-resign" aria-hidden="true"/>Resignations</span>
      <small>Select a period to review its employee records</small>
    </div>
    <div className="movement-chart-scroll" role="region" aria-label="Monthly hires and resignations. Scroll horizontally to view all periods." tabIndex={0}>
      <svg className="movement-bars" style={{ width: `${width}px` }} viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Grouped bar chart of hires and resignations by period">
        <defs><pattern id="movement-resign-pattern" width="5" height="5" patternTransform="rotate(45)" patternUnits="userSpaceOnUse"><rect width="5" height="5" fill="#fff4e8"/><rect width="2" height="5" fill="#c47a3e"/></pattern></defs>
        {ticks.map((tick, index) => <g key={`${tick}-${index}`} aria-hidden="true"><line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} className="movement-chart-grid"/><text x={pad.left - 9} y={y(tick) + 4} textAnchor="end" className="movement-chart-y-label">{tick}</text></g>)}
        {items.map((row, index) => {
          const center = pad.left + step * (index + 0.5);
          const hire = number(row.new_hires);
          const resign = number(row.resignations);
          const isActive = index === activeIndex;
          const label = `${row.period}: ${hire} ${hire === 1 ? "hire" : "hires"}, ${resign} ${resign === 1 ? "resignation" : "resignations"}. Activate to review this period.`;
          return <g key={`${row.period}-${row.bucket_start || index}`} className={`movement-bar-group${isActive ? " active" : ""}`} role="button" tabIndex={0} aria-label={label} onMouseEnter={() => setActiveIndex(index)} onFocus={() => setActiveIndex(index)} onBlur={() => setActiveIndex(null)} onClick={() => select(index)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(index); } }}>
            <rect x={center - step * 0.43} y={pad.top} width={step * 0.86} height={plotHeight + 8} className="movement-bar-hit"/>
            {hire > 0 ? <rect x={center - barWidth - 2} y={y(hire)} width={barWidth} height={Math.max(2, baseline - y(hire))} rx="3" className="movement-bar-hire"/> : <circle cx={center - barWidth / 2 - 2} cy={baseline - 2} r="2.5" className="movement-zero-hire"/>}
            {resign > 0 ? <rect x={center + 2} y={y(resign)} width={barWidth} height={Math.max(2, baseline - y(resign))} rx="3" className="movement-bar-resign"/> : <circle cx={center + barWidth / 2 + 2} cy={baseline - 2} r="2.5" className="movement-zero-resign"/>}
            {isActive && <g className="movement-chart-tooltip" aria-hidden="true"><rect x={center - 63} y="2" width="126" height="40" rx="7"/><text x={center} y="17" textAnchor="middle" className="movement-tooltip-period">{row.period}</text><text x={center} y="32" textAnchor="middle">{hire} hires · {resign} resignations</text></g>}
            <text x={center} y={height - 16} textAnchor="middle" className="movement-chart-x-label">{row.period}</text>
          </g>;
        })}
      </svg>
    </div>
    {selected && <p className="movement-chart-live" role="status" aria-live="polite"><strong>{selected.period}</strong><span>{number(selected.new_hires)} hires</span><span>{number(selected.resignations)} resignations</span><span>Net {number(selected.new_hires) - number(selected.resignations) > 0 ? "+" : ""}{number(selected.new_hires) - number(selected.resignations)}</span></p>}
  </div>;
}
