import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {getSellWorkspaceNumbers} from "../app/components/sell-plan-row";
import type {PositionQuote} from "../lib/position-quote";
import type {EnrichedPosition} from "../lib/types";
import {
  resolveSellTargetAprInput,holdDecisionForPosition,BUY_TARGET_APR_STORAGE_KEY,SELL_TARGET_APR_STORAGE_KEY
} from "../lib/position-apr-strategy";

const page=readFileSync("app/page.tsx","utf8");
const detail=page.slice(page.indexOf("function PositionQuotePanel({"),page.indexOf("function TargetAprPlanPanel({"));
const review=readFileSync("app/components/manual-sell-review.tsx","utf8");
const clob=readFileSync("app/components/browser-clob-panel.tsx","utf8");
const sellTable=readFileSync("app/components/sell-plan-row.tsx","utf8");

test("only one expandable position card: advanced BUY is a sibling view, not nested details",()=>{
  assert.match(page,/aria-expanded={quoteExpanded}/);
  assert.doesNotMatch(detail,/<details\b|<summary\b/);
  assert.match(detail,/setView\("overview"\)/);
  assert.match(detail,/setView\("buy"\)/);
  assert.match(detail,/BUY 目标 APR 独立保存/);
  assert.match(detail,/综合持有 APR/);
  assert.match(detail,/实时盘口/);
  assert.match(detail,/SELL 规划 · 模拟/);
});
test("global threshold feeds SELL default through both table and manual review; BUY has separate storage",()=>{
  assert.notEqual(BUY_TARGET_APR_STORAGE_KEY,SELL_TARGET_APR_STORAGE_KEY);
  assert.match(page,/BUY_TARGET_APR_STORAGE_KEY/);
  assert.match(page,/function handleBuyTargetAprChange/);
  assert.match(page,/function resetSellTargetApr/);
  assert.match(page,/resolveSellTargetAprInput\(p\.asset,targetAprInputs,holdAprThreshold\)/);
  assert.match(page,/defaultTargetAprPercent={holdAprThreshold}/);
  assert.match(clob,/defaultTargetAprPercent={defaultTargetAprPercent}/);
  assert.match(review,/targetAprInputs\[id\]\?\?String\(defaultTargetAprPercent\)/);
  assert.match(review,/defaultTargetAprPercent,proposedQuantities,busy/);
  assert.deepEqual(resolveSellTargetAprInput("A",{},10),{value:"10",source:"global"});
  assert.deepEqual(resolveSellTargetAprInput("A",{"A":"13"},20),{value:"13",source:"custom"});
});
test("combined hold APR drives watch state, Mark APR alone drives limit price",()=>{
  const p={
    asset:"123",size:100,redeemable:false,avgPrice:.9,
    holdApr:.1125,markApr:.08,holdingRewardApr:.0325,holdingRewardEligible:true
  } as EnrichedPosition;
  const quote={
    currentPrice:.96,daysToSettle:30,tickSize:.001,tickVerified:true,
    orderBookAvailable:true,bestBid:.95
  } as PositionQuote;
  const x=getSellWorkspaceNumbers(p,quote,"10","11.111",[],true);
  assert.equal(x.normalized,11.11);
  assert.equal(x.plan?.mode,"dry-run");
  assert.equal(x.plan?.basis,"mark-apr");
  assert.equal(holdDecisionForPosition(p,10),"continue_holding");
  const adjusted={...p,holdApr:.095,holdingRewardApr:.015};
  const y=getSellWorkspaceNumbers(adjusted,quote,"10","11.111",[],true);
  assert.equal(holdDecisionForPosition(adjusted,10),"consider_exit");
  assert.equal(x.plan?.proposedLimitPrice,y.plan?.proposedLimitPrice);
});
test("SELL planning uses one compressed six-column table with safe manual review only",()=>{
  assert.match(page,/["']APR 策略["']/);
  assert.match(page,/["']份额 \/ 挂单["']/);
  assert.match(page,/["']状态 \/ 操作["']/);
  assert.match(sellTable,/onOpenOrders/);
  assert.match(sellTable,/canReview/);
  assert.match(sellTable,/normalizeSdkSellShares/);
  assert.match(sellTable,/onAprReset/);
  assert.match(page,/onPlanSell=\{\(\) => openSellWorkspaceFor\(row\.original\.asset\)\}/);
  assert.match(page,/Do not automatically open preflight, sign or POST/);
  assert.match(review,/createSafeSellClient/);
  assert.match(review,/loadSellReview/);
  assert.match(review,/matchingLiveSellOrder/);
  assert.match(review,/自动安全核验 · 无需勾选/);
  assert.doesNotMatch(review,/setCoverage|setSettlementDates/);
});

