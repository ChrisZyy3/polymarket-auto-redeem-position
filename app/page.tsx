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
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Info,
  Loader2,
  Search,
  Wallet,
  DollarSign,
  TrendingUp,
  Percent,
  Activity,
  Award,
  AlertTriangle,
  X,
  ShieldCheck,
  Zap,
  CalendarClock,
  Database,
} from "lucide-react";
import { PortfolioHistoryChart } from "@/app/components/portfolio-history-chart";
import type { PortfolioHistoryMetrics, PortfolioSnapshot } from "@/lib/portfolio-history";
import type { EnrichedPosition } from "@/lib/types";

// Structure definition for Dashboard statistics summary
// 看板统计汇总结构接口定义
interface Summary {
  totalPositions: number;
  totalValue: number;
  totalBalance: number;
  availableBalance: number;
  avgHoldApr: number;
  avgCostApr: number;
}

// Format API response payload
// API 请求返回的数据负荷接口定义
interface ApiResponse {
  summary: Summary;
  positions: EnrichedPosition[];
}

interface HistoryResponse {
  snapshots: PortfolioSnapshot[];
  metrics: PortfolioHistoryMetrics;
}

// User-friendly status labels mapping
// 仓位状态友好名称映射字典
const STATUS_LABEL: Record<EnrichedPosition["status"], string> = {
  good: "收益极佳",
  attention: "需关注/低年化",
  losing: "跌破阈值/建议止损",
  redeemable: "已结算可赎回",
};

// Styling for status pills
// 仓位状态胶囊标签的样式字典
const STATUS_STYLE: Record<EnrichedPosition["status"], string> = {
  good: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-[0_0_12px_rgba(16,185,129,0.1)]",
  attention: "bg-amber-500/10 text-amber-400 border border-amber-500/20 shadow-[0_0_12px_rgba(245,158,11,0.1)]",
  losing: "bg-rose-500/10 text-rose-400 border border-rose-500/20 shadow-[0_0_12px_rgba(244,63,94,0.1)]",
  redeemable: "bg-sky-500/10 text-sky-400 border border-sky-500/20 shadow-[0_0_12px_rgba(14,165,233,0.1)]",
};

// LocalStorage Keys for state persistence
// 本地状态存储字段常量定义
const HISTORY_KEY = "polymarket-dashboard-address-history";
const MAX_HISTORY = 8;

const HOLD_APR_THRESHOLD_KEY = "polymarket-dashboard-hold-apr-threshold";
const DEFAULT_HOLD_APR_THRESHOLD = 8; // Default 8% APR alert threshold / 默认 8% 的 APR 预警阈值

/**
 * Shorten hex addresses to improve visual presentation
 * 缩短显示以太坊钱包地址以优化视觉排版 (例: 0x1234...5678)
 */
function shortenAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address;
}

/**
 * Formats a decimal to a percentage representation (e.g. 0.082 -> 8.2%)
 * 将浮点数格式化为带指定小数位数的百分比字符串
 */
function formatPercent(value: number | null | undefined, digits = 1): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

/**
 * Formats numbers into readable financial representations
 * 将数字格式化为保留指定小数位的金融展示字符串
 */
function formatNumber(value: number | null | undefined, digits = 2): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * Polymarket Position Analysis Dashboard Entry Component
 * Polymarket 自动仓位与收益监控系统前端主界面
 */
