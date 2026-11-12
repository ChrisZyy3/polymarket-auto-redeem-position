// Auto Sell V2 order reconciliation: pure, read-only, maker-first decision engine.
//
// It NEVER sends transactions, signs, posts or cancels orders. Inputs MUST be
// complete, authenticated CLOB order snapshots and verified on-chain balances
// before an execution adapter can use this plan. No "empty array" defaults for
// unavailable orders: unknown != zero open orders.
export const GTD_EFFECTIVE_SECONDS = 7 * 24 * 60 * 60;
export const GTD_SECURITY_OFFSET_SECONDS = 60;
export const GTD_RENEW_WINDOW_SECONDS = 24 * 60 * 60;
export const RECONCILIATION_MODE = "maker-post-only-gtd7-dry-run";
const EPS = 1e-8;
const roundShares = n => Number(Number(n).toFixed(6));
const roundPrice = n => Number(Number(n).toFixed(10));
const finite = n => n !== null && n !== undefined && n !== "" && Number.isFinite(Number(n));
const numeric = (n, label) => {
  if (!finite(n) || Number(n)<0) throw new Error("Invalid "+label);
  return Number(n);
};
const isLive = status => ["LIVE","ORDER_STATUS_LIVE"].includes(status);
const terminal = status => ["CANCELED","ORDER_STATUS_CANCELED",
  "CANCELED_MARKET_RESOLVED","ORDER_STATUS_CANCELED_MARKET_RESOLVED",
  "INVALID","ORDER_STATUS_INVALID","MATCHED","ORDER_STATUS_MATCHED"].includes(status);
const statusNormalized = input => String(input??"").trim().toUpperCase();
const blocked = (reason, attrs={}) => ({mode:RECONCILIATION_MODE,
  action:"blocked",reason,postOnly:true,orderType:"GTD",
  expirationToSubmit:null,proposedLimitPrice:null,...attrs});
const validFresh = (stamp,now,age) => finite(stamp) &&
  Number(stamp)<=now+5 && now-Number(stamp)<=age;
const validWallet = wallet => /^0x[a-f0-9]{40}$/i.test(String(wallet??""));

export function gtdExpirationForSubmission(nowSec) {
  if(!Number.isInteger(nowSec)||nowSec<=0)throw new Error("Invalid GTD clock");
  // Polymarket expires GTD one minute before the stated expiration.
  return nowSec + GTD_EFFECTIVE_SECONDS + GTD_SECURITY_OFFSET_SECONDS;
}
export function ceilMakerPrice(price,tick) {
  if(!finite(price)||!finite(tick)||Number(tick)<=0||Number(tick)>=1||
     Number(price)<=0||Number(price)>=1) return null;
  const t=Number(tick),p=Number(price);
  const upper=roundPrice(1-t);
  const proposed=roundPrice(Math.ceil((p-1e-12)/t)*t);
  if(proposed<p-EPS||proposed>upper+EPS||proposed<=0)return null;
  return proposed;
}

/**
 * authOrders is null on unavailable/unauthenticated or incomplete reads.
 * snapshot = {complete:true,asOf:Unix seconds,orders:[CLOB OpenOrder...]}.
 * position shares MUST represent TOTAL shares, not the CLOB available balance;
 * availableBalanceShares is optional, already net of reservations, and is
 * compared as an additional CAP rather than being deducted a second time.
 */
