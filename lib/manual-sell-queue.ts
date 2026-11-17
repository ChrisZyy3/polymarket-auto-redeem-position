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
