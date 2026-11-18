"use client";

import type { EnrichedPosition } from "@/lib/types";
import type { ClobOrder } from "@/lib/browser-clob";
import type { PositionQuote } from "@/lib/position-quote";
import { buildMarkAutoSellPlan } from "@/lib/auto-sell-plan";
import { observedSellShares } from "@/lib/order-review-status";
import { indicativeUnreservedShares } from "@/lib/manual-sell-queue";
import { formatMarketPercentForTick } from "@/lib/price-format";
import { normalizeSdkSellShares } from "@/lib/sdk-sell-quantity";

export function getSellWorkspaceNumbers(position:EnrichedPosition,quote:PositionQuote|null,aprInput:string,quantityInput:string|undefined,orders:ClobOrder[]|null,ordersReady:boolean){
  // The no-wallet mode is DRY RUN only. Never claim that portfolio holdings
  // equal the CLOB-confirmed amount available to sign and sell.
  const openSell=ordersReady&&orders?observedSellShares(orders,position.asset):null;
  const indicative=ordersReady&&orders?indicativeUnreservedShares(position.size,position.asset,orders):null;
  const quantity=quantityInput??String(indicative??position.size);
  const targetApr=Number(aprInput);
  const validApr=aprInput.trim().length>0&&Number.isFinite(targetApr)&&targetApr>0&&targetApr<=10000;
  const normalized=quantity.trim()?normalizeSdkSellShares(Number(quantity)):null;
  const validQuantity=quantity.trim().length>0&&normalized!==null;
  const noUnreserved=ordersReady&&indicative!==null&&indicative<0.01;
  const canReview=ordersReady&&indicative!==null&&indicative>=0.01&&validApr&&validQuantity
    &&normalized!==null&&normalized<=indicative+1e-8;
  const plan=quote&&validApr&&validQuantity?buildMarkAutoSellPlan({
    quote,targetAprPercent:targetApr,quantity:Number(quantity),avgPrice:position.avgPrice,redeemable:position.redeemable
  }):null;
  return {openSell,indicative,quantity,plan,validApr,validQuantity,canReview,noUnreserved};
}

