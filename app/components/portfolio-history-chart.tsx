"use client";

import { useMemo, useState } from "react";
import { CalendarDays, LineChart } from "lucide-react";

import type { PortfolioSnapshot } from "@/lib/portfolio-history";

type Range = 30 | 90 | "all";

const WIDTH = 800;
const HEIGHT = 280;
const PADDING = { top: 24, right: 24, bottom: 38, left: 68 };

function money(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

function shortDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export function PortfolioHistoryChart({ snapshots }: { snapshots: PortfolioSnapshot[] }) {
  const [range, setRange] = useState<Range>(30);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const visible = useMemo(() => {
    if (range === "all" || snapshots.length === 0) return snapshots;
    const latestMs = Date.parse(snapshots.at(-1)!.recordedAt);
    const cutoff = latestMs - range * 24 * 60 * 60 * 1000;
    return snapshots.filter((snapshot) => Date.parse(snapshot.recordedAt) >= cutoff);
  }, [range, snapshots]);

  const chart = useMemo(() => {
    if (visible.length === 0) return null;
    const values = visible.map((snapshot) => snapshot.totalBalance);
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const span = Math.max(rawMax - rawMin, Math.max(rawMax * 0.02, 1));
    const min = Math.max(0, rawMin - span * 0.15);
    const max = rawMax + span * 0.15;
    const plotWidth = WIDTH - PADDING.left - PADDING.right;
    const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
    const points = visible.map((snapshot, index) => ({
      x:
        visible.length === 1
          ? PADDING.left + plotWidth / 2
          : PADDING.left + (index / (visible.length - 1)) * plotWidth,
      y: PADDING.top + ((max - snapshot.totalBalance) / (max - min)) * plotHeight,
    }));
    return { min, max, points };
  }, [visible]);

  const selected = selectedIndex === null ? visible.at(-1) : visible[selectedIndex];

  return (
    <section className="mt-8 border-y border-slate-800 py-7" aria-labelledby="portfolio-history-title">
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="portfolio-history-title" className="flex items-center gap-2 text-lg font-bold text-slate-100">
            <LineChart className="h-5 w-5 text-cyan-400" />
            总资产历史曲线
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            每日快照由定时任务写入 Git 仓库，包含全部持仓市值与链上可用余额。
          </p>
        </div>
        <div className="inline-flex h-9 self-start rounded-lg border border-slate-700 bg-slate-950 p-1" aria-label="曲线时间范围">
          {([30, 90, "all"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setRange(value);
                setSelectedIndex(null);
              }}
              className={`min-w-14 rounded px-3 text-xs font-semibold transition-colors ${
                range === value
                  ? "bg-slate-700 text-white"
                  : "text-slate-500 hover:text-slate-200"
              }`}
            >
              {value === "all" ? "全部" : `${value} 天`}
            </button>
          ))}
        </div>
      </div>

      {chart ? (
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">
          <div className="mb-3 flex h-10 items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <CalendarDays className="h-4 w-4" />
              {selected ? new Date(selected.recordedAt).toLocaleString("zh-CN") : ""}
            </div>
            <div className="text-right">
              <div className="font-mono text-lg font-bold text-slate-100">
                {selected ? money(selected.totalBalance) : "--"}
              </div>
              {selected && (
                <div className="text-[11px] text-slate-500">
                  持仓 {money(selected.positionsValue)} · 可用 {money(selected.availableBalance)}
                </div>
              )}
            </div>
          </div>
          <div className="aspect-[800/280] min-h-[220px] w-full">
            <svg
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              className="h-full w-full overflow-visible"
              role="img"
              aria-label={`总资产从 ${money(visible[0].totalBalance)} 变化至 ${money(visible.at(-1)!.totalBalance)}`}
              onMouseLeave={() => setSelectedIndex(null)}
            >
              {[0, 0.5, 1].map((ratio) => {
                const y = PADDING.top + ratio * (HEIGHT - PADDING.top - PADDING.bottom);
                const value = chart.max - ratio * (chart.max - chart.min);
                return (
                  <g key={ratio}>
                    <line x1={PADDING.left} x2={WIDTH - PADDING.right} y1={y} y2={y} stroke="#1e293b" strokeWidth="1" />
                    <text x={PADDING.left - 10} y={y + 4} fill="#64748b" fontSize="11" textAnchor="end">
                      {money(value)}
                    </text>
                  </g>
                );
              })}
              {chart.points.length > 1 && (
                <path
                  d={`${chart.points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`).join(" ")} L${chart.points.at(-1)!.x},${HEIGHT - PADDING.bottom} L${chart.points[0].x},${HEIGHT - PADDING.bottom} Z`}
                  fill="#06b6d4"
                  fillOpacity="0.08"
                />
              )}
              <polyline
                points={chart.points.map((point) => `${point.x},${point.y}`).join(" ")}
                fill="none"
                stroke="#22d3ee"
                strokeWidth="3"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {chart.points.map((point, index) => (
                <g key={visible[index].recordedAt} onMouseEnter={() => setSelectedIndex(index)}>
                  <circle cx={point.x} cy={point.y} r="14" fill="transparent" />
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={selectedIndex === index ? 5 : 3}
                    fill="#0f172a"
                    stroke="#67e8f9"
                    strokeWidth="2"
                  />
                </g>
              ))}
              <text x={PADDING.left} y={HEIGHT - 10} fill="#64748b" fontSize="11">
                {shortDate(visible[0].recordedAt)}
              </text>
              <text x={WIDTH - PADDING.right} y={HEIGHT - 10} fill="#64748b" fontSize="11" textAnchor="end">
                {shortDate(visible.at(-1)!.recordedAt)}
              </text>
            </svg>
          </div>
        </div>
      ) : (
        <div className="flex min-h-56 items-center justify-center rounded-lg border border-dashed border-slate-700 bg-slate-950/30 px-6 text-center text-sm text-slate-500">
          暂无历史快照。定时任务首次成功执行后，资产曲线会从当天开始记录。
        </div>
      )}
    </section>
  );
}
