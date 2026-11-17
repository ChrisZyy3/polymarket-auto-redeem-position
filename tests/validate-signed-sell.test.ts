import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { validateSignedSell, signedSellMismatchFields } from '../lib/validate-signed-sell';
const expected={assetId:'123',funder:'0x'+'1'.repeat(40),signer:'0x'+'2'.repeat(40),price:0.89,size:10,expiration:2000000000};
const order={side:'SELL',orderType:'GTD',signatureType:2,signer:expected.signer,postOnly:true,expiration:expected.expiration,maker:expected.funder,tokenId:'123',makerAmount:'10000000',takerAmount:'8900000'};
test('only reviewed shares and price pass',()=>{
 assert.equal(validateSignedSell(order,expected),true);
 for(const changed of [{makerAmount:'9999999'},{takerAmount:'8899999'},{postOnly:false},{side:'BUY'},{signatureType:1},{orderType:'GTC'},{signer:expected.funder},{tokenId:'124'},{expiration:0},{maker:'0x'+'2'.repeat(40)}]) assert.equal(validateSignedSell({...order,...changed},expected),false);
});

test('SDK 0.20.0 rounded share quantity reports a precise and safe diagnostic',()=>{
 const signed={...order,makerAmount:'2871160000',takerAmount:'2545342400'};
 const target={...expected,size:2871.160109};
 assert.equal(validateSignedSell(signed,target),false);
 assert.ok(signedSellMismatchFields(signed,target).includes('share_size'));
});
test('SDK postOnly must survive the signature workflow and price guard stays strict',()=>{
 assert.deepEqual(signedSellMismatchFields({...order,postOnly:undefined},expected),['post_only']);
 assert.deepEqual(signedSellMismatchFields({...order,takerAmount:'8899999'},expected),['price_below_review']);
});

test('canonical two-decimal SELL quantity matches SDK maker/taker amounts at tick 0.001',()=>{
 const amount=2871.16;
 const makerAmount='2871160000';
 const takerAmount=(BigInt(makerAmount)*986000n/1000000n).toString();
 const signed={...order,makerAmount,takerAmount};
 const intent={...expected,size:amount,price:0.986};
 assert.equal(validateSignedSell(signed,intent),true);
 assert.deepEqual(signedSellMismatchFields(signed,intent),[]);
});
