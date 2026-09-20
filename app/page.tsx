"use client";

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  AlertTriangle,
  X,
  Zap,
  CalendarClock,
  Database,
  ExternalLink,
  Languages,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from "lucide-react";
import { PortfolioHistoryChart } from "@/app/components/portfolio-history-chart";
import type { PortfolioHistoryMetrics, PortfolioSnapshot } from "@/lib/portfolio-history";
import { formatPriceForTick } from "@/lib/price-format";
import { buildTargetAprPlan, type PositionQuote } from "@/lib/position-quote";
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
  fetchedAt: string;
  summary: Summary;
  positions: EnrichedPosition[];
}

interface HistoryResponse {
  snapshots: PortfolioSnapshot[];
  metrics: PortfolioHistoryMetrics;
}

interface PositionQuoteResponse {
  ok: boolean;
  quote?: PositionQuote;
  error?: string;
}

interface QuoteState {
  status: "loading" | "ready" | "error";
  thresholdAprPercent: number;
  quote?: PositionQuote;
  error?: string;
}

type Language = "zh" | "en";

const LANGUAGE_KEY = "polymarket-dashboard-language";

// LocalStorage Keys for state persistence
// 本地状态存储字段常量定义
const HISTORY_KEY = "polymarket-dashboard-address-history";
const MAX_HISTORY = 8;

const HOLD_APR_THRESHOLD_KEY = "polymarket-dashboard-hold-apr-threshold";
const DEFAULT_HOLD_APR_THRESHOLD = 8; // Default 8% APR alert threshold / 默认 8% 的 APR 预警阈值
const TARGET_APR_BY_ASSET_KEY = "polymarket-dashboard-target-apr-by-asset-v1";
const DUST_POSITION_VALUE_USD = 1;

