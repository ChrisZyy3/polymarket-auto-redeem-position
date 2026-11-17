"use client";
import { useEffect, useRef, useState } from 'react';
import { useWalletClient } from 'wagmi';
import type { ClobCredentials } from '@/lib/browser-clob';
import { loadSellReview } from '@/lib/sell-snapshot';
import type { EnrichedPosition } from '@/lib/types';

type Snapshot=Awaited<ReturnType<typeof loadSellReview>>;
export function ManualSellReview({address,funder,credentials,positions,language}:{address:string;funder:string;credentials:ClobCredentials;positions:EnrichedPosition[];language:'zh'|'en'}) {
 const en=language==='en', {data:wallet}=useWalletClient();
 const [asset,setAsset]=useState(''),[apr,setApr]=useState('12'),[quantity,setQuantity]=useState(''),[coverage,setCoverage]=useState(false),[settlement,setSettlement]=useState(false),[review,setReview]=useState<Snapshot|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const generation=useRef(0),lock=useRef(false);
 useEffect(()=>()=>{generation.current++},[address,funder]);
 function reset(){generation.current++;setReview(null);setMessage('');}
 function input(){return {credentials,signer:address,funder,asset,apr:Number(apr),quantity:Number(quantity),coverageConfirmed:coverage,settlementConfirmed:settlement};}
 async function prepare(){if(lock.current)return;lock.current=true;const g=++generation.current;setBusy(true);setReview(null);setMessage('');try{const snapshot=await loadSellReview(input());if(g===generation.current)setReview(snapshot);}catch{if(g===generation.current)setMessage(en?'Unable to refresh all data; no order prepared.':'刷新数据失败，未生成订单。');}finally{lock.current=false;if(g===generation.current)setBusy(false);}}
 async function execute(){
  if(lock.current||!review||review.result.status!=='review'||!wallet||Date.now()-review.asOf>60000)return;
  lock.current=true;const g=generation.current;setBusy(true);setMessage('');let posting=false;
  try{
   if(wallet.account.address.toLowerCase()!==address.toLowerCase()||wallet.chain?.id!==137)throw Error('wallet_changed');
   const {createSafeSellClient}=await import('@/lib/secure-sell-client');
   const fresh=await loadSellReview(input());
   if(g!==generation.current||fresh.result.status!=='review'||fresh.result.price!==review.result.price||fresh.result.quantity!==review.result.quantity||fresh.position.endDate!==review.position.endDate)throw Error('review_changed');
   const client=await createSafeSellClient(wallet,funder,credentials);
   if(g!==generation.current)throw Error('wallet_changed');
   const signed=await client.sign(asset,review.result.price,review.result.quantity,review.result.expirationSec);
   if(g!==generation.current)throw Error('wallet_changed');
   const final=await loadSellReview(input());
   if(g!==generation.current||final.result.status!=='review'||final.result.price!==review.result.price||final.result.quantity!==review.result.quantity||final.position.endDate!==review.position.endDate||Date.now()-review.asOf>60000)throw Error('review_changed');
   posting=true;
   const response=await client.post(signed);
   if(g===generation.current){setReview(null);setMessage(response.ok?(en?`Accepted: ${response.orderId}. Refresh open orders to confirm.`:`订单已受理：${response.orderId}。请刷新挂单并核对。`):(en?'Order rejected; check open orders before retrying.':'订单被拒绝，请先核对挂单再重试。'));}
  }catch(e){if(g===generation.current){setReview(null);setMessage(posting?(en?'Submission outcome unknown; check open orders before any retry.':'提交结果不确定，请先核对挂单，切勿直接重试。'):(en?'Signing or validation failed; no order was submitted.':'签名或复核未通过，未提交订单。'));}}
  finally{lock.current=false;if(g===generation.current)setBusy(false);}
 }
 const edit=(f:()=>void)=>{reset();f();};
 return <section className="mt-4 rounded-xl border border-indigo-400/30 bg-indigo-500/5 p-4"><h3 className="font-semibold text-slate-100">{en?'Manual sell review':'人工审核卖单'}</h3><p className="mt-1 text-xs text-slate-400">{en?'Refreshes orders, balance and order book before and after signing. Seven-day GTD, post-only.':'签名前后刷新挂单、余额及盘口；7 天 GTD、Post-Only。仅支持当前连接的 Safe。'}</p>
 <div className="mt-3 grid gap-2 sm:grid-cols-3"><label className="text-xs text-slate-400">{en?'Position':'仓位'}<select disabled={busy} value={asset} onChange={e=>edit(()=>setAsset(e.target.value))} className="mt-1 w-full rounded border border-slate-600 bg-slate-950 p-2 text-sm text-slate-100"><option value="">{en?'Select':'请选择'}</option>{positions.filter(p=>!p.redeemable).map(p=><option key={p.asset} value={p.asset}>{p.title} · {p.outcome}</option>)}</select></label><label className="text-xs text-slate-400">{en?'Target APR (%)':'目标 APR（%）'}<input disabled={busy} value={apr} onChange={e=>edit(()=>setApr(e.target.value))} type="number" min="0.1" className="mt-1 w-full rounded border border-slate-600 bg-slate-950 p-2 text-sm text-slate-100"/></label><label className="text-xs text-slate-400">{en?'Shares':'卖出份额'}<input disabled={busy} value={quantity} onChange={e=>edit(()=>setQuantity(e.target.value))} type="number" min="0" className="mt-1 w-full rounded border border-slate-600 bg-slate-950 p-2 text-sm text-slate-100"/></label></div>
 <div className="mt-3 space-y-2 text-xs text-slate-300"><label className="flex gap-2"><input disabled={busy} type="checkbox" checked={coverage} onChange={e=>edit(()=>setCoverage(e.target.checked))}/>{en?'I checked that the displayed open orders match all account orders.':'我已核对官网，当前读取的挂单覆盖此账户全部未成交订单。'}</label><label className="flex gap-2"><input disabled={busy} type="checkbox" checked={settlement} onChange={e=>edit(()=>setSettlement(e.target.checked))}/>{en?'I reviewed the estimated settlement date and accept the pricing assumption.':'我已核对该市场的预计结算日期，理解其可能变化并影响 APR 定价。'}</label></div>
 <button disabled={busy||!asset||!coverage||!settlement} onClick={()=>void prepare()} className="mt-3 rounded border border-indigo-400/50 px-3 py-2 text-sm text-indigo-200 disabled:opacity-50">{busy?(en?'Working…':'处理中…'):(en?'Refresh and review':'刷新并生成审核单')}</button>
 {review&&(review.result.status==='blocked'?<p role="alert" className="mt-2 text-xs text-amber-300">{en?'Blocked':'暂不可下单'}: {review.result.reasons.join(', ')}</p>:<div className="mt-3 rounded-lg border border-amber-400/30 bg-slate-950/60 p-3 text-sm text-slate-200"><p className="font-semibold">{review.position.title} · {review.position.outcome}</p><p className="mt-1">SELL {review.result.quantity} @ {review.result.price} · GTD · Post-Only</p><p className="mt-1 text-xs text-slate-400">{en?'Gross proceeds at limit':'限价预计卖出总额'}: ${(review.result.quantity*review.result.price).toFixed(4)} · {en?'Expires':'订单到期'}: {new Date(review.result.expirationSec*1000).toLocaleString()}</p><p className="mt-1 text-xs text-slate-400">{en?'Estimated settlement':'预计结算日'}: {review.position.endDate} · {en?'Outstanding SELL':'已有 SELL'}: {Number(review.comparison.reserved)/1e6} · {en?'Snapshot remainder':'快照差额'}: {Number(review.comparison.remainder)/1e6}</p><p className="mt-1 text-xs text-amber-300">{en?'Review expires after 60 seconds. A signed order is submitted only after a second validation.':'审核单 60 秒后失效。点击后需在钱包签名；签名后复核通过才提交。'}</p><button disabled={busy||!wallet} onClick={()=>void execute()} className="mt-3 rounded bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{en?'Sign and submit SELL':'签名并提交 SELL'}</button></div>)}
 {message&&<p role="status" className="mt-3 break-all text-xs text-amber-200">{message}</p>}</section>;
}
