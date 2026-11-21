import test from 'node:test';
import assert from 'node:assert/strict';
import { settlementConfirmedForDate, nextAfterVerifiedSell, sellReviewConfigKey, sellQuantityForPercent, sellLimitSummary } from '../lib/sell-workbench-flow';
import type { QueueRecord } from '../lib/manual-sell-queue';
import { normalizeMarketEndDate, verifyMarketSettlementDate } from '../lib/sell-settlement-verification';

test('auto verification only accepts exact independently matched market dates',()=>{
 assert.equal(normalizeMarketEndDate('2099-01-01T00:00:00Z'),'2099-01-01');
 assert.equal(normalizeMarketEndDate('2099-02-29'),null);
 assert.equal(normalizeMarketEndDate('2099-1-01'),null);
 assert.equal(verifyMarketSettlementDate('2099-01-01','2099-01-01T00:00:00Z').verified,true);
 for(const marketDate of [null,undefined,'2099-01-02T00:00:00Z','unavailable','2099-02-29'])
  assert.equal(verifyMarketSettlementDate('2099-01-01',marketDate).verified,false);
});

test('settlement confirmation belongs to the exact market date, never a missing or changed estimate',()=>{
 assert.equal(settlementConfirmedForDate('2027-01-01','2027-01-01'),true);
 assert.equal(settlementConfirmedForDate('2027-01-01','2027-01-02'),false);
 assert.equal(settlementConfirmedForDate('2027-01-01',null),false);
 assert.equal(settlementConfirmedForDate('',null),false);
 assert.equal(settlementConfirmedForDate(undefined,'2027-01-01'),false);
});
test('batch navigation requires a verified exact live SELL; never navigates on unknown POST',()=>{
 const records:Record<string,QueueRecord>={};
 assert.equal(nextAfterVerifiedSell(['a','b'],records,'a',false),null);
 assert.equal(nextAfterVerifiedSell(['a','b'],records,'a',true),'b');
 assert.equal(nextAfterVerifiedSell(['a','b'],records,'b',true),'a');
 assert.equal(nextAfterVerifiedSell(['a'],records,'a',true),null);
 assert.equal(nextAfterVerifiedSell(['a','b'],records,'x',true),null);
});
test('batch skips all already submitted and ambiguous orders rather than replaying',()=>{
 const records:Record<string,QueueRecord>={
  b:{status:'uncertain',updatedAt:1},
  c:{status:'open',updatedAt:2},
  d:{status:'partially_filled',updatedAt:3}
 };
 assert.equal(nextAfterVerifiedSell(['a','b','c','d'],records,'a',true),null);
 assert.equal(nextAfterVerifiedSell(['a','b','c','d','e'],records,'a',true),'e');
});

test('review input fingerprint changes with APR, shares, coverage, or date',()=>{
 const base={asset:'123',apr:'12',quantity:'11',coverage:true,settlementConfirmed:true,endDate:'2026-12-31'};
 for(const diff of [{apr:'10'},{quantity:'12'},{coverage:false},{settlementConfirmed:false},{endDate:'2027-01-01'}])
  assert.notEqual(sellReviewConfigKey(base),sellReviewConfigKey({...base,...diff}));
});
test('quick shares never exceed indicative gross available shares',()=>{
 assert.equal(sellQuantityForPercent(11,25),'2.75');
 assert.equal(sellQuantityForPercent(11,50),'5.5');
 assert.equal(sellQuantityForPercent(11,100),'11');
 assert.equal(sellQuantityForPercent(null,100),'');
});
test('limit APR and gross proceeds share 365-day dashboard convention',()=>{
 const r=sellLimitSummary(.986,11,.9,'2026-12-31',new Date('2026-11-17T00:00:00Z'));
 assert.equal(r.grossProceeds,10.846);
 assert.ok(r.limitAprPercent!==null&&r.limitAprPercent>0);
});
