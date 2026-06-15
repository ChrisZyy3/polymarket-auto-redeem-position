"use client";

import { useEffect, useMemo, useState } from "react";
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, Info, Loader2, Search } from "lucide-react";
import type { EnrichedPosition } from "@/lib/types";

interface Summary {
  totalPositions: number;
  totalValue: number;
  totalBalance: number;
  availableBalance: number;
  avgHoldApr: number;
  avgCostApr: number;
}

interface ApiResponse {
  summary: Summary;
  positions: EnrichedPosition[];
}

const STATUS_LABEL: Record<EnrichedPosition["status"], string> = {
  good: "正常",
  attention: "关注",
  losing: "止损",
  redeemable: "可赎回",
};

const STATUS_STYLE: Record<EnrichedPosition["status"], string> = {
  good: "bg-green-100 text-green-700",
  attention: "bg-yellow-100 text-yellow-700",
  losing: "bg-red-100 text-red-700",
  redeemable: "bg-blue-100 text-blue-700",
};

const HISTORY_KEY = "polymarket-dashboard-address-history";
const MAX_HISTORY = 10;

const HOLD_APR_THRESHOLD_KEY = "polymarket-dashboard-hold-apr-threshold";
const DEFAULT_HOLD_APR_THRESHOLD = 10;

function shortenAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address;
}

function formatPercent(value: number | null | undefined, digits = 1): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return `${(value * 100).toFixed(digits)}%`;
}

function formatNumber(value: number | null | undefined, digits = 2): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return value.toFixed(digits);
}

