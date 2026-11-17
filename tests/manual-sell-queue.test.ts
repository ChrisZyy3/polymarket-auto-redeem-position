import test from 'node:test';
import assert from 'node:assert/strict';
import { indicativeUnreservedShares, nextReviewAsset, sameSellIntent, exchangeAllowanceSufficient, isCurrentPendingAttempt, matchingLiveSellOrder, matchingPendingOpenSell, persistedAcceptedOrder } from '../lib/manual-sell-queue';
import { verifiedOrderLifecycle } from '../lib/order-review-status';
import type { ClobOrder } from '../lib/browser-clob';
const order=(id:string, asset:string,original:string,matched:string):ClobOrder=>({id,asset_id:asset,maker_address:'0x'+'1'.repeat(40),side:'SELL',status:'LIVE',price:'0.9',original_size:original,size_matched:matched});
test('multiple holdings, partial fills and existing orders yield indicative quantities',()=>{
 const orders=[order('1','a','10','4'),order('2','a','5','0'),order('3','b','7','3')];
 assert.equal(indicativeUnreservedShares(50,'a',orders),39);
 assert.equal(indicativeUnreservedShares(30,'b',orders),26);
 assert.equal(indicativeUnreservedShares(9,'a',orders),null);
 assert.equal(indicativeUnreservedShares(50,'a',[orders[0],orders[0]]),null);
});
test('queue only advances by explicit user action; known accepted/unknown are not replayed',()=>{
 const now=Date.now(),records={a:{status:'open' as const,updatedAt:now},b:{status:'uncertain' as const,updatedAt:now},c:{status:'queued' as const,updatedAt:now}};
 assert.equal(nextReviewAsset(['a','b','c'],records,'a'),'c');
 assert.equal(nextReviewAsset(['a','b'],records,'a'),null);
});
test('changed quote invalidates the prior signing review',()=>{
 const a={status:'review' as const,price:0.99,quantity:10,side:'SELL' as const,orderType:'GTD' as const,postOnly:true as const,effectiveGtdSeconds:604800,expirationSec:1000,observedReservedShares:0};
 assert.equal(sameSellIntent(a,{...a}),true);
 assert.equal(sameSellIntent(a,{...a,price:0.98}),false);
 assert.equal(sameSellIntent(a,{status:'blocked',reasons:['book_changed']}),false);
});
test('spend authorization must match actual signing exchange and quantity',()=>{
 const exchange='0x'+'a'.repeat(40),wrong='0x'+'b'.repeat(40);
 assert.equal(exchangeAllowanceSufficient({[exchange]:'5000000'},exchange,5),true);
 assert.equal(exchangeAllowanceSufficient({[exchange]:'5000000'},exchange,5.000001),false);
 assert.equal(exchangeAllowanceSufficient({[wrong]:'999999999'},exchange,5),false);
 assert.equal(exchangeAllowanceSufficient({},undefined,1),false);
});
test('account switching and malformed persisted pending attempts do not leak state',()=>{
 const address='0x'+'1'.repeat(40),safe='0x'+'2'.repeat(40),raw=JSON.stringify({address,funder:safe,asset:'123',price:.9,quantity:5,at:1234});
 assert.equal(isCurrentPendingAttempt(raw,address,safe),true);
 assert.equal(isCurrentPendingAttempt(raw,'0x'+'3'.repeat(40),safe),false);
 assert.equal(isCurrentPendingAttempt('{',address,safe),false);
});
test('missing orders and ambiguous network outcomes are unknown, never automatically canceled',()=>{
 assert.equal(verifiedOrderLifecycle(null),'unknown');
 assert.equal(verifiedOrderLifecycle({status:'LIVE',original_size:'100',size_matched:'40'}),'partially_filled');
 assert.equal(verifiedOrderLifecycle({status:'LIVE',original_size:'100',size_matched:'100'}),'matched_pending');
 assert.equal(verifiedOrderLifecycle({status:'CANCELED'}),'canceled');
 assert.equal(verifiedOrderLifecycle({status:'EXPIRED'}),'expired');
 assert.equal(verifiedOrderLifecycle({status:'FILLED'}),'filled');
 assert.equal(verifiedOrderLifecycle({status:'MATCHED'}),'matched_pending');
});


test('accepted response only unlocks after a complete verified live SELL id and exact intent match',()=>{
 const maker='0x'+'a'.repeat(40),asset='123456789',id='0x'+'b'.repeat(64);
 const live:ClobOrder={id,asset_id:asset,maker_address:maker,side:'SELL',status:'LIVE',price:'0.986',original_size:'11',size_matched:'0'};
 const intent={orderId:id,asset,funder:maker,price:0.986,quantity:11};
 assert.equal(matchingLiveSellOrder([live],intent)?.id,id);
 assert.equal(matchingLiveSellOrder([{...live,size_matched:'4'}],intent)?.id,id);
 assert.equal(matchingLiveSellOrder([],intent),null);
 assert.equal(matchingLiveSellOrder([{...live,asset_id:'different'}],intent),null);
 assert.equal(matchingLiveSellOrder([{...live,side:'BUY'}],intent),null);
 assert.equal(matchingLiveSellOrder([{...live,price:'0.985'}],intent),null);
 assert.equal(matchingLiveSellOrder([{...live,original_size:'12'}],intent),null);
 assert.equal(matchingLiveSellOrder([{...live,maker_address:'0x'+'c'.repeat(40)}],intent),null);
 assert.equal(matchingLiveSellOrder([live,live],intent),null);
 assert.equal(matchingLiveSellOrder([{...live,status:'CANCELED'}],intent),null);
});
test('pending order id is written after accept, verified on reload, and scoped to the same Safe',()=>{
 const address='0x'+'1'.repeat(40),maker='0x'+'2'.repeat(40),id='0x'+'e'.repeat(64),asset='123456789';
 const pending=JSON.stringify({address,funder:maker,asset,price:0.986,quantity:11,at:Date.now()});
 const acknowledged=persistedAcceptedOrder(pending,address,maker,id);
 assert.ok(acknowledged);
 const live:ClobOrder={id,asset_id:asset,maker_address:maker,side:'SELL',status:'LIVE',price:'0.986',original_size:'11',size_matched:'0'};
 assert.equal(matchingPendingOpenSell(acknowledged,address,maker,[live])?.id,id);
 assert.equal(matchingPendingOpenSell(pending,address,maker,[live]),null);
 assert.equal(matchingPendingOpenSell(acknowledged,'0x'+'3'.repeat(40),maker,[live]),null);
 assert.equal(matchingPendingOpenSell(acknowledged,address,'0x'+'4'.repeat(40),[live]),null);
 assert.equal(matchingPendingOpenSell(acknowledged,address,maker,[]),null);
 assert.equal(persistedAcceptedOrder(null,address,maker,id),null);
});
