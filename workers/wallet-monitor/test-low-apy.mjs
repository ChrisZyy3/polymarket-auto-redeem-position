import assert from "node:assert/strict";
import {
  effectiveApy,
  simpleApr,
  inspectLowApy,
  lowApyMessage
} from "./low-apy.mjs";

const now = Date.parse("2026-10-26T00:00:00Z") / 1000;
const end = "2026-12-25";
const fetchBook = (price="0.98", size="1000") => async () => ({
  ok: true,
  async json() {
    return {
      bids: [{price,size}],
      asks: [{price:"0.995",size:"1000"}],
      tick_size: "0.001"
    };
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

// Mark APY is low enough to trigger, even when the executable bid implies a higher APY.
const low = await inspectLowApy([position],null,now,fetchBook("0.98"),{
  thresholdPct:10,recoverPct:12,checkMinutes:30,cooldownHours:24,
  minUsd:5,timeoutMs:1000
});
assert.equal(low.raised.length,1);
assert.equal(low.state.basis,"mark-apy-v2");
assert.equal(low.raised[0].markPrice,0.99);
assert.equal(low.raised[0].bestBid,0.98);
assert.ok(low.raised[0].executableApyPct > low.raised[0].markApyPct,
  "lower executable bid should imply a higher remaining APY");
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
assert.equal(migrated.raised.length,1,"legacy executable-APY state should be re-evaluated immediately");

// Interval gating works once state is on the new basis.
const skipped = await inspectLowApy([position],low.state,now+600,fetchBook("0.98"),{
  thresholdPct:10,recoverPct:12,checkMinutes:30,cooldownHours:24,
  minUsd:5,timeoutMs:1000
});
assert.equal(skipped.skipped,"interval");
assert.equal(skipped.raised.length,0);

// Cooldown is based on Mark APY, not on the executable bid.
const cooldown = await inspectLowApy([position],low.state,now+3600,fetchBook("0.98"),{
  thresholdPct:10,recoverPct:12,checkMinutes:30,cooldownHours:24,
  minUsd:5,timeoutMs:1000
});
assert.equal(cooldown.raised.length,0,"no repeat within cooldown");

// Recovery is also based on Mark APY.
const recoveredPosition={...position,curPrice:0.97,currentValue:485};
const recovered = await inspectLowApy([recoveredPosition],low.state,now+3600,fetchBook("0.96"),{
  thresholdPct:10,recoverPct:12,checkMinutes:30,cooldownHours:24,
  minUsd:5,timeoutMs:1000
});
assert.equal(recovered.state.tokens["1"].below,false,"rearm after Mark APY recovery");

// Crossing below again after recovery should alert again.
const again = await inspectLowApy([position],recovered.state,now+7200,fetchBook("0.98"),{
  thresholdPct:10,recoverPct:12,checkMinutes:30,cooldownHours:24,
  minUsd:5,timeoutMs:1000
});
assert.equal(again.raised.length,1);

// A CLOB outage must not suppress a Mark-APY opportunity-cost alert.
const failingFetch=async()=>{ throw new Error("network down"); };
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

const msg=lowApyMessage("ChrisZyy",low.raised,10,now);
assert.ok(msg.title.includes("LOW MARK APY"));
assert.ok(msg.desp.includes("Mark APY（复利）"));
assert.ok(msg.desp.includes("Mark APR（简单年化）"));
assert.ok(msg.desp.includes("可执行 APY（复利）"));
assert.ok(msg.desp.includes("当前持仓价值"));
console.log("mark-apy tests passed");
