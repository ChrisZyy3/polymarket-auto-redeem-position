"use client";

import { useEffect, useRef, useState } from 'react';
import { usePublicClient, useWalletClient } from 'wagmi';
import type { Address } from 'viem';
import { fetchBrowserOpenOrders, type ClobCredentials, type ClobOrder } from '@/lib/browser-clob';
import { buildMarkAutoSellPlan } from '@/lib/auto-sell-plan';
import type { PositionQuote } from '@/lib/position-quote';
import { observedSellShares } from '@/lib/order-review-status';
import {
  indicativeUnreservedShares, nextReviewAsset, pendingAttemptKey, isCurrentPendingAttempt,
  sameSellIntent, matchingLiveSellOrder, matchingPendingOpenSell, persistedAcceptedOrder,
  type QueueRecord, displayedSellQueueRecord
} from '@/lib/manual-sell-queue';
import { loadSellReview } from '@/lib/sell-snapshot';
import { sellQueueStatusLabel } from '@/lib/sell-queue-status';
import { settlementConfirmedForDate, nextAfterVerifiedSell, sellReviewConfigKey, sellQuantityForPercent, sellLimitSummary } from '@/lib/sell-workbench-flow';
import type { EnrichedPosition } from '@/lib/types';

type Snapshot = Awaited<ReturnType<typeof loadSellReview>>;
type Draft = { apr?: string; quantity?: string };
type Props = {
  address: string; funder: string; credentials: ClobCredentials;
  positions: EnrichedPosition[]; orders: ClobOrder[]; language: 'zh' | 'en';
  onOrdersRefresh?: (next: ClobOrder[]) => void;
};
const erc1155ApprovalAbi = [{
  type: 'function', name: 'isApprovedForAll', stateMutability: 'view',
  inputs: [{name:'account',type:'address'},{name:'operator',type:'address'}],
  outputs: [{name:'',type:'bool'}]
}] as const;
const showShares = (n: number) => Number.isFinite(n) ? n.toLocaleString(undefined,{maximumFractionDigits:6}) : '—';