type Props={
 position:EnrichedPosition;language:"zh"|"en";aprInput:string;quantityInput:string|undefined;
 quote:PositionQuote|null;orders:ClobOrder[]|null;ordersReady:boolean;selected:boolean;
 onAprChange:(value:string)=>void;onQuantityChange:(value:string)=>void;onSelect:(checked:boolean)=>void;
 onReview:()=>void;onOpenOrders:()=>void;onRefreshQuote:()=>void;
};
const fmtShares=(v:number)=>v.toLocaleString(undefined,{maximumFractionDigits:6});
export function SellPlanRow({position,language,aprInput,quantityInput,quote,orders,ordersReady,selected,onAprChange,onQuantityChange,onSelect,onReview,onOpenOrders,onRefreshQuote}:Props){
 const en=language==="en";
 const {openSell,indicative,quantity,plan,validApr,validQuantity,canReview,noUnreserved}=getSellWorkspaceNumbers(position,quote,aprInput,quantityInput,orders,ordersReady);
 const price=plan?.proposedLimitPrice;
 const priceText=price!=null?formatMarketPercentForTick(price,quote?.tickSize??null):"—";
 const existingCount=ordersReady?(orders??[]).filter(o=>o.asset_id===position.asset&&o.side==="SELL").length:0;
 return <tr className={selected ? "border-b border-slate-700/20 bg-cyan-900/10 align-middle text-slate-200" : "border-b border-slate-700/20 align-middle text-slate-200 hover:bg-slate-800/25"}>
   <td className="px-2 py-3">
     <input type="checkbox" aria-label={(en?"Select ":"勾选 ")+position.title} checked={selected} disabled={position.redeemable}
       className="accent-cyan-300" onChange={e=>onSelect(e.target.checked)}/>
   </td>
   <td className="max-w-[290px] min-w-[200px] px-3 py-3">
     {position.eventSlug||position.slug?<a href={"https://polymarket.com/event/"+encodeURIComponent(position.eventSlug||position.slug||"")}
       target="_blank" rel="noreferrer" className="line-clamp-2 font-semibold text-slate-100 hover:text-cyan-300" title={position.title}>{position.title}</a>:
       <p className="line-clamp-2 font-semibold text-slate-100" title={position.title}>{position.title}</p>}
     <p className="mt-0.5 text-xs text-indigo-300">{position.outcome}</p>
   </td>
   <td className="whitespace-nowrap px-2 py-3 tabular-nums">{position.markApr==null?"—":(position.markApr*100).toFixed(2)+"%"}</td>
   <td className="px-2 py-3">
     <input type="number" min="0.1" max="10000" step="0.1" aria-label={position.title+" Target APR"}
       value={aprInput} onChange={e=>onAprChange(e.target.value)}
       className={"ui-input w-20 px-2 py-2 text-sm "+(validApr?"":"border-amber-400")}/>
   </td>
   <td className="whitespace-nowrap px-2 py-3">
     {quote?<><p className="font-bold text-cyan-200 tabular-nums">{priceText}</p>
       <p className="text-[11px] text-slate-500">{plan?.status==="would_cross"?(en?"Taker risk":"可能吃单"):en?"Simulation":"模拟参考"}</p></>
       :<button type="button" onClick={onRefreshQuote} className="text-xs text-cyan-300 underline underline-offset-2">{en?"Fetch quote":"刷新报价"}</button>}
   </td>
   <td className="whitespace-nowrap px-2 py-3 tabular-nums">
     <p>{fmtShares(position.size)} <span className="text-[11px] text-slate-500">{en?"held":"持仓"}</span></p>
     {openSell===null?<p className="text-xs text-slate-500">{en?"SELL unverified":"SELL 未核对"}</p>:
       openSell>0?<button type="button" onClick={onOpenOrders} className="text-xs text-amber-300 underline underline-offset-2">
        {en?"SELL ":"已有 SELL "}{fmtShares(openSell)}{existingCount>0?" ("+existingCount+")":""}
       </button>:<p className="text-xs text-slate-500">{en?"No SELL orders":"无 SELL 挂单"}</p>}
   </td>
   <td className="px-2 py-3">
     <input type="number" min="0" step="any" aria-label={position.title+" SELL shares"}
       value={quantity} onChange={e=>onQuantityChange(e.target.value)} disabled={position.redeemable}
       className={"ui-input w-28 px-2 py-2 text-sm "+(validQuantity?"":"border-amber-400")}/>
     <p className="mt-1 text-[10px] text-slate-500">{indicative!==null?(en?"Indicative max ":"模拟剩余 ")+fmtShares(indicative):(en?"DRY RUN shares":"DRY RUN 数量")}</p>
     {ordersReady&&!canReview&&<p className="mt-1 text-[10px] text-amber-300">{
       noUnreserved?(en?"No unreserved SELL shares":"剩余可卖份额已被占用"):
       indicative===null?(en?"Share balance needs verification":"份额余额待核对"):
       validQuantity&&indicative!==null&&Number(quantity)>indicative?(en?"Exceeds unreserved shares":"超过模拟可用份额"):
       !validQuantity?(en?"Minimum 0.01 share":"SELL 至少 0.01 份"):(en?"Check APR / quantity":"核对 APR 与份额")
     }</p>}
   </td>
   <td className="whitespace-nowrap px-2 py-3 text-xs">
     {position.redeemable?<span className="text-emerald-300">{en?"Redeemable":"可赎回"}</span>:
      !ordersReady?<span className="text-amber-300">{en?"DRY RUN":"仅模拟"}</span>:
      <span className={openSell!==null&&openSell>0?"text-amber-300":"text-slate-300"}>{noUnreserved&&openSell!==null&&openSell>0?(en?"Already fully listed":"已全部挂单"):indicative===null?(en?"Verify balance":"余额待核对"):openSell!==null&&openSell>0?(en?"Existing SELL order":"已有 SELL 挂单"):(en?"Ready to review":"可进入审核")}</span>}
   </td>
   <td className="px-3 py-3">
     <button type="button" disabled={!canReview||position.redeemable}
       onClick={onReview} className="ui-button-trade-outline px-3 py-2 text-xs disabled:cursor-not-allowed">
       {noUnreserved&&openSell!==null&&openSell>0?(en?"Already listed":"已全部挂单"):openSell!==null&&openSell>0?(en?"Review add SELL":"追加审核"):(en?"Review SELL":"审核 SELL")}
     </button>
   </td>
 </tr>;
}
