import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSdkSellShares } from '../lib/sdk-sell-quantity';

test('Polymarket SDK SELL size rounds DOWN to 0.01 share, not 0.000001',()=>{
 assert.equal(normalizeSdkSellShares(2871.160109),2871.16);
 assert.equal(normalizeSdkSellShares(11.234567),11.23);
 assert.equal(normalizeSdkSellShares(11),11);
 assert.equal(normalizeSdkSellShares(2.05),2.05);
 assert.equal(normalizeSdkSellShares(.019999),.01);
 assert.equal(normalizeSdkSellShares(.009999),null);
});
test('unrepresentable amounts and excess precision fail closed',()=>{
 for(const n of [-1,0,Number.POSITIVE_INFINITY,Number.NaN,1e-7])
  assert.equal(normalizeSdkSellShares(n),null);
});
