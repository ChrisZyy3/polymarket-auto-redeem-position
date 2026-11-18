"use client";

import type { EnrichedPosition } from "@/lib/types";
import type { ClobOrder } from "@/lib/browser-clob";
import type { PositionQuote } from "@/lib/position-quote";
import { buildMarkAutoSellPlan } from "@/lib/auto-sell-plan";
import { observedSellShares } from "@/lib/order-review-status";
import { indicativeUnreservedShares } from "@/lib/manual-sell-queue";
import { formatMarketPercentForTick } from "@/lib/price-format";
import { normalizeSdkSellShares } from "@/lib/sdk-sell-quantity";
import { holdDecisionForPosition } from "@/lib/position-apr-strategy";

export function getSellWorkspaceNumbers(
  position:EnrichedPosition,quote:PositionQuote|null,aprInput:string,
  quantityInput:string|undefined,orders:ClobOrder[]|null,ordersReady:boolean
) {
  // This is only a planning estimate. Actual executable shares are determined
  // by the fresh CLOB/on-chain preflight in ManualSellReview.
  const openSell=ordersReady&&orders?observedSellShares(orders,position.asset):null;
  const indicative=ordersReady&&orders?indicativeUnreservedShares(position.size,position.asset,orders):null;
  const quantity=quantityInput??String(indicative??position.size);
  const targetApr=Number(aprInput);
  const validApr=aprInput.trim().length>0&&Number.isFinite(targetApr)&&targetApr>0&&targetApr<=10000;
  const normalized=quantity.trim()?normalizeSdkSellShares(Number(quantity)):null;
  const validQuantity=quantity.trim().length>0&&normalized!==null;
  const noUnreserved=ordersReady&&indicative!==null&&indicative<0.01;
  const canReview=ordersReady&&indicative!==null&&indicative>=0.01&&validApr&&validQuantity
    &&normalized!==null&&normalized<=indicative+1e-8&&!position.redeemable;
  const plan=quote&&validApr&&validQuantity&&normalized!==null?buildMarkAutoSellPlan({
    quote,targetAprPercent:targetApr,quantity:normalized,avgPrice:position.avgPrice,redeemable:position.redeemable
  }):null;
  return {openSell,indicative,quantity,normalized,plan,validApr,validQuantity,canReview,noUnreserved};
}

type Props={
  position:EnrichedPosition;language:"zh"|"en";aprInput:string;aprCustom:boolean;globalAprThreshold:number;quantityInput:string|undefined;
  quote:PositionQuote|null;orders:ClobOrder[]|null;ordersReady:boolean;selected:boolean;
  onAprChange:(value:string)=>void;onAprReset:()=>void;onQuantityChange:(value:string)=>void;onSelect:(checked:boolean)=>void;
  onReview:()=>void;onOpenOrders:()=>void;onRefreshQuote:()=>void;
};
const fmtShares=(v:number)=>v.toLocaleString(undefined,{maximumFractionDigits:6});
const pct=(v:number|null|undefined)=>v===null||v===undefined||!Number.isFinite(v)?"—":(v*100).toFixed(2)+"%";

