import assert from "node:assert/strict";
import test from "node:test";
import { buildMarkAutoSellPlan } from "../lib/auto-sell-plan";
import { buildPositionQuote } from "../lib/position-quote";
import type { OrderBook } from "../lib/poly-yield/types";

const now=new Date("2026-01-01T00:00:00.000Z");
const book=(tick="0.001",bid="0.980"):OrderBook=>({
  bids:[{price:bid,size:"1000"}],asks:[{price:"0.995",size:"1000"}],tick_size:tick
});
function quote(opts:{book?:OrderBook|null;price?:number;endDate?:string|null}={}){
 return buildPositionQuote({
  currentPrice:opts.price??0.98,
  endDate:opts.endDate===undefined?"2026-01-31":opts.endDate,
  thresholdAprPercent:12,orderBook:opts.book===undefined?book():opts.book,now
 });
}

test("SELL target is rounded upward to the next legal tick, not down",()=>{
 const q=quote();
 const p=buildMarkAutoSellPlan({quote:q,targetAprPercent:12,quantity:1000,avgPrice:0.92});
 assert.equal(p.mode,"dry-run");
 assert.equal(p.basis,"mark-apr");
 assert.equal(p.status,"ready");
 assert.equal(p.proposedLimitPrice,0.990);
 assert.ok(p.theoreticalTargetPrice! <= p.proposedLimitPrice!);
 assert.ok(p.priceAtLimitAprPercent! <= 12);
 assert.equal(p.quantity,1000);
 assert.equal(p.estimatedGrossProceeds,990);
 assert.equal(p.estimatedProfitVsAvgCost,70);
});

test("a bid above planned limit would cross, but no fill is assumed",()=>{
 const q=quote({book:book("0.001","0.995")});
 const p=buildMarkAutoSellPlan({quote:q,targetAprPercent:12,quantity:100,avgPrice:0.96});
 assert.equal(p.status,"would_cross");
 assert.equal(p.bidCrossesLimit,true);
 assert.equal(p.proposedLimitPrice,0.990);
 assert.equal(p.estimatedGrossProceeds,99);
});

test("cannot produce an executable sell limit when book or tick is unverified",()=>{
 const noBook=buildMarkAutoSellPlan({quote:quote({book:null}),targetAprPercent:12,quantity:100,avgPrice:0.95});
 assert.equal(noBook.status,"theoretical_only");
 assert.equal(noBook.proposedLimitPrice,null);
 assert.ok(noBook.theoreticalTargetPrice!==null);
 const malformed=buildMarkAutoSellPlan({quote:quote({book:book("BAD")}),targetAprPercent:12,quantity:100,avgPrice:0.95});
 assert.equal(malformed.status,"theoretical_only");
 assert.equal(malformed.proposedLimitPrice,null);
});

test("do not clamp SELL price down when it cannot fit the maximum tick",()=>{
 const q=quote({book:book("0.01"),endDate:"2026-01-02"});
 const p=buildMarkAutoSellPlan({quote:q,targetAprPercent:12,quantity:1000,avgPrice:0.9});
 assert.equal(p.status,"unreachable_tick");
 assert.equal(p.proposedLimitPrice,null);
});

test("expired/redeemable or invalid positions never suggest a SELL order",()=>{
 const q=quote({endDate:"2025-12-30"});
 assert.equal(buildMarkAutoSellPlan({quote:q,targetAprPercent:12,quantity:100,avgPrice:0.9}).status,"invalid_window");
 assert.equal(buildMarkAutoSellPlan({quote:quote(),targetAprPercent:12,quantity:100,avgPrice:0.9,redeemable:true}).status,"invalid_position");
 assert.equal(buildMarkAutoSellPlan({quote:quote(),targetAprPercent:12,quantity:0,avgPrice:0.9}).status,"invalid_position");
 assert.equal(buildMarkAutoSellPlan({quote:quote(),targetAprPercent:-1,quantity:100,avgPrice:0.9}).status,"invalid_target");
});

test("target sell floor rises as settlement approaches at fixed APR",()=>{
 const earlier=quote({endDate:"2026-04-01"});
 const later=quote({endDate:"2026-01-31"});
 const a=buildMarkAutoSellPlan({quote:earlier,targetAprPercent:12,quantity:100,avgPrice:0.8});
 const b=buildMarkAutoSellPlan({quote:later,targetAprPercent:12,quantity:100,avgPrice:0.8});
 assert.ok(b.theoreticalTargetPrice! > a.theoreticalTargetPrice!);
 assert.ok(b.proposedLimitPrice! > a.proposedLimitPrice!);
});
