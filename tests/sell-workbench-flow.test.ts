import test from 'node:test';
import assert from 'node:assert/strict';
import { settlementConfirmedForDate, nextAfterVerifiedSell } from '../lib/sell-workbench-flow';
import type { QueueRecord } from '../lib/manual-sell-queue';

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
