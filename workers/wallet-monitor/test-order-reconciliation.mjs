import assert from "node:assert/strict";
import { reconcileAutoSellMaker,ceilMakerPrice,gtdExpirationForSubmission,
  GTD_EFFECTIVE_SECONDS,GTD_SECURITY_OFFSET_SECONDS } from "./order-reconciliation.mjs";

const now=1794500000;
const wallet="0x1111111111111111111111111111111111111111";
const other="0x2222222222222222222222222222222222222222";
const tokenId="token-no";
const order=(id,opts={})=>({
  id,asset_id:tokenId,maker_address:wallet,side:"SELL",
  original_size:"300",size_matched:"100",status:"LIVE",
  price:"0.993",order_type:"GTD",
  expiration:String(now+GTD_EFFECTIVE_SECONDS+GTD_SECURITY_OFFSET_SECONDS),
  ...opts
});
const base=(extra={})=>({
 wallet,tokenId,nowSec:now,positionShares:1000,positionAsOf:now-60,
 authOrders:{complete:true,asOf:now-10,orders:[]},
 managedOrderIds:[],targetFloorPrice:0.9903,
 quote:{bestBid:0.992,bestAsk:0.994,tickSize:0.0001,asOf:now-5},
 minOrderShares:1,...extra
});
const run=(orders=[],extra={})=>reconcileAutoSellMaker(base({
 authOrders:{complete:true,asOf:now-10,orders},...extra
}));
let p=run();
assert.equal(p.action,"would_create_post_only");
assert.equal(p.mode,"maker-post-only-gtd7-dry-run");
assert.equal(p.proposedLimitPrice,0.994);
assert.equal(p.minimumAprPrice,0.9903);
assert.equal(p.proposedShares,1000);
assert.equal(p.expirationToSubmit,now+7*24*3600+60);
assert.equal(p.expirationToSubmit-now-GTD_SECURITY_OFFSET_SECONDS,GTD_EFFECTIVE_SECONDS);
assert.equal(p.postOnly,true);assert.equal(p.orderType,"GTD");
assert.equal(p.action.includes("market"),false);
assert.equal(ceilMakerPrice(0.99031,0.0001),0.9904);
assert.equal(ceilMakerPrice(0.999999,0.001),null);
assert.equal(gtdExpirationForSubmission(now),now+604860);
console.log("Passed: maker-first best ask, 7-day GTD, correct security offset, tick ceiling");

p=run([], {quote:{bestBid:0.985,bestAsk:0.989,tickSize:0.001,asOf:now}});
assert.equal(p.action,"would_create_post_only");
assert.equal(p.proposedLimitPrice,0.991, "never sell below minimum APR floor");

p=run([order("manual-1",{price:"0.989"})]);
assert.equal(p.action,"would_create_post_only");
assert.equal(p.reservedShares,200);
assert.equal(p.manualReservedShares,200);
assert.equal(p.availableToNewOrder,800);
assert.equal(p.proposedShares,800);
assert.deepEqual(p.manualBelowFloorOrderIds,["manual-1"]);
assert.deepEqual(p.managedOrders,[]);
console.log("Passed: existing manual SELL reduces total shares; never canceled or taken over");

p=run([order("managed-1",{price:"0.996",original_size:"900",size_matched:"100"})],
  {managedOrderIds:["managed-1"],quote:{bestBid:0.995,bestAsk:0.997,tickSize:0.001,asOf:now}});
assert.equal(p.action,"keep_existing");
assert.equal(p.protectedOrderId,"managed-1");
assert.equal(p.reservedShares,800);
assert.equal(p.availableToNewOrder,200);
assert.equal(p.proposedLimitPrice,null, "never reprice just because the ask moved");
assert.equal(p.managedOrders.length,1);
console.log("Passed: queue-preserving keep of compliant managed order, no chase repricing");

p=run([order("managed-2",{price:"0.989"})],{managedOrderIds:["managed-2"]});
assert.equal(p.action,"would_cancel_then_reconcile");
assert.equal(p.protectedOrderId,"managed-2");
assert.equal(p.reason,"managed_price_below_apr_floor");
assert.equal(p.proposedLimitPrice,null,"never post replacement before confirmed cancellation");

p=run([order("managed-3",{expiration:String(now+12*3600+60)})],
  {managedOrderIds:["managed-3"]});
assert.equal(p.action,"would_renew_gtd");
assert.equal(p.proposedLimitPrice,null);

p=run([order("managed-4",{order_type:"GTC",expiration:"0"})],
  {managedOrderIds:["managed-4"]});
assert.equal(p.action,"would_cancel_then_reconcile");
assert.equal(p.reason,"managed_order_not_gtd");
console.log("Passed: under-floor / non-GTD orders need cancel confirmation; nearing expiration prompts renewal");

p=run([order("manual-1")],{availableBalanceShares:300});
assert.equal(p.availableToNewOrder,300,"already-net available must not have reservations deducted twice");
assert.equal(p.proposedShares,300);
p=run([order("manual-1"),order("manual-2",{original_size:"800",size_matched:"0"})]);
assert.equal(p.action,"no_available_shares");
p=run([order("overallocated",{original_size:"1200",size_matched:"0"})]);
assert.equal(p.action,"blocked");assert.equal(p.reason,"orders_reserved_exceed_position");
console.log("Passed: holdings reservation, net CLOB balance cap and oversubscription protection");

const missing=reconcileAutoSellMaker(base({authOrders:null}));
assert.equal(missing.action,"blocked");
assert.equal(missing.reason,"authenticated_open_orders_unavailable");
assert.equal(reconcileAutoSellMaker(base({authOrders:{complete:false,asOf:now,orders:[]}})).action,"blocked");
assert.equal(reconcileAutoSellMaker(base({authOrders:{complete:true,asOf:now-121,orders:[]}})).reason,"orders_stale");
assert.equal(reconcileAutoSellMaker(base({positionAsOf:now-601})).reason,"positions_stale");
assert.equal(run([],{quote:{bestBid:0.995,bestAsk:0.994,tickSize:0.001,asOf:now}}).reason,"crossed_or_invalid_orderbook");
assert.equal(run([],{quote:{bestBid:0.992,bestAsk:0.994,tickSize:0.001,asOf:now-121}}).reason,"live_orderbook_or_tick_unverified");
assert.equal(run([],{targetFloorPrice:0.9999,quote:{bestBid:0.99,bestAsk:0.995,tickSize:0.001,asOf:now}}).reason,"floor_above_legal_tick");
assert.equal(run([order("duplicate"),order("duplicate")]).reason,"missing_or_duplicate_order_id");
assert.equal(run([order("unknown-status",{status:"DELAYED"})]).reason,"unknown_sell_order_status");
assert.equal(run([order("unconfirmed-expiry",{expiration:String(now+30)})]).reason,"live_order_expiration_unconfirmed");
assert.equal(run([order("other-maker",{maker_address:other})]).reservedShares,0);
assert.equal(run([order("bids-dont-reserve",{side:"BUY"})]).reservedShares,0);
assert.equal(run([order("settling",{status:"MATCHED",original_size:"300",size_matched:"100"})]).reason,"matched_status_has_unconfirmed_remainder");
console.log("Passed: fail-closed on missing orders, stale books, crossing, expiry, duplication, malformed status");
