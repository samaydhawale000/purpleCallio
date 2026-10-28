'use client';

import { useEffect, useRef, useState } from 'react';

export type ChartSeries = { key: string; label: string; color: string };

type Point = { label: string } & Record<string, number | string>;

const PAD = { top: 12, right: 12, bottom: 26, left: 44 };

/** Round the axis maximum up to a friendly number (1, 2, 2.5, 5 × 10ⁿ). */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return step * exp;
}

const compact = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : `${Math.round(n * 10) / 10}`;

/**
 * Minimal responsive line chart: gridlines, one line per series, a hover
 * guide with a tooltip. No dependencies.
 */
export function LineChart({
  data,
  series,
  height = 220,
  format = (n) => n.toLocaleString('en-IN'),
  ariaLabel,
}: {
  data: Point[];
  series: ChartSeries[];
  height?: number;
  format?: (n: number) => string;
  ariaLabel: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(240, entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const values = data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0));
  const max = niceMax(Math.max(0, ...values));
  const n = data.length;
  const x = (i: number) => PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const ticks = [0, 0.5, 1].map((t) => t * max);
  const labelEvery = Math.max(1, Math.ceil(n / 7));

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (n === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - PAD.left;
    const i = n <= 1 ? 0 : Math.round((px / innerW) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  };

  const hovered = hover != null ? data[hover] : null;

  return (
    <div>
      {series.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-4">
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5 text-xs text-[#6B6478]">
              <span className="h-0.5 w-3 rounded" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <div ref={wrap} className="relative w-full">
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={ariaLabel}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          className="block"
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="#ECE8F2" strokeDasharray={t === 0 ? undefined : '3 4'} />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill="#9C95A8">
                {compact(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) =>
            i % labelEvery === 0 || i === n - 1 ? (
              <text
                key={i}
                x={x(i)}
                y={height - 6}
                textAnchor={n > 1 && i === 0 ? 'start' : n > 1 && i === n - 1 ? 'end' : 'middle'}
                fontSize="11"
                fill="#9C95A8"
              >
                {d.label}
              </text>
            ) : null,
          )}
          {hover != null && (
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="#D9D2E6" />
          )}
          {series.map((s) => (
            <g key={s.key}>
              <polyline
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                points={data.map((d, i) => `${x(i)},${y(Number(d[s.key]) || 0)}`).join(' ')}
              />
              {hover != null && (
                <circle cx={x(hover)} cy={y(Number(data[hover][s.key]) || 0)} r={3.5} fill="#fff" stroke={s.color} strokeWidth={2} />
              )}
            </g>
          ))}
        </svg>
        {hovered && hover != null && (
          <div
            className="pointer-events-none absolute top-0 z-10 rounded-lg border border-[#ECE8F2] bg-white px-3 py-2 text-xs shadow-sm"
            style={{
              left: Math.min(Math.max(0, x(hover) - 70), width - 150),
            }}
          >
            <p className="mb-1 font-medium text-[#170B2E]">{hovered.label}</p>
            {series.map((s) => (
              <p key={s.key} className="flex items-center justify-between gap-4 text-[#6B6478]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                  {s.label}
                </span>
                <span className="font-medium tabular-nums text-[#170B2E]">{format(Number(hovered[s.key]) || 0)}</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
