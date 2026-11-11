"use client";

import { buildMarkAutoSellPlan } from "@/lib/auto-sell-plan";
import { formatMarketPercentForTick } from "@/lib/price-format";
import type { PositionQuote } from "@/lib/position-quote";
import type { EnrichedPosition } from "@/lib/types";

export function AutoSellPlannerPanel({
  position,quote,targetAprPercent,language
}:{
  position: EnrichedPosition;
  quote: PositionQuote | null;
  targetAprPercent: number;
  language:"zh"|"en";
}) {
  const en=language==="en";
  const plan=buildMarkAutoSellPlan({
    quote,targetAprPercent,quantity:position.size,avgPrice:position.avgPrice,
    redeemable:position.redeemable
  });
  const good=plan.status==="ready"||plan.status==="would_cross";
  const statusLabel=plan.status==="would_cross"
    ? (en?"Would cross best bid":"模拟：当前买一已触达")
    : plan.status==="ready"
      ? (en?"Would wait for target":"模拟：等待目标价")
      : (en?"Not executable (simulation only)":"待核实：仅理论价格");
  const priceText=(p:number|null)=>p===null?"—":
    formatMarketPercentForTick(p,quote?.tickSize??null);
  const number=(n:number|null)=>n===null||!Number.isFinite(n)?"—":
    n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
  return (
    <section className="mt-3 rounded-xl border border-indigo-500/25 bg-indigo-500/5 p-3"
      aria-label={en?"Auto Sell planner (dry run)":"自动卖出规划（仅模拟）"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h5 className="text-sm font-bold text-slate-100">
            {en?"Auto Sell Planner":"Auto Sell · 自动卖出规划"}
          </h5>
          <p className="mt-1 text-xs text-slate-400">
            {en?"Mark APR only · excludes holding rewards":"仅使用 Mark APR，不计 Holding Rewards"}
          </p>
        </div>
        <span className="rounded-md border border-indigo-400/30 bg-indigo-400/10 px-2 py-1 text-xs font-bold text-indigo-200">
          DRY RUN · {en?"NO ORDERS":"不真实挂单"}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg border border-slate-700/60 bg-slate-950/50 p-2.5">
          <p className="text-[11px] text-slate-400">{en?"Mark APR":"当前 Mark APR"}</p>
          <p className="mt-1 font-mono font-bold text-slate-100">
            {plan.currentMarkAprPercent===null?"—":plan.currentMarkAprPercent.toFixed(2)+"%"}
          </p>
        </div>
        <div className="rounded-lg border border-slate-700/60 bg-slate-950/50 p-2.5">
          <p className="text-[11px] text-slate-400">{en?"Target Mark APR":"目标剩余 APR"}</p>
          <p className="mt-1 font-mono font-bold text-slate-100">{targetAprPercent.toFixed(2)}%</p>
        </div>
        <div className="rounded-lg border border-slate-700/60 bg-slate-950/50 p-2.5">
          <p className="text-[11px] text-slate-400">{en?"SELL limit (simulation)":"模拟 SELL 限价"}</p>
          <p className="mt-1 font-mono font-bold text-indigo-300">
            {priceText(plan.proposedLimitPrice)}
          </p>
        </div>
        <div className="rounded-lg border border-slate-700/60 bg-slate-950/50 p-2.5">
          <p className="text-[11px] text-slate-400">{en?"Shares to sell":"模拟卖出数量"}</p>
          <p className="mt-1 font-mono font-bold text-slate-100">
            {number(plan.quantity)}
          </p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-700/70 bg-slate-950/50 px-3 py-2">
        <span className={good?"text-emerald-300":"text-amber-300"}>
          {statusLabel}
        </span>
        <span className="text-xs text-slate-400">
          {en?"Theoretical price":"理论目标价"}：{priceText(plan.theoreticalTargetPrice)}
        </span>
      </div>
      {good ? (
        <p className="mt-2 text-xs leading-5 text-slate-300">
          {en?"Gross proceeds at limit":"按模拟限价估算的卖出总额"}：
          <strong className="font-mono">${number(plan.estimatedGrossProceeds)}</strong>
          {" · "}{en?"APR if settles at $1":"限价对应剩余 APR"}：
          <strong className="font-mono">
            {plan.priceAtLimitAprPercent===null?"—":plan.priceAtLimitAprPercent.toFixed(2)+"%"}
          </strong>
        </p>
      ) : null}
      <p className="mt-2 text-[11px] leading-5 text-slate-400">
        {en
          ? "The Dashboard refreshes an expanded quote every 5 minutes; the Worker calculates portfolio-wide theoretical targets on successful 5-minute polls. No order IDs, signatures or real orders are created."
          : "展开盘口时每 5 分钟刷新一次报价；Worker 成功轮询持仓后同步更新理论目标价。不创建订单 ID、不签名、不下真实订单。"}
      </p>
      <p className="mt-1 text-[11px] leading-5 text-amber-300/90">
        {en
          ? "Plan excludes fees, existing sell orders and share reservations; end date is an estimate. A bid crossing the limit does not guarantee full fill."
          : "未扣交易费，未核实既有卖单及股份占用；预计结算日可能延迟。即使买一达到目标价，也不代表全仓能够成交。"}
      </p>
    </section>
  );
}
