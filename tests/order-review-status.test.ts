import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { observedSellShares, openOrderStatus } from '../lib/order-review-status';
import type { ClobOrder } from '../lib/browser-clob';
const order=(asset:string, side:'BUY'|'SELL', size:string, matched:string):ClobOrder=>({id:asset+side,asset_id:asset,maker_address:'0x0000000000000000000000000000000000000001',side,status:'LIVE',price:'0.9',original_size:size,size_matched:matched});
test('counts only remaining sell shares for the selected token',()=>{
 const orders=[order('a','SELL','100','40'),order('a','BUY','20','0'),order('b','SELL','99','0')];
 assert.equal(observedSellShares(orders,'a'),60);
 assert.equal(observedSellShares(orders,'b'),99);
});
test('shows partial fill without inferring terminal status',()=>{
 assert.equal(openOrderStatus(order('a','SELL','100','40')),'partially_filled');
 assert.equal(openOrderStatus(order('a','SELL','100','0')),'open');
});