export function ManualSellReview({address,funder,credentials,positions,orders,language,onOrdersRefresh}: Props) {
  const en = language === 'en';
  const {data:wallet} = useWalletClient();
  const publicClient = usePublicClient({chainId:137});
  const [selected,setSelected] = useState<string[]>([]);
  const [globalApr,setGlobalApr] = useState('12');
  const [drafts,setDrafts] = useState<Record<string,Draft>>({});
  const [coverage,setCoverage] = useState(false);
  // Store the exact date confirmed for each market. If the date changes, it must be confirmed again.
  const [settlementDates,setSettlementDates] = useState<Record<string,string>>({});
  const [active,setActive] = useState<string|null>(null);
  const [review,setReview] = useState<Snapshot|null>(null);
  const [busy,setBusy] = useState(false);
  const [quoteBusy,setQuoteBusy] = useState(false);
  const [clock,setClock] = useState(Date.now());
  const [quotes,setQuotes] = useState<Record<string,PositionQuote|null>>({});
  const [queue,setQueue] = useState<Record<string,QueueRecord>>({});
  const [message,setMessage] = useState('');
  const [uncertain,setUncertain] = useState(false);
  const [pending,setPending] = useState(false);
  const generation=useRef(0), lock=useRef(false);
  const previousConfirm=useRef('');
  const [reviewSignature,setReviewSignature]=useState('');
  const batchIds=useRef<string[]|null>(null);
  const [batchMode,setBatchMode]=useState(false);
  const closeButton=useRef<HTMLButtonElement|null>(null);
  const dialogRef=useRef<HTMLElement|null>(null);
  const pendingKey = pendingAttemptKey(address,funder);
  const tradable = positions.filter(p=>!p.redeemable && p.size>0);
  const activePosition=tradable.find(p=>p.asset===active);
  const activeDraft=active ? drafts[active] : undefined;
  const activeApr=activeDraft?.apr ?? globalApr;
  const activeQuantity=activePosition ? (activeDraft?.quantity ?? String(indicativeUnreservedShares(activePosition.size,activePosition.asset,orders) ?? '')) : '';
  const activeSettled=!!activePosition && settlementConfirmedForDate(settlementDates[activePosition.asset],activePosition.endDate);

  useEffect(()=>{
    try {
      const raw=localStorage.getItem(pendingKey);
      const hasPending=isCurrentPendingAttempt(raw,address,funder);
      setUncertain(hasPending);setPending(hasPending);
    } catch {setUncertain(true);setPending(true);}
    return ()=>{generation.current++;};
  },[pendingKey,address,funder]);

  useEffect(()=>{
    try {
      const matched=matchingPendingOpenSell(localStorage.getItem(pendingKey),address,funder,orders);
      if(matched){
        localStorage.removeItem(pendingKey);
        if(localStorage.getItem(pendingKey)!==null)return;
        setUncertain(false);setPending(false);
        setQueue(old=>({...old,[matched.asset_id]:{
          status:Number(matched.size_matched)>0?'partially_filled':'open',
          orderId:matched.id,updatedAt:Date.now()
        }}));
      }
    }catch {/* Uncertain submissions remain blocked when storage or order reconciliation fails. */}
  },[pendingKey,address,funder,orders]);

  useEffect(()=>{
    if(!active)return;
    const old=document.body.style.overflow;
    document.body.style.overflow='hidden';
    closeButton.current?.focus();
    const interval=window.setInterval(()=>setClock(Date.now()),5000);
    function onKey(event:KeyboardEvent){
      if(event.key==='Escape'&&!lock.current)leaveReview();
      if(event.key==='Tab'){
        const elements=dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href], select:not([disabled])');
        if(!elements?.length)return;
        const first=elements[0],last=elements[elements.length-1];
        if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
      }
    }
    window.addEventListener('keydown',onKey);
    return ()=>{document.body.style.overflow=old;window.clearInterval(interval);window.removeEventListener('keydown',onKey);};
  },[active]);

  function positionFor(id:string){return tradable.find(p=>p.asset===id);}
  function isSettled(id:string){const p=positionFor(id);return !!p&&settlementConfirmedForDate(settlementDates[id],p.endDate);}
  function draftFor(id:string){
    const p=positionFor(id);
    return {
      apr: drafts[id]?.apr ?? globalApr,
      quantity: drafts[id]?.quantity ?? String(p ? indicativeUnreservedShares(p.size,id,orders)??'' : '')
    };
  }
  function updateDraft(id:string,change:Draft){
    setDrafts(old=>({...old,[id]:{...old[id],...change}}));
    setQuotes(old=>({...old,[id]:null}));
    if(id===active){generation.current++;setReview(null);setReviewSignature('');setMessage('');}
  }
  function status(id:string,state:QueueRecord['status'],reason?:string,orderId?:string){
    setQueue(old=>({...old,[id]:{status:state,reason,orderId,updatedAt:Date.now()}}));
  }
  function clearPending(){
    try{
      localStorage.removeItem(pendingKey);
      if(localStorage.getItem(pendingKey)!==null)throw Error('storage_not_cleared');
      setPending(false);setUncertain(false);return true;
    }catch{setPending(true);setUncertain(true);return false;}
  }
  function verifiedPending(){
    if(!clearPending())return;
    // Manual override is only offered after the user checks the official order history.
    if(active && queue[active]?.status==='uncertain')status(active,'queued');
    setMessage(en?'Manual reconciliation recorded; reread orders before any new submission.':'已记录人工核对；再次操作前请重新读取官网挂单。');
  }

  async function readOnchainBalance(token:string,account:string,asset:string):Promise<bigint>{
    if(!wallet||!publicClient||wallet.chain?.id!==137||wallet.account.address.toLowerCase()!==address.toLowerCase())throw Error('wallet_changed');
    if(!/^0x[0-9a-f]{40}$/i.test(token)||!/^0x[0-9a-f]{40}$/i.test(account)||!/^\d{1,100}$/.test(asset))throw Error('invalid_balance_request');
    return publicClient.readContract({address:token as Address,abi:[{type:'function',name:'balanceOf',stateMutability:'view',
      inputs:[{name:'account',type:'address'},{name:'id',type:'uint256'}],outputs:[{name:'',type:'uint256'}]}] as const,
      functionName:'balanceOf',args:[account as Address,BigInt(asset)]});
  }
  async function readOnchainApproval(token:string,operator:string,account:string):Promise<boolean>{
    if(!wallet||!publicClient||wallet.chain?.id!==137||wallet.account.address.toLowerCase()!==address.toLowerCase())throw Error('wallet_changed');
    if(!/^0x[0-9a-f]{40}$/i.test(token)||!/^0x[0-9a-f]{40}$/i.test(operator)||!/^0x[0-9a-f]{40}$/i.test(account))throw Error('invalid_address');
    return publicClient.readContract({address:token as Address,abi:erc1155ApprovalAbi,functionName:'isApprovedForAll',args:[account as Address,operator as Address]});
  }
  function requestFor(id:string,apr:string,quantity:string,confirmedCoverage=coverage,confirmedSettlement=isSettled(id)){
    return {credentials,signer:address,funder,asset:id,apr:Number(apr),quantity:Number(quantity),
      coverageConfirmed:confirmedCoverage,settlementConfirmed:confirmedSettlement,
      readOnchainApproval:wallet?readOnchainApproval:undefined,readOnchainBalance:wallet?readOnchainBalance:undefined};
  }

  function configKey(id:string){
    const pos=positionFor(id),v=draftFor(id);
    return sellReviewConfigKey({asset:id,apr:v.apr,quantity:v.quantity,coverage,
      settlementConfirmed:isSettled(id),endDate:pos?.endDate});
  }
  async function prepareFor(id:string){
    if(lock.current||!positionFor(id)||uncertain||pending)return;
    const config=draftFor(id),key=configKey(id);
    previousConfirm.current=key;
    const g=++generation.current;
    lock.current=true;setBusy(true);setActive(id);setReview(null);setReviewSignature('');setMessage('');
    status(id,'reviewing');
    try{
      const snapshot=await loadSellReview(requestFor(id,config.apr,config.quantity));
      if(g===generation.current){
        setReview(snapshot);setReviewSignature(key);
        status(id,snapshot.result.status==='review'?'reviewing':'blocked',snapshot.result.status==='blocked'?snapshot.result.reasons.join(', '):undefined);
      }
    }catch(error){
      if(g===generation.current){
        const reason=error instanceof Error?error.message:'snapshot_fetch_failed';
        status(id,'blocked',reason);
        setMessage((en?'Unable to prepare a fresh review: ':'无法完成实时审核：')+reason);
      }
    }finally{
      lock.current=false;
      if(g===generation.current)setBusy(false);
    }
  }

  // Confirmations are deliberate user actions, but the fresh read starts automatically afterward.
  useEffect(()=>{
    if(!active||busy||lock.current||pending||uncertain)return;
    const key=configKey(active);
    if(previousConfirm.current===key)return;
    void prepareFor(active);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[active,coverage,settlementDates,globalApr,drafts,busy,pending,uncertain,activePosition?.endDate]);

  async function refreshQuotes(){
    if(quoteBusy||busy||selected.length===0)return;
    setQuoteBusy(true);setQuotes({});
    const chosen=[...selected];
    try{
      for(const id of chosen){
        const p=positionFor(id);if(!p)continue;
        try{
          const q=new URLSearchParams({tokenId:id,currentPrice:String(p.curPrice),thresholdApr:draftFor(id).apr});
          if(p.endDate)q.set('endDate',p.endDate);
          const r=await fetch('/api/position-quote?'+q.toString(),{cache:'no-store',signal:AbortSignal.timeout(15000)});
          const body=await r.json();
          setQuotes(old=>({...old,[id]:r.ok&&body.ok?body.quote:null}));
        }catch{setQuotes(old=>({...old,[id]:null}));}
      }
    }finally{setQuoteBusy(false);}
  }

  async function execute(){
    if(lock.current||!active||!review||review.position.asset!==active||review.result.status!=='review'
      ||!wallet||!coverage||!isSettled(active)||pending||uncertain||reviewSignature!==configKey(active)
      ||review.checks.marketStatus!=='accepting'||!review.checks.authorizationVerified||review.checks.tokenBalanceStatus!=='verified'||!review.checks.operator||Date.now()-review.asOf>60000)return;
    const id=active,config=draftFor(id);
    lock.current=true;const g=generation.current;setBusy(true);setMessage('');
    let posting=false,nextId:string|null=null;
    status(id,'signing');
    try{
      if(wallet.account.address.toLowerCase()!==address.toLowerCase()||wallet.chain?.id!==137)throw Error('wallet_changed');
      const {createSafeSellClient}=await import('@/lib/secure-sell-client');
      const request=()=>requestFor(id,config.apr,config.quantity);
      const fresh=await loadSellReview(request());
      if(g!==generation.current||fresh.result.status!=='review'||!sameSellIntent(fresh.result,review.result)
        ||fresh.position.endDate!==review.position.endDate||fresh.checks.marketStatus!=='accepting'
        ||!fresh.checks.authorizationVerified||fresh.checks.tokenBalanceStatus!=='verified'||fresh.checks.operator!==review.checks.operator||configKey(id)!==reviewSignature)throw Error('review_changed');
      const client=await createSafeSellClient(wallet,funder,credentials,review.checks.operator);
      if(g!==generation.current)throw Error('wallet_changed');
      const signed=await client.sign(id,review.result.price,review.result.quantity,review.result.expirationSec);
      if(g!==generation.current)throw Error('wallet_changed');
      const final=await loadSellReview(request());
      if(g!==generation.current||final.result.status!=='review'||!sameSellIntent(final.result,review.result)
        ||final.position.endDate!==review.position.endDate||final.checks.marketStatus!=='accepting'
        ||!final.checks.authorizationVerified||final.checks.tokenBalanceStatus!=='verified'||final.checks.operator!==review.checks.operator||configKey(id)!==reviewSignature
        ||Date.now()-review.asOf>60000)throw Error('review_changed');
      // Store before POST. A failed network response must never trigger a silent replay.
      try{
        localStorage.setItem(pendingKey,JSON.stringify({address,funder,asset:id,quantity:review.result.quantity,price:review.result.price,at:Date.now()}));
      }catch{throw Error('pending_store_unavailable');}
      posting=true;
      const response=await client.post(signed);
      if(g===generation.current){
        setReview(null);
        if(!response.ok){
          setUncertain(true);setPending(true);
          status(id,'uncertain','rejected_response_requires_reconciliation');
          setMessage(en?'Response rejected; verify order history before retrying.':'订单响应拒绝；请先核对官网订单历史再重试。');
        }else{
          setUncertain(true);setPending(true);
          status(id,'uncertain','accepted_pending_readback',response.orderId);
          try{
            const updated=persistedAcceptedOrder(localStorage.getItem(pendingKey),address,funder,response.orderId);
            if(updated)localStorage.setItem(pendingKey,updated);
          }catch{/* Remain locked if storage update fails. */}
          try{
            const latest=await fetchBrowserOpenOrders(credentials,address,funder);
            const matched=matchingLiveSellOrder(latest,{
              orderId:response.orderId,asset:id,funder,price:review.result.price,quantity:review.result.quantity
            });
            if(g===generation.current){
              if(matched && clearPending()){
                const filled=Number(matched.size_matched)>0;
                status(id,filled?'partially_filled':'open',undefined,response.orderId);
                onOrdersRefresh?.(latest);
                setMessage((en?'Order verified in CLOB: ':'已精确回读 SELL：')+response.orderId);
                if(batchIds.current?.includes(id)){
                  nextId=nextAfterVerifiedSell(batchIds.current,queue,id,true);
                  if(!nextId){batchIds.current=null;setBatchMode(false);}
                }
              }else{
                setMessage(en?'Accepted, but exact LIVE SELL readback was not verified. Reconcile before another order.':'订单已受理，但未能精确确认 LIVE SELL；核对订单历史后才能继续。');
              }
            }
          }catch{
            if(g===generation.current)setMessage(en?'Accepted; CLOB readback failed. Check official orders before retrying.':'订单已受理；CLOB 回读失败，请先核对官网挂单。');
          }
        }
      }
    }catch(error){
      if(g===generation.current){
        setReview(null);
        const reason=error instanceof Error?error.message:'unknown';
        if(posting){setPending(true);setUncertain(true);status(id,'uncertain',reason);}
        else status(id,'blocked',reason);
        setMessage(posting?(en?'Submission uncertain; do not retry until reconciled.':'提交结果不确定，请先核对官网记录，切勿重试。')
          :(en?'Signing or recheck failed; no submission. ':'签名或复核失败，未提交：')+reason);
      }
    }finally{
      lock.current=false;
      if(g===generation.current){
        setBusy(false);
        if(nextId)void prepareFor(nextId); // auto review ONLY; no automatic wallet signature or POST
      }
    }
  }

  function startBatch(){
    if(uncertain||pending)return;
    const chosen=[...selected],next=nextReviewAsset(chosen,queue,'');
    if(next){batchIds.current=chosen;setBatchMode(true);void prepareFor(next);}
  }
  function startSingle(id:string){batchIds.current=null;setBatchMode(false);void prepareFor(id);}
  function leaveReview(){
    if(lock.current)return;
    batchIds.current=null;setBatchMode(false);setActive(null);setReview(null);setReviewSignature('');
  }
  const previewReady=!!review && review.result.status==='review' && !!active && review.position.asset===active && reviewSignature===configKey(active);
  const signReady=previewReady&&!busy&&!pending&&!uncertain&&!!wallet&&coverage&&!!active
    &&isSettled(active)&&review.checks.marketStatus==='accepting'
    &&review.checks.authorizationVerified&&review.checks.tokenBalanceStatus==='verified'&&!!review.checks.operator&&clock-review.asOf<60000;
  const summary=review?.result.status==='review'&&activePosition
    ?sellLimitSummary(review.result.price,review.result.quantity,activePosition.avgPrice,activePosition.endDate):null;
  const seconds=review?Math.max(0,Math.ceil((review.asOf+60000-clock)/1000)):0;

  const draftFields=(p:EnrichedPosition,compact=false)=>{
    const id=p.asset,configuration=draftFor(id),remaining=indicativeUnreservedShares(p.size,id,orders);
    const heldSell=observedSellShares(orders,id);
    const preview=quotes[id] ? buildMarkAutoSellPlan({
      quote:quotes[id],targetAprPercent:Number(configuration.apr),
      quantity:Number(configuration.quantity),avgPrice:p.avgPrice
    }).proposedLimitPrice : null;
    const completed=queue[id]?.status==='open'||queue[id]?.status==='partially_filled';
    return {
      configuration,remaining,heldSell,preview,completed,
      apr:<input aria-label={p.title+' APR'} className="w-20 rounded-lg border border-slate-600 bg-slate-950/70 px-2 py-1.5 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
        type="number" min="0.1" max="10000" step="0.1" value={configuration.apr} disabled={busy}
        onChange={e=>updateDraft(id,{apr:e.target.value})}/>,
      shares:<div><input aria-label={p.title+' shares'} className={'rounded-lg border border-slate-600 bg-slate-950/70 px-2 py-1.5 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none '+(compact?'w-28':'w-32')}
        type="number" min="0" step="any" max={remaining??undefined} value={configuration.quantity} disabled={busy}
        onChange={e=>updateDraft(id,{quantity:e.target.value})}/>
        <p className="mt-1 text-[10px] text-slate-500">{remaining===null?(en?'Check balance':'需核对余额'):(en?'Indicative max ':'模拟上限 ')+showShares(remaining)}</p></div>
    };
  };

  return <section id="sell-review-workbench" className="mt-4 overflow-hidden rounded-2xl border border-indigo-400/30 bg-slate-900/70 p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-[.18em] text-indigo-300">CLOB · SELL WORKBENCH</div>
        <h3 className="text-lg font-semibold text-slate-100">{en?'Sell review workbench':'卖单审核工作台'}</h3>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">{en?
          'Set APR and shares in one place. Review an individual position directly, or select several for sequential review. Every order needs a fresh check and a separate wallet signature.':
          '表格内统一设置 APR 与份额；单笔直接点「审核」，批量才需要勾选。每笔实时校验并单独钱包签名，不会自动撤换单。'}</p>
      </div>
      <div className="rounded-xl border border-slate-700 bg-slate-950/55 px-4 py-2 text-right">
        <div className="text-xs text-slate-400">{en?'Selected positions':'已选仓位'}</div>
        <div className="text-xl font-semibold tabular-nums text-slate-100">{selected.length} <span className="text-sm text-slate-500">/ {tradable.length}</span></div>
      </div>
    </div>

    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-700/70 bg-slate-950/40 px-3 py-3 text-sm">
      <label className="flex items-center gap-2 text-slate-300">
        <span className="whitespace-nowrap">{en?'Default APR':'默认目标 APR'}</span>
        <input aria-label={en?'Default APR':'默认目标 APR'} type="number" min="0.1" max="10000" step="0.1"
          className="w-20 rounded-lg border border-slate-600 bg-slate-950 px-2 py-1.5 text-slate-100"
          value={globalApr} disabled={busy} onChange={e=>{setGlobalApr(e.target.value);setQuotes({});}}/>
        <span className="text-xs text-slate-500">%</span>
      </label>
      <div className="h-6 w-px bg-slate-700 max-sm:hidden"/>
      <label className="flex cursor-pointer items-start gap-2 text-xs text-slate-300">
        <input type="checkbox" className="mt-0.5 accent-cyan-400" checked={coverage} disabled={busy}
          onChange={e=>setCoverage(e.target.checked)}/>
        <span>{en?'I confirmed that CLOB covers all my open orders for this Safe (this wallet session only).':
          '我已对照官网确认本 Safe 全部未成交挂单（本次钱包会话有效）'}</span>
      </label>
    </div>

    <div className="mt-4 flex flex-wrap items-center gap-2">
      <button type="button" disabled={busy} onClick={()=>setSelected(tradable.map(p=>p.asset))}
        className="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50">{en?'Select all':'全选'}</button>
      <button type="button" disabled={busy||!selected.length} onClick={()=>setSelected([])}
        className="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50">{en?'Clear selection':'清空'}</button>
      <button type="button" disabled={busy||quoteBusy||!selected.length} onClick={()=>void refreshQuotes()}
        className="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50">
        {quoteBusy?(en?'Loading quotes…':'刷新中…'):(en?'Preview selected prices':'预览所选报价')}</button>
      <span className="flex-1"/>
      <button type="button" disabled={busy||uncertain||!selected.length} onClick={startBatch}
        className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white shadow shadow-indigo-500/20 hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40">
        {en?'Review selected one by one':'逐笔审核已选'} <span aria-hidden="true">→</span>
      </button>
    </div>

    <div className="mt-3 hidden overflow-x-auto lg:block">
      <table className="w-full min-w-[1050px] table-fixed text-left text-xs">
        <thead><tr className="border-b border-slate-700 text-slate-400">
          <th className="w-[4%] py-3 pl-2">{en?'Pick':'选'}</th><th className="w-[27%] py-3">{en?'Market / outcome':'市场 / 方向'}</th>
          <th className="w-[8%] py-3">{en?'APR %':'APR %'}</th><th className="w-[8%] py-3">{en?'Shares held':'持仓'}</th>
          <th className="w-[10%] py-3">{en?'Open SELL':'已有 SELL'}</th><th className="w-[15%] py-3">{en?'Proposed shares':'拟卖份额'}</th>
          <th className="w-[10%] py-3">{en?'Limit':'限价'}</th><th className="w-[11%] py-3">{en?'Review':'审核进度'}</th><th className="w-[7%] py-3 text-right pr-1">{en?'Action':'操作'}</th>
        </tr></thead>
        <tbody>{tradable.map(p=>{
          const d=draftFields(p),record=displayedSellQueueRecord(queue[p.asset],p.asset,orders,true);
          return <tr key={p.asset} className="border-b border-slate-800/80 align-middle text-slate-200 hover:bg-slate-800/20">
            <td className="py-3 pl-2"><input type="checkbox" aria-label={(en?'Select ':'勾选 ')+p.title} checked={selected.includes(p.asset)} disabled={busy}
              onChange={e=>setSelected(old=>e.target.checked?[...new Set([...old,p.asset])]:old.filter(id=>id!==p.asset))} className="accent-indigo-400"/></td>
            <td className="pr-2 py-3"><p className="line-clamp-2 font-medium leading-5 text-slate-100" title={p.title}>{p.title}</p><p className="mt-0.5 text-[11px] text-indigo-300">{p.outcome}</p></td>
            <td className="py-3">{d.apr}</td><td className="py-3 tabular-nums">{showShares(p.size)}</td>
            <td className="py-3 tabular-nums">{d.heldSell>0?<span className="text-amber-300">{showShares(d.heldSell)}</span>:'—'}</td>
            <td className="py-3">{d.shares}</td>
            <td className="py-3 tabular-nums">{d.preview===null?'—':d.preview.toFixed(3)}</td>
            <td className="py-3 text-amber-200">
              {sellQueueStatusLabel({selected:selected.includes(p.asset),record,activePreview:active===p.asset?review:null,language})}
              {record?.orderId&&<p title={record.orderId} className="max-w-[100px] truncate text-[10px] text-slate-400">{record.orderId}</p>}
              {record?.reason&&<p title={record.reason} className="max-w-[120px] truncate text-[10px] text-rose-300">{record.reason}</p>}
            </td>
            <td className="py-3 pr-1 text-right"><button type="button" disabled={busy||uncertain||pending} onClick={()=>startSingle(p.asset)}
              className="rounded-lg border border-cyan-500/40 px-2.5 py-1.5 font-medium text-cyan-200 hover:bg-cyan-500/10 disabled:opacity-40">
              {d.heldSell>0?(en?'Add review':'追加审核'):(en?'Review':'审核')}</button></td>
          </tr>;
        })}</tbody>
      </table>
    </div>

    <div className="mt-3 space-y-2 lg:hidden">{tradable.map(p=>{
      const d=draftFields(p,true),record=displayedSellQueueRecord(queue[p.asset],p.asset,orders,true);
      return <div key={p.asset} className="rounded-xl border border-slate-700/80 bg-slate-950/40 p-3">
        <div className="flex items-start gap-2">
          <input type="checkbox" aria-label={(en?'Select ':'勾选 ')+p.title} className="mt-1 accent-indigo-400"
            checked={selected.includes(p.asset)} disabled={busy} onChange={e=>setSelected(old=>e.target.checked?[...new Set([...old,p.asset])]:old.filter(id=>id!==p.asset))}/>
          <div className="min-w-0 flex-1"><p className="text-sm font-semibold leading-5 text-slate-100">{p.title}</p>
            <p className="mt-1 text-xs text-indigo-300">{p.outcome}</p></div>
          <button type="button" disabled={busy||uncertain||pending} onClick={()=>startSingle(p.asset)}
            className="shrink-0 rounded-lg bg-indigo-500/20 px-3 py-2 text-xs font-semibold text-indigo-200 disabled:opacity-40">{en?'Review':'审核'}</button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="space-y-1 text-xs text-slate-400">{en?'Target APR':'目标 APR'} {d.apr}</label>
          <label className="space-y-1 text-xs text-slate-400">{en?'Shares':'拟卖份额'} {d.shares}</label>
        </div>
        <div className="mt-3 flex flex-wrap justify-between gap-2 border-t border-slate-800 pt-2 text-xs text-slate-400">
          <span>{en?'Held':'持仓'} {showShares(p.size)} · {en?'Open SELL':'已有 SELL'} {showShares(d.heldSell)}</span>
          <span className="text-amber-200">{sellQueueStatusLabel({selected:selected.includes(p.asset),record,activePreview:active===p.asset?review:null,language})}</span>
        </div>
      </div>;
    })}</div>
    <p className="mt-3 text-xs leading-5 text-slate-500">{en?
      'Indicative shares and prices are not executable guarantees. Each review fetches fresh account orders, actual balance, order book and authorizations.':
      '表中数量和限价均为模拟参考。进入每笔审核时会重新读取账户挂单、可卖余额、盘口和授权；已挂单不会自动撤换。'}</p>

    {uncertain&&<div role="alert" className="mt-4 rounded-xl border border-rose-500/50 bg-rose-950/20 p-3 text-xs text-rose-200">
      <p className="font-semibold">{en?'Order reconciliation required':'存在待核对提交记录'}</p>
      <p className="mt-1">{en?'Check the official Polymarket open orders and history before any new submission. Never retry blindly.':
        '请先在 Polymarket 官网检查全部未成交挂单和订单历史，确认无重复单后再继续。'}</p>
      {pending&&<p className="mt-2 text-amber-200">{en?'Submission guard survives refresh for this wallet.':'此钱包的提交保护记录会跨页面刷新保留。'}</p>}
      <button type="button" onClick={verifiedPending} className="mt-2 underline underline-offset-2">
        {en?'I verified the result in official order history':'我已在官网核对订单结果，解除限制'}
      </button>
    </div>}
    {message&&!active&&<p role="status" className="mt-3 break-all text-xs text-amber-200">{message}</p>}

    {active&&activePosition&&<div className="fixed inset-0 z-[90] flex items-end justify-end bg-slate-950/70 backdrop-blur-sm lg:items-stretch"
      onMouseDown={event=>{if(event.target===event.currentTarget&&!lock.current)leaveReview();}}>
      <aside ref={dialogRef} role="dialog" aria-modal="true" aria-label={en?'SELL order review':'SELL 卖单审核'}
        className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-indigo-500/30 bg-[#0c1327] shadow-2xl shadow-black/60 lg:h-full lg:max-h-none lg:w-[560px] lg:rounded-l-2xl lg:rounded-tr-none">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-700/70 px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-indigo-300">SELL · GTD 7D · POST-ONLY</p>
            <h4 className="mt-1 text-lg font-semibold text-slate-100">{en?'Review order':'审核卖单'}
              {batchMode&&batchIds.current?.includes(active)&&<span className="ml-2 text-xs font-normal text-slate-400">
                {batchIds.current.indexOf(active)+1} / {batchIds.current.length}</span>}
            </h4>
          </div>
          <button ref={closeButton} type="button" disabled={busy} onClick={leaveReview}
            className="rounded-lg border border-slate-600 p-2 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
            aria-label={en?'Close review':'关闭审核'}>✕</button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <p className="font-semibold leading-6 text-slate-100">{activePosition.title} <span className="text-indigo-300">· {activePosition.outcome}</span></p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3"><p className="text-xs text-slate-400">{en?'Target APR':'目标剩余 APR'}</p>
                <p className="mt-1 text-xl font-semibold text-slate-100">{activeApr}%</p></div>
              <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3"><p className="text-xs text-slate-400">{en?'Proposed shares':'拟卖份额'}</p>
                <p className="mt-1 text-xl font-semibold text-slate-100">{showShares(Number(activeQuantity))}</p></div>
              <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3"><p className="text-xs text-slate-400">{en?'SELL limit':'建议 SELL 限价'}</p>
                <p className="mt-1 text-xl font-semibold text-cyan-300">{review?.result.status==='review'?review.result.price:'—'}</p></div>
              <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3"><p className="text-xs text-slate-400">{en?'Open SELL shares':'已有 SELL'}</p>
                <p className="mt-1 text-xl font-semibold text-amber-200">{showShares(observedSellShares(orders,active))}</p></div>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
              <span>{en?'Quick quantity':'快捷数量（模拟可用份额）'}</span>
              <div className="flex gap-1">{([25,50,100] as const).map(percent=><button type="button" key={percent} disabled={busy}
                onClick={()=>updateDraft(active,{quantity:sellQuantityForPercent(indicativeUnreservedShares(activePosition.size,active,orders),percent)})}
                className="rounded border border-slate-600 px-2 py-1 disabled:opacity-40">{percent}%</button>)}</div>
            </div>
            {summary&&<div className="mt-3 rounded-lg border border-cyan-500/30 p-3 text-xs text-slate-300">
              <p className="font-semibold text-cyan-200">{en?'APR and proceeds at SELL limit':'SELL 限价收益摘要'}</p>
              <p>{en?'Current Mark APR':'当前 Mark APR'}：{activePosition.markApr===null?'—':(activePosition.markApr*100).toFixed(2)+'%'} · {en?'Target':'目标'}：{activeApr}%</p>
              <p>{en?'APR at limit':'限价实际 APR'}：{summary.limitAprPercent===null?'—':summary.limitAprPercent.toFixed(2)+'%'}</p>
              <p>{en?'Gross proceeds':'限价卖出总额'}：{summary.grossProceeds===null?'—':'
            <p className="font-semibold text-slate-100">{en?'Account and settlement confirmations':'账户与结算日期确认'}</p>
            <label className="mt-2 flex cursor-pointer items-start gap-2 text-slate-300">
              <input type="checkbox" checked={coverage} disabled={busy} onChange={e=>setCoverage(e.target.checked)} className="mt-0.5 accent-cyan-400"/>
              <span>{en?'I matched all open orders on Polymarket for this Safe.':'已对照官网核对本 Safe 全部未成交挂单。'}</span>
            </label>
            <label className="mt-2 flex cursor-pointer items-start gap-2 text-slate-300">
              <input type="checkbox" checked={activeSettled} disabled={busy||!activePosition.endDate}
                onChange={e=>setSettlementDates(old=>({...old,[active]:e.target.checked?(activePosition.endDate??''):''}))}
                className="mt-0.5 accent-cyan-400"/>
              <span>{en?'I checked this market settlement estimate: ':'已确认本市场的预计结算日：'}{activePosition.endDate||'—'}.
                {en?' Changes may affect APR pricing.':' 结算变化可能影响 APR。'}</span>
            </label>
            <p className="mt-2 text-slate-500">{en?'Confirmation immediately triggers a fresh non-trading precheck.':'确认选项变化后会自动重新执行只读预检查。'}</p>
          </div>

          {busy&&<div role="status" className="rounded-lg border border-indigo-500/40 bg-indigo-950/25 p-3 text-sm text-indigo-200">
            {en?'Checking data or requesting wallet signature…':'正在核对最新数据或等待钱包签名…'}
          </div>}
          {review&&<div className="space-y-3">
            {review.result.status==='blocked'&&<div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-950/20 p-3 text-xs text-amber-200">
              <p className="font-semibold">{en?'Order blocked':'暂不可下单'}</p>
              <p className="mt-1 break-words">{review.result.reasons.map(r=>r==='onchain_clob_balance_mismatch'?'CLOB 与链上持仓不一致，禁止交易':r==='onchain_balance_unverified'?'链上持仓无法核实，禁止交易':r).join(' · ')}</p>
            </div>}
            {review.result.status==='review'&&<p className="text-sm font-semibold text-emerald-300">{en?'Quote calculated; check all safety conditions.':'已生成审核价格，请检查各项下单条件。'}</p>}
            <div className="space-y-2 rounded-xl border border-slate-700 p-3 text-xs text-slate-300">
              <h5 className="font-semibold text-slate-100">{en?'Fresh preflight checks':'实时下单前检查'}</h5>
              <p>{en?'Market accepting orders':'市场接单状态'}：
                <span className={review.checks.marketStatus==='accepting'?'text-emerald-300':'text-amber-300'}>
                  {review.checks.marketStatus==='accepting'?(en?'Accepting':'接单中'):(en?'Paused / unknown':'暂停 / 待核实')}</span>
              </p>
              <p>{en?'Safe ERC-1155 authorization':'Safe ERC-1155 授权'}：
                <span className={review.checks.authorizationVerified?'text-emerald-300':'text-amber-300'}>
                  {review.checks.authorizationStatus==='approved'?(en?'Verified':'已核实'):review.checks.authorizationStatus==='missing'?(en?'Missing':'未授权'):(en?'Unknown / mismatch':'待核实 / 数据不一致')}
                </span>
              </p>
              <p className="break-all">{en?'Exchange':'交易合约'}：{review.checks.operator??'—'}</p>
              <p>{en?'Bid / ask':'买一 / 卖一'}：{review.checks.bestBid??'—'} / {review.checks.bestAsk??'—'} · Tick {review.checks.tick??'—'}</p>
              <p>{en?'Minimum shares':'最小份额'}：{review.checks.minimumOrderShares??'—'}</p>
              <p>{en?'Onchain CTF balance':'链上 CTF 持仓'}：{review.checks.tokenBalanceStatus==='verified'?'已与 CLOB 余额核对一致':review.checks.tokenBalanceStatus==='mismatch'?'不一致，禁止交易':'未核实，禁止交易'}</p>
              <p>{en?'Available comparison':'快照差额'}：{showShares(Number(review.comparison.remainder)/1e6)}</p>
              {review.result.status==='review'&&<p>{en?'Expires':'订单到期'}：{new Date(review.result.expirationSec*1000).toLocaleString()}</p>}
            </div>
          </div>}
          {!review&&!busy&&queue[active]?.status==='open'&&<div className="rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-3 text-sm text-emerald-200">
            {en?'SELL verified in CLOB open orders.':'SELL 已在 CLOB 未成交挂单中核实。'}
          </div>}
          {message&&<p role="status" className="break-all rounded-lg border border-amber-600/30 bg-amber-950/20 p-3 text-xs text-amber-200">{message}</p>}
          {pending&&<p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-950/20 p-3 text-xs text-rose-200">
            {en?'Submission hold: reconcile official order history before placing more orders.':'提交保护中：请先在官网核对订单历史，禁止重复提交。'}
          </p>}
        </div>

        <footer className="shrink-0 space-y-2 border-t border-slate-700 bg-slate-950/60 px-5 py-4">
          {review&&<p className="text-xs text-slate-400">{en?'Review expires in':'审核剩余'} {seconds}s · {en?'Checked again after signing':'签名后重新校验全部条件'}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={leaveReview}
              className="rounded-lg border border-slate-600 px-4 py-2.5 text-sm text-slate-200 disabled:opacity-50">{en?'Back to list':'返回列表'}</button>
            <button type="button" disabled={busy||pending||uncertain} onClick={()=>void prepareFor(active)}
              className="rounded-lg border border-indigo-500/50 px-4 py-2.5 text-sm font-medium text-indigo-200 disabled:opacity-40">
              {en?'Recheck':'重新核验'}</button>
            <button type="button" disabled={!signReady} onClick={()=>void execute()}
              className="min-w-[165px] flex-1 rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-35">
              {en?'Sign and submit SELL':'钱包签名并提交 SELL'}
            </button>
          </div>
          <p className="text-[11px] text-slate-500">{en?'No automatic signatures, orders, cancellations or replacements.':'不自动签名、下单、撤单或替换已有挂单。'}</p>
        </footer>
      </aside>
    </div>}
  </section>;
}
+summary.grossProceeds.toFixed(4)}</p>
              <p>{en?'P/L vs avg cost (before fees)':'对比成本收益（未扣费用）'}：{summary.profitVsAvgCost===null?'—':'
            <p className="font-semibold text-slate-100">{en?'Account and settlement confirmations':'账户与结算日期确认'}</p>
            <label className="mt-2 flex cursor-pointer items-start gap-2 text-slate-300">
              <input type="checkbox" checked={coverage} disabled={busy} onChange={e=>setCoverage(e.target.checked)} className="mt-0.5 accent-cyan-400"/>
              <span>{en?'I matched all open orders on Polymarket for this Safe.':'已对照官网核对本 Safe 全部未成交挂单。'}</span>
            </label>
            <label className="mt-2 flex cursor-pointer items-start gap-2 text-slate-300">
              <input type="checkbox" checked={activeSettled} disabled={busy||!activePosition.endDate}
                onChange={e=>setSettlementDates(old=>({...old,[active]:e.target.checked?(activePosition.endDate??''):''}))}
                className="mt-0.5 accent-cyan-400"/>
              <span>{en?'I checked this market settlement estimate: ':'已确认本市场的预计结算日：'}{activePosition.endDate||'—'}.
                {en?' Changes may affect APR pricing.':' 结算变化可能影响 APR。'}</span>
            </label>
            <p className="mt-2 text-slate-500">{en?'Confirmation immediately triggers a fresh non-trading precheck.':'确认选项变化后会自动重新执行只读预检查。'}</p>
          </div>

          {busy&&<div role="status" className="rounded-lg border border-indigo-500/40 bg-indigo-950/25 p-3 text-sm text-indigo-200">
            {en?'Checking data or requesting wallet signature…':'正在核对最新数据或等待钱包签名…'}
          </div>}
          {review&&<div className="space-y-3">
            {review.result.status==='blocked'&&<div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-950/20 p-3 text-xs text-amber-200">
              <p className="font-semibold">{en?'Order blocked':'暂不可下单'}</p>
              <p className="mt-1 break-words">{review.result.reasons.map(r=>r==='onchain_clob_balance_mismatch'?'CLOB 与链上持仓不一致，禁止交易':r==='onchain_balance_unverified'?'链上持仓无法核实，禁止交易':r).join(' · ')}</p>
            </div>}
            {review.result.status==='review'&&<p className="text-sm font-semibold text-emerald-300">{en?'Quote calculated; check all safety conditions.':'已生成审核价格，请检查各项下单条件。'}</p>}
            <div className="space-y-2 rounded-xl border border-slate-700 p-3 text-xs text-slate-300">
              <h5 className="font-semibold text-slate-100">{en?'Fresh preflight checks':'实时下单前检查'}</h5>
              <p>{en?'Market accepting orders':'市场接单状态'}：
                <span className={review.checks.marketStatus==='accepting'?'text-emerald-300':'text-amber-300'}>
                  {review.checks.marketStatus==='accepting'?(en?'Accepting':'接单中'):(en?'Paused / unknown':'暂停 / 待核实')}</span>
              </p>
              <p>{en?'Safe ERC-1155 authorization':'Safe ERC-1155 授权'}：
                <span className={review.checks.authorizationVerified?'text-emerald-300':'text-amber-300'}>
                  {review.checks.authorizationStatus==='approved'?(en?'Verified':'已核实'):review.checks.authorizationStatus==='missing'?(en?'Missing':'未授权'):(en?'Unknown / mismatch':'待核实 / 数据不一致')}
                </span>
              </p>
              <p className="break-all">{en?'Exchange':'交易合约'}：{review.checks.operator??'—'}</p>
              <p>{en?'Bid / ask':'买一 / 卖一'}：{review.checks.bestBid??'—'} / {review.checks.bestAsk??'—'} · Tick {review.checks.tick??'—'}</p>
              <p>{en?'Minimum shares':'最小份额'}：{review.checks.minimumOrderShares??'—'}</p>
              <p>{en?'Onchain CTF balance':'链上 CTF 持仓'}：{review.checks.tokenBalanceStatus==='verified'?'已与 CLOB 余额核对一致':review.checks.tokenBalanceStatus==='mismatch'?'不一致，禁止交易':'未核实，禁止交易'}</p>
              <p>{en?'Available comparison':'快照差额'}：{showShares(Number(review.comparison.remainder)/1e6)}</p>
              {review.result.status==='review'&&<p>{en?'Expires':'订单到期'}：{new Date(review.result.expirationSec*1000).toLocaleString()}</p>}
            </div>
          </div>}
          {!review&&!busy&&queue[active]?.status==='open'&&<div className="rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-3 text-sm text-emerald-200">
            {en?'SELL verified in CLOB open orders.':'SELL 已在 CLOB 未成交挂单中核实。'}
          </div>}
          {message&&<p role="status" className="break-all rounded-lg border border-amber-600/30 bg-amber-950/20 p-3 text-xs text-amber-200">{message}</p>}
          {pending&&<p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-950/20 p-3 text-xs text-rose-200">
            {en?'Submission hold: reconcile official order history before placing more orders.':'提交保护中：请先在官网核对订单历史，禁止重复提交。'}
          </p>}
        </div>

        <footer className="shrink-0 space-y-2 border-t border-slate-700 bg-slate-950/60 px-5 py-4">
          {review&&<p className="text-xs text-slate-400">{en?'Review expires in':'审核剩余'} {seconds}s · {en?'Checked again after signing':'签名后重新校验全部条件'}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={leaveReview}
              className="rounded-lg border border-slate-600 px-4 py-2.5 text-sm text-slate-200 disabled:opacity-50">{en?'Back to list':'返回列表'}</button>
            <button type="button" disabled={busy||pending||uncertain} onClick={()=>void prepareFor(active)}
              className="rounded-lg border border-indigo-500/50 px-4 py-2.5 text-sm font-medium text-indigo-200 disabled:opacity-40">
              {en?'Recheck':'重新核验'}</button>
            <button type="button" disabled={!signReady} onClick={()=>void execute()}
              className="min-w-[165px] flex-1 rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-35">
              {en?'Sign and submit SELL':'钱包签名并提交 SELL'}
            </button>
          </div>
          <p className="text-[11px] text-slate-500">{en?'No automatic signatures, orders, cancellations or replacements.':'不自动签名、下单、撤单或替换已有挂单。'}</p>
        </footer>
      </aside>
    </div>}
  </section>;
}
+summary.profitVsAvgCost.toFixed(4)}</p>
            </div>}
            <details className="mt-3 rounded-lg border border-slate-700 p-3 text-xs text-slate-300">
              <summary className="cursor-pointer">{en?'Existing SELL orders':'已有 SELL 明细'} ({orders.filter(o=>o.asset_id===active&&o.side==='SELL').length})</summary>
              {orders.filter(o=>o.asset_id===active&&o.side==='SELL').map(o=><p key={o.id} className="mt-2 break-all border-t border-slate-800 pt-2">SELL {o.original_size} @ {o.price} · {en?'unfilled':'未成交'} {Math.max(0,Number(o.original_size)-Number(o.size_matched)).toFixed(6)} · {o.id}</p>)}
            </details>
          </div>

          <div className="rounded-xl border border-slate-700/80 bg-slate-900/70 p-3 text-xs">
            <p className="font-semibold text-slate-100">{en?'Account and settlement confirmations':'账户与结算日期确认'}</p>
            <label className="mt-2 flex cursor-pointer items-start gap-2 text-slate-300">
              <input type="checkbox" checked={coverage} disabled={busy} onChange={e=>setCoverage(e.target.checked)} className="mt-0.5 accent-cyan-400"/>
              <span>{en?'I matched all open orders on Polymarket for this Safe.':'已对照官网核对本 Safe 全部未成交挂单。'}</span>
            </label>
            <label className="mt-2 flex cursor-pointer items-start gap-2 text-slate-300">
              <input type="checkbox" checked={activeSettled} disabled={busy||!activePosition.endDate}
                onChange={e=>setSettlementDates(old=>({...old,[active]:e.target.checked?(activePosition.endDate??''):''}))}
                className="mt-0.5 accent-cyan-400"/>
              <span>{en?'I checked this market settlement estimate: ':'已确认本市场的预计结算日：'}{activePosition.endDate||'—'}.
                {en?' Changes may affect APR pricing.':' 结算变化可能影响 APR。'}</span>
            </label>
            <p className="mt-2 text-slate-500">{en?'Confirmation immediately triggers a fresh non-trading precheck.':'确认选项变化后会自动重新执行只读预检查。'}</p>
          </div>

          {busy&&<div role="status" className="rounded-lg border border-indigo-500/40 bg-indigo-950/25 p-3 text-sm text-indigo-200">
            {en?'Checking data or requesting wallet signature…':'正在核对最新数据或等待钱包签名…'}
          </div>}
          {review&&<div className="space-y-3">
            {review.result.status==='blocked'&&<div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-950/20 p-3 text-xs text-amber-200">
              <p className="font-semibold">{en?'Order blocked':'暂不可下单'}</p>
              <p className="mt-1 break-words">{review.result.reasons.map(r=>r==='onchain_clob_balance_mismatch'?'CLOB 与链上持仓不一致，禁止交易':r==='onchain_balance_unverified'?'链上持仓无法核实，禁止交易':r).join(' · ')}</p>
            </div>}
            {review.result.status==='review'&&<p className="text-sm font-semibold text-emerald-300">{en?'Quote calculated; check all safety conditions.':'已生成审核价格，请检查各项下单条件。'}</p>}
            <div className="space-y-2 rounded-xl border border-slate-700 p-3 text-xs text-slate-300">
              <h5 className="font-semibold text-slate-100">{en?'Fresh preflight checks':'实时下单前检查'}</h5>
              <p>{en?'Market accepting orders':'市场接单状态'}：
                <span className={review.checks.marketStatus==='accepting'?'text-emerald-300':'text-amber-300'}>
                  {review.checks.marketStatus==='accepting'?(en?'Accepting':'接单中'):(en?'Paused / unknown':'暂停 / 待核实')}</span>
              </p>
              <p>{en?'Safe ERC-1155 authorization':'Safe ERC-1155 授权'}：
                <span className={review.checks.authorizationVerified?'text-emerald-300':'text-amber-300'}>
                  {review.checks.authorizationStatus==='approved'?(en?'Verified':'已核实'):review.checks.authorizationStatus==='missing'?(en?'Missing':'未授权'):(en?'Unknown / mismatch':'待核实 / 数据不一致')}
                </span>
              </p>
              <p className="break-all">{en?'Exchange':'交易合约'}：{review.checks.operator??'—'}</p>
              <p>{en?'Bid / ask':'买一 / 卖一'}：{review.checks.bestBid??'—'} / {review.checks.bestAsk??'—'} · Tick {review.checks.tick??'—'}</p>
              <p>{en?'Minimum shares':'最小份额'}：{review.checks.minimumOrderShares??'—'}</p>
              <p>{en?'Onchain CTF balance':'链上 CTF 持仓'}：{review.checks.tokenBalanceStatus==='verified'?'已与 CLOB 余额核对一致':review.checks.tokenBalanceStatus==='mismatch'?'不一致，禁止交易':'未核实，禁止交易'}</p>
              <p>{en?'Available comparison':'快照差额'}：{showShares(Number(review.comparison.remainder)/1e6)}</p>
              {review.result.status==='review'&&<p>{en?'Expires':'订单到期'}：{new Date(review.result.expirationSec*1000).toLocaleString()}</p>}
            </div>
          </div>}
          {!review&&!busy&&queue[active]?.status==='open'&&<div className="rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-3 text-sm text-emerald-200">
            {en?'SELL verified in CLOB open orders.':'SELL 已在 CLOB 未成交挂单中核实。'}
          </div>}
          {message&&<p role="status" className="break-all rounded-lg border border-amber-600/30 bg-amber-950/20 p-3 text-xs text-amber-200">{message}</p>}
          {pending&&<p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-950/20 p-3 text-xs text-rose-200">
            {en?'Submission hold: reconcile official order history before placing more orders.':'提交保护中：请先在官网核对订单历史，禁止重复提交。'}
          </p>}
        </div>

        <footer className="shrink-0 space-y-2 border-t border-slate-700 bg-slate-950/60 px-5 py-4">
          {review&&<p className="text-xs text-slate-400">{en?'Review expires in':'审核剩余'} {seconds}s · {en?'Checked again after signing':'签名后重新校验全部条件'}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={leaveReview}
              className="rounded-lg border border-slate-600 px-4 py-2.5 text-sm text-slate-200 disabled:opacity-50">{en?'Back to list':'返回列表'}</button>
            <button type="button" disabled={busy||pending||uncertain} onClick={()=>void prepareFor(active)}
              className="rounded-lg border border-indigo-500/50 px-4 py-2.5 text-sm font-medium text-indigo-200 disabled:opacity-40">
              {en?'Recheck':'重新核验'}</button>
            <button type="button" disabled={!signReady} onClick={()=>void execute()}
              className="min-w-[165px] flex-1 rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-35">
              {en?'Sign and submit SELL':'钱包签名并提交 SELL'}
            </button>
          </div>
          <p className="text-[11px] text-slate-500">{en?'No automatic signatures, orders, cancellations or replacements.':'不自动签名、下单、撤单或替换已有挂单。'}</p>
        </footer>
      </aside>
    </div>}
  </section>;
}
