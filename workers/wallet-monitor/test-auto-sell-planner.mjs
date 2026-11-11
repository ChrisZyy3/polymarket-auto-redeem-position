import assert from "node:assert/strict";
import { buildAutoSellDryRun, theoreticalSellPrice,
  AUTO_SELL_PLANNER_BASIS } from "./auto-sell-planner.mjs";
import { simpleApr } from "./low-apy.mjs";

const now=Date.parse("2026-11-11T08:40:00Z")/1000;
const endDate="2026-12-31";
const walletPositions=[
 {asset:"token-no",size:1000,curPrice:0.98,avgPrice:0.94,
   currentValue:980,endDate,title:"Fed decision",outcome:"NO",redeemable:false},
 {asset:"redeemable",size:1000,curPrice:1,avgPrice:0.95,
   currentValue:1000,endDate,title:"Resolved",outcome:"YES",redeemable:true},
 {asset:"dust",size:1,curPrice:0.01,avgPrice:0.01,currentValue:0.01,
   endDate,title:"Dust",outcome:"YES",redeemable:false}
];

const theoretical=theoreticalSellPrice(12,endDate,now);
assert.ok(theoretical>0.98 && theoretical<1);
const initial=buildAutoSellDryRun(walletPositions,null,now,{enabled:true,targetAprPct:12,minUsd:5});
assert.equal(initial.mode,"dry-run");
assert.equal(initial.basis,AUTO_SELL_PLANNER_BASIS);
assert.equal(initial.summary.eligible,1);
assert.deepEqual(Object.keys(initial.plans),["token-no"]);
const p=initial.plans["token-no"];
assert.equal(p.status,"theoretical_only");
assert.equal(p.indicativeAction,"would_create");
assert.equal(p.proposedLimitPrice,null,"never fabricate an executable SELL price");
assert.equal(p.orderBookChecked,false);
assert.equal(p.tickVerified,false);
assert.equal(p.markAprPct,Number((simpleApr(0.98,endDate,now)*100).toFixed(8)));
assert.equal(p.quantity,1000);
assert.equal(p.theoreticalPrice,Number(theoretical.toFixed(8)));
const rerun=buildAutoSellDryRun(walletPositions,initial,now,{enabled:true,targetAprPct:12,minUsd:5});
assert.equal(rerun.plans["token-no"].indicativeAction,"unchanged");
const next=buildAutoSellDryRun(walletPositions,initial,now+86400,{enabled:true,targetAprPct:12,minUsd:5});
assert.ok(next.plans["token-no"].theoreticalPrice>p.theoreticalPrice);
assert.equal(next.plans["token-no"].indicativeAction,"would_reprice");
assert.equal(next.summary.reprice,1);
const disabled=buildAutoSellDryRun(walletPositions,next,now,{enabled:false,targetAprPct:12});
assert.equal(disabled.mode,"off");
assert.deepEqual(disabled.plans,{});
assert.equal(theoreticalSellPrice(12,null,now),null);
assert.equal(theoreticalSellPrice(12,"2026-01-01",now),null);
assert.throws(()=>buildAutoSellDryRun(walletPositions,null,now,{enabled:true,targetAprPct:-1}));
const missing=buildAutoSellDryRun([{...walletPositions[0],endDate:null}],null,now,{enabled:true,targetAprPct:12});
assert.equal(missing.plans["token-no"].status,"unknown_settlement");
assert.equal(missing.plans["token-no"].proposedLimitPrice,null);
console.log("Passed: five-minute read-only Auto Sell Mark APR planner, date repricing, no fake orders");
