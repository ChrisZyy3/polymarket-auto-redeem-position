import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { loadSellReview } from '../lib/sell-snapshot';
const signer='0x'+'1'.repeat(40),funder='0x'+'2'.repeat(40);
const input={credentials:{apiKey:'example-key',secret:'c2VjcmV0c2VjcmV0',passphrase:'example'},signer,funder,asset:'123',apr:12,quantity:50,coverageConfirmed:true,settlementConfirmed:true};
test('fresh review uses live outstanding orders and balances; failures block',async()=>{
 const original=globalThis.fetch;
 let bookAsset='123';
 globalThis.fetch=async (request)=>{
  const u=String(request);
  if(u.includes('/data/orders'))return Response.json({data:[{id:'o1',asset_id:'123',maker_address:funder,side:'SELL',status:'LIVE',price:'0.9',original_size:'20',size_matched:'0'}],next_cursor:'LTE='});
  if(u.includes('/balance-allowance'))return Response.json({balance:'100000000',allowances:{}});
  if(u.includes('/api/positions'))return Response.json({fetchedAt:new Date().toISOString(),positions:[{asset:'123',proxyWallet:funder,size:100,redeemable:false,endDate:'2099-01-01'}]});
  if(u.includes('/markets/'))return Response.json({condition_id:'0x'+'a'.repeat(64),accepting_orders:true,active:true,closed:false});
  if(u.includes('/book?'))return Response.json({asset_id:bookAsset,bids:[{price:'0.8',size:'1'}],asks:[{price:'0.9',size:'1'}],tick_size:'0.01',min_order_size:'1'});
  throw Error('unexpected');
 };
 try{
  const a=await loadSellReview(input);assert.equal(a.result.status,'review');assert.equal(a.comparison.remainder,80000000n);
  const b=await loadSellReview({...input,quantity:81});assert.equal(b.result.status,'blocked');
  bookAsset='124';await assert.rejects(()=>loadSellReview(input),/invalid_snapshot/);
 }finally{globalThis.fetch=original;}
});
