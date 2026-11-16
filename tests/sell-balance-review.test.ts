import { test } from "node:test";
import { strict as assert } from "node:assert";
import { reviewSellBalance } from "../lib/sell-balance-review";
import type { ClobOrder } from "../lib/browser-clob";
const order:ClobOrder = {id:"1",asset_id:"123",maker_address:"0x0000000000000000000000000000000000000000",side:"SELL",status:"LIVE",price:"0.89",original_size:"2871.160109",size_matched:"0"};
test("compares exact microshares and excludes other assets",()=>{
  assert.deepEqual(reviewSellBalance("2871166776","123",[order,{...order,id:"2",asset_id:"456"}]),{reserved:2871160109n,remainder:6667n,count:1});
});
test("never reports a negative remainder as available",()=>{
  assert.equal(reviewSellBalance("1","123",[order])?.remainder,null);
  assert.equal(reviewSellBalance("1","123",[{...order,original_size:"0.0000001"}]),null);
});
