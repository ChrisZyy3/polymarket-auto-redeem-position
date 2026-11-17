import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { validateSignedSell } from '../lib/validate-signed-sell';
const expected={assetId:'123',funder:'0x'+'1'.repeat(40),price:0.89,size:10,expiration:2000000000};
const order={side:'SELL',postOnly:true,expiration:expected.expiration,maker:expected.funder,tokenId:'123',makerAmount:'10000000',takerAmount:'8900000'};
test('only reviewed shares and price pass',()=>{
 assert.equal(validateSignedSell(order,expected),true);
 for(const changed of [{makerAmount:'9999999'},{takerAmount:'8899999'},{postOnly:false},{side:'BUY'},{tokenId:'124'},{expiration:0},{maker:'0x'+'2'.repeat(40)}]) assert.equal(validateSignedSell({...order,...changed},expected),false);
});
