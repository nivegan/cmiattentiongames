"use client";
// admin/DauChart.tsx
// Hand-rolled inline-SVG bar chart of DAU per IST day (no chart library —
// deliberate, see AdminDashboard). Single series, so no legend: the section
// heading names it. Retro-system marks: hard-edged bars in the brand maroon,
// faint horizontal gridlines at integer ticks, 10px mono labels. Hovering a
// day highlights its bar and prints the value in the terminal-green readout
// above the plot (the hit target is the full column, not just the bar).

import { useState } from "react";
import type { DauPoint } from "./types";

// Internal SVG coordinate system; the element scales responsively via viewBox.
const VIEW_W = 640;
const VIEW_H = 220;
const PAD_LEFT = 36; // y-axis label gutter
const PAD_RIGHT = 8;
const PAD_TOP = 12;
const PAD_BOTTOM = 24; // x-axis label gutter
const PLOT_W = VIEW_W - PAD_LEFT - PAD_RIGHT;
const PLOT_H = VIEW_H - PAD_TOP - PAD_BOTTOM;
const BAR_GAP = 2; // surface gap between adjacent bars

const fmtTick = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
});
const fmtReadout = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

// Date keys are IST calendar dates; anchor at IST noon so the formatted day
// never shifts across timezones.
const keyToDate = (dateKey: string): Date =>
  new Date(`${dateKey}T12:00:00+05:30`);

type DauChartProps = { series: DauPoint[] };

const DauChart = ({ series }: DauChartProps) => {
  const [hovered, setHovered] = useState<number | null>(null);

  if (series.length === 0) return null; // parent renders the empty state

  const maxDau = Math.max(1, ...series.map((p) => p.dau)); // clamp: never 0-domain
  const yTickStep = Math.max(1, Math.ceil(maxDau / 4));
  const yTicks: number[] = [];
  for (let v = 0; v <= maxDau; v += yTickStep) yTicks.push(v);

  const slotW = PLOT_W / series.length;
  // Cap bar width so short series don't render comically wide bars; the bar
  // stays centered in its slot.
  const barW = Math.min(48, Math.max(1, slotW - BAR_GAP));
  const barOffset = (slotW - barW) / 2;
  const yFor = (v: number) => PAD_TOP + PLOT_H - (v / maxDau) * PLOT_H;

  // Label the last day and every ⌈n/6⌉th day, suppressing a periodic label
  // that would land within one interval of the last (avoids "21 Jul22 Jul").
  const xLabelEvery = Math.ceil(series.length / 6);
  const showXLabel = (i: number) =>
    i === series.length - 1 ||
    (i % xLabelEvery === 0 && series.length - 1 - i >= xLabelEvery);

  const hoveredPoint = hovered !== null ? series[hovered] : null;

  return (
    <div className="space-y-2">
      {/* Terminal-style readout: hovered day, or the latest day by default */}
      <div className="bg-[#232323] text-[#00FF33] px-3 py-1.5 text-[11px] tracking-widest uppercase w-fit">
        {hoveredPoint
          ? `${fmtReadout.format(keyToDate(hoveredPoint.date))} · ${hoveredPoint.dau} USER${hoveredPoint.dau === 1 ? "" : "S"}`
          : `HOVER A DAY · LATEST ${series[series.length - 1].dau} USER${series[series.length - 1].dau === 1 ? "" : "S"}`}
      </div>

      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="w-full h-auto"
        role="img"
        aria-label="Daily active users per day"
        onMouseLeave={() => setHovered(null)}
      >
        {/* Gridlines + y-axis labels at integer ticks */}
        {yTicks.map((v) => (
          <g key={v}>
            <line
              x1={PAD_LEFT}
              y1={yFor(v)}
              x2={VIEW_W - PAD_RIGHT}
              y2={yFor(v)}
              stroke="#232323"
              strokeOpacity={v === 0 ? 0.4 : 0.1}
              strokeWidth={1}
            />
            <text
              x={PAD_LEFT - 6}
              y={yFor(v) + 3}
              textAnchor="end"
              fontSize={10}
              fill="#232323"
              fillOpacity={0.6}
              fontFamily="var(--font-geist-mono), monospace"
            >
              {v}
            </text>
          </g>
        ))}

        {/* Bars + full-column hover hit targets */}
        {series.map((p, i) => {
          const x = PAD_LEFT + i * slotW + barOffset;
          const y = yFor(p.dau);
          return (
            <g key={p.date}>
              {p.dau > 0 && (
                <rect
                  x={x}
                  y={y}
                  width={barW}
                  height={PAD_TOP + PLOT_H - y}
                  fill={hovered === i ? "#232323" : "#8B2626"}
                />
              )}
              <rect
                x={PAD_LEFT + i * slotW}
                y={PAD_TOP}
                width={slotW}
                height={PLOT_H}
                fill="transparent"
                onMouseEnter={() => setHovered(i)}
              />
              {showXLabel(i) && (
                <text
                  x={x + barW / 2}
                  y={VIEW_H - 8}
                  textAnchor="middle"
                  fontSize={10}
                  fill="#232323"
                  fillOpacity={0.6}
                  fontFamily="var(--font-geist-mono), monospace"
                >
                  {fmtTick.format(keyToDate(p.date))}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
};

export { DauChart };
