"use client";
import { useEffect, useMemo, useState } from 'react';
import type { ClobOrder } from '@/lib/browser-clob';
import type { EnrichedPosition } from '@/lib/types';
import type { OrderMarketMetadata } from '@/lib/order-market';
import { groupOpenOrders } from '@/lib/open-order-groups';
import { openOrderStatus } from '@/lib/order-review-status';

export function OpenOrdersTable({orders,positions,language}:{orders:ClobOrder[];positions:EnrichedPosition[];language:'zh'|'en'}){
 const en=language==='en';
 const [metadata,setMetadata]=useState<Record<string,OrderMarketMetadata>>({});
 const orphanAssets=useMemo(()=>{
  const known=new Set(positions.map(p=>p.asset));
  return [...new Set(orders.map(o=>o.asset_id))].filter(token=>!known.has(token)).slice(0,25);
 },[orders,positions]);
 useEffect(()=>{
  if(orphanAssets.length===0)return;
  const abort=new AbortController();let disposed=false;
  setMetadata({});
  async function resolve(){
   for(let i=0;i<orphanAssets.length;i+=4){
    if(disposed)break;
    await Promise.all(orphanAssets.slice(i,i+4).map(async token=>{
     try{const r=await fetch('/api/order-market?tokenId='+encodeURIComponent(token),{signal:abort.signal});if(!r.ok)return;
      const body:unknown=await r.json();
      if(body&&typeof body==='object'&&'market' in body){
       const market=(body as {market?:OrderMarketMetadata}).market;
       if(market&&market.conditionId&&market.title&&!disposed)setMetadata(old=>({...old,[token]:market}));
      }
     }catch{/* Keep unresolved token legible rather than inventing a question. */}
    }));
   }
  }
  void resolve();return ()=>{disposed=true;abort.abort();};
 },[orphanAssets]);
 const groups=useMemo(()=>groupOpenOrders(orders,positions,metadata),[orders,positions,metadata]);
 const shares=(n:number)=>n.toLocaleString(undefined,{maximumFractionDigits:6});
 return <div className="mt-3 space-y-2">
  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
   <span>{en?orders.length+' open orders in '+groups.length+' markets':orders.length+' 笔未成交订单 · '+groups.length+' 个市场'}</span>
   {orphanAssets.length>0&&<span>{en?'Unheld orders are matched using verified Gamma token IDs.':'未持仓的挂单通过 Gamma Token ID 精确匹配市场标题。'}</span>}
  </div>
  {groups.map(g=><div key={g.key} className="overflow-hidden rounded-lg border border-slate-700/80">
   <div className="flex items-center justify-between gap-2 bg-slate-800/50 px-3 py-2 text-sm font-semibold text-slate-100">
    {g.slug?<a href={'https://polymarket.com/event/'+encodeURIComponent(g.slug)} target="_blank" rel="noreferrer" className="min-w-0 truncate hover:text-cyan-300">{g.title}</a>:<span className="min-w-0 truncate">{g.title==='Unidentified market'?(en?'Unidentified market':'市场暂未识别'):g.title}</span>}
    <span className="shrink-0 text-xs font-normal text-slate-400">{g.items.length} {en?'orders':'笔'}</span>
   </div>
   <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-xs tabular-nums">
    <thead className="bg-slate-900/50 text-slate-400"><tr><th className="px-3 py-2">{en?'Action / outcome':'方向 / 结果'}</th><th className="px-3 py-2">{en?'Limit price':'限价'}</th><th className="px-3 py-2">{en?'Filled / total':'已成交 / 总份额'}</th><th className="px-3 py-2">{en?'Remaining':'未成交'}</th><th className="px-3 py-2">{en?'Status':'状态'}</th></tr></thead>
    <tbody>{g.items.map(({order,outcome,tokenLabel})=>{const filled=Number(order.size_matched),total=Number(order.original_size),partial=openOrderStatus(order)==='partially_filled';
     return <tr key={order.id} className="border-t border-slate-800/90 text-slate-200">
      <td className="px-3 py-2"><span className={order.side==='SELL'?'font-semibold text-rose-300':'font-semibold text-cyan-300'}>{order.side}</span> <span className="ml-1 text-slate-300">{outcome||tokenLabel}</span>
       {!outcome&&<div title={order.asset_id} className="text-[11px] text-slate-500">Token: {tokenLabel}</div>}
      </td>
      <td className="px-3 py-2">{order.price}</td>
      <td className="px-3 py-2">{shares(filled)} / {shares(total)}</td>
      <td className="px-3 py-2 font-semibold">{shares(total-filled)}</td>
      <td className="px-3 py-2">{partial?(en?'Partially filled':'部分成交'):(en?'Open':'未成交')}</td>
     </tr>;
    })}</tbody>
   </table></div>
  </div>)}
  {orders.length===0&&<p className="p-3 text-xs text-slate-400">{en?'No live orders returned; confirm full account coverage.':'未读取到 LIVE 订单；仍需核对账户挂单覆盖范围。'}</p>}
 </div>;
}
