"use client";

import { useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { CalendarDays, ChevronDown, ChevronUp, LineChart } from "lucide-react";

import type { PortfolioSnapshot } from "@/lib/portfolio-history";

type Range = 30 | 90 | "all";
type Language = "zh" | "en";

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

function shortDate(value: string, language: Language): string {
  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "zh-CN", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export function PortfolioHistoryChart({
  snapshots,
  language,
}: {
  snapshots: PortfolioSnapshot[];
  language: Language;
}) {
  const isEnglish = language === "en";
  const [range, setRange] = useState<Range>(30);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

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

  // Roving tabindex refs so keyboard users can arrow through data points
  // 通过 ref 数组实现 roving tabindex，键盘用户可用方向键遍历数据点
  const pointRefs = useRef<Array<SVGCircleElement | null>>([]);

  function moveSelection(step: number | "first" | "last") {
    if (visible.length === 0) return;
    const current = selectedIndex ?? visible.length - 1;
    const next =
      step === "first"
        ? 0
        : step === "last"
          ? visible.length - 1
          : Math.min(visible.length - 1, Math.max(0, current + step));
    setSelectedIndex(next);
    pointRefs.current[next]?.focus();
  }

  function handlePointKeyDown(event: ReactKeyboardEvent<SVGCircleElement>) {
    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        moveSelection(-1);
        break;
      case "ArrowRight":
        event.preventDefault();
        moveSelection(1);
        break;
      case "Home":
        event.preventDefault();
        moveSelection("first");
        break;
      case "End":
        event.preventDefault();
        moveSelection("last");
        break;
    }
  }

  function formatPointLabel(snapshot: PortfolioSnapshot, isEnglish: boolean): string {
    const date = new Date(snapshot.recordedAt).toLocaleString(isEnglish ? "en-US" : "zh-CN");
    return isEnglish
      ? `${date}, total assets ${money(snapshot.totalBalance)}`
      : `${date}，总资产 ${money(snapshot.totalBalance)}`;
  }

  return (
    <section className="mt-8 border-y border-slate-800 py-7" aria-labelledby="portfolio-history-title">
      <div className={`${isExpanded ? "mb-5" : ""} flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between`}>
        <div>
          <h2 id="portfolio-history-title" className="flex items-center gap-2 text-lg font-bold text-slate-100">
            <LineChart className="h-5 w-5 text-cyan-400" />
            {isEnglish ? "Total portfolio history" : "总资产历史曲线"}
            <button
              type="button"
              onClick={() => setIsExpanded((expanded) => !expanded)}
              aria-expanded={isExpanded}
              aria-controls="portfolio-history-content"
              aria-label={isExpanded ? (isEnglish ? "Collapse history chart" : "收起历史曲线") : isEnglish ? "Expand history chart" : "展开历史曲线"}
              title={isExpanded ? (isEnglish ? "Collapse" : "收起") : isEnglish ? "Expand" : "展开"}
              className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </h2>
          {isExpanded && (
            <p className="mt-1 text-xs text-slate-500">
              {isEnglish
                ? "Daily snapshots are recorded by a scheduled task and include position value and available on-chain balance."
                : "每日快照由定时任务写入 Git 仓库，包含全部持仓市值与链上可用余额。"}
            </p>
          )}
        </div>
        {isExpanded && (
          <div className="inline-flex h-9 self-start rounded-lg border border-slate-700 bg-slate-950 p-1" aria-label={isEnglish ? "Chart time range" : "曲线时间范围"}>
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
                {value === "all" ? (isEnglish ? "All" : "全部") : isEnglish ? `${value} days` : `${value} 天`}
              </button>
            ))}
          </div>
        )}
      </div>

      {isExpanded && (chart ? (
        <div id="portfolio-history-content" className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">
          <div className="mb-3 flex h-10 items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <CalendarDays className="h-4 w-4" />
              {selected ? new Date(selected.recordedAt).toLocaleString(isEnglish ? "en-US" : "zh-CN") : ""}
            </div>
            <div className="text-right" aria-live="polite">
              <div className="font-mono text-lg font-bold text-slate-100">
                {selected ? money(selected.totalBalance) : "--"}
              </div>
              {selected && (
                <div className="text-[11px] text-slate-500">
                  {isEnglish ? "Positions" : "持仓"} {money(selected.positionsValue)} · {isEnglish ? "Available" : "可用"} {money(selected.availableBalance)}
                </div>
              )}
            </div>
          </div>
          <div className="aspect-[800/280] min-h-[220px] w-full">
            <svg
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              className="h-full w-full overflow-visible"
              role="img"
              aria-label={isEnglish
                ? `Total portfolio changed from ${money(visible[0].totalBalance)} to ${money(visible.at(-1)!.totalBalance)}`
                : `总资产从 ${money(visible[0].totalBalance)} 变化至 ${money(visible.at(-1)!.totalBalance)}`}
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
              {(() => {
                // Crosshair tracking the selected data point / 跟随选中数据点的十字准线
                const crossPoint = chart.points[selectedIndex ?? chart.points.length - 1];
                if (!crossPoint) return null;
                return (
                  <line
                    x1={crossPoint.x}
                    x2={crossPoint.x}
                    y1={PADDING.top}
                    y2={HEIGHT - PADDING.bottom}
                    stroke="#475569"
                    strokeWidth="1"
                    strokeDasharray="4 4"
                  />
                );
              })()}
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
              {chart.points.map((point, index) => {
                const snapshot = visible[index];
                const isSelected = index === (selectedIndex ?? visible.length - 1);
                return (
                  <g key={snapshot.recordedAt}>
                    {/* Large transparent hit area for mouse and touch / 鼠标与触屏共用的透明热区 */}
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r="14"
                      fill="transparent"
                      onMouseEnter={() => setSelectedIndex(index)}
                      onPointerDown={() => setSelectedIndex(index)}
                    />
                    {isSelected && (
                      <circle cx={point.x} cy={point.y} r="9" fill="none" stroke="#22d3ee" strokeWidth="1.5" opacity="0.5" />
                    )}
                    {/* Focusable data point: roving tabindex + arrow key navigation
                        可聚焦数据点：roving tabindex 配合方向键、Home/End 导航 */}
                    <circle
                      ref={(el) => { pointRefs.current[index] = el; }}
                      cx={point.x}
                      cy={point.y}
                      r={isSelected ? 5 : 3}
                      fill="#0f172a"
                      stroke="#67e8f9"
                      strokeWidth="2"
                      tabIndex={isSelected ? 0 : -1}
                      role="button"
                      aria-label={formatPointLabel(snapshot, isEnglish)}
                      onFocus={() => setSelectedIndex(index)}
                      onKeyDown={handlePointKeyDown}
                      className="cursor-pointer focus:outline-none focus-visible:stroke-sky-300"
                    >
                      <title>{formatPointLabel(snapshot, isEnglish)}</title>
                    </circle>
                  </g>
                );
              })}
              <text x={PADDING.left} y={HEIGHT - 10} fill="#64748b" fontSize="11">
                {shortDate(visible[0].recordedAt, language)}
              </text>
              <text x={WIDTH - PADDING.right} y={HEIGHT - 10} fill="#64748b" fontSize="11" textAnchor="end">
                {shortDate(visible.at(-1)!.recordedAt, language)}
              </text>
            </svg>
          </div>
        </div>
      ) : (
        <div id="portfolio-history-content" className="flex min-h-56 items-center justify-center rounded-lg border border-dashed border-slate-700 bg-slate-950/30 px-6 text-center text-sm text-slate-500">
          {isEnglish
            ? "No history snapshots yet. The chart will begin recording after the scheduled task succeeds for the first time."
            : "暂无历史快照。定时任务首次成功执行后，资产曲线会从当天开始记录。"}
        </div>
      ))}
    </section>
  );
}
