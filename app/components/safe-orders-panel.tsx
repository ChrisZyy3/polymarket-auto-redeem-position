"use client";
import { useEffect, useRef, useState } from "react";
import { useConnection, useSignMessage } from "wagmi";
import { orderAccessMessage } from "@/lib/safe-order-access";
import type { EnrichedPosition } from "@/lib/types";

type Order={id:string;asset_id:string;side:string;price:string;original_size:string;size_matched:string};
type Snapshot={complete:true;asOf:number;mappingStatus:string;orders:Order[]};
export function SafeOrdersPanel({profileAddress,queryAddress,positions,language}:{profileAddress:string|null;queryAddress:string;positions:EnrichedPosition[];language:"zh"|"en"}) {
  const en=language==="en", {address,isConnected,chainId}=useConnection(), {signMessageAsync}=useSignMessage();
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null), [error,setError]=useState(""), [busy,setBusy]=useState(false);
  const version=useRef(0);
  useEffect(()=>{version.current++;setSnapshot(null);setError("");setBusy(false);},[address,profileAddress,queryAddress]);
  if(!isConnected || !address || !profileAddress) return null;
  const matches=profileAddress.toLowerCase()===queryAddress.trim().toLowerCase();
  async function load() {
    if (!address || !profileAddress || !matches || chainId!==137) return;
    const current=++version.current; setBusy(true);setError("");setSnapshot(null);
    try {
      const availability=await fetch("/api/safe-open-orders",{cache:"no-store"});
      const availabilityBody=await availability.json();
      if(current!==version.current)return;
      if(!availability.ok || !availabilityBody.configured) throw new Error("reader_not_configured");
      const nonce=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,"0")).join("");
      const proof={signer:address,funder:profileAddress,origin:window.location.origin,issuedAt:Date.now(),nonce};
      const signature=await signMessageAsync({message:orderAccessMessage(proof)});
      if(current!==version.current)return;
      const response=await fetch("/api/safe-open-orders",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...proof,signature}),cache:"no-store"});
      const result=await response.json(); if(current!==version.current)return;
      if(!response.ok || result.complete!==true || !Array.isArray(result.orders)) throw new Error(result.error || "reader_unavailable");
      setSnapshot(result);
    } catch(e) { if(current===version.current) setError(e instanceof Error?e.message:"reader_unavailable"); }
    finally { if(current===version.current)setBusy(false); }
  }
  const displayError=error==="reader_not_configured"||error==="wallet_not_configured" ? (en?"Order reader or wallet credentials are not configured.":"订单读取服务或此钱包的 CLOB 凭据尚未配置。") : error==="invalid_wallet_proof" ? (en?"Safe address or wallet proof did not match.":"Safe 地址或钱包签名验证失败。") : (en?"Unable to read orders or signature was cancelled. Try again.":"订单读取失败或签名已取消，请检查后重试。");
  return <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/55 p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-slate-100">{en?"Open orders · read only":"已有挂单 · 只读"}</h2><p className="mt-1 text-xs text-slate-400">{en?"Wallet signature authorizes this order read, not a trade.":"需要钱包消息签名验证，只读取挂单，不会下单或撤单。"}</p></div><button type="button" disabled={busy||!matches||chainId!==137} onClick={()=>void load()} className="rounded-lg border border-cyan-500/40 px-3 py-2 text-sm text-cyan-200 disabled:opacity-50">{busy?(en?"Reading…":"读取中…"):(en?"Read open orders":"读取已有挂单")}</button></div>
    {!matches && <p className="mt-2 text-xs text-amber-300">{en?"Analyze the connected wallet's position address first.":"当前查询地址与连接的钱包不一致，请先查询连接钱包的持仓地址。"}</p>}
    {chainId!==137 && <p className="mt-2 text-xs text-amber-300">{en?"Switch wallet to Polygon first.":"请先切换钱包至 Polygon。"}</p>}
    {error && <p role="alert" className="mt-2 text-sm text-amber-300">{displayError}</p>}
    {snapshot && <div className="mt-4 overflow-x-auto"><p className="mb-2 text-xs text-slate-400">{en?"Snapshot":"快照"}: {new Date(snapshot.asOf*1000).toLocaleString()} · {en?"Read only; available shares not verified.":"只读数据，可卖份额尚未核实。"}</p>{snapshot.mappingStatus!=="observed" && <p className="mb-2 text-xs text-amber-300">{en?"No matching orders; wallet mapping cannot be verified from an empty result.":"没有匹配订单；空结果无法验证钱包地址映射。"}</p>}<table className="w-full min-w-[600px] text-left text-sm"><thead className="text-slate-400"><tr><th>{en?"Market / Outcome":"市场 / 方向"}</th><th>{en?"Side":"方向"}</th><th>{en?"Price":"挂单价"}</th><th>{en?"Remaining":"未成交份额"}</th></tr></thead><tbody>{snapshot.orders.map(o=>{const p=positions.find(x=>x.asset===o.asset_id);return <tr key={o.id} className="border-t border-slate-800"><td className="py-2">{p?`${p.title} · ${p.outcome}`:o.asset_id}</td><td>{o.side}</td><td>{o.price}</td><td>{(Number(o.original_size)-Number(o.size_matched)).toLocaleString(undefined,{maximumFractionDigits:6})}</td></tr>;})}</tbody></table>{snapshot.orders.length===0 && <p className="py-3 text-sm text-slate-400">{en?"No open orders returned.":"未返回未成交订单。"}</p>}</div>}
  </section>;
}
