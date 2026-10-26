import assert from "node:assert/strict";
import test from "node:test";
import {rewardEligibility,combinedHoldingApr,holdingRewardForSlug} from "../lib/holding-rewards";
test("market eligibility is checked",()=>{
 assert.equal(rewardEligibility({holdingRewardsEnabled:true}),true);
 assert.equal(rewardEligibility({holdingRewardsEnabled:false}),false);
 assert.equal(rewardEligibility({markets:[{}]}),null);
});
test("reward is only added for confirmed true",async()=>{
 const fetcher=async (_url:string)=>({ok:true,json:async()=>({holdingRewardsEnabled:true})}) as Response;
 const reward=await holdingRewardForSlug("will-china-invade-taiwan-before-2027",fetcher);
 assert.equal(reward.apr,0.0325);
 assert.equal(combinedHoldingApr(0.08,reward.apr),0.1125);
});
test("unknown eligibility contributes zero and stays unknown",async()=>{
 const reward=await holdingRewardForSlug("example",async()=>{throw Error("unavailable");});
 assert.deepEqual(reward,{eligible:null,apr:0});
});

test("event with multiple markets never applies unrelated market reward",()=>{
 assert.equal(rewardEligibility({markets:[{conditionId:"0xa",holdingRewardsEnabled:true},{conditionId:"0xb",holdingRewardsEnabled:false}]},"0xb"),false);
 assert.equal(rewardEligibility({markets:[{conditionId:"0xa",holdingRewardsEnabled:true}]},"0xb"),null);
});