export default function Home() {
  const [address, setAddress] = useState("");
  const [data, setData] = useState<ApiResponse | null>(null);
  const [portfolioHistory, setPortfolioHistory] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [holdAprThreshold, setHoldAprThreshold] = useState(DEFAULT_HOLD_APR_THRESHOLD);

  // Initialize state configurations from localstorage and URL params on mount
  // 组件挂载时从浏览器 LocalStorage 和 URL 参数中初始化用户参数
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) setHistory(JSON.parse(raw));
    } catch {
      // Ignore invalid localStorage access / 忽略无法访问 localStorage 的异常情况
    }

    const params = new URLSearchParams(window.location.search);

    // Read or set Default hold APR threshold
    // 获取继续持有 APR 警告门槛配置值
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
        // Ignore errors / 忽略异常
      }
    }
    setHoldAprThreshold(threshold);

    // Sync state params back to URL context
    // 将解析出的预警阈值实时反馈回浏览器 URL 的 query params
    const url = new URL(window.location.href);
    url.searchParams.set("holdAprThreshold", String(threshold));
    window.history.replaceState(null, "", url);

    // Auto trigger search if a valid wallet address is found in URL query
    // 若 URL 查询参数中预置了合法的 EVM 地址，直接触发查询流
    const addr = params.get("address")?.trim();
    if (addr && /^0x[a-fA-F0-9]{40}$/.test(addr)) {
      setAddress(addr);
      void runQuery(addr);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update threshold value and write to localStorage
  // 处理持有 APR 阈值的修改事件，并持久化写入 LocalStorage 与 URL 参数
  function handleThresholdChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = Number(e.target.value);
    if (Number.isNaN(value)) return;
    setHoldAprThreshold(value);
    try {
      localStorage.setItem(HOLD_APR_THRESHOLD_KEY, String(value));
    } catch {
      // Ignore errors / 忽略异常
    }
    const url = new URL(window.location.href);
    url.searchParams.set("holdAprThreshold", String(value));
    window.history.replaceState(null, "", url);
  }

  // Memoize positions from state payload
  // 缓存提取并解析的仓位数组
  const positions = useMemo(() => data?.positions ?? [], [data]);

  // Table columns definition with lucide icons and custom render cells
  // 定义表格每一列的数据绑定及其 UI 渲染细节，使用 Tailwind 精准样式控制
  const columns = useMemo<ColumnDef<EnrichedPosition>[]>(
    () => [
      {
        accessorKey: "title",
        header: "分析市场 / outcome",
        cell: ({ row }) => (
          <div className="max-w-[280px]">
            <div className="font-semibold text-slate-200 truncate group-hover:text-cyan-400 transition-colors">
              {row.original.title}
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                持有方向
              </span>
              <span className="text-xs font-semibold text-cyan-400 truncate">
                {row.original.outcome}
              </span>
            </div>
          </div>
        ),
      },
      {
        accessorKey: "size",
        header: "持仓数量",
        cell: ({ getValue }) => (
          <span className="font-mono font-medium text-slate-300">
            {formatNumber(getValue<number>(), 1)}
          </span>
        ),
      },
      {
        accessorKey: "avgPrice",
        header: "建仓均价 ($)",
        cell: ({ getValue }) => (
          <span className="font-mono text-slate-400">
            {formatNumber(getValue<number>(), 3)}
          </span>
        ),
      },
      {
        accessorKey: "curPrice",
        header: "当前市价 ($)",
        cell: ({ getValue }) => (
          <span className="font-mono font-semibold text-cyan-300">
            {formatNumber(getValue<number>(), 3)}
          </span>
        ),
      },
      {
        accessorKey: "currentValue",
        header: "持仓市值 ($)",
        cell: ({ getValue }) => (
          <span className="font-mono font-bold text-slate-200">
            ${formatNumber(getValue<number>())}
          </span>
        ),
      },
      {
        accessorKey: "holdApr",
        header: "继续持有 APR",
        cell: ({ getValue }) => {
          const value = getValue<number | null>();
          const isLow = value !== null && value * 100 <= holdAprThreshold;
          return (
            <span
              className={`font-mono font-bold flex items-center gap-1 ${
                isLow ? "text-rose-400 animate-pulse" : "text-emerald-400"
              }`}
            >
              {isLow && <AlertTriangle className="h-3.5 w-3.5" />}
              {formatPercent(value)}
            </span>
          );
        },
      },
      {
        accessorKey: "costApr",
        header: "初始建仓 APR",
        cell: ({ getValue }) => (
          <span className="font-mono text-slate-400">{formatPercent(getValue<number | null>())}</span>
        ),
      },
      {
        accessorKey: "daysToSettle",
        header: "距结算 (天)",
        cell: ({ getValue }) => {
          const value = getValue<number>();
          const text = Number.isFinite(value) ? Math.max(0, value).toFixed(1) : "—";
          return <span className="font-mono font-medium text-slate-300">{text}</span>;
        },
      },
      {
        accessorKey: "expectedProfit",
        header: "预估到期收益 ($)",
        cell: ({ getValue }) => {
          const val = getValue<number>();
          return (
            <span
              className={`font-mono font-bold ${
                val >= 0 ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {val >= 0 ? "+" : ""}${formatNumber(val)}
            </span>
          );
        },
      },
      {
        accessorKey: "status",
        header: "风控状态",
        cell: ({ getValue }) => {
          const status = getValue<EnrichedPosition["status"]>();
          return (
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[status]}`}>
              {STATUS_LABEL[status]}
            </span>
          );
        },
      },
    ],
    [holdAprThreshold]
  );

  // Setup React Table instance
  // 初始化 React Table 表格引擎实例
  const table = useReactTable({
    data: positions,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  // Save new address queries in local memory and enforce history limit
  // 将新查询到的钱包地址存入历史缓存记录中，并按上限裁剪数量
  function pushHistory(addr: string) {
    setHistory((prev) => {
      const next = [addr, ...prev.filter((a) => a !== addr)].slice(0, MAX_HISTORY);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch {
        // Ignore errors / 忽略异常
      }
      return next;
    });
  }

  // Remove queries from search history
  // 从历史查询记录中清除指定钱包地址
  function removeHistory(addr: string) {
    setHistory((prev) => {
      const next = prev.filter((a) => a !== addr);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch {
        // Ignore errors / 忽略异常
      }
      return next;
    });
  }

  // Primary API trigger to run positions and balance check on a wallet address
  // 核心查询函数：触发后端 API 获取指定钱包的持仓分析数据以及 pUSD 现金资产
  async function runQuery(addr: string) {
    setLoading(true);
    setError(null);
    try {
      const [res, historyRes] = await Promise.all([
        fetch(`/api/positions?address=${encodeURIComponent(addr)}&aprThreshold=${holdAprThreshold}`),
        fetch(`/api/portfolio-history?address=${encodeURIComponent(addr)}`),
      ]);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "请求接口失败，请检查网络或钱包地址格式");
      }
      setData(json as ApiResponse);
      setPortfolioHistory(historyRes.ok ? ((await historyRes.json()) as HistoryResponse) : null);
      pushHistory(addr);

      // Sync active search address into query param context
      // 将当前正在查询的地址反映在浏览器 URL 参数中，方便刷新不丢失
      const url = new URL(window.location.href);
      url.searchParams.set("address", addr);
      window.history.replaceState(null, "", url);
    } catch (err) {
      setData(null);
      setPortfolioHistory(null);
      setError(err instanceof Error ? err.message : "未知的请求链路错误");
    } finally {
      setLoading(false);
    }
  }

  // Handle manual input search submission
  // 提交输入表单执行查询
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = address.trim();
    if (!trimmed) return;
    await runQuery(trimmed);
  }

  // Click handler to trigger queries from search history pills
  // 快捷查询：点击历史记录徽章时快速激活对应地址查询
  function handleHistoryClick(addr: string) {
    setAddress(addr);
    void runQuery(addr);
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 relative z-10">
      
      {/* 
        * Dashboard Header Brand & Description
        * 顶部系统主标题与装饰标徽
        */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-slate-800 pb-8">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 text-xs font-semibold tracking-wider uppercase mb-3 shadow-[0_0_15px_rgba(6,182,212,0.15)] animate-pulse">
            <Zap className="h-3.5 w-3.5" />
            Polymarket Portfolio Analyzer
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-slate-100 via-cyan-200 to-indigo-300 bg-clip-text text-transparent">
            自动持仓监控与收益看板
          </h1>
          <p className="mt-2 text-sm text-slate-400 max-w-2xl leading-relaxed">
            解析链上钱包持仓数据，以当前成交市价为本金，实时测算至“到期结算日”的继续持有年化收益率 (Hold APR)，并自动标识即将归零或可以赎回的仓位，助您科学调仓。
          </p>
        </div>
        <div className="flex items-center gap-3 bg-slate-900/50 backdrop-blur-md border border-slate-800 rounded-xl px-4 py-3 self-start md:self-auto shadow-inner">
          <div className="h-3.5 w-3.5 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]"></div>
          <span className="text-xs font-semibold tracking-wider text-slate-300">数据源：Polymarket Data API</span>
        </div>
      </div>

      {/* 
        * Search Bar & Configurations Container
        * 地址检索框与年化告警阀值调节面板
        */}
      <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Search Address Input Card / 钱包地址查询输入卡片 */}
        <div className="lg:col-span-2 backdrop-blur-xl bg-slate-900/40 border border-slate-800/80 rounded-2xl p-6 shadow-xl relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent"></div>
          <h2 className="text-base font-bold text-slate-200 mb-4 flex items-center gap-2">
            <Wallet className="h-4.5 w-4.5 text-cyan-400" />
            账户检索与分析
          </h2>
          <form onSubmit={handleSubmit} className="flex gap-3">
            <div className="relative flex-1">
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="请输入以太坊格式钱包地址 (0x...)"
                className="w-full rounded-xl border border-slate-700 bg-slate-950/70 py-3 pl-4 pr-10 text-sm text-slate-100 placeholder-slate-500 transition-all focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 shadow-inner"
              />
              {address && (
                <button
                  type="button"
                  onClick={() => setAddress("")}
                  className="absolute right-3.5 top-3.5 text-slate-500 hover:text-slate-300 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-cyan-950/50 hover:from-cyan-400 hover:to-indigo-500 transition-all focus:outline-none disabled:opacity-50 active:scale-98 cursor-pointer"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              查询分析
            </button>
          </form>

          {/* Search History Badges List / 历史检索地址胶囊徽章列表 */}
          {history.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2 pt-2">
              <span className="text-xs font-semibold text-slate-500">历史查询:</span>
              {history.map((addr) => (
                <span
                  key={addr}
                  className="group/badge inline-flex items-center gap-1 rounded-full border border-slate-800 bg-slate-950/50 pl-3 pr-1 text-xs text-slate-300 hover:border-slate-700 transition-all shadow-sm"
                >
                  <button
                    type="button"
                    onClick={() => handleHistoryClick(addr)}
                    disabled={loading}
                    title={addr}
                    className="py-1.5 font-mono hover:text-cyan-400 transition-colors text-[11px] disabled:opacity-50 cursor-pointer"
                  >
                    {shortenAddress(addr)}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeHistory(addr)}
                    aria-label="移除"
                    className="rounded-full p-0.5 text-slate-500 hover:bg-slate-800 hover:text-rose-400 transition-colors cursor-pointer"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Global Warnings Parameter Card / 报警参数面板卡片 */}
        <div className="backdrop-blur-xl bg-slate-900/40 border border-slate-800/80 rounded-2xl p-6 shadow-xl relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-purple-500/30 to-transparent"></div>
          <h2 className="text-base font-bold text-slate-200 mb-4 flex items-center gap-2">
            <Percent className="h-4.5 w-4.5 text-purple-400" />
            继续持有 APR 警报阀值
          </h2>
          <div className="flex flex-col gap-3">
            <label htmlFor="hold-apr-threshold" className="text-xs text-slate-400 leading-relaxed">
              继续持有年化收益率 (Hold APR) 低于或等于此设定阈值时，看板和推送将进行风险预警并标红。
            </label>
            <div className="relative mt-1">
              <input
                id="hold-apr-threshold"
                type="number"
                step="0.5"
                value={holdAprThreshold}
                onChange={handleThresholdChange}
                className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 font-semibold focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500/50 shadow-inner"
              />
              <span className="absolute right-4 top-3 text-sm font-bold text-purple-400">%</span>
            </div>
          </div>
        </div>
      </div>

      {/* 
        * Error prompt feedback overlay
        * 异常及失败信息捕获面板
        */}
      {error && (
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-400 backdrop-blur-md shadow-lg shadow-rose-950/10">
          <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5 text-rose-500" />
          <div>
            <span className="font-bold">查询异常:</span> {error}
          </div>
        </div>
      )}

      {/* 
        * Metrics & Statistics Dashboard (Only rendered when data is loaded)
        * 账户总体业绩卡片与统计分析结果
        */}
      {data && (
        <>
          {/* Dashboard Summary Statistics Cards Grid / 指标概览区块 */}
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <SummaryCard
              label="资产总价值"
              value={`$${formatNumber(data.summary.totalBalance)}`}
              icon={<DollarSign className="h-4 w-4 text-cyan-400" />}
              glowColor="cyan"
              tooltip="总余额 + 仓位当前市值总和"
            />
            <SummaryCard
              label="链上可用余额"
              value={`$${formatNumber(data.summary.availableBalance)}`}
              icon={<Wallet className="h-4 w-4 text-emerald-400" />}
              glowColor="green"
              tooltip="钱包中可用于买入市场的流动 pUSD 现金总额"
            />
            <SummaryCard
              label="当前持仓市值"
              value={`$${formatNumber(data.summary.totalValue)}`}
              icon={<Activity className="h-4 w-4 text-indigo-400" />}
              glowColor="purple"
              tooltip="用户当前所有未结算的持仓当前市价总价值"
            />
            <SummaryCard
              label="当前持仓数量"
              value={data.summary.totalPositions}
              icon={<Award className="h-4 w-4 text-purple-400" />}
              glowColor="purple"
              tooltip="当前拥有的 Polymarket 持仓市场总个数 (已滤除小于 0.1 刀的细微垃圾仓位)"
            />
            <SummaryCard
              label="加权继续持有 APR"
              value={formatPercent(data.summary.avgHoldApr)}
              icon={<TrendingUp className="h-4 w-4 text-fuchsia-400" />}
              glowColor="red"
              tooltip="以仓位当前市值为权重，加权计算的持仓预期年化收益率。评估继续锁定资金的性价比"
            />
            <SummaryCard
              label="加权建仓初始 APR"
              value={formatPercent(data.summary.avgCostApr)}
              icon={<Percent className="h-4 w-4 text-amber-400" />}
              glowColor="cyan"
              tooltip="以仓位当前市值为权重，加权计算的买入成本初始年化收益率"
            />
          </div>

          <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <HistoryMetric
              label="记录以来变化"
              value={formatSignedPercent(portfolioHistory?.metrics.changeSinceStart)}
              icon={<Database className="h-4 w-4 text-cyan-400" />}
            />
            <HistoryMetric
              label="记录以来年化"
              value={formatSignedPercent(portfolioHistory?.metrics.annualizedSinceStart)}
              icon={<TrendingUp className="h-4 w-4 text-emerald-400" />}
            />
            <HistoryMetric
              label="7 日年化"
              value={formatSignedPercent(portfolioHistory?.metrics.annualized7d)}
              icon={<CalendarClock className="h-4 w-4 text-amber-400" />}
            />
            <HistoryMetric
              label="30 日年化"
              value={formatSignedPercent(portfolioHistory?.metrics.annualized30d)}
              icon={<CalendarClock className="h-4 w-4 text-indigo-400" />}
            />
          </div>

          <PortfolioHistoryChart snapshots={portfolioHistory?.snapshots ?? []} />

          {/* Positions detailed tables container / 仓位细分数据列表 */}
          <div className="mt-8 backdrop-blur-xl bg-slate-900/30 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl relative">
            <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-cyan-500/20 to-transparent"></div>
            
            <div className="px-6 py-5 border-b border-slate-800 bg-slate-900/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-slate-200 flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-emerald-400" />
                  当前仓位风控明细
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  点击各列标题可进行多维排序。若继续持有 APR 变红，说明当前锁定资金的机会成本过高。
                </p>
              </div>
              <div className="flex items-center gap-1.5 self-start sm:self-auto text-xs text-slate-500 font-semibold bg-slate-950/60 border border-slate-800 px-3 py-1.5 rounded-lg shadow-inner">
                <Info className="h-3.5 w-3.5 text-slate-400" />
                自动忽略大小低于 0.1 刀的尘埃仓位
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <tr key={headerGroup.id} className="bg-slate-950/60 border-b border-slate-800 text-slate-400">
                      {headerGroup.headers.map((header) => {
                        const sortDirection = header.column.getIsSorted();
                        return (
                          <th
                            key={header.id}
                            onClick={header.column.getToggleSortingHandler()}
                            className="group/th cursor-pointer select-none whitespace-nowrap px-4 py-4 font-semibold hover:text-slate-200 transition-colors"
                          >
                            <span className="flex items-center gap-1.5">
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              {sortDirection === "asc" && <ArrowUp className="h-3.5 w-3.5 text-cyan-400" />}
                              {sortDirection === "desc" && <ArrowDown className="h-3.5 w-3.5 text-cyan-400" />}
                              {!sortDirection && (
                                <ArrowUpDown className="h-3.5 w-3.5 text-slate-600 group-hover/th:text-slate-400 transition-colors" />
                              )}
                            </span>
                          </th>
                        );
                      })}
                    </tr>
                  ))}
                </thead>
                <tbody className="divide-y divide-slate-800/50 bg-slate-950/10">
                  {table.getRowModel().rows.map((row) => (
                    <tr
                      key={row.id}
                      className="group hover:bg-slate-900/30 transition-all duration-150"
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="px-4 py-4 align-middle whitespace-nowrap">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {positions.length === 0 && (
                    <tr>
                      <td
                        colSpan={columns.length}
                        className="px-4 py-16 text-center text-slate-500 font-semibold"
                      >
                        未在此钱包中分析到符合条件的持仓数据。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </main>
  );
}

function formatSignedPercent(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "数据积累中";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function HistoryMetric({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  const isNegative = value.startsWith("-");
  const isPending = value === "数据积累中";
  return (
    <div className="min-h-24 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-500">
        {label}
        {icon}
      </div>
      <div
        className={`mt-4 font-mono text-lg font-bold ${
          isPending ? "text-slate-500" : isNegative ? "text-rose-400" : "text-emerald-400"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

// Summary Card sub-component for metrics overview
// 看板统计卡片子组件
function SummaryCard({
  label,
  value,
  icon,
  glowColor,
  tooltip,
}: {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  glowColor: "cyan" | "green" | "purple" | "red";
  tooltip?: string;
}) {
  // Glow border shadows configuration
  // 外边框霓虹发光阴影样式选项字典
  const glowStyles = {
    cyan: "neon-border-glow-cyan focus-within:ring-cyan-500 border-slate-800 hover:border-cyan-500/50",
    green: "neon-border-glow-green focus-within:ring-emerald-500 border-slate-800 hover:border-emerald-500/50",
    purple: "neon-border-glow-purple focus-within:ring-indigo-500 border-slate-800 hover:border-indigo-500/50",
    red: "neon-border-glow-red focus-within:ring-rose-500 border-slate-800 hover:border-rose-500/50",
  };

  return (
    <div
      className={`rounded-2xl border bg-slate-900/50 p-5 backdrop-blur-md transition-all duration-300 hover:scale-103 shadow-lg flex flex-col justify-between min-h-[120px] group/card ${glowStyles[glowColor]}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-400 group-hover/card:text-slate-300 transition-colors">
          {label}
        </span>
        {icon && <div className="p-1.5 rounded-lg bg-slate-950/80 border border-slate-800 shadow-inner">{icon}</div>}
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-1">
        <div className="text-xl md:text-2xl font-black text-slate-100 tracking-tight group-hover/card:text-white transition-colors">
          {value}
        </div>
        {tooltip && (
          <div className="group/tip relative inline-flex self-end mb-1 cursor-pointer">
            <Info className="h-3.5 w-3.5 text-slate-600 hover:text-slate-400 transition-colors" />
            <div className="pointer-events-none absolute bottom-full right-0 z-30 mb-2 w-56 rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-[10px] text-slate-400 leading-normal opacity-0 shadow-2xl transition-opacity group-hover/tip:opacity-100">
              {tooltip}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
