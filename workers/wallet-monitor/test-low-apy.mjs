import assert from "node:assert/strict";
import {
  effectiveApy,
  simpleApr,
  inspectLowApy,
  lowApyMessage
} from "./low-apy.mjs";

const now = Date.parse("2026-10-26T00:00:00Z") / 1000;
const end = "2026-12-25";
const fetchBook = (price="0.98", size="1000", eligible=false) => async url => ({
  ok:true,
  async json() {
    if (String(url).includes("gamma-api.polymarket.com"))
      return {holdingRewardsEnabled:eligible};
    return {bids:[{price,size}],asks:[{price:"0.995",size:"1000"}],tick_size:"0.001"};
  }
});

const markApy = effectiveApy(0.99,end,now);
const markApr = simpleApr(0.99,end,now);
assert.ok(markApy > markApr, "compound APY should exceed simple APR for a positive yield");

const position = {
  asset:"1",
  size:500,
  avgPrice:0.95,
  currentValue:495,
  curPrice:0.99,
  endDate:end,
  title:"Test market",
  outcome:"NO",
  eventSlug:"test-market",
  redeemable:false
};

// Mark APR is the trigger basis; APY is informational only.
const low = await inspectLowApy([position],null,now,fetchBook("0.98"),{
  thresholdPct:10,recoverPct:12,checkMinutes:30,cooldownHours:24,
  minUsd:5,timeoutMs:1000
});
assert.equal(low.raised.length,1);
assert.equal(low.state.basis,"combined-apr-holding-v4");
assert.equal(low.raised[0].markPrice,0.99);
assert.equal(low.raised[0].bestBid,0.98);
assert.ok(low.raised[0].executableAprPct > low.raised[0].markAprPct,
  "lower executable bid should imply a higher remaining APR");
assert.equal(low.raised[0].markPositionValueUsd,495);
assert.equal(low.raised[0].bidDepthUsd,980);

// Old state must not suppress the first Mark-APY alert after migration.
const legacyState={
  lastCheckedAt:now-60,
  tokens:{"1":{below:false,apyPct:20,bestBid:0.98}}
};
const migrated=await inspectLowApy([position],legacyState,now,fetchBook("0.98"),{
  thresholdPct:10,recoverPct:12,checkMinutes:30,cooldownHours:24,
  minUsd:5,timeoutMs:1000
});
assert.equal(migrated.raised.length,1,"legacy APY-basis state should be re-evaluated immediately");

// Interval gating works once state is on the new basis.
const skipped = await inspectLowApy([position],low.state,now+600,fetchBook("0.98"),{
  thresholdPct:10,recoverPct:12,checkMinutes:30,cooldownHours:24,
  minUsd:5,timeoutMs:1000
});
assert.equal(skipped.skipped,"interval");
assert.equal(skipped.raised.length,0);

// Cooldown is based on Mark APR, not on the executable bid.
const cooldown = await inspectLowApy([position],low.state,now+3600,fetchBook("0.98"),{
  thresholdPct:10,recoverPct:12,checkMinutes:30,cooldownHours:24,
  minUsd:5,timeoutMs:1000
});
assert.equal(cooldown.raised.length,0,"no repeat within cooldown");

// Recovery is also based on Mark APR.
const recoveredPosition={...position,curPrice:0.97,currentValue:485};
const recovered = await inspectLowApy([recoveredPosition],low.state,now+3600,fetchBook("0.96"),{
  thresholdPct:10,recoverPct:12,checkMinutes:30,cooldownHours:24,
  minUsd:5,timeoutMs:1000
});
assert.equal(recovered.state.tokens["1"].below,false,"rearm after Mark APR recovery");

// Crossing below again after recovery should alert again.
const again = await inspectLowApy([position],recovered.state,now+7200,fetchBook("0.98"),{
  thresholdPct:10,recoverPct:12,checkMinutes:30,cooldownHours:24,
  minUsd:5,timeoutMs:1000
});
assert.equal(again.raised.length,1);

// A CLOB outage must not suppress a Mark-APR opportunity-cost alert.
const failingFetch=async url => {
  if(String(url).includes("gamma-api.polymarket.com"))
    return {ok:true,json:async()=>({holdingRewardsEnabled:false})};
  throw new Error("network down");
};
const noBook = await inspectLowApy([{...position,asset:"3"}],null,now,failingFetch,{
  thresholdPct:10,recoverPct:12,checkMinutes:30,cooldownHours:24,
  minUsd:5,timeoutMs:1000
});
assert.equal(noBook.raised.length,1);
assert.equal(noBook.raised[0].bestBid,null);
assert.equal(noBook.raised[0].executableApyPct,null);
assert.equal(noBook.errors,1);

// Dust stays filtered.
const dust={...position,asset:"2",size:1,currentValue:0.99,initialValue:0.95};
const dustResult=await inspectLowApy([dust],null,now,fetchBook("0.98"),{
  thresholdPct:10,recoverPct:12,checkMinutes:30,cooldownHours:24,
  minUsd:5,timeoutMs:1000
});
assert.equal(dustResult.checked,0);



const wtiEnd = "2026-11-01";
const wtiNow = Date.parse("2026-10-25T18:05:03Z") / 1000;
const wtiApr = simpleApr(0.998, wtiEnd, wtiNow);
const wtiApy = effectiveApy(0.998, wtiEnd, wtiNow);
assert.ok(wtiApr * 100 < 10, "WTI-style mark APR should be below 10%");
assert.ok(wtiApy * 100 > 10, "WTI-style mark APY may still be above 10%");
const wti = await inspectLowApy([{
  ...position,
  asset:"wti",
  curPrice:0.998,
  endDate:wtiEnd,
  currentValue:77621.446,
  size:77777
}],null,wtiNow,fetchBook("0.997","1000"),{
  thresholdPct:10,recoverPct:12,checkMinutes:30,cooldownHours:24,
  minUsd:5,timeoutMs:1000
});
assert.equal(wti.raised.length,1,"APR basis should trigger for WTI-style 9.8% APR");
assert.ok(wti.raised[0].markAprPct < 10);
assert.ok(wti.raised[0].markApyPct > 10);

const msg=lowApyMessage("ChrisZyy",low.raised,10,now);
assert.ok(msg.title.includes("LOW COMBINED APR"));
assert.ok(msg.desp.includes("Mark APY（复利）"));
assert.ok(msg.desp.includes("Mark APR（简单年化）"));
assert.ok(msg.desp.includes("可执行 APY（复利）"));
assert.ok(msg.desp.includes("当前持仓价值"));
const rewarded = await inspectLowApy([{...position,curPrice:0.988}],null,now,fetchBook("0.98","1000",true),{
  thresholdPct:10,recoverPct:12,checkMinutes:30,cooldownHours:24,minUsd:5,timeoutMs:1000
});
assert.equal(rewarded.raised.length,0,"reward lifts combined APR above threshold");
assert.ok(rewarded.state.tokens["1"].combinedAprPct > 10);
const unavailable=await inspectLowApy([position],null,now,async()=>{throw Error("Gamma down");},{
  thresholdPct:10,recoverPct:12,checkMinutes:30,cooldownHours:24,minUsd:5,timeoutMs:1000
});
assert.equal(unavailable.raised.length,0,"unknown eligibility must not imply confirmed zero reward");
console.log("combined-apr tests passed");
