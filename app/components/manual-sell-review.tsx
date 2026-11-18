"use client";

import { useEffect, useRef, useState } from 'react';
import { usePublicClient, useWalletClient } from 'wagmi';
import type { Address } from 'viem';
import { fetchBrowserOpenOrders, type ClobCredentials, type ClobOrder } from '@/lib/browser-clob';
import { observedSellShares } from '@/lib/order-review-status';
import {
  indicativeUnreservedShares, nextReviewAsset, pendingAttemptKey, isCurrentPendingAttempt,
  sameSellIntent, matchingLiveSellOrder, matchingPendingOpenSell, persistedAcceptedOrder,
  type QueueRecord
} from '@/lib/manual-sell-queue';
import { loadSellReview } from '@/lib/sell-snapshot';
import { settlementConfirmedForDate, nextAfterVerifiedSell, sellReviewConfigKey, sellQuantityForPercent, sellLimitSummary } from '@/lib/sell-workbench-flow';
import type { EnrichedPosition } from '@/lib/types';
import { sellSubmitProgress, shouldAutoRecheckSell, sellBlockReasonText, type SellSubmitReceipt, type SellSubmitStage } from '@/lib/sell-submit-feedback';

type Snapshot = Awaited<ReturnType<typeof loadSellReview>>;
export type SellReviewRequest={serial:number;mode:'single'|'batch';asset?:string}|null;
type Props = {
 address:string;funder:string;credentials:ClobCredentials;
 positions:EnrichedPosition[];orders:ClobOrder[];language:'zh'|'en';
 onOrdersRefresh?:(next:ClobOrder[])=>void;
 onOpenOrders:(asset:string)=>void;
 ordersReady:boolean;
 targetAprInputs:Record<string,string>;
 selectedAssets:string[];
 proposedQuantities:Record<string,string>;
 onQuantityChange:(asset:string,value:string)=>void;
 reviewRequest:SellReviewRequest;
};
const erc1155ApprovalAbi = [{
  type: 'function', name: 'isApprovedForAll', stateMutability: 'view',
  inputs: [{name:'account',type:'address'},{name:'operator',type:'address'}],
  outputs: [{name:'',type:'bool'}]
}] as const;
const showShares = (n: number) => Number.isFinite(n) ? n.toLocaleString(undefined,{maximumFractionDigits:6}) : '—';
function SellSubmissionBanner({receipt,language,onOpenOrders,onDismiss}:{
 receipt:SellSubmitReceipt;language:'zh'|'en';onOpenOrders:()=>void;onDismiss:()=>void
}){
 const en=language==='en',live=receipt.outcome==='live';
 return <section role={live?'status':'alert'} aria-live={live?'polite':'assertive'}
  className={'rounded-xl border p-3 text-xs '+(live?'border-emerald-500/50 bg-emerald-950/35 text-emerald-100':'border-amber-500/50 bg-amber-950/30 text-amber-100')}>
  <p className="text-sm font-bold">{live?(en?'SELL confirmed: LIVE order verified':'SELL 已挂单成功 · CLOB LIVE 已确认')
   :(en?'CLOB responded, LIVE status still unverified':'CLOB 已响应 · LIVE 挂单尚未核实')}</p>
  <p className="mt-1 break-words">{receipt.title}</p>
  <p className="mt-1 font-mono">SELL {showShares(receipt.quantity)} @ {receipt.price}</p>
  <p className="mt-1 break-all font-mono text-[11px] opacity-80">{en?'Order ID':'订单 ID'}：{receipt.orderId||'—'}</p>
  {!live&&<p className="mt-2">{en?'Check official order history before trying again.':'请先核对官网订单历史，确认结果前不要重复提交。'}</p>}
  <div className="mt-3 flex flex-wrap gap-3">
    <button type="button" onClick={onOpenOrders} className="font-semibold underline underline-offset-2">{en?'View this market’s orders':'查看该市场挂单'}</button>
    <button type="button" onClick={onDismiss} className="opacity-80 underline underline-offset-2">{en?'Dismiss':'关闭提示'}</button>
  </div>
 </section>;
}