export function SellPlanRow({
  position,language,aprInput,aprCustom,globalAprThreshold,quantityInput,quote,orders,ordersReady,selected,
  onAprChange,onAprReset,onQuantityChange,onSelect,onReview,onOpenOrders,onRefreshQuote
}:Props){
  const en=language==="en";
  const {openSell,indicative,quantity,normalized,plan,validApr,validQuantity,canReview,noUnreserved}
    =getSellWorkspaceNumbers(position,quote,aprInput,quantityInput,orders,ordersReady);
  const price=plan?.proposedLimitPrice;
  const priceText=price!==null&&price!==undefined?formatMarketPercentForTick(price,quote?.tickSize??null):"—";
  const existingCount=ordersReady?(orders??[]).filter(o=>o.asset_id===position.asset&&o.side==="SELL").length:0;
  const holdDecision=holdDecisionForPosition(position,globalAprThreshold);
  const lowHold=holdDecision==="consider_exit";
  const reserved=ordersReady&&openSell!==null&&openSell>0;
  return <tr className={selected
    ? "border-b border-slate-700/20 bg-cyan-900/10 align-middle text-slate-200"
    : "border-b border-slate-700/20 align-middle text-slate-200 hover:bg-slate-800/25"}>
    <td className="px-2 py-3">
      <input type="checkbox" aria-label={(en?"Select ":"勾选 ")+position.title} checked={selected}
        disabled={position.redeemable} className="accent-cyan-300" onChange={e=>onSelect(e.target.checked)}/>
    </td>
    <td className="max-w-[300px] min-w-[205px] px-3 py-3">
      {position.eventSlug||position.slug?<a href={"https://polymarket.com/event/"+encodeURIComponent(position.eventSlug||position.slug||"")}
        target="_blank" rel="noreferrer" className="line-clamp-2 font-semibold text-slate-100 hover:text-cyan-300" title={position.title}>{position.title}</a>:
        <p className="line-clamp-2 font-semibold text-slate-100" title={position.title}>{position.title}</p>}
      <p className="mt-1 text-xs text-indigo-300">{position.outcome}</p>
    </td>
    <td className="min-w-[190px] px-3 py-3">
      <div className="flex items-center gap-2">
        <span className={"font-mono text-sm font-bold "+(lowHold?"text-amber-300":"text-emerald-300")}>{pct(position.holdApr)}</span>
        <span className="text-[10px] text-slate-500">{en?"Combined hold":"综合持有"}</span>
      </div>
      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-400">
        <span>{en?"Mark":"市场"} {pct(position.markApr)}</span>
        {position.holdingRewardEligible===true&&position.holdingRewardApr>0&&
          <span>+ Reward {pct(position.holdingRewardApr)}</span>}
      </div>
      {holdDecision!=="unavailable"&&
        <p className={"mt-1 text-[10px] "+(lowHold?"text-amber-300":"text-slate-500")}>
          {lowHold?(en?"Below hold APR watch threshold":"综合 APR 低于警报阈值"):(en?"Holding APR above threshold":"综合 APR 尚未触发警报")}
        </p>}
      <div className="mt-2 flex items-center gap-2">
        <label className="shrink-0 text-[11px] text-slate-400" htmlFor={"sell-target-"+position.asset}>
          {en?"SELL Mark target":"SELL 目标 Mark"}
        </label>
        <input id={"sell-target-"+position.asset} type="number" min="0.1" max="10000" step="0.1" inputMode="decimal"
          aria-label={position.title+" SELL Target Mark APR"} value={aprInput} onChange={e=>onAprChange(e.target.value)}
          className={"ui-input w-[75px] px-2 py-1.5 text-xs "+(validApr?"":"border-amber-400")}/>
        <span className="text-xs text-slate-500">%</span>
      </div>
      {aprCustom?
        <button type="button" onClick={onAprReset} className="mt-1.5 text-[10px] text-cyan-300 underline underline-offset-2"
          title={en?"Reset to global threshold":"恢复跟随全局阈值"}>
          {en?"Custom · use global "+globalAprThreshold+"%":"自定义 · 恢复全局 "+globalAprThreshold+"%"}
        </button>:
        <p className="mt-1.5 text-[10px] text-slate-500">{en?"Following global "+globalAprThreshold+"%":"跟随全局 "+globalAprThreshold+"%"}</p>}
    </td>
    <td className="min-w-[115px] whitespace-nowrap px-2 py-3">
      {quote?<div>
        <p className="font-mono text-base font-bold text-cyan-200 tabular-nums">{priceText}</p>
        <p className="mt-1 text-[11px] text-slate-400">{en?"APR at limit":"限价 Mark APR"} {plan?.priceAtLimitAprPercent===null||plan?.priceAtLimitAprPercent===undefined?"—":plan.priceAtLimitAprPercent.toFixed(2)+"%"}</p>
        {plan?.status==="would_cross"&&<p className="mt-1 text-[11px] font-semibold text-amber-300">{en?"May cross bid":"可能吃单 · 审核前复核"}</p>}
        {plan?.status==="theoretical_only"&&<p className="mt-1 text-[11px] text-amber-300">{en?"No verified tick":"报价未完全核实"}</p>}
      </div>:
      <button type="button" onClick={onRefreshQuote} className="text-xs text-cyan-300 underline underline-offset-2">{en?"Fetch quote":"刷新报价"}</button>}
    </td>
    <td className="min-w-[184px] px-2 py-3 tabular-nums">
      <p className="text-xs text-slate-300">{en?"Held ":"持有 "}<strong className="font-mono">{fmtShares(position.size)}</strong>
        {reserved&&<button type="button" onClick={onOpenOrders} className="ml-2 text-amber-300 underline underline-offset-2">
          {en?"LIVE SELL ":"已挂 "}{fmtShares(openSell!)}{existingCount>0?" ("+existingCount+")":""}
        </button>}
      </p>
      <label htmlFor={"sell-shares-"+position.asset} className="mt-2 flex items-center gap-2">
        <span className="shrink-0 text-[11px] text-slate-400">{en?"Sell shares":"拟卖份额"}</span>
        <input id={"sell-shares-"+position.asset} type="number" min="0" step="any" inputMode="decimal"
          aria-label={position.title+" SELL shares"} value={quantity} onChange={e=>onQuantityChange(e.target.value)}
          disabled={position.redeemable} className={"ui-input w-24 px-2 py-1.5 text-xs "+(validQuantity?"":"border-amber-400")}/>
      </label>
      <p className="mt-1 text-[10px] text-slate-500">{indicative!==null?(en?"Unreserved ≈ ":"模拟可卖 ≈ ")+fmtShares(indicative):(en?"Wallet not checked · DRY RUN":"未核对钱包 · 仅模拟")}</p>
      {validQuantity&&normalized!==null&&normalized!==Number(quantity)&&
        <p className="mt-1 text-[10px] text-cyan-300">{en?"SDK signable":"SDK 实际份额"} {fmtShares(normalized)}</p>}
      {ordersReady&&!canReview&&<p className="mt-1 text-[10px] text-amber-300">{
        noUnreserved?(en?"Shares reserved by existing SELL":"份额已被已有 SELL 占用"):
        indicative===null?(en?"Balance needs verification":"可卖份额待核对"):
        validQuantity&&normalized!==null&&indicative!==null&&normalized>indicative+1e-8?(en?"Exceeds available shares":"超过模拟可卖份额"):
        !validQuantity?(en?"Minimum 0.01 share":"SELL 至少 0.01 份"):(en?"Check APR / quantity":"检查 APR / 数量")
      }</p>}
    </td>
    <td className="min-w-[130px] px-3 py-3 text-xs">
      <p className={"mb-2 "+(reserved?"text-amber-300":ordersReady?"text-slate-300":"text-amber-300")}>
        {position.redeemable?(en?"Redeemable":"可赎回"):
         !ordersReady?(en?"Dry run only":"仅模拟"):
         noUnreserved&&reserved?(en?"Already fully listed":"已全部挂单"):
         reserved?(en?"Existing LIVE SELL":"已有 LIVE SELL"):
         (en?"Ready for review":"可进入审核")}
      </p>
      <button type="button" disabled={!canReview} onClick={onReview}
        className="ui-button-trade-outline w-full px-3 py-2 text-xs disabled:cursor-not-allowed">
        {noUnreserved&&reserved?(en?"Already listed":"已全部挂单"):
         reserved?(en?"Review add SELL":"追加审核"):(en?"Review SELL":"审核 SELL")}
      </button>
      <p className="mt-1.5 text-[10px] text-slate-500">{en?"Manual signature only":"仅手动签名"}</p>
    </td>
  </tr>;
}
