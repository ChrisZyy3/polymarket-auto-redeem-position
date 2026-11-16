import { ceilToTick } from "./poly-yield/yield";

export type OpenSell = { id:string; assetId:string; side:"BUY"|"SELL"; originalSize:number; matchedSize:number };
export type SellPreflightInput = {
  nowMs:number; signer:string; funder:string; safeMatches:boolean;
  assetId:string; targetAprPercent:number; settlementMs:number|null; settlementConfirmed:boolean;
  positionShares:number; positionAsOfMs:number; positionFreshMs?:number;
  orders:OpenSell[]|null; ordersAsOfMs:number|null; ordersComplete:boolean; ordersCoverWallet:boolean;
  availableShares:number|null; balanceAsOfMs:number|null;
  bestBid:number|null; bestAsk:number|null; tick:number|null; tickVerified:boolean; bookAsOfMs:number|null;
  minimumOrderShares:number|null; requestedShares:number;
};
export type SellPreflight = { status:"blocked"; reasons:string[] } | {
  status:"review"; price:number; quantity:number; observedReservedShares:number;
  effectiveGtdSeconds:number; expirationSec:number; postOnly:true; orderType:"GTD"; side:"SELL";
};
const fresh=(timestamp:number|null,now:number,max:number)=>timestamp!==null&&Number.isFinite(timestamp)&&timestamp<=now&&now-timestamp<=max;
const finitePositive=(n:number|null):n is number=>n!==null&&Number.isFinite(n)&&n>0;
const validAddress=(s:string)=>/^0x[\da-f]{40}$/i.test(s);

/** Pure preparation only. A successful result does not sign or submit an order. */
export function prepareManualSell(i:SellPreflightInput):SellPreflight {
  const reasons:string[]=[];
  if(!Number.isFinite(i.nowMs)||!validAddress(i.signer)||!validAddress(i.funder)||!i.safeMatches)reasons.push("wallet_unverified");
  if(!i.settlementConfirmed||!finitePositive(i.settlementMs)||i.settlementMs<=i.nowMs)reasons.push("settlement_unverified");
  if(!Number.isFinite(i.targetAprPercent)||i.targetAprPercent<=0||i.targetAprPercent>10000)reasons.push("invalid_apr");
  if(!finitePositive(i.positionShares)||!fresh(i.positionAsOfMs,i.nowMs,i.positionFreshMs??600000))reasons.push("position_stale_or_invalid");
  if(!i.ordersComplete||!i.ordersCoverWallet||!Array.isArray(i.orders)||!fresh(i.ordersAsOfMs,i.nowMs,120000))reasons.push("orders_unverified_or_stale");
  if(i.availableShares===null||!Number.isFinite(i.availableShares)||i.availableShares<0||!fresh(i.balanceAsOfMs,i.nowMs,120000))reasons.push("balance_unverified_or_stale");
  if(!finitePositive(i.bestBid)||!finitePositive(i.bestAsk)||i.bestBid>=i.bestAsk||i.bestAsk>=1||!finitePositive(i.tick)||i.tick>=1||!i.tickVerified||!fresh(i.bookAsOfMs,i.nowMs,120000))reasons.push("book_unverified_or_stale");
  if(!finitePositive(i.requestedShares)||!finitePositive(i.minimumOrderShares)||i.requestedShares<i.minimumOrderShares)reasons.push("invalid_quantity");
  let reserved=0;const ids=new Set<string>();
  if(Array.isArray(i.orders))for(const o of i.orders){
    if(!o.id||ids.has(o.id)||!o.assetId||!["BUY","SELL"].includes(o.side)||!Number.isFinite(o.originalSize)||!Number.isFinite(o.matchedSize)||o.originalSize<0||o.matchedSize<0||o.matchedSize>o.originalSize){reasons.push("invalid_order_snapshot");break;}
    ids.add(o.id);if(o.assetId===i.assetId&&o.side==="SELL")reserved+=o.originalSize-o.matchedSize;
  }
  if(!i.assetId||!Number.isFinite(reserved)||reserved>i.positionShares+1e-8)reasons.push("invalid_reservations");
  // availableShares is already net of reservations: never subtract twice.
  if(Number.isFinite(i.requestedShares) && (i.requestedShares>i.positionShares-reserved+1e-8 || (i.availableShares!==null && i.requestedShares>i.availableShares+1e-8)))reasons.push("insufficient_available_shares");
  if(reasons.length)return {status:"blocked",reasons:[...new Set(reasons)]};
  const days=(i.settlementMs!-i.nowMs)/86400000;
  const floor=1/(1+i.targetAprPercent/100*days/365);
  const price=ceilToTick(Math.max(floor,i.bestAsk!),i.tick!);
  if(!Number.isFinite(price)||price>=1||price>1-i.tick!+1e-10||price<=i.bestBid!)return {status:"blocked",reasons:["no_legal_post_only_price"]};
  return {status:"review",price,quantity:i.requestedShares,observedReservedShares:reserved,effectiveGtdSeconds:604800,expirationSec:Math.floor(i.nowMs/1000)+604800+60,postOnly:true,orderType:"GTD",side:"SELL"};
}
