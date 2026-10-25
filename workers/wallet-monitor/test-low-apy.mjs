import assert from "node:assert/strict";
import { effectiveApy, inspectLowApy, lowApyMessage } from "./low-apy.mjs";

const now = Date.parse("2026-10-26T00:00:00Z")/1000;
const end = "2026-12-25T00:00:00Z";
const fetchBook = (price="0.99", size="1000") => async () => ({
  ok:true,
  async json(){
    return {
      bids:[{price,size}],
      asks:[{price:"0.995",size:"1000"}],
      tick_size:"0.001"
    };
  }
});

const apy = effectiveApy(0.99,end,now);
assert.ok(apy > 0.06 && apy < 0.07, "compound APY sanity");

const position={
  asset:"1",size:500,avgPrice:0.95,currentValue:495,endDate:end,
  title:"Test market",outcome:"NO",eventSlug:"test-market",redeemable:false
};

const low = await inspectLowApy([position],null,now,fetchBook("0.99"),{
  thresholdPct:10,recoverPct:12,checkMinutes:30,cooldownHours:24,
  minUsd:5,timeoutMs:1000
});
assert.equal(low.raised.length,1);
assert.equal(low.raised[0].positionValueUsd,495);
assert.equal(low.raised[0].bidDepthUsd,990);

const skipped = await inspectLowApy([position],low.state,now+600,fetchBook("0.99"),{
  thresholdPct:10,recoverPct:12,checkMinutes:30,cooldownHours:24,
  minUsd:5,timeoutMs:1000
});
assert.equal(skipped.skipped,"interval");
assert.equal(skipped.raised.length,0);

const cooldown = await inspectLowApy([position],low.state,now+3600,fetchBook("0.99"),{
  thresholdPct:10,recoverPct:12,checkMinutes:30,cooldownHours:24,
  minUsd:5,timeoutMs:1000
});
assert.equal(cooldown.raised.length,0,"no repeat within cooldown");

const recovered = await inspectLowApy([position],low.state,now+3600,fetchBook("0.97"),{
  thresholdPct:10,recoverPct:12,checkMinutes:30,cooldownHours:24,
  minUsd:5,timeoutMs:1000
});
assert.equal(recovered.state.tokens["1"].below,false,"rearm after APY recovery");

const again = await inspectLowApy([position],recovered.state,now+7200,fetchBook("0.99"),{
  thresholdPct:10,recoverPct:12,checkMinutes:30,cooldownHours:24,
  minUsd:5,timeoutMs:1000
});
assert.equal(again.raised.length,1,"alert again after recovery then crossing below");

const dust={...position,asset:"2",size:1,currentValue:0.99,initialValue:0.95};
const dustResult=await inspectLowApy([dust],null,now,fetchBook("0.99"),{
  thresholdPct:10,recoverPct:12,checkMinutes:30,cooldownHours:24,
  minUsd:5,timeoutMs:1000
});
assert.equal(dustResult.checked,0);

const msg=lowApyMessage("ChrisZyy",low.raised,10,now);
assert.ok(msg.title.includes("ChrisZyy"));
assert.ok(msg.desp.includes("按买一估算持仓价值"));
assert.ok(msg.desp.includes("有效 APY"));
console.log("low-apy tests passed");