export function ManualSellReview({address,funder,credentials,positions,orders,language,onOrdersRefresh,onOpenOrders,ordersReady,targetAprInputs,selectedAssets,proposedQuantities,onQuantityChange,reviewRequest}: Props) {
  const en = language === 'en';
  const {data:wallet} = useWalletClient();
  const publicClient = usePublicClient({chainId:137});
  const selected=selectedAssets;
  const [coverage,setCoverage] = useState(false);
  // Store the exact date confirmed for each market. If the date changes, it must be confirmed again.
  const [settlementDates,setSettlementDates] = useState<Record<string,string>>({});
  const [active,setActive] = useState<string|null>(null);
  const [review,setReview] = useState<Snapshot|null>(null);
  const [busy,setBusy] = useState(false);
  const [clock,setClock] = useState(Date.now());
  const [queue,setQueue] = useState<Record<string,QueueRecord>>({});
  const [message,setMessage] = useState('');
  const [submitStage,setSubmitStage]=useState<SellSubmitStage|null>(null);
  const [lastSubmission,setLastSubmission]=useState<SellSubmitReceipt|null>(null);
  const [uncertain,setUncertain] = useState(false);
  const [pending,setPending] = useState(false);
  const generation=useRef(0), lock=useRef(false);
  const previousConfirm=useRef('');
  const handledRequest=useRef(0);
  const [reviewSignature,setReviewSignature]=useState('');
  const batchIds=useRef<string[]|null>(null);
  const [batchMode,setBatchMode]=useState(false);
  const closeButton=useRef<HTMLButtonElement|null>(null);
  const dialogRef=useRef<HTMLElement|null>(null);
  const pendingKey = pendingAttemptKey(address,funder);
  const tradable=positions.filter(p=>!p.redeemable&&p.size>0);
  const activePosition=tradable.find(p=>p.asset===active);
  const activeApr=active?targetAprInputs[active]??'12':'12';
  const activeQuantity=activePosition ? (proposedQuantities[activePosition.asset] ?? String(indicativeUnreservedShares(activePosition.size,activePosition.asset,orders) ?? '')) : '';
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
        setLastSubmission({asset:matched.asset_id,title:positions.find(p=>p.asset===matched.asset_id)?.title??matched.asset_id,
          orderId:matched.id,price:Number(matched.price),quantity:Number(matched.original_size),at:Date.now(),outcome:'live'});
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
      apr: targetAprInputs[id]??'12',
      quantity: proposedQuantities[id] ?? String(p ? indicativeUnreservedShares(p.size,id,orders)??'' : '')
    };
  }
  function updateDraft(id:string,change:{quantity?:string}){
    if(change.quantity!==undefined)onQuantityChange(id,change.quantity);
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
    if(lock.current||!positionFor(id)||!ordersReady||uncertain||pending)return;
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
    if(!active)return;
    const key=configKey(active);
    if(!shouldAutoRecheckSell({active:true,hasReview:review!==null,busy,locked:lock.current,
      ordersReady,pending,uncertain,configChanged:previousConfirm.current!==key}))return;
    // A completed POST intentionally clears review. Changes in available shares
    // must never start an implicit second order review (invalid_quantity).
    void prepareFor(active);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[active,review,coverage,settlementDates,targetAprInputs,proposedQuantities,busy,ordersReady,pending,uncertain,activePosition?.endDate]);

  async function execute(){
    if(lock.current||!active||!review||review.position.asset!==active||review.result.status!=='review'
      ||!wallet||!ordersReady||!coverage||!isSettled(active)||pending||uncertain||reviewSignature!==configKey(active)
      ||review.checks.marketStatus!=='accepting'||!review.checks.authorizationVerified||review.checks.tokenBalanceStatus!=='verified'||!review.checks.operator||Date.now()-review.asOf>60000)return;
    const id=active,config=draftFor(id);
    lock.current=true;const g=generation.current;setBusy(true);setMessage('');setSubmitStage('precheck');
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
      setSubmitStage('wallet');
      const client=await createSafeSellClient(wallet,funder,credentials,review.checks.operator);
      if(g!==generation.current)throw Error('wallet_changed');
      const signed=await client.sign(id,review.result.price,review.result.quantity,review.result.expirationSec);
      if(g!==generation.current)throw Error('wallet_changed');
      setSubmitStage('postcheck');
      const final=await loadSellReview(request());
      if(g!==generation.current||final.result.status!=='review'||!sameSellIntent(final.result,review.result)
        ||final.position.endDate!==review.position.endDate||final.checks.marketStatus!=='accepting'
        ||!final.checks.authorizationVerified||final.checks.tokenBalanceStatus!=='verified'||final.checks.operator!==review.checks.operator||configKey(id)!==reviewSignature
        ||Date.now()-review.asOf>60000)throw Error('review_changed');
      // Store before POST. A failed network response must never trigger a silent replay.
      try{
        localStorage.setItem(pendingKey,JSON.stringify({address,funder,asset:id,quantity:review.result.quantity,price:review.result.price,at:Date.now()}));
      }catch{throw Error('pending_store_unavailable');}
      posting=true;setSubmitStage('posting');
      const response=await client.post(signed);
      if(g===generation.current){
        setReview(null);
        if(!response.ok){
          setUncertain(true);setPending(true);
          status(id,'uncertain','rejected_response_requires_reconciliation');
          setMessage(en?'Response rejected; verify order history before retrying.':'订单响应拒绝；请先核对官网订单历史再重试。');
        }else{
          setUncertain(true);setPending(true);setSubmitStage('readback');
          const receiptBase={asset:id,title:review.position.title,orderId:response.orderId,
            price:review.result.price,quantity:review.result.quantity,at:Date.now()};
          setLastSubmission({...receiptBase,outcome:'needs_reconciliation'});
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
                setLastSubmission({...receiptBase,outcome:'live',at:Date.now()});
                onOrdersRefresh?.(latest);
                setMessage('');
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
        const mismatch=reason.startsWith('signed_order_differs:');
        const detail=mismatch?(en?'Signed fields did not match the reviewed order; not posted. Check fields: ':'签名字段与审核单不一致，订单尚未提交。请核对字段：')+reason.slice('signed_order_differs:'.length)
          :(en?'Signing or recheck failed; no submission. ':'签名或复核失败，未提交：')+reason;
        setMessage(posting?(en?'Submission uncertain; do not retry until reconciled.':'提交结果不确定，请先核对官网记录，切勿重试。'):detail);
      }
    }finally{
      lock.current=false;
      if(g===generation.current){
        setSubmitStage(null);
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
  useEffect(()=>{
    if(!reviewRequest||handledRequest.current===reviewRequest.serial||!ordersReady||busy||lock.current)return;
    // A queued command is never replayed after a submission requiring reconciliation.
    handledRequest.current=reviewRequest.serial;
    if(reviewRequest.mode==='single'&&reviewRequest.asset)startSingle(reviewRequest.asset);
    else if(reviewRequest.mode==='batch')startBatch();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[reviewRequest?.serial,ordersReady,busy]);

  const previewReady=!!review && review.result.status==='review' && !!active && review.position.asset===active && reviewSignature===configKey(active);
  const signReady=previewReady&&!busy&&!pending&&!uncertain&&ordersReady&&!!wallet&&coverage&&!!active
    &&isSettled(active)&&review.checks.marketStatus==='accepting'
    &&review.checks.authorizationVerified&&review.checks.tokenBalanceStatus==='verified'&&!!review.checks.operator&&clock-review.asOf<60000;
  const summary=review?.result.status==='review'&&activePosition
    ?sellLimitSummary(review.result.price,review.result.quantity,activePosition.avgPrice,activePosition.endDate):null;
  const seconds=review?Math.max(0,Math.ceil((review.asOf+60000-clock)/1000)):0;

  // The only position table is in the dashboard. This component owns preflight and its modal.
  return <>
    {uncertain&&<div role="alert" className="mt-4 rounded-xl border border-rose-500/50 bg-rose-950/20 p-3 text-xs text-rose-200">
      <p className="font-semibold">{en?'Order reconciliation required':'存在待核对提交记录'}</p>
      <p className="mt-1">{en?'Check the official Polymarket open orders and history before any new submission. Never retry blindly.':
        '请先在 Polymarket 官网检查全部未成交挂单和订单历史，确认无重复单后再继续。'}</p>
      {pending&&<p className="mt-2 text-amber-200">{en?'Submission guard survives refresh for this wallet.':'此钱包的提交保护记录会跨页面刷新保留。'}</p>}
      <button type="button" onClick={verifiedPending} className="mt-2 underline underline-offset-2">
        {en?'I verified the result in official order history':'我已在官网核对订单结果，解除限制'}
      </button>
    </div>}
    {lastSubmission&&!active&&<div className="mx-4 my-3 sm:mx-6"><SellSubmissionBanner receipt={lastSubmission} language={language}
      onOpenOrders={()=>onOpenOrders(lastSubmission.asset)} onDismiss={()=>setLastSubmission(null)}/></div>}
    {message&&!active&&<p role="status" className="mx-4 my-3 break-all text-xs text-amber-200 sm:mx-6">{message}</p>}

    {active&&activePosition&&<div className="fixed inset-0 z-[90] flex items-end justify-end bg-slate-950/70 backdrop-blur-sm lg:items-stretch"
      onMouseDown={event=>{if(event.target===event.currentTarget&&!lock.current)leaveReview();}}>
      <aside ref={dialogRef} role="dialog" aria-modal="true" aria-label={en?'SELL order review':'SELL 卖单审核'}
        className="ui-dialog flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border lg:h-full lg:max-h-none lg:w-[560px] lg:rounded-l-2xl lg:rounded-tr-none">
        <header className="ui-dialog-header flex shrink-0 items-start justify-between gap-3 border-b border-slate-700/30 px-5 py-5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-indigo-300">SELL · GTD 7D · POST-ONLY</p>
            <h4 className="mt-1 text-lg font-semibold text-slate-100">{en?'Review order':'审核卖单'}
              {batchMode&&batchIds.current?.includes(active)&&<span className="ml-2 text-xs font-normal text-slate-400">
                {batchIds.current.indexOf(active)+1} / {batchIds.current.length}</span>}
            </h4>
          </div>
          <button ref={closeButton} type="button" disabled={busy} onClick={leaveReview}
            className="ui-button-quiet h-9 w-9 p-2 disabled:opacity-40"
            aria-label={en?'Close review':'关闭审核'}>✕</button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <p className="font-semibold leading-6 text-slate-100">{activePosition.title} <span className="text-indigo-300">· {activePosition.outcome}</span></p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="ui-inset p-3"><p className="text-xs text-slate-400">{en?'Target APR':'目标剩余 APR'}</p>
                <p className="mt-1 text-xl font-semibold text-slate-100">{activeApr}%</p></div>
              <div className="ui-inset p-3"><p className="text-xs text-slate-400">{en?'Proposed shares':'拟卖份额'}</p>
                <p className="mt-1 text-xl font-semibold text-slate-100">{review?.result.status==='review'?showShares(review.result.quantity):showShares(Number(activeQuantity))}</p></div>
              <div className="ui-inset p-3"><p className="text-xs text-slate-400">{en?'SELL limit':'建议 SELL 限价'}</p>
                <p className="mt-1 text-xl font-semibold text-cyan-300">{review?.result.status==='review'?review.result.price:'—'}</p></div>
              <div className="ui-inset p-3"><p className="text-xs text-slate-400">{en?'Open SELL shares':'已有 SELL'}</p>
                <p className="mt-1 text-xl font-semibold text-amber-200">{showShares(observedSellShares(orders,active))}</p></div>
            </div>
            {review?.result.status==='review'&&review.result.quantity!==Number(activeQuantity)&&
              <p role="status" className="mt-3 rounded-lg border border-amber-500/40 bg-amber-950/20 p-3 text-xs leading-5 text-amber-200">
                {en?'Polymarket SDK accepts 0.01-share steps: requested ':'Polymarket SDK 按 0.01 份向下取整：原拟卖 '}
                {showShares(Number(activeQuantity))} → {showShares(review.result.quantity)}
                {en?'. The small remainder stays in your holdings; only the displayed rounded amount will be signed.':'。剩余碎份保留在持仓中；仅签名当前展示的实际订单份额。'}
              </p>}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
              <span>{en?'Quick quantity':'快捷数量（模拟可用份额）'}</span>
              <div className="flex gap-1">{([25,50,100] as const).map(percent=><button type="button" key={percent} disabled={busy}
                onClick={()=>updateDraft(active,{quantity:sellQuantityForPercent(indicativeUnreservedShares(activePosition.size,active,orders),percent)})}
                className="ui-button-quiet px-2.5 py-1 text-xs disabled:opacity-40">{percent}%</button>)}</div>
            </div>
            {summary&&<div className="ui-inset mt-3 space-y-1 p-3 text-xs text-slate-300">
              <p className="font-semibold text-cyan-200">{en?'APR and proceeds at SELL limit':'SELL 限价收益摘要'}</p>
              <p>{en?'Current Mark APR':'当前 Mark APR'}：{activePosition.markApr===null?'—':(activePosition.markApr*100).toFixed(2)+'%'} · {en?'Target':'目标'}：{activeApr}%</p>
              <p>{en?'APR at limit':'限价实际 APR'}：{summary.limitAprPercent===null?'—':summary.limitAprPercent.toFixed(2)+'%'}</p>
              <p>{en?'Gross proceeds':'限价卖出总额'}：{summary.grossProceeds===null?'—':'$'+summary.grossProceeds.toFixed(4)}</p>
              <p>{en?'P/L before fees':'对比成本收益（未扣费用）'}：{summary.profitVsAvgCost===null?'—':'$'+summary.profitVsAvgCost.toFixed(4)}</p>
            </div>}
            <details className="ui-inset mt-3 p-3 text-xs text-slate-300">
              <summary className="cursor-pointer">{en?'Existing SELL orders':'已有 SELL 明细'} ({orders.filter(o=>o.asset_id===active&&o.side==='SELL').length})</summary>
              {orders.filter(o=>o.asset_id===active&&o.side==='SELL').map(o=><p key={o.id} className="mt-2 break-all border-t border-slate-800 pt-2">
                SELL {o.original_size} @ {o.price} · {en?'Unfilled':'未成交'} {Math.max(0,Number(o.original_size)-Number(o.size_matched)).toFixed(6)} · {o.id}
              </p>)}
            </details>
          </div>
          <div className="ui-inset p-4 text-xs">
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


          {review&&<div className="space-y-3">
            {review.result.status==='blocked'&&<div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-950/20 p-3 text-xs text-amber-200">
              <p className="font-semibold">{en?'Order blocked':'暂不可下单'}</p>
              <p className="mt-1 break-words">{review.result.reasons.map(r=>r==='onchain_clob_balance_mismatch'?'CLOB 与链上持仓不一致，禁止交易':r==='onchain_balance_unverified'?'链上持仓无法核实，禁止交易':sellBlockReasonText(r,language)).join(' · ')}</p>
            </div>}
            {review.result.status==='review'&&<p className="text-sm font-semibold text-emerald-300">{en?'Quote calculated; check all safety conditions.':'已生成审核价格，请检查各项下单条件。'}</p>}
            <div className="ui-inset space-y-2 p-4 text-xs text-slate-300">
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


          {pending&&<p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-950/20 p-3 text-xs text-rose-200">
            {en?'Submission hold: reconcile official order history before placing more orders.':'提交保护中：请先在官网核对订单历史，禁止重复提交。'}
          </p>}
        </div>

        <footer className="max-h-[50dvh] shrink-0 space-y-3 overflow-y-auto border-t border-slate-700/35 bg-slate-950/50 px-5 py-4">
          {busy&&<div role="status" aria-live="polite" aria-busy="true" className="flex items-start gap-3 rounded-lg border border-indigo-400/50 bg-indigo-950/35 p-3 text-sm text-indigo-100">
            <span aria-hidden="true" className="mt-0.5 inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-indigo-300 border-t-transparent"/>
            {submitStage?(()=>{
              const progress=sellSubmitProgress(submitStage,language);
              return <div><p className="font-semibold">{progress.step} / {progress.total} · {progress.title}</p>
                <p className="mt-1 text-xs text-indigo-200/80">{progress.hint}</p></div>;
            })():<div><p className="font-semibold">{en?'Loading live SELL preflight…':'正在加载实时卖单审核…'}</p>
              <p className="mt-1 text-xs text-indigo-200/80">{en?'Read-only; wallet signature has not started.':'正在只读核对，尚未请求交易签名。'}</p></div>}
          </div>}
          {busy&&<div className="ui-progress-rail" aria-hidden="true"><span/></div>}
          {lastSubmission&&!busy&&<SellSubmissionBanner receipt={lastSubmission} language={language}
            onOpenOrders={()=>{leaveReview();onOpenOrders(lastSubmission.asset);}} onDismiss={()=>setLastSubmission(null)}/>}
          {message&&<p role="status" className="break-all rounded-lg border border-amber-600/30 bg-amber-950/20 p-3 text-xs text-amber-200">{message}</p>}
          {review&&<p className="text-xs text-slate-400">{en?'Review expires in':'审核剩余'} {seconds}s · {en?'Checked again after signing':'签名后重新校验全部条件'}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={leaveReview}
              className="ui-button-quiet px-4 py-2.5 text-sm disabled:opacity-50">{en?'Back to list':'返回列表'}</button>
            {lastSubmission?.asset===active&&lastSubmission.outcome==='live'&&!review?
              <button type="button" onClick={()=>{leaveReview();onOpenOrders(active);}}
                className="ui-button-secondary px-4 py-2.5 text-sm text-emerald-200">
                {en?'View confirmed SELL':'查看已挂订单'}</button>:
              <button type="button" disabled={busy||!ordersReady||pending||uncertain} onClick={()=>void prepareFor(active)}
                className="ui-button-secondary px-4 py-2.5 text-sm disabled:opacity-40">
                {en?'Recheck':'重新核验'}</button>}
            <button type="button" disabled={!signReady} onClick={()=>void execute()}
              className="ui-button-trade min-w-[165px] flex-1 px-4 py-2.5 text-sm font-bold disabled:cursor-not-allowed">
              {submitStage?<span className="inline-flex items-center justify-center gap-2">
                <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"/>
                {sellSubmitProgress(submitStage,language).title}
              </span>:lastSubmission?.asset===active&&!review?
                (lastSubmission.outcome==='live'?(en?'SELL confirmed':'SELL 已挂单'):(en?'Awaiting verification':'待核对订单')):
                (en?'Sign and submit SELL':'钱包签名并提交 SELL')}
            </button>
          </div>
          <p className="text-[11px] text-slate-500">{en?'No automatic signatures, orders, cancellations or replacements.':'不自动签名、下单、撤单或替换已有挂单。'}</p>
        </footer>
      </aside>
    </div>}
  </>;
}