export function reconcileAutoSellMaker(input) {
  const {wallet,tokenId,nowSec,positionShares,positionAsOf,authOrders,
    managedOrderIds=[],targetFloorPrice,quote,
    availableBalanceShares=null,minOrderShares=0.01,confirmedTerminalOrderIds=[]} = input||{};
  if(!Number.isInteger(nowSec)||nowSec<=0||!validWallet(wallet)||
      !String(tokenId??"").trim())return blocked("invalid_identity_or_clock");
  if(!validFresh(positionAsOf,nowSec,600))return blocked("positions_stale");
  if(!finite(positionShares)||Number(positionShares)<=0)return blocked("position_missing_or_invalid");
  if(authOrders==null||authOrders.complete!==true||!Array.isArray(authOrders.orders))
    return blocked("authenticated_open_orders_unavailable");
  if(!validFresh(authOrders.asOf,nowSec,120))return blocked("orders_stale");
  if(!Array.isArray(managedOrderIds)||managedOrderIds.some(x=>typeof x!=="string"||!x)||
     !Array.isArray(confirmedTerminalOrderIds) ||
     confirmedTerminalOrderIds.some(x=>typeof x!=="string"||!x))
    return blocked("invalid_order_identity_list");
  if(!finite(targetFloorPrice)||Number(targetFloorPrice)<=0||Number(targetFloorPrice)>=1)
    return blocked("target_apr_floor_unverified");
  const total=Number(positionShares);
  if(!finite(minOrderShares)||Number(minOrderShares)<=0)return blocked("invalid_min_order_size");
  let netCap=total;
  if(availableBalanceShares!==null){
    if(!finite(availableBalanceShares))return blocked("spendable_balance_unverified");
    // This may be already net available: never subtract reservations twice.
    netCap=Math.min(total,Math.max(0,Number(availableBalanceShares)));
  }
  const target=String(tokenId);
  const ids=new Set(), managed=new Set(managedOrderIds),
    terminalConfirmed=new Set(confirmedTerminalOrderIds),live=[];
  const unknownStatuses=[];
  for(const order of authOrders.orders){
    if(!order||typeof order!=="object")return blocked("malformed_order_page");
    // Account L2 auth may expose multiple maker addresses. Only reconcile
    // orders from the exact wallet; missing maker identity must fail closed.
    if(!validWallet(order.maker_address))return blocked("order_wallet_unverified");
    if(order.maker_address.toLowerCase()!==wallet.toLowerCase())continue;
    if(String(order.asset_id??"")!==target)continue;
    const id=String(order.id??"");
    if(!id||ids.has(id))return blocked("missing_or_duplicate_order_id");
    ids.add(id);
    const side=String(order.side??"").toUpperCase();
    if(side!=="SELL"&&side!=="BUY")return blocked("unknown_order_side");
    if(side==="BUY")continue;
    const status=statusNormalized(order.status);
    if(!isLive(status)&&!terminal(status)){
      unknownStatuses.push(status);continue;
    }
    let orig, matched;
    try{
      orig=numeric(order.original_size,"original size");
      matched=numeric(order.size_matched,"matched size");
    }catch{return blocked("invalid_order_numeric_fields");}
    if(matched>orig+EPS)return blocked("matched_exceeds_original");
    const remain=roundShares(Math.max(0,orig-matched));
    if(status==="MATCHED"||status==="ORDER_STATUS_MATCHED"){
      if(remain>EPS)return blocked("matched_status_has_unconfirmed_remainder");
      continue;
    }
    if(!isLive(status))continue;
    if(remain<=EPS)continue;
    let px;
    try{px=numeric(order.price,"order price");}
    catch{return blocked("invalid_order_numeric_fields");}
    if(px<=0||px>=1)return blocked("invalid_order_price");
    const expiry=Number(order.expiration??0);
    if(!Number.isFinite(expiry)||expiry<0)return blocked("invalid_order_expiration");
    // A LIVE GTD order apparently past its expiry needs another query before
    // treating shares as free or attempting to replace it.
    if(expiry>0 && expiry-GTD_SECURITY_OFFSET_SECONDS<=nowSec)
      return blocked("live_order_expiration_unconfirmed");
    live.push({id,price:px,remainingShares:remain,
      expiration:expiry,orderType:String(order.order_type??"").toUpperCase(),
      autoManaged:managed.has(id)});
  }
  if(unknownStatuses.length)return blocked("unknown_sell_order_status");
  // /data/orders often returns only LIVE orders. A missing Auto Sell order
  // may be filled, canceled, or a stale response. Require an independent
  // terminal confirmation before treating its reserved shares as reusable.
  const stillLive=new Set(live.filter(o=>o.autoManaged).map(o=>o.id));
  if([...managed].some(id=>!stillLive.has(id)&&!terminalConfirmed.has(id)))
    return blocked("managed_order_terminal_state_unverified");
  const reserved=roundShares(live.reduce((sum,o)=>sum+o.remainingShares,0));
  if(reserved>total+EPS)return blocked("orders_reserved_exceed_position");
  const manual=live.filter(o=>!o.autoManaged),owned=live.filter(o=>o.autoManaged);
  const manuallyReserved=roundShares(manual.reduce((sum,o)=>sum+o.remainingShares,0));
  const managedReserved=roundShares(owned.reduce((sum,o)=>sum+o.remainingShares,0));
  const remaining=roundShares(Math.max(0,total-reserved));
  const free=roundShares(Math.min(remaining,netCap));
  const belowFloorManual=manual.filter(o=>o.price+EPS<Number(targetFloorPrice)).map(o=>o.id);
  const common={wallet:wallet.toLowerCase(),tokenId:target,positionShares:total,
    reservedShares:reserved,manualReservedShares:manuallyReserved,
    managedReservedShares:managedReserved,availableToNewOrder:free,
    manualBelowFloorOrderIds:belowFloorManual,activeSellCount:live.length,
    managedOrders:owned.map(o=>({...o})),observedAt:nowSec};
  if(owned.length>1)return blocked("multiple_managed_orders_need_review",common);
  if(owned.length===1){
    const o=owned[0];
    const expiredSoon=o.expiration>0 &&
      (o.expiration-GTD_SECURITY_OFFSET_SECONDS-nowSec)<=GTD_RENEW_WINDOW_SECONDS;
    const compliantPrice=o.price+EPS>=Number(targetFloorPrice);
    if(!compliantPrice||o.orderType!=="GTD"||o.expiration<=0){
      return {mode:RECONCILIATION_MODE,action:"would_cancel_then_reconcile",postOnly:true,
        orderType:"GTD",reason:!compliantPrice?"managed_price_below_apr_floor":"managed_order_not_gtd",
        protectedOrderId:o.id,proposedLimitPrice:null,expirationToSubmit:null,...common};
    }
    if(expiredSoon){
      return {mode:RECONCILIATION_MODE,action:"would_renew_gtd",postOnly:true,
        orderType:"GTD",reason:"under_24h_to_expiry",
        protectedOrderId:o.id,proposedLimitPrice:null,expirationToSubmit:null,...common};
    }
    // Do not chase best ask or reset FIFO queue when compliant.
    return {mode:RECONCILIATION_MODE,action:"keep_existing",postOnly:true,
      orderType:"GTD",reason:"price_compliant_keep_queue",
      protectedOrderId:o.id,proposedLimitPrice:null,expirationToSubmit:null,...common};
  }
  if(free+EPS<Number(minOrderShares)){
    return {mode:RECONCILIATION_MODE,action:"no_available_shares",
      reason:"all_shares_reserved_or_below_minimum",postOnly:true,orderType:"GTD",
      proposedLimitPrice:null,expirationToSubmit:null,...common};
  }
  if(!quote||!validFresh(quote.asOf,nowSec,120)||
     quote.tickVerified!==true||
     !finite(quote.tickSize)||Number(quote.tickSize)<=0||
     !finite(quote.bestAsk)||!finite(quote.bestBid))
    return blocked("live_orderbook_or_tick_unverified",common);
  const tick=Number(quote.tickSize),bid=Number(quote.bestBid),ask=Number(quote.bestAsk);
  if(!(bid>=0 && bid<1 && ask>0 && ask<1) || bid>=ask-EPS)
    return blocked("crossed_or_invalid_orderbook",common);
  // Never silently move the displayed best ask to a different price level.
  if(Math.abs(Math.round(ask/Number(quote.tickSize))*Number(quote.tickSize)-ask)>EPS)
    return blocked("best_ask_not_on_tick",common);
  const floor=ceilMakerPrice(Number(targetFloorPrice),tick);
  const price=ceilMakerPrice(Math.max(ask,Number(targetFloorPrice)),tick);
  if(floor===null||price===null)return blocked("floor_above_legal_tick",common);
  if(price<=bid+EPS)return blocked("post_only_would_take_liquidity",common);
  return {mode:RECONCILIATION_MODE,action:"would_create_post_only",
    reason:"new_maker_sell_at_ask_or_floor",postOnly:true,orderType:"GTD",
    proposedLimitPrice:price,minimumAprPrice:floor,
    expirationToSubmit:gtdExpirationForSubmission(nowSec),
    effectiveGtdSeconds:GTD_EFFECTIVE_SECONDS,
    proposedShares:free,...common};
}