function parseTargetAprInput(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function serializeTargetAprInputs(inputs: Record<string, string>): string {
  const validEntries = Object.entries(inputs).flatMap(([asset, value]) => {
    const parsed = parseTargetAprInput(value);
    return parsed === null ? [] : [[asset, parsed] as const];
  });
  return JSON.stringify(Object.fromEntries(validEntries));
}

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

function formatMoneyCompact(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function formatPriceCents(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `$${(value * 100).toFixed(2).replace(/\.?0+$/, "")}`;
}

function formatDateTime(value: string, language: Language): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString(language === "en" ? "en-US" : "zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSettlementDate(value: string | null | undefined, language: Language): string {
  if (typeof value !== "string" || !value.trim()) return "—";
  const trimmedValue = value.trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmedValue);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(trimmedValue);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(language === "en" ? "en-US" : "zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function calculateHoldingReturn(position: EnrichedPosition): number | null {
  if (!Number.isFinite(position.cashPnl) || !Number.isFinite(position.initialValue) || position.initialValue <= 0) {
    return null;
  }
  return position.cashPnl / position.initialValue;
}

function getMarketUrl(position: EnrichedPosition): string | null {
  const slug = position.eventSlug || position.slug;
  return slug ? `https://polymarket.com/event/${encodeURIComponent(slug)}` : null;
}

function getPositionKey(position: EnrichedPosition): string {
  return `${position.conditionId}:${position.asset}`;
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
  const [language, setLanguage] = useState<Language>("zh");
  const [expandedPositionKey, setExpandedPositionKey] = useState<string | null>(null);
  const [quoteStates, setQuoteStates] = useState<Record<string, QuoteState>>({});
  const [targetAprInputs, setTargetAprInputs] = useState<Record<string, string>>({});
  const quoteRequestVersion = useRef(0);
  const isEnglish = language === "en";

  // Initialize state configurations from localstorage and URL params on mount
  // 组件挂载时从浏览器 LocalStorage 和 URL 参数中初始化用户参数
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) setHistory(JSON.parse(raw));
      const storedLanguage = localStorage.getItem(LANGUAGE_KEY);
      if (storedLanguage === "zh" || storedLanguage === "en") setLanguage(storedLanguage);
      const storedTargetApr = localStorage.getItem(TARGET_APR_BY_ASSET_KEY);
      if (storedTargetApr) {
        const parsed = JSON.parse(storedTargetApr) as unknown;
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          const entries = Object.entries(parsed).flatMap(([asset, value]) =>
            typeof value === "number" && Number.isFinite(value) && value >= 0
              ? [[asset, String(value)] as const]
              : [],
          );
          setTargetAprInputs(Object.fromEntries(entries));
        }
      }
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

  useEffect(() => {
    document.documentElement.lang = isEnglish ? "en" : "zh-CN";
  }, [isEnglish]);

  function changeLanguage(nextLanguage: Language) {
    setLanguage(nextLanguage);
    try {
      localStorage.setItem(LANGUAGE_KEY, nextLanguage);
    } catch {
      // Ignore unavailable localStorage.
    }
  }

  // Update threshold value and write to localStorage
  // 处理持有 APR 阈值的修改事件，并持久化写入 LocalStorage 与 URL 参数
  function handleThresholdChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = Number(e.target.value);
    if (Number.isNaN(value)) return;
    setHoldAprThreshold(value);
    quoteRequestVersion.current += 1;
    setExpandedPositionKey(null);
    setQuoteStates({});
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
  const totalAssetValue = data?.summary.totalBalance ?? 0;
  const marketValues = useMemo(() => {
    const values = new Map<string, number>();
    positions.forEach((position) => {
      const marketKey = position.conditionId || position.eventSlug || position.slug || position.asset;
      const currentValue = Number.isFinite(position.currentValue) ? position.currentValue : 0;
      values.set(marketKey, (values.get(marketKey) ?? 0) + currentValue);
    });
    return values;
  }, [positions]);

  async function loadPositionQuote(
    position: EnrichedPosition,
    thresholdApr = holdAprThreshold,
    force = false,
  ) {
    const key = getPositionKey(position);
    const existing = quoteStates[key];
    if (
      !force &&
      existing &&
      existing.thresholdAprPercent === thresholdApr &&
      (existing.status === "loading" || existing.status === "ready")
    ) return;

    const requestVersion = ++quoteRequestVersion.current;

    setQuoteStates((previous) => ({
      ...previous,
      [key]: { status: "loading", thresholdAprPercent: thresholdApr },
    }));

    try {
      const params = new URLSearchParams({
        tokenId: position.asset,
        currentPrice: String(position.curPrice),
        thresholdApr: String(thresholdApr),
      });
      if (position.endDate) params.set("endDate", position.endDate);

      const response = await fetch(`/api/position-quote?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json()) as PositionQuoteResponse;
      if (!response.ok || !payload.ok || !payload.quote) {
        throw new Error(payload.error || (isEnglish ? "Quote request failed" : "获取仓位报价失败"));
      }

      setQuoteStates((previous) => {
        if (requestVersion !== quoteRequestVersion.current) return previous;
        return {
          ...previous,
          [key]: { status: "ready", thresholdAprPercent: thresholdApr, quote: payload.quote },
        };
      });
    } catch (err) {
      setQuoteStates((previous) => {
        if (requestVersion !== quoteRequestVersion.current) return previous;
        return {
          ...previous,
          [key]: {
            status: "error",
            thresholdAprPercent: thresholdApr,
            error: err instanceof Error ? err.message : isEnglish ? "Unexpected quote error" : "获取报价时发生未知错误",
          },
        };
      });
    }
  }

  function handleTargetAprChange(asset: string, value: string) {
    if (value && !/^\d*(?:\.\d*)?$/.test(value)) return;
    const nextInputs = { ...targetAprInputs };
    if (value) {
      nextInputs[asset] = value;
    } else {
      delete nextInputs[asset];
    }
    setTargetAprInputs(nextInputs);
    try {
      localStorage.setItem(TARGET_APR_BY_ASSET_KEY, serializeTargetAprInputs(nextInputs));
    } catch {
      // Ignore unavailable localStorage.
    }
  }

  function handleQuoteToggle(position: EnrichedPosition) {
    const key = getPositionKey(position);
    if (expandedPositionKey === key) {
      setExpandedPositionKey(null);
      return;
    }

    setExpandedPositionKey(key);
    const state = quoteStates[key];
    if (!state || state.thresholdAprPercent !== holdAprThreshold || state.status === "error") {
      void loadPositionQuote(position);
    }
  }

  function handleQuoteRefresh(position: EnrichedPosition) {
    setExpandedPositionKey(getPositionKey(position));
    void loadPositionQuote(position, holdAprThreshold, true);
  }

  // Table columns definition with lucide icons and custom render cells
  // 定义表格每一列的数据绑定及其 UI 渲染细节，使用 Tailwind 精准样式控制
  const columns = useMemo<ColumnDef<EnrichedPosition>[]>(
    () => [
      {
        accessorKey: "title",
        header: isEnglish ? "Market / outcome" : "分析市场 / 方向",
        cell: ({ row }) => {
          const marketUrl = getMarketUrl(row.original);
          const fullMarketName = `${row.original.title} - ${row.original.outcome}`;
          const quoteKey = getPositionKey(row.original);
          const quoteExpanded = expandedPositionKey === quoteKey;
          const marketContent = (
            <>
              <div className="flex items-center gap-1 font-semibold text-slate-200 group-hover:text-cyan-400 transition-colors">
                <span className="truncate">{row.original.title}</span>
                {marketUrl && <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                  {isEnglish ? "Outcome" : "持有方向"}
                </span>
                <span className="text-xs font-semibold text-cyan-400 truncate">{row.original.outcome}</span>
              </div>
            </>
          );
          return (
            <div className="max-w-[280px]">
              {marketUrl ? (
                <a
                  href={marketUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={fullMarketName}
                  aria-label={`${isEnglish ? "Open market on Polymarket" : "打开 Polymarket 市场"}: ${fullMarketName}`}
                  className="block rounded-sm outline-none hover:text-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400"
                >
                  {marketContent}
                </a>
              ) : (
                <div title={fullMarketName}>{marketContent}</div>
              )}
              {row.original.status !== "redeemable" ? (
                <button
                  type="button"
                  onClick={() => handleQuoteToggle(row.original)}
                  aria-expanded={quoteExpanded}
                  aria-label={isEnglish ? "Show live bid and ask APR" : "展开实时买一和卖一 APR"}
                  className="mt-2 inline-flex items-center gap-1 rounded-md border border-cyan-500/20 bg-cyan-500/5 px-2 py-1 text-[10px] font-semibold text-cyan-400 transition-colors hover:border-cyan-400/50 hover:bg-cyan-500/10 focus:outline-none focus:ring-1 focus:ring-cyan-400"
                >
                  {quoteExpanded ? <ChevronUp className="h-3 w-3" aria-hidden="true" /> : <ChevronDown className="h-3 w-3" aria-hidden="true" />}
                  {isEnglish ? "Market APR" : "查看盘口 APR"}
                </button>
              ) : null}
            </div>
          );
        },
      },
      {
        id: "pricePath",
        accessorFn: (row) => row.curPrice,
        header: isEnglish ? "Entry → current" : "建仓价 → 当前价",
        cell: ({ row }) => (
          <span className="font-mono font-semibold text-cyan-300 whitespace-nowrap">
            {formatPriceCents(row.original.avgPrice)} <span className="text-slate-500">→</span> {formatPriceCents(row.original.curPrice)}
          </span>
        ),
      },
      {
        accessorKey: "currentValue",
        header: isEnglish ? "Value ($)" : "持仓市值 ($)",
        cell: ({ row, getValue }) => {
          const marketKey = row.original.conditionId || row.original.eventSlug || row.original.slug || row.original.asset;
          const marketValue = marketValues.get(marketKey) ?? 0;
          const positionWeight = totalAssetValue > 0 ? marketValue / totalAssetValue : 0;
          const isHighConcentration = positionWeight > 0.3;
          const isConcentrated = positionWeight > 0.2;
          const riskLabel = isHighConcentration
            ? (isEnglish ? "High concentration" : "高集中风险")
            : isConcentrated
              ? (isEnglish ? "Concentration risk" : "集中风险")
              : "";
          const riskClass = isHighConcentration
            ? "text-rose-400"
            : isConcentrated
              ? "text-amber-400"
              : "text-cyan-300";

          return (
            <div
              className="flex min-w-[120px] flex-col gap-0.5"
              title={isEnglish
                ? "Market position value as a share of total asset value"
                : "该市场持仓市值占资产总价值的比例"}
            >
              <span className="font-mono font-bold text-slate-200">
                ${formatNumber(getValue<number>())}
              </span>
              <span className={`flex items-center gap-1 text-xs font-semibold ${riskClass}`}>
                <span className="text-slate-500">{isEnglish ? "Asset share" : "仓位占比"}</span>
                <span className="font-mono">{formatPercent(positionWeight)}</span>
                {isConcentrated ? <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
                {riskLabel ? <span className="text-[10px]">{riskLabel}</span> : null}
              </span>
            </div>
          );
        },
      },
      {
        accessorKey: "cashPnl",
        header: isEnglish ? "Holding P&L ($)" : "持有收益 ($)",
        cell: ({ getValue }) => {
          const cashPnl = getValue<number>();
          if (typeof cashPnl !== "number" || !Number.isFinite(cashPnl)) {
            return <span className="font-mono font-bold text-slate-500">—</span>;
          }
          return (
            <span
              title={isEnglish ? "Sort by holding P&L" : "按持有收益金额排序"}
              className={`whitespace-nowrap font-mono font-bold ${cashPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}
            >
              {cashPnl >= 0 ? "+" : "-"}{formatMoneyCompact(Math.abs(cashPnl))}
            </span>
          );
        },
      },
      {
        id: "holdingReturn",
        accessorFn: (row) => calculateHoldingReturn(row),
        header: isEnglish ? "Holding return" : "收益率",
        cell: ({ getValue }) => {
          const holdingReturn = getValue<number | null>();
          if (typeof holdingReturn !== "number" || !Number.isFinite(holdingReturn)) {
            return <span className="font-mono font-bold text-slate-500">—</span>;
          }
          return (
            <span
              title={isEnglish ? "Sort by holding return" : "按持有收益率排序"}
              className={`whitespace-nowrap font-mono font-bold ${holdingReturn >= 0 ? "text-emerald-400" : "text-rose-400"}`}
            >
              {holdingReturn >= 0 ? "+" : ""}{formatPercent(holdingReturn)}
            </span>
          );
        },
      },
      {
        id: "aprComparison",
        accessorFn: (position) => position.holdApr,
        header: isEnglish ? "APR (market / cost)" : "APR（当前价 / 成本）",
        cell: ({ row }) => {
          const { holdApr, costApr } = row.original;
          const isLow = holdApr !== null && holdApr * 100 <= holdAprThreshold;
          return (
            <div className="flex min-w-28 flex-col gap-0.5 font-mono">
              <span
                className={`flex items-center gap-1 font-bold ${
                  isLow ? "text-rose-400 animate-pulse" : "text-emerald-400"
                }`}
              >
                <span className="font-sans text-[11px] font-medium text-slate-500">
                  {isEnglish ? "Market" : "当前价"}
                </span>
                {isLow && <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
                {formatPercent(holdApr)}
              </span>
              <span className="flex items-center gap-1 text-slate-400">
                <span className="font-sans text-[11px] font-medium text-slate-500">
                  {isEnglish ? "Cost" : "成本"}
                </span>
                {formatPercent(costApr)}
              </span>
            </div>
          );
        },
      },
      {
        accessorKey: "daysToSettle",
        header: isEnglish ? "Settlement" : "到期信息",
        cell: ({ row }) => {
          const value = row.original.daysToSettle;
          const days = Number.isFinite(value) ? Math.max(0, value).toFixed(1) : "—";
          return (
            <div className="flex min-w-28 flex-col gap-0.5">
              <span className="font-medium text-slate-200">{formatSettlementDate(row.original.endDate, language)}</span>
              <span className="font-mono text-xs text-slate-400">
                {isEnglish ? `${days} days left` : `剩余 ${days} 天`}
              </span>
            </div>
          );
        },
      },
    ],
    [expandedPositionKey, handleQuoteToggle, holdAprThreshold, isEnglish, language, marketValues, totalAssetValue]
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
    quoteRequestVersion.current += 1;
    setExpandedPositionKey(null);
    setQuoteStates({});
    try {
      const [res, historyRes] = await Promise.all([
        fetch(`/api/positions?address=${encodeURIComponent(addr)}&aprThreshold=${holdAprThreshold}&minValue=${DUST_POSITION_VALUE_USD}`),
        fetch(`/api/portfolio-history?address=${encodeURIComponent(addr)}`),
      ]);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || (isEnglish ? "Request failed. Check your connection or wallet address." : "请求接口失败，请检查网络或钱包地址格式"));
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
      setError(err instanceof Error ? err.message : isEnglish ? "Unexpected request error" : "未知的请求链路错误");
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

  // Keep the dashboard shell visible before the first query and make the
  // empty/loading state explicit instead of conditionally removing the whole
  // statistics and positions sections.
  const emptyMetricValue = isEnglish ? "No data yet" : "等待查询";
  const fetchedAtLabel = data
    ? `${isEnglish ? "Updated" : "数据获取于"} ${formatDateTime(data.fetchedAt, language)}`
    : loading
      ? (isEnglish ? "Loading portfolio…" : "正在读取持仓数据…")
      : emptyMetricValue;
  const emptyPositionsMessage = loading
    ? (isEnglish ? "Loading positions…" : "正在读取持仓数据…")
    : data
      ? (isEnglish ? "No qualifying positions found." : "未在此钱包中分析到符合条件的持仓数据。")
      : (isEnglish ? "Enter a wallet address and click Analyze." : "请输入钱包地址并点击查询分析，查看仓位数据。");

  return (
    <main className="relative z-10 mx-auto max-w-7xl px-4 py-6 md:py-7">
      
      {/* 
        * Dashboard Header Brand & Description
        * 顶部系统主标题与装饰标徽
        */}
      <div className="flex flex-col justify-between gap-4 border-b border-slate-800 pb-5 md:flex-row md:items-center">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.12)]">
            <Zap className="h-3.5 w-3.5" />
            Polymarket Portfolio Analyzer
          </div>
          <h1 className="bg-gradient-to-r from-slate-100 via-cyan-200 to-indigo-300 bg-clip-text text-2xl font-extrabold tracking-tight text-transparent md:text-3xl">
            {isEnglish ? "Portfolio & Returns Monitor" : "自动持仓监控与收益看板"}
          </h1>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-slate-400">
            {isEnglish
              ? "Estimate annualized returns to settlement at current prices, and flag low-APR, losing, and redeemable positions."
              : "按当前价格计算到期年化，快速识别低 APR、亏损和可赎回仓位。"}
          </p>
        </div>
        <div className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/50 p-1 self-start md:self-auto shadow-inner" aria-label={isEnglish ? "Language" : "语言"}>
          <Languages className="ml-2 h-4 w-4 text-cyan-400" aria-hidden="true" />
          <button
            type="button"
            onClick={() => changeLanguage("zh")}
            aria-pressed={!isEnglish}
            className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${!isEnglish ? "bg-cyan-500 text-slate-950" : "text-slate-400 hover:text-slate-100"}`}
          >
            中文
          </button>
          <button
            type="button"
            onClick={() => changeLanguage("en")}
            aria-pressed={isEnglish}
            className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${isEnglish ? "bg-cyan-500 text-slate-950" : "text-slate-400 hover:text-slate-100"}`}
          >
            EN
          </button>
        </div>
      </div>

      {/* 
        * Search Bar & Configurations Container
        * 地址检索框与年化告警阈值调节面板
        */}
      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
        
        {/* Search Address Input Card / 钱包地址查询输入卡片 */}
        <div className="group relative overflow-hidden rounded-xl border border-slate-800/80 bg-slate-900/40 p-4 shadow-lg backdrop-blur-xl lg:col-span-2">
          <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent"></div>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-200">
            <Wallet className="h-4.5 w-4.5 text-cyan-400" />
            {isEnglish ? "Wallet analysis" : "账户检索与分析"}
          </h2>
          <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1">
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder={isEnglish ? "Ethereum wallet address (0x…)" : "请输入以太坊格式钱包地址 (0x...)"}
                className="w-full rounded-lg border border-slate-700 bg-slate-950/70 py-2.5 pl-3.5 pr-10 text-sm text-slate-100 placeholder-slate-500 shadow-inner transition-all focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
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
              className="flex cursor-pointer items-center gap-2 rounded-lg bg-gradient-to-r from-cyan-500 to-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-cyan-950/50 transition-all hover:from-cyan-400 hover:to-indigo-500 focus:outline-none disabled:opacity-50 active:scale-98"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {isEnglish ? "Analyze" : "查询分析"}
            </button>
            <div className="hidden shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px] text-slate-500">
              <Database className="h-3.5 w-3.5" />
              {fetchedAtLabel}
            </div>
          </form>

          {/* Search History Badges List / 历史检索地址胶囊徽章列表 */}
          {history.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs font-semibold text-slate-500">{isEnglish ? "Recent searches:" : "历史查询:"}</span>
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
                    aria-label={isEnglish ? "Remove" : "移除"}
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
        <div className="group relative overflow-hidden rounded-xl border border-slate-800/80 bg-slate-900/40 p-4 shadow-lg backdrop-blur-xl">
          <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-purple-500/30 to-transparent"></div>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-200">
            <Percent className="h-4.5 w-4.5 text-purple-400" />
            {isEnglish ? "Hold APR threshold" : "继续持有 APR 警报阈值"}
          </h2>
          <div className="flex flex-col gap-3">
            <label htmlFor="hold-apr-threshold" className="text-xs text-slate-400 leading-relaxed">
              {isEnglish
                ? "Positions at or below this Hold APR are flagged in the dashboard and alerts."
                : "继续持有年化收益率 (Hold APR) 低于或等于此设定阈值时，看板和推送将进行风险预警并标红。"}
            </label>
            <div className="relative mt-1">
              <input
                id="hold-apr-threshold"
                type="number"
                step="0.5"
                value={holdAprThreshold}
                onChange={handleThresholdChange}
                className="w-full rounded-lg border border-slate-700 bg-slate-950/70 px-3.5 py-2.5 text-sm font-semibold text-slate-100 shadow-inner focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500/50"
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
            <span className="font-bold">{isEnglish ? "Request failed:" : "查询异常:"}</span> {error}
          </div>
        </div>
      )}

      {/*
        * Metrics & Statistics Dashboard (Always rendered with an empty state)
        * 账户总体业绩卡片与统计分析结果：查询前保留完整页面骨架
        */}
      {/* Dashboard Summary Statistics Cards Grid / 指标概览区块 */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <SummaryCard
              label={isEnglish ? "Total portfolio value" : "资产总价值"}
              value={data ? `$${formatNumber(data.summary.totalBalance)}` : "—"}
              icon={<DollarSign className="h-4 w-4 text-cyan-400" />}
              glowColor="cyan"
              tooltip={isEnglish ? "Available balance + current position value" : "总余额 + 仓位当前市值总和"}
            />
            <SummaryCard
              label={isEnglish ? "Available balance" : "链上可用余额"}
              value={data ? `$${formatNumber(data.summary.availableBalance)}` : "—"}
              icon={<Wallet className="h-4 w-4 text-emerald-400" />}
              glowColor="green"
              tooltip={isEnglish ? "Liquid pUSD available for trading" : "钱包中可用于买入市场的流动 pUSD 现金总额"}
            />
            <SummaryCard
              label={isEnglish ? "Position value" : "当前持仓市值"}
              value={data ? `$${formatNumber(data.summary.totalValue)}` : "—"}
              icon={<Activity className="h-4 w-4 text-indigo-400" />}
              glowColor="purple"
              tooltip={isEnglish ? "Current market value of all positions" : "用户当前所有未结算的持仓当前市价总价值"}
            />
            <SummaryCard
              label={isEnglish ? "Weighted hold APR" : "加权继续持有 APR"}
              value={data ? formatPercent(data.summary.avgHoldApr) : "—"}
              icon={<TrendingUp className="h-4 w-4 text-fuchsia-400" />}
              glowColor="red"
              tooltip={isEnglish ? "Expected annualized return, weighted by position value" : "以仓位当前市值为权重，加权计算的持仓预期年化收益率。评估继续锁定资金的性价比"}
            />
            <SummaryCard
              label={isEnglish ? "Weighted entry APR" : "加权建仓初始 APR"}
              value={data ? formatPercent(data.summary.avgCostApr) : "—"}
              icon={<Percent className="h-4 w-4 text-amber-400" />}
              glowColor="cyan"
              tooltip={isEnglish ? "Annualized return at entry, weighted by position value" : "以仓位当前市值为权重，加权计算的买入成本初始年化收益率"}
            />
      </div>

     <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <HistoryMetric
          label={isEnglish ? "Change since first record" : "记录以来变化 / 年化"}
          value={data ? formatHistoryChange(
            portfolioHistory?.metrics.changeSinceStart,
            portfolioHistory?.metrics.balanceChangeSinceStart,
            isEnglish,
            portfolioHistory?.metrics.annualizedSinceStart,
          ) : emptyMetricValue}
          icon={<Database className="h-4 w-4 text-cyan-400" />}
        />
        <HistoryMetric
          label={isEnglish ? "7-day change" : "7 日变化 / 年化"}
          value={data ? formatHistoryChange(
            portfolioHistory?.metrics.change7d,
            portfolioHistory?.metrics.balanceChange7d,
            isEnglish,
            portfolioHistory?.metrics.annualized7d,
          ) : emptyMetricValue}
          icon={<CalendarClock className="h-4 w-4 text-amber-400" />}
        />
        <HistoryMetric
          label={isEnglish ? "30-day change" : "30 日变化 / 年化"}
          value={data ? formatHistoryChange(
            portfolioHistory?.metrics.change30d,
            portfolioHistory?.metrics.balanceChange30d,
            isEnglish,
            portfolioHistory?.metrics.annualized30d,
          ) : emptyMetricValue}
          icon={<CalendarClock className="h-4 w-4 text-indigo-400" />}
        />
      </div>

      <PortfolioHistoryChart snapshots={portfolioHistory?.snapshots ?? []} language={language} />

      {/* Positions detailed tables container / 仓位细分数据列表 */}
      <div className="mt-8 backdrop-blur-xl bg-slate-900/30 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl relative">
        <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-cyan-500/20 to-transparent"></div>

        <div className="px-6 py-5 border-b border-slate-800 bg-slate-900/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-slate-200 flex items-center gap-2">
              <Activity className="h-5 w-5 text-cyan-400" />
              {isEnglish ? "Position yield and market APR" : "持仓收益与盘口 APR"}
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              {isEnglish
                ? "Expand a market to compare the live best-bid and best-ask conditional APR."
                : "展开市场即可比较实时买一、卖一价格对应的条件 APR。"}
            </p>
          </div>
          <div className="flex items-center gap-1.5 self-start sm:self-auto text-xs text-slate-500 font-semibold bg-slate-950/60 border border-slate-800 px-3 py-1.5 rounded-lg shadow-inner">
            <Info className="h-3.5 w-3.5 text-slate-400" />
            {isEnglish
              ? `Positions worth less than $${DUST_POSITION_VALUE_USD} are excluded`
              : `自动忽略市值低于 ${DUST_POSITION_VALUE_USD} 美元的尘埃仓位`}
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
              {table.getRowModel().rows.map((row) => {
                const positionKey = getPositionKey(row.original);
                const isExpanded = expandedPositionKey === positionKey;
                return (
                  <Fragment key={row.id}>
                    <tr className="group hover:bg-slate-900/30 transition-all duration-150">
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="px-4 py-4 align-middle whitespace-nowrap">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                    {isExpanded ? (
                      <tr className="bg-slate-950/40">
                        <td colSpan={columns.length} className="px-4 pb-5 pt-1 align-top whitespace-normal">
                          <PositionQuotePanel
                            position={row.original}
                            quoteState={quoteStates[positionKey]}
                            targetAprInput={targetAprInputs[row.original.asset] ?? ""}
                            language={language}
                            onTargetAprChange={(value) => handleTargetAprChange(row.original.asset, value)}
                            onRefresh={() => handleQuoteRefresh(row.original)}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
              {positions.length === 0 && (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-4 py-16 text-center text-slate-500 font-semibold"
                  >
                    {emptyPositionsMessage}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

function PositionQuotePanel({
  position,
  quoteState,
  targetAprInput,
  language,
  onTargetAprChange,
  onRefresh,
}: {
  position: EnrichedPosition;
  quoteState?: QuoteState;
  targetAprInput: string;
  language: Language;
  onTargetAprChange: (value: string) => void;
  onRefresh: () => void;
}) {
  const isEnglish = language === "en";
  const quote = quoteState?.quote;
  const isLoading = quoteState?.status === "loading";
  const targetAprPercent = parseTargetAprInput(targetAprInput);
  const targetAprPlan = quote && targetAprPercent !== null
    ? buildTargetAprPlan({
        targetAprPercent,
        daysToSettle: quote.daysToSettle,
        bestBid: quote.bestBid,
        bestAsk: quote.bestAsk,
        tickSize: quote.tickSize,
      })
    : null;
  const targetAprInputId = `target-apr-${position.asset}`;
  const targetAprHelpId = `${targetAprInputId}-help`;
  const hasInvalidTargetApr = targetAprInput.trim() !== "" && targetAprPercent === null;
  return (
    <div className="rounded-xl border border-cyan-500/20 bg-slate-900/70 p-4 shadow-inner">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-bold text-slate-100">
              {isEnglish ? "Live order-book conditional APR" : "实时盘口条件 APR"}
            </h4>
            <span className="rounded-full border border-slate-700 bg-slate-950/70 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
              {position.outcome}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            {isEnglish
              ? "Gross annualized return if this outcome settles at $1. This panel never places orders."
              : "假设该结果最终结算为 $1 的单利年化收益；这里只读取盘口，不执行下单。"}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 self-start rounded-md border border-slate-700 bg-slate-950/70 px-2.5 py-1.5 text-xs font-semibold text-slate-300 transition-colors hover:border-cyan-500/50 hover:text-cyan-300 disabled:cursor-wait disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} aria-hidden="true" />
          {isEnglish ? "Refresh quote" : "刷新报价"}
        </button>
      </div>

      {isLoading ? (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-4 text-xs text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin text-cyan-400" aria-hidden="true" />
          {isEnglish ? "Reading the live order book…" : "正在读取当前实时盘口…"}
        </div>
      ) : quoteState?.status === "error" ? (
        <div className="mt-4 rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-3 text-xs text-rose-300">
          {quoteState.error}
        </div>
      ) : quote ? (
        <>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <OrderBookAprCard
              label={isEnglish ? "Best bid" : "买一"}
              price={quote.bestBid}
              apr={quote.bestBidApr}
              tickSize={quote.tickSize}
              accent="emerald"
              description={isEnglish ? "Maker bid reference" : "Maker 买单收益参考"}
              language={language}
            />
            <OrderBookAprCard
              label={isEnglish ? "Best ask" : "卖一"}
              price={quote.bestAsk}
              apr={quote.bestAskApr}
              tickSize={quote.tickSize}
              accent="rose"
              description={isEnglish ? "Immediate buy reference" : "即时买入收益参考"}
              language={language}
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-slate-800 bg-slate-950/45 px-3 py-2.5 text-xs text-slate-400">
            <span>{isEnglish ? "Time to settlement" : "距结算"}: <strong className="font-mono text-slate-200">{quote.daysToSettle === null ? "—" : `${quote.daysToSettle.toFixed(1)}d`}</strong></span>
            <span>{isEnglish ? "Tick" : "最小价位"}: <strong className="font-mono text-slate-300">{formatPriceForTick(quote.tickSize, quote.tickSize)}</strong></span>
            <span className={quote.orderBookAvailable ? "text-emerald-400" : "text-amber-400"}>
              {quote.orderBookAvailable
                ? (isEnglish ? "Live book available" : "已读取实时盘口")
                : (isEnglish ? "Theoretical price only" : "当前仅显示理论价格")}
            </span>
          </div>

          <div className="mt-3 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-xl">
                <label htmlFor={targetAprInputId} className="text-sm font-bold text-slate-100">
                  {isEnglish ? "Target APR for this outcome" : "该 Outcome 的目标 APR"}
                </label>
                <p id={targetAprHelpId} className="mt-1 text-xs leading-relaxed text-slate-400">
                  {isEnglish
                    ? "Saved in this browser for this token only. It is separate from the global Alert APR."
                    : "仅针对当前 token 保存在此浏览器中，与全局 Alert APR 预警阈值相互独立。"}
                </p>
              </div>
              <div className="relative w-full max-w-44 shrink-0">
                <input
                  id={targetAprInputId}
                  type="number"
                  min="0"
                  step="0.1"
                  inputMode="decimal"
                  value={targetAprInput}
                  onChange={(event) => onTargetAprChange(event.target.value)}
                  aria-describedby={targetAprHelpId}
                  aria-invalid={hasInvalidTargetApr}
                  placeholder="12.0"
                  className="h-11 w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 pr-9 font-mono text-base font-bold text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-500">%</span>
              </div>
            </div>

            {hasInvalidTargetApr ? (
              <p className="mt-3 text-xs font-semibold text-rose-300" role="alert">
                {isEnglish ? "Enter a non-negative APR." : "请输入不小于 0 的 APR。"}
              </p>
            ) : targetAprPlan ? (
              <TargetAprPlanPanel plan={targetAprPlan} tickSize={quote.tickSize} language={language} />
            ) : (
              <p className="mt-3 rounded-lg border border-dashed border-slate-700 px-3 py-3 text-xs text-slate-400">
                {isEnglish
                  ? "Set a Target APR to calculate the target price and maker bid."
                  : "输入 Target APR 后，将计算目标价格与 Maker 建议挂价。"}
              </p>
            )}
          </div>

          {quote.note && (
            <p className="mt-2 text-[11px] leading-relaxed text-amber-300/80">{quote.note}</p>
          )}
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
            {isEnglish
              ? "APR excludes fees and is realized only if the outcome settles at $1."
              : "APR 未计手续费，且仅在该结果最终结算为 $1 时成立。"}
          </p>
        </>
      ) : (
        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-4 text-xs text-slate-500">
          {isEnglish ? "Preparing quote…" : "正在准备报价…"}
        </div>
      )}
    </div>
  );
}

function TargetAprPlanPanel({
  plan,
  tickSize,
  language,
}: {
  plan: NonNullable<ReturnType<typeof buildTargetAprPlan>>;
  tickSize: number | null;
  language: Language;
}) {
  const isEnglish = language === "en";
  const status = plan.bestBidMeetsTarget === true
    ? {
        label: isEnglish ? "Best bid meets target" : "当前买一满足目标 APR",
        detail: isEnglish ? "Join the current best bid as a maker." : "建议以当前买一作为 Maker 挂价。",
        className: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
      }
    : plan.bestBidMeetsTarget === false
      ? {
          label: isEnglish ? "Best bid is below target yield" : "当前买一 APR 未达到目标",
          detail: isEnglish ? "Use the lower target-APR price as a maker bid." : "建议降低挂价至目标 APR 对应价格。",
          className: "border-amber-500/25 bg-amber-500/10 text-amber-300",
        }
      : {
          label: isEnglish ? "No best bid available" : "当前暂无买一",
          detail: isEnglish ? "The suggestion uses the target APR and best ask only." : "建议价仅根据目标 APR 与卖一计算。",
          className: "border-slate-700 bg-slate-900/70 text-slate-300",
        };

  return (
    <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)]">
      <TargetAprMetric
        label={isEnglish ? "Target price" : "目标 APR 对应价格"}
        value={formatPriceForTick(plan.targetPrice, tickSize)}
      />
      <TargetAprMetric
        label={isEnglish ? "Suggested maker bid" : "Maker 建议挂价"}
        value={formatPriceForTick(plan.suggestedMakerBuyPrice, tickSize)}
        supportingValue={isEnglish
          ? `APR ${formatPercent(plan.suggestedMakerApr, 2)}`
          : `对应 APR ${formatPercent(plan.suggestedMakerApr, 2)}`}
      />
      <div className={`rounded-lg border px-3 py-3 ${status.className}`}>
        <div className="text-xs font-bold">{status.label}</div>
        <div className="mt-1 text-xs leading-relaxed opacity-80">{status.detail}</div>
      </div>
    </div>
  );
}

function TargetAprMetric({
  label,
  value,
  supportingValue,
}: {
  label: string;
  value: string;
  supportingValue?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/55 px-3 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 font-mono text-lg font-black text-cyan-300">{value}</div>
      {supportingValue ? <div className="mt-1 text-xs text-slate-400">{supportingValue}</div> : null}
    </div>
  );
}

function OrderBookAprCard({
  label,
  price,
  apr,
  tickSize,
  accent,
  description,
  language,
}: {
  label: string;
  price: number | null;
  apr: number | null;
  tickSize: number | null;
  accent: "emerald" | "rose";
  description: string;
  language: Language;
}) {
  const isEnglish = language === "en";
  const borderClass = accent === "emerald" ? "border-emerald-500/25" : "border-rose-500/25";
  const accentClass = accent === "emerald" ? "text-emerald-300" : "text-rose-300";

  return (
    <div className={`rounded-xl border ${borderClass} bg-slate-950/55 px-4 py-4`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className={`text-sm font-bold ${accentClass}`}>{label}</div>
          <div className="mt-1 text-xs text-slate-400">{description}</div>
        </div>
        <div className="text-right">
          <div className="font-mono text-lg font-black text-slate-100">{formatPriceForTick(price, tickSize)}</div>
          <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            {isEnglish ? "Price" : "价格"}
          </div>
        </div>
      </div>
      <div className="mt-4 border-t border-slate-800 pt-3">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          {isEnglish ? "Conditional APR" : "条件 APR"}
        </div>
        <div className={`mt-1 font-mono text-2xl font-black ${accentClass}`}>
          {formatPercent(apr, 2)}
        </div>
      </div>
    </div>
  );
}

function formatSignedPercent(value: number | null | undefined, isEnglish: boolean): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return isEnglish ? "Collecting data" : "数据积累中";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function formatAnnualizedPercent(value: number | null | undefined, isEnglish: boolean): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return isEnglish ? "Collecting data" : "数据积累中";
  return `${(value * 100).toFixed(2)}%`;
}

function formatHistoryChange(
  rate: number | null | undefined,
  balanceChange: number | null | undefined,
  isEnglish: boolean,
  annualizedRate?: number | null,
): string {
  if (typeof balanceChange !== "number" || !Number.isFinite(balanceChange)) {
    return isEnglish ? "Collecting data" : "数据积累中";
  }
  const percent = formatSignedPercent(rate, isEnglish);
  if (percent === "数据积累中" || percent === "Collecting data") return percent;
  const amount = `${balanceChange >= 0 ? "+" : "-"}$${formatNumber(Math.abs(balanceChange))}`;
  if (typeof annualizedRate !== "number" || !Number.isFinite(annualizedRate)) {
    return isEnglish ? `${amount} (${percent})` : `${amount}（${percent}）`;
  }
  const annualized = formatAnnualizedPercent(annualizedRate, isEnglish);
  return isEnglish
    ? `${amount} (${percent})\nAnnualized: ${annualized}`
    : `${amount}（${percent}）\n年化：${annualized}`;
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
  const [mainValue, annualizedValue] = value.split("\n");
  const isNegative = mainValue.startsWith("-");
  const isPending =
    mainValue === "数据积累中" ||
    mainValue === "Collecting data" ||
    mainValue === "等待查询" ||
    mainValue === "No data yet";
  return (
    <div className="min-h-20 rounded-lg border border-slate-800 bg-slate-900/40 p-3.5">
      <div className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-500">
        {label}
        {icon}
      </div>
      <div
        className={`mt-3 font-mono text-lg font-bold ${
          isPending ? "text-slate-500" : isNegative ? "text-rose-400" : "text-emerald-400"
        }`}
      >
        <span className="block">{mainValue}</span>
        {annualizedValue && (
          <span className="mt-1 block text-sm font-semibold text-slate-400">
            {annualizedValue}
          </span>
        )}
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
      className={`group/card flex min-h-[104px] flex-col justify-between rounded-xl border bg-slate-900/50 p-4 shadow-md backdrop-blur-md transition-all duration-200 ${glowStyles[glowColor]}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-slate-400 transition-colors group-hover/card:text-slate-300">
          {label}
        </span>
        {icon && <div className="rounded-md border border-slate-800 bg-slate-950/80 p-1 shadow-inner">{icon}</div>}
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-1">
        <AutoFitValue value={value} />
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

function AutoFitValue({ value }: { value: string | number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef<HTMLSpanElement>(null);
  const [fontSize, setFontSize] = useState(24);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const valueElement = valueRef.current;
    if (!container || !valueElement) return;

    const fitValue = () => {
      valueElement.style.fontSize = "24px";
      setFontSize(24);
      const availableWidth = container.clientWidth;
      const contentWidth = valueElement.scrollWidth;
      if (!availableWidth || contentWidth <= availableWidth) return;
      const nextFontSize = Math.max(10, Math.floor((24 * availableWidth) / contentWidth));
      valueElement.style.fontSize = `${nextFontSize}px`;
      setFontSize(nextFontSize);
    };

    fitValue();
    const observer = new ResizeObserver(fitValue);
    observer.observe(container);
    return () => observer.disconnect();
  }, [value]);

  return (
    <div ref={containerRef} className="min-w-0 flex-1 overflow-hidden">
      <span
        ref={valueRef}
        style={{ fontSize }}
        className="block w-max max-w-full whitespace-nowrap font-mono font-black leading-tight text-slate-100 tracking-tight transition-colors group-hover/card:text-white"
      >
        {value}
      </span>
    </div>
  );
}
