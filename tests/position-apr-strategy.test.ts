import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_BUY_TARGET_APR, SELL_TARGET_APR_STORAGE_KEY, BUY_TARGET_APR_STORAGE_KEY,
  resolveSellTargetAprInput, holdDecisionForApr
} from "../lib/position-apr-strategy";

test("SELL target defaults to global threshold only when no custom override exists",()=>{
  assert.deepEqual(resolveSellTargetAprInput("asset-A",{},10),{value:"10",source:"global"});
  assert.deepEqual(resolveSellTargetAprInput("asset-A",{},14.5),{value:"14.5",source:"global"});
  assert.deepEqual(resolveSellTargetAprInput("asset-A",{"asset-A":"12"},10),{value:"12",source:"custom"});
  // Preserve an in-progress blank input; never silently sign with a fallback.
  assert.deepEqual(resolveSellTargetAprInput("asset-A",{"asset-A":""},10),{value:"",source:"custom"});
});
test("BUY analysis has an independent persistent key and its own default",()=>{
  assert.notEqual(BUY_TARGET_APR_STORAGE_KEY, SELL_TARGET_APR_STORAGE_KEY);
  assert.equal(DEFAULT_BUY_TARGET_APR,12);
});
test("combined holding APR controls only an advisory watch, not SELL pricing",()=>{
  assert.equal(holdDecisionForApr(.1125,10),"continue_holding");
  assert.equal(holdDecisionForApr(.095,10),"consider_exit");
  assert.equal(holdDecisionForApr(.1,10),"consider_exit");
  assert.equal(holdDecisionForApr(null,10),"unavailable");
  assert.equal(holdDecisionForApr(.08,Number.NaN),"unavailable");
  assert.equal(holdDecisionForApr(.08,-1),"unavailable");
});
