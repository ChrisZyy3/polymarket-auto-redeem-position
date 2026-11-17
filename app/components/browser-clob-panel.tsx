"use client";
import { useEffect, useRef, useState } from "react";
import { useConnection, useSignTypedData } from "wagmi";
import { encodeAbiParameters,getAddress,getCreate2Address,keccak256,formatUnits } from "viem";
import { deriveClobCredentials, fetchBrowserOpenOrders, fetchConditionalBalance, type ClobCredentials, type ClobOrder } from "@/lib/browser-clob";
import type { EnrichedPosition } from "@/lib/types";
import { ManualSellReview, type SellReviewRequest } from "./manual-sell-review";
import { OpenOrdersTable } from "./open-orders-table";
import { reviewSellBalance } from "@/lib/sell-balance-review";

export function BrowserClobPanel({profileAddress,queryAddress,positions,language,activeMode,targetAprInputs,selectedAssets,proposedQuantities,onQuantityChange,reviewRequest,orderCenterRequest,onSnapshotChange}:{
 profileAddress:string|null;queryAddress:string;positions:EnrichedPosition[];language:"zh"|"en";
 activeMode:'yield'|'sell';targetAprInputs:Record<string,string>;
 selectedAssets:string[];proposedQuantities:Record<string,string>;onQuantityChange:(asset:string,value:string)=>void;
 reviewRequest:SellReviewRequest;orderCenterRequest:{serial:number;asset?:string}|null;
 onSnapshotChange:(next:{orders:ClobOrder[]|null;ready:boolean})=>void;
}){
 const en=language==="en",{address,isConnected,chainId}=useConnection(),{signTypedDataAsync}=useSignTypedData();
 const creds=useRef<ClobCredentials|null>(null),version=useRef(0),balanceVersion=useRef(0);
 const [selectedAsset,setSelectedAsset]=useState(""),[balance,setBalance]=useState<{asset:string;raw:string;asOf:number}|null>(null),[balanceBusy,setBalanceBusy]=useState(false),[balanceError,setBalanceError]=useState("");
 const [orders,setOrders]=useState<ClobOrder[]|null>(null),[ordersReady,setOrdersReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[time,setTime]=useState<number|null>(null);
 const [orderCenterOpen,setOrderCenterOpen]=useState(false),[orderCenterAsset,setOrderCenterAsset]=useState<string|null>(null);
 const centerSeen=useRef(0);
 useEffect(()=>{version.current++;balanceVersion.current++;creds.current=null;setOrders(null);setOrdersReady(false);setError("");setBusy(false);setTime(null);setBalance(null);setBalanceError("");setSelectedAsset("");setBalanceBusy(false);setOrderCenterOpen(false);onSnapshotChange({orders:null,ready:false});},[address,profileAddress,queryAddress,chainId]);
 useEffect(()=>{
   if(!orderCenterRequest||centerSeen.current===orderCenterRequest.serial)return;
   centerSeen.current=orderCenterRequest.serial;
   setOrderCenterAsset(orderCenterRequest.asset??null);setOrderCenterOpen(true);
 },[orderCenterRequest?.serial]);
 useEffect(()=>{if(reviewRequest)setOrderCenterOpen(false);},[reviewRequest?.serial]);
 useEffect(()=>{
   if(!orderCenterOpen)return;
   const original=document.body.style.overflow;document.body.style.overflow='hidden';
   function esc(e:KeyboardEvent){if(e.key==='Escape')setOrderCenterOpen(false);}
   document.addEventListener('keydown',esc);
   return()=>{document.body.style.overflow=original;document.removeEventListener('keydown',esc);};
 },[orderCenterOpen]);
 if(!isConnected||!address||!profileAddress)return activeMode==='sell'?<p className="px-4 py-3 text-xs text-slate-400">{en?'Connect a Polygon wallet to load open orders and enable reviewed SELL.':'连接 Polygon 钱包后可读取挂单并进入 SELL 审核；未连接时仍可模拟报价。'}</p>:null;
 const matches=profileAddress.toLowerCase()===queryAddress.trim().toLowerCase();
 async function read(){
  if(!address||!profileAddress||!matches||chainId!==137)return;
  const safe=getCreate2Address({from:"0xaacFeEa03eb1561C4e67d661e40682Bd20E3541b",salt:keccak256(encodeAbiParameters([{type:"address"}],[getAddress(address)])),bytecodeHash:"0x2bce2127ff07fb632d16c8347c4ebf501f4841168bed00d9e6ef715ddb6fcecf"});
  if(safe.toLowerCase()!==profileAddress.toLowerCase()){setError("safe_mismatch");return;}
  const current=++version.current;balanceVersion.current++;setOrdersReady(false);onSnapshotChange({orders,ready:false});setBusy(true);setError("");setBalance(null);setBalanceError("");setBalanceBusy(false);
  try{
   let session=creds.current;
   if(!session){
    const timestamp=Math.floor(Date.now()/1000);
    const signature=await signTypedDataAsync({domain:{name:"ClobAuthDomain",version:"1",chainId:137},types:{ClobAuth:[{name:"address",type:"address"},{name:"timestamp",type:"string"},{name:"nonce",type:"uint256"},{name:"message",type:"string"}]},primaryType:"ClobAuth",message:{address,timestamp:String(timestamp),nonce:0n,message:"This message attests that I control the given wallet"}});
    if(current!==version.current)return;
    session=await deriveClobCredentials(address,signature,timestamp);if(current!==version.current)return;creds.current=session;
   }
   const snapshot=await fetchBrowserOpenOrders(session,address,profileAddress);if(current!==version.current)return;setOrders(snapshot);setOrdersReady(true);onSnapshotChange({orders:snapshot,ready:true});setTime(Date.now());
  }catch(e){if(current===version.current){creds.current=null;setOrdersReady(false);onSnapshotChange({orders,ready:false});setError(e instanceof Error?e.message:"unknown");}}
  finally{if(current===version.current)setBusy(false);}
 }
 async function readBalance(){
  if(!creds.current||!address||!selectedAsset||busy||balanceBusy)return;
  const current=++balanceVersion.current, asset=selectedAsset;setBalanceBusy(true);setBalance(null);setBalanceError("");
  try{const result=await fetchConditionalBalance(creds.current,address,asset);if(current!==balanceVersion.current)return;setBalance({asset,raw:result.balance,asOf:Date.now()});}
  catch{if(current===balanceVersion.current)setBalanceError(en?"Unable to read balance; no quantity can be confirmed.":"余额读取失败，无法确认可卖数量。");}
  finally{if(current===balanceVersion.current)setBalanceBusy(false);}
 }

 const messages:Record<string,string>={
  safe_mismatch:en?"Safe does not match signer.":"签名地址与持仓 Safe 不匹配。",
  credentials_not_found:en?"Existing credentials not found.":"未找到已有 CLOB 凭据。",
  connection_or_cors:en?"CLOB connection unavailable.":"无法访问 CLOB。",
  incomplete_pagination:en?"Open order list incomplete.":"订单分页不完整，已停止展示。",
  maker_mismatch:en?"Order maker mismatch.":"订单所属 Safe 不匹配。",
  rate_limited:en?"CLOB request rate limited.":"CLOB 限流，请稍后重试。"
 };
 const currentOrders=orders??[];
 const visibleOrders=orderCenterAsset?currentOrders.filter(o=>o.asset_id===orderCenterAsset):currentOrders;
 return <>
  {activeMode==='sell'&&<div className="border-b border-slate-800 bg-slate-950/25 px-4 py-3 sm:px-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-100">{en?'CLOB connection & orders':'CLOB 连接与订单'}</p>
        <p className="mt-1 text-xs text-slate-400">{ordersReady&&!busy?(en?'Snapshot ready · '+currentOrders.length+' open orders':'已读取 '+currentOrders.length+' 笔 LIVE 挂单'):busy?(en?'Refreshing account orders…':'正在核对挂单快照…'):(en?'Read official orders before signing.':'签名前须读取并核对全部官方挂单。')}
        {time&&<span className="ml-2 text-slate-500">{new Date(time).toLocaleTimeString()}</span>}</p>
      </div>
      <div className="flex gap-2">
        <button type="button" disabled={busy||!matches||chainId!==137} onClick={()=>void read()}
          className="rounded-lg border border-cyan-500/40 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/10 disabled:opacity-40">
          {busy?(en?'Refreshing…':'读取中…'):(en?'Read / refresh orders':'读取 / 刷新挂单')}
        </button>
      </div>
    </div>
    {!matches&&<p className="mt-2 text-xs text-amber-300">{en?'Query the connected Safe first.':'当前查询地址与钱包 Safe 不匹配，请先切换查询账户。'}</p>}
    {chainId!==137&&<p className="mt-2 text-xs text-amber-300">{en?'Switch to Polygon.':'请切换至 Polygon。'}</p>}
    {error&&<p role="alert" className="mt-2 text-xs text-amber-300">{messages[error]??(en?'Order read failed.':'订单读取失败，不能按空单处理。')}</p>}
  </div>}
  {orders&&creds.current&&matches&&chainId===137&&
    <ManualSellReview key={address+'-'+profileAddress}
      address={address} funder={profileAddress} credentials={creds.current}
      positions={positions} orders={orders} language={language}
      ordersReady={ordersReady&&!busy} targetAprInputs={targetAprInputs}
      selectedAssets={selectedAssets} proposedQuantities={proposedQuantities}
      onQuantityChange={onQuantityChange} reviewRequest={reviewRequest}
      onOpenOrders={asset=>{setOrderCenterAsset(asset);setOrderCenterOpen(true);}}
      onOrdersRefresh={next=>{
        balanceVersion.current++;setBalanceBusy(false);setOrders(next);setOrdersReady(true);
        onSnapshotChange({orders:next,ready:true});
        setTime(Date.now());setBalance(null);setBalanceError("");
      }}
    />}
  {orderCenterOpen&&<div className="fixed inset-0 z-[85] flex justify-end bg-slate-950/70 backdrop-blur-sm"
    onMouseDown={e=>{if(e.target===e.currentTarget)setOrderCenterOpen(false);}}>
    <aside role="dialog" aria-modal="true" aria-label={en?'Order center':'订单中心'}
      className="flex h-full w-full max-w-[700px] flex-col overflow-hidden border-l border-slate-700 bg-[#0c1327] shadow-2xl">
      <header className="flex shrink-0 items-center justify-between border-b border-slate-700 p-4">
        <div><h3 className="text-lg font-semibold text-slate-100">{en?'Order center':'订单中心'}</h3>
          <p className="mt-1 text-xs text-slate-400">{en?'All official LIVE orders · includes orders without current positions.':'全部 LIVE 挂单，包含已无持仓的 BUY / SELL。'}</p></div>
        <button type="button" aria-label={en?'Close order center':'关闭订单中心'} onClick={()=>setOrderCenterOpen(false)}
          className="rounded-lg border border-slate-600 px-3 py-2 text-slate-200 hover:bg-slate-800">✕</button>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {!ordersReady&&<p role="alert" className="rounded-lg border border-amber-500/30 p-3 text-xs text-amber-300">
          {en?'Order snapshot is unavailable or refreshing.':'挂单快照尚未准备好或正在刷新，不能认为列表完整。'}
        </p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-slate-400">{en?'Current LIVE orders':'当前未成交订单'}：{currentOrders.length}</span>
          <div className="flex gap-2">
            {orderCenterAsset&&<button type="button" onClick={()=>setOrderCenterAsset(null)}
              className="rounded border border-slate-600 px-2 py-1 text-xs text-cyan-200">{en?'Show all markets':'查看全部市场'}</button>}
            <button type="button" disabled={busy||!matches||chainId!==137} onClick={()=>void read()}
              className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-200 disabled:opacity-40">{en?'Refresh':'刷新挂单'}</button>
          </div>
        </div>
        <OpenOrdersTable orders={visibleOrders} positions={positions} language={language}/>
        {orders&&<details className="rounded-lg border border-slate-700 p-3 text-xs text-slate-300">
          <summary className="cursor-pointer font-semibold text-slate-100">{en?'Advanced: compare CLOB balance':'高级核对 · CLOB 余额'}</summary>
          <p className="mt-2 text-amber-300">{en?'Balance shown is not executable quantity until validated.':'以下为只读快照差额，并非可执行份额；下单时仍需独立核查链上余额和授权。'}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <select aria-label={en?'Select position':'选择核对仓位'} disabled={busy||balanceBusy}
              className="max-w-full rounded border border-slate-600 bg-slate-950 p-2"
              value={selectedAsset} onChange={e=>{balanceVersion.current++;setBalance(null);setSelectedAsset(e.target.value);}}>
              <option value="">{en?'Choose position':'选择仓位'}</option>
              {positions.filter(p=>!p.redeemable).map(p=><option key={p.asset} value={p.asset}>{p.title} · {p.outcome}</option>)}
            </select>
            <button type="button" disabled={!selectedAsset||balanceBusy||busy} onClick={()=>void readBalance()}
              className="rounded border border-cyan-500/40 px-3 py-2 text-cyan-200 disabled:opacity-40">{en?'Read balance':'读取余额'}</button>
          </div>
          {balanceError&&<p role="alert" className="mt-2 text-amber-300">{balanceError}</p>}
          {balance&&<div className="mt-3 space-y-1">
            <p>{en?'CLOB balance':'CLOB 余额'}：{formatUnits(BigInt(balance.raw),6)}</p>
            {(()=>{const comp=reviewSellBalance(balance.raw,balance.asset,orders);
              return <><p>{en?'Observed SELL reservation':'已读取 SELL 占用'}：{comp?formatUnits(comp.reserved,6):'—'}</p>
                <p>{en?'Snapshot difference':'快照差额'}：{comp?.remainder!=null?formatUnits(comp.remainder,6):'—'}</p></>;
            })()}
          </div>}
        </details>}
      </div>
    </aside>
  </div>}
 </>;
}