export default function Home() {
  const [address, setAddress] = useState("");
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [holdAprThreshold, setHoldAprThreshold] = useState(DEFAULT_HOLD_APR_THRESHOLD);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) setHistory(JSON.parse(raw));
    } catch {
      // ignore invalid/inaccessible localStorage
    }

    const params = new URLSearchParams(window.location.search);

    let threshold = DEFAULT_HOLD_APR_THRESHOLD;
    const thresholdParam = params.get("holdAprThreshold");
    if (thresholdParam !== null && thresholdParam !== "" && !Number.isNaN(Number(thresholdParam))) {
      threshold = Number(thresholdParam);
    } else {
      try {
        const stored = localStorage.getItem(HOLD_APR_THRESHOLD_KEY);
        if (stored !== null && !Number.isNaN(Number(stored))) {
          threshold = Number(stored);
        }
      } catch {
        // ignore inaccessible localStorage
      }
    }
    setHoldAprThreshold(threshold);

    const url = new URL(window.location.href);
    url.searchParams.set("holdAprThreshold", String(threshold));
    window.history.replaceState(null, "", url);

    const addr = params.get("address")?.trim();
    if (addr && /^0x[a-fA-F0-9]{40}$/.test(addr)) {
      setAddress(addr);
      void runQuery(addr);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleThresholdChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = Number(e.target.value);
    if (Number.isNaN(value)) return;
    setHoldAprThreshold(value);
    try {
      localStorage.setItem(HOLD_APR_THRESHOLD_KEY, String(value));
    } catch {
      // ignore inaccessible localStorage
    }
    const url = new URL(window.location.href);
    url.searchParams.set("holdAprThreshold", String(value));
    window.history.replaceState(null, "", url);
  }

  const positions = useMemo(() => data?.positions ?? [], [data]);

  const columns = useMemo<ColumnDef<EnrichedPosition>[]>(
    () => [
      {
        accessorKey: "title",
        header: "市场",
        cell: ({ row }) => (
          <div className="max-w-xs">
            <div className="truncate font-medium text-gray-900">{row.original.title}</div>
            <div className="text-xs text-gray-500">{row.original.outcome}</div>
          </div>
        ),
      },
      {
        accessorKey: "size",
        header: "持仓数量",
        cell: ({ getValue }) => formatNumber(getValue<number>()),
      },
      {
        accessorKey: "avgPrice",
        header: "买入价格",
        cell: ({ getValue }) => formatNumber(getValue<number>() * 100, 1),
      },
      {
        accessorKey: "curPrice",
        header: "当前价格",
        cell: ({ getValue }) => formatNumber(getValue<number>() * 100, 1),
      },
      {
        accessorKey: "currentValue",
        header: "当前价值 ($)",
        cell: ({ getValue }) => formatNumber(getValue<number>()),
      },
      {
        accessorKey: "holdApr",
        header: "继续持有APR",
        cell: ({ getValue }) => {
          const value = getValue<number | null>();
          const isLow = value !== null && value * 100 <= holdAprThreshold;
          return <span className={isLow ? "font-semibold text-red-600" : undefined}>{formatPercent(value)}</span>;
        },
      },
      {
        accessorKey: "costApr",
        header: "初始持有APR",
        cell: ({ getValue }) => formatPercent(getValue<number | null>()),
      },
      {
        accessorKey: "daysToSettle",
        header: "距结算(天)",
        cell: ({ getValue }) => {
          const value = getValue<number>();
          return Number.isFinite(value) ? Math.max(0, value).toFixed(1) : "-";
        },
      },
      {
        accessorKey: "endDate",
        header: "结算日",
        cell: ({ getValue }) => getValue<string>() || "-",
      },
      {
        accessorKey: "expectedProfit",
        header: "预期收益 ($)",
        cell: ({ getValue }) => formatNumber(getValue<number>()),
      },
      {
        accessorKey: "status",
        header: "状态",
        cell: ({ getValue }) => {
          const status = getValue<EnrichedPosition["status"]>();
          return (
            <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_STYLE[status]}`}>
              {STATUS_LABEL[status]}
            </span>
          );
        },
      },
    ],
    [holdAprThreshold]
  );

  const table = useReactTable({
    data: positions,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  function pushHistory(addr: string) {
    setHistory((prev) => {
      const next = [addr, ...prev.filter((a) => a !== addr)].slice(0, MAX_HISTORY);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch {
        // ignore inaccessible localStorage
      }
      return next;
    });
  }

  function removeHistory(addr: string) {
    setHistory((prev) => {
      const next = prev.filter((a) => a !== addr);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch {
        // ignore inaccessible localStorage
      }
      return next;
    });
  }

  async function runQuery(addr: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/positions?address=${encodeURIComponent(addr)}`);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "请求失败");
      }
      setData(json as ApiResponse);
      pushHistory(addr);

      const url = new URL(window.location.href);
      url.searchParams.set("address", addr);
      window.history.replaceState(null, "", url);
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : "请求失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = address.trim();
    if (!trimmed) return;
    await runQuery(trimmed);
  }

  function handleHistoryClick(addr: string) {
    setAddress(addr);
    void runQuery(addr);
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900">Polymarket 持仓看板</h1>
      <p className="mt-1 text-sm text-gray-500">
        输入钱包地址，查看当前持仓的 APR / ROI 与状态提示。
      </p>

      <form onSubmit={handleSubmit} className="mt-6 flex gap-2">
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="0x..."
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading}
          className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          查询
        </button>
      </form>

      <div className="mt-3 flex items-center gap-2">
        <label htmlFor="hold-apr-threshold" className="text-xs text-gray-500">
          继续持有APR 预警阈值 (%)
        </label>
        <div className="group relative inline-flex">
          <button
            type="button"
            aria-label="说明"
            className="flex h-4 w-4 items-center justify-center rounded-full text-gray-400 hover:text-gray-600 focus:outline-none"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
          <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 w-56 -translate-x-1/2 rounded-md bg-gray-800 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            继续持有APR 小于等于这个预警阈值时，系统会标红提示
          </div>
        </div>
        <input
          id="hold-apr-threshold"
          type="number"
          step="0.1"
          value={holdAprThreshold}
          onChange={handleThresholdChange}
          className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
        />
      </div>

      {history.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500">历史查询:</span>
          <div className="group relative inline-flex">
            <button
              type="button"
              aria-label="说明"
              className="flex h-4 w-4 items-center justify-center rounded-full text-gray-400 hover:text-gray-600 focus:outline-none"
            >
              <Info className="h-3.5 w-3.5" />
            </button>
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 w-56 -translate-x-1/2 rounded-md bg-gray-800 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              历史查询记录仅保存在你的浏览器本地
            </div>
          </div>
          {history.map((addr) => (
            <span
              key={addr}
              className="group flex items-center gap-1 rounded-full border border-gray-200 bg-white pl-3 pr-1 text-xs text-gray-600"
            >
              <button
                type="button"
                onClick={() => handleHistoryClick(addr)}
                disabled={loading}
                title={addr}
                className="py-1 hover:text-blue-600 disabled:opacity-50"
              >
                {shortenAddress(addr)}
              </button>
              <button
                type="button"
                onClick={() => removeHistory(addr)}
                title="移除"
                className="rounded-full px-1.5 py-0.5 text-gray-400 hover:bg-gray-100 hover:text-red-500"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {data && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <SummaryCard label="总余额 ($)" value={formatNumber(data.summary.totalBalance)} />
            <SummaryCard label="可用余额 ($)" value={formatNumber(data.summary.availableBalance)} />
            <SummaryCard label="总仓位价值 ($)" value={formatNumber(data.summary.totalValue)} />
            <SummaryCard label="持仓数" value={data.summary.totalPositions} />
            <SummaryCard label="加权继续持有APR" value={formatPercent(data.summary.avgHoldApr)} />
            <SummaryCard label="加权初始持有APR" value={formatPercent(data.summary.avgCostApr)} />
          </div>

          <div className="mt-6 overflow-x-auto rounded-md border border-gray-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-100">
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => {
                      const sortDirection = header.column.getIsSorted();
                      return (
                        <th
                          key={header.id}
                          onClick={header.column.getToggleSortingHandler()}
                          className="cursor-pointer select-none whitespace-nowrap px-3 py-2 font-medium text-gray-600"
                        >
                          <span className="flex items-center gap-1">
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {sortDirection === "asc" && <ArrowUp className="h-3 w-3" />}
                            {sortDirection === "desc" && <ArrowDown className="h-3 w-3" />}
                            {!sortDirection && <ArrowUpDown className="h-3 w-3 text-gray-300" />}
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-3 py-2 align-top">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
                {positions.length === 0 && (
                  <tr>
                    <td colSpan={columns.length} className="px-3 py-6 text-center text-gray-400">
                      暂无持仓数据
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-gray-900">{value}</div>
    </div>
  );
}
