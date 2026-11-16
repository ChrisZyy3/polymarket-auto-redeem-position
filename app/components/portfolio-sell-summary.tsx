"use client";

import { useEffect, useState } from "react";
import { CardToggle } from "@/app/components/card-toggle";
import { buildMarkAutoSellPlan } from "@/lib/auto-sell-plan";
import { formatMarketPercentForTick } from "@/lib/price-format";
import type { PositionQuote } from "@/lib/position-quote";
import type { EnrichedPosition } from "@/lib/types";

type Result = { quote?: PositionQuote; error?: boolean; fetchedAt?: number };

export function PortfolioSellSummary({ positions, language }: { positions: EnrichedPosition[]; language: "zh" | "en" }) {
  const en = language === "en";
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("12");
  const [results, setResults] = useState<Record<string, Result>>({});
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const apr = Number(target);
  const valid = target.trim() !== "" && Number.isFinite(apr) && apr > 0 && apr <= 10000;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const controller = new AbortController();
    setResults({});
    setLoading(true);
    async function load() {
      for (const position of positions) {
        if (cancelled) break;
        if (position.redeemable) continue;
        try {
          const params = new URLSearchParams({ tokenId: position.asset, currentPrice: String(position.curPrice), thresholdApr: "12" });
          if (position.endDate) params.set("endDate", position.endDate);
          const response = await fetch(`/api/position-quote?${params}`, { cache: "no-store", signal: controller.signal });
          const payload = await response.json();
          if (!response.ok || !payload.ok || !payload.quote) throw new Error("quote unavailable");
          if (!cancelled) setResults(prev => ({ ...prev, [position.asset]: { quote: payload.quote, fetchedAt: Date.now() } }));
        } catch {
          if (!cancelled) setResults(prev => ({ ...prev, [position.asset]: { error: true } }));
        }
      }
      if (!cancelled) setLoading(false);
    }
    void load();
    return () => { cancelled = true; controller.abort(); };
  }, [open, positions, version]);

  const fmt = (price: number | null | undefined, tick: number | null) => price == null ? "—" : formatMarketPercentForTick(price, tick);
  return <section className="mt-8 rounded-2xl border border-indigo-500/25 bg-slate-900/60 p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-lg font-semibold text-slate-100">{en ? "Portfolio sell plan" : "全仓卖出计划"} <span className="text-xs text-indigo-300">DRY RUN</span></h2>
        <p className="mt-1 text-xs text-slate-400">{en ? "Current wallet · Mark APR only · estimates, not orders" : "当前查询钱包 · 仅 Mark APR · 价格为模拟参考"}</p></div>
      <CardToggle expanded={open} onToggle={() => setOpen(value => !value)} controls="portfolio-sell-content" label={en ? "portfolio sell plan" : "全仓卖出计划"} language={language} />
    </div>
    {open && <div id="portfolio-sell-content">
      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-slate-200">
        <label htmlFor="portfolio-sell-apr">{en ? "Target remaining APR (%)" : "统一目标剩余 APR（%）"}</label>
        <input id="portfolio-sell-apr" type="number" min="0.1" max="10000" step="0.1" value={target} onChange={e => setTarget(e.target.value)} className="w-24 rounded border border-slate-600 bg-slate-950 px-2 py-1" />
        <button type="button" disabled={loading} onClick={() => setVersion(v => v + 1)} className="rounded border border-slate-600 px-3 py-1 disabled:opacity-50">{loading ? (en ? "Loading…" : "读取中…") : (en ? "Refresh quotes" : "刷新盘口")}</button>
        {!valid && <span className="text-amber-300">{en ? "Enter an APR above 0 and at most 10000%." : "请输入大于 0 且不超过 10000 的 APR。"}</span>}
      </div>
      <p className="mt-2 text-xs leading-5 text-amber-300">{en ? "Existing orders and reserved shares are not checked; displayed shares are holdings, not confirmed available shares. Quotes are snapshots. A limit at or below best bid can execute as taker; post-only is not guaranteed. Settlement dates are estimates; fees excluded." : "未核实已有卖单和份额占用；展示的是持仓数量，不是已确认可卖数量。盘口为快照；限价触及买一可能成为 Taker，不保证 Post-Only。结算时间为估计，未计手续费。"}</p>
      <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm tabular-nums"><thead className="text-xs text-slate-400"><tr>{(en ? ["Market / Outcome", "Shares", "Mark APR", "Bid / Ask", "SELL limit", "Status / quote time"] : ["市场 / 方向", "持仓份额", "Mark APR", "买一 / 卖一", "模拟 SELL 限价", "状态 / 报价时间"]).map(x => <th key={x} className="border-b border-slate-700 px-2 py-2">{x}</th>)}</tr></thead><tbody>
        {positions.map(p => {
          const result = results[p.asset]; const quote = result?.quote; const tick = quote?.tickSize ?? null;
          const plan = valid && quote ? buildMarkAutoSellPlan({ quote, targetAprPercent: apr, quantity: p.size, avgPrice: p.avgPrice, redeemable: p.redeemable }) : null;
          const status = p.redeemable ? (en ? "Redeemable" : "可赎回") : result?.error ? (en ? "Quote failed" : "报价失败") : !quote ? (loading ? (en ? "Loading" : "读取中") : "—") : !valid ? "—" : plan?.status === "would_cross" ? (en ? "Crosses bid: taker risk" : "触及买一：Taker 风险") : plan?.status === "ready" ? (en ? "Simulation" : "模拟") : (en ? "Unavailable / verify" : "不可用 / 待核实");
          const slug = p.eventSlug || p.slug;
          return <tr key={`${p.proxyWallet}:${p.asset}`} className="border-b border-slate-800 align-top text-slate-200"><td className="max-w-xs px-2 py-3">{slug ? <a className="text-cyan-300 hover:underline" href={`https://polymarket.com/event/${encodeURIComponent(slug)}`} target="_blank" rel="noreferrer">{p.title}</a> : p.title}<div className="text-xs text-slate-400">{p.outcome}</div></td><td className="px-2 py-3">{p.size.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td><td className="px-2 py-3">{plan?.currentMarkAprPercent == null ? "—" : `${plan.currentMarkAprPercent.toFixed(2)}%`}</td><td className="px-2 py-3 whitespace-nowrap">{fmt(quote?.bestBid, tick)} / {fmt(quote?.bestAsk, tick)}</td><td className="px-2 py-3 font-semibold text-indigo-300">{fmt(plan?.proposedLimitPrice, tick)}</td><td className="px-2 py-3 text-xs">{status}{result?.fetchedAt && <div className="mt-1 text-slate-500">{new Date(result.fetchedAt).toLocaleTimeString()}</div>}</td></tr>;
        })}
      </tbody></table>{positions.length === 0 && <p className="py-4 text-sm text-slate-400">{en ? "No positions loaded." : "当前没有持仓。"}</p>}</div>
    </div>}
  </section>;
}
