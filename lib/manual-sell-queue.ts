import { parseUnits } from 'viem';
import type { ClobOrder } from './browser-clob';
import type { SellPreflight } from './manual-sell-preflight';

export type QueueOutcome = 'queued' | 'reviewing' | 'signing' | 'open' | 'partially_filled' | 'matched_pending' | 'filled' | 'canceled' | 'expired' | 'rejected' | 'blocked' | 'uncertain';
export type QueueRecord = {status:QueueOutcome; orderId?:string; reason?:string; updatedAt:number};

/** Indicative holdings less observed open SELL; this is NOT an executable balance. */
export function indicativeUnreservedShares(held:number,asset:string,orders:ClobOrder[]):number|null {
  if(!Number.isFinite(held)||held<0)return null;
  let heldRaw:bigint;
  try{heldRaw=parseUnits(String(held),6);}catch{return null;}
  let reserved=0n;const seen=new Set<string>();
  for(const o of orders){
    if(!o.id||seen.has(o.id))return null;
    seen.add(o.id);
    if(o.asset_id!==asset||o.side!=='SELL')continue;
    try{
      const total=parseUnits(o.original_size,6),matched=parseUnits(o.size_matched,6);
      if(total<0n||matched<0n||matched>total)return null;
      reserved+=total-matched;
    }catch{return null;}
  }
  return reserved>heldRaw?null:Number(heldRaw-reserved)/1e6;
}

export function nextReviewAsset(selected:string[],records:Record<string,QueueRecord>,current:string):string|null {
 const remaining=selected.filter(id=>!['open','partially_filled','matched_pending','filled','uncertain'].includes(records[id]?.status??'queued'));
 if(!remaining.length)return null;
 const index=remaining.indexOf(current);
 return remaining[(index+1)%remaining.length]??null;
}

export function sameSellIntent(a:SellPreflight,b:SellPreflight):boolean {
 return a.status==='review' && b.status==='review'
 && a.price===b.price && a.quantity===b.quantity && a.side===b.side
 && a.orderType===b.orderType && a.postOnly===b.postOnly;
}

/** The actual EIP-712 exchange must be known before checking spend approval.
 * An unrelated spender's allowance does not establish permission.
 */
export function exchangeAllowanceSufficient(allowances:Record<string,string>,exchange:string|undefined,quantity:number):boolean {
 if(!exchange||!/^0x[0-9a-fA-F]{40}$/.test(exchange) || !Number.isFinite(quantity) || quantity<=0)return false;
 try{
   const needed=parseUnits(String(quantity),6);
   const actual=Object.entries(allowances).find(([address])=>address.toLowerCase()===exchange.toLowerCase());
   return !!actual && /^\d+$/.test(actual[1]) && BigInt(actual[1])>=needed;
 }catch{return false;}
}

export type PendingSellAttempt = {address:string;funder:string;asset:string;quantity:number;price:number;at:number;orderId?:string};
export function pendingAttemptKey(address:string,funder:string):string {
 return 'poly:sell-submit:v1:'+address.toLowerCase()+':'+funder.toLowerCase();
}
export function isCurrentPendingAttempt(raw:string|null,address:string,funder:string):boolean {
 if(!raw)return false;
 try{
   const value=JSON.parse(raw) as Partial<PendingSellAttempt>;
   return value.address?.toLowerCase()===address.toLowerCase()
    && value.funder?.toLowerCase()===funder.toLowerCase()
    && typeof value.asset==='string' && !!value.asset
    && typeof value.at==='number' && Number.isFinite(value.at);
 }catch{return false;}
}


/** Do not unlock a signed submission merely because POST returned a success response.
 * A complete, maker-filtered CLOB open-order snapshot must contain the exact
 * order ID and the expected SELL intent. Missing orders require manual history
 * verification (they may have matched, been canceled or expired).
 */
export function matchingLiveSellOrder(orders:ClobOrder[],intent:{
  orderId:string;asset:string;funder:string;price:number;quantity:number;
}):ClobOrder|null{
 if(!intent.orderId||!intent.asset||!/^0x[0-9a-f]{40}$/i.test(intent.funder))return null;
 if(!Number.isFinite(intent.price)||intent.price<=0||intent.price>=1||!Number.isFinite(intent.quantity)||intent.quantity<=0)return null;
 let expectedPrice:bigint,expectedSize:bigint;
 try{expectedPrice=parseUnits(String(intent.price),6);expectedSize=parseUnits(String(intent.quantity),6);}catch{return null;}
 const matches=orders.filter(o=>o.id.toLowerCase()===intent.orderId.toLowerCase());
 if(matches.length!==1)return null;
 const order=matches[0];
 if(order.asset_id!==intent.asset||order.maker_address.toLowerCase()!==intent.funder.toLowerCase()
   ||order.side!=='SELL'||order.status.toUpperCase()!=='LIVE')return null;
 try {
  const price=parseUnits(order.price,6),total=parseUnits(order.original_size,6),filled=parseUnits(order.size_matched,6);
  return price===expectedPrice&&total===expectedSize&&filled>=0n&&filled<total?order:null;
 } catch{return null;}
}

export function validatedPendingAttempt(raw:string|null,address:string,funder:string):PendingSellAttempt|null{
 if(!isCurrentPendingAttempt(raw,address,funder))return null;
 try{
  const v=JSON.parse(raw!) as PendingSellAttempt;
  if(!/^\d{1,100}$/.test(v.asset)||!Number.isFinite(v.price)||v.price<=0||v.price>=1||
     !Number.isFinite(v.quantity)||v.quantity<=0||v.at<=0||
     (v.orderId!==undefined&&(typeof v.orderId!=='string'||!v.orderId)))return null;
  return v;
 }catch{return null;}
}

export function matchingPendingOpenSell(raw:string|null,address:string,funder:string,orders:ClobOrder[]):ClobOrder|null{
 const attempt=validatedPendingAttempt(raw,address,funder);
 if(!attempt?.orderId)return null;
 return matchingLiveSellOrder(orders,{orderId:attempt.orderId,asset:attempt.asset,funder,price:attempt.price,quantity:attempt.quantity});
}

export function persistedAcceptedOrder(raw:string|null,address:string,funder:string,orderId:string):string|null{
 const attempt=validatedPendingAttempt(raw,address,funder);
 if(!attempt||!orderId)return null;
 return JSON.stringify({...attempt,orderId});
}

/** Open-order absence never establishes a fill/cancel; local state needs reconciling. */
export function displayedSellQueueRecord(record:QueueRecord|undefined,asset:string,orders:ClobOrder[],snapshotReady:boolean):QueueRecord|undefined{
 if(!record||!['open','partially_filled'].includes(record.status))return record;
 const item=record.orderId&&orders.find(o=>o.id.toLowerCase()===record.orderId?.toLowerCase()&&o.asset_id===asset&&o.side==='SELL'&&o.status.toUpperCase()==='LIVE');
 if(!snapshotReady||!item)return {...record,status:'uncertain',reason:snapshotReady?'order_missing_from_open_snapshot':'snapshot_not_verified'};
 return {...record,status:Number(item.size_matched)>0?'partially_filled':'open',reason:undefined};
}
