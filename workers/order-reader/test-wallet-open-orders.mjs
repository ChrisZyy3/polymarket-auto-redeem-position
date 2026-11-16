import test from "node:test";
import assert from "node:assert/strict";
import { fetchWalletOpenOrders, parseReadonlyAccount } from "./wallet-open-orders.mjs";
import { createReaderHandler } from "./worker.mjs";
const signer="0x1111111111111111111111111111111111111111", funder="0x2222222222222222222222222222222222222222";
const account={walletType:"deposit",signerAddress:signer,funderAddress:funder,readonlyApiKey:"test-readonly-key"};
const order=(id)=>({id,asset_id:"123",maker_address:funder,side:"SELL",status:"LIVE",original_size:"100",size_matched:"30",price:"0.99",order_type:"GTC",expiration:"0"});
test("follows empty intermediate pages until empty cursor and uses only readonly headers",async()=>{
 const calls=[];const mock=async(url,init)=>{calls.push({url,init});return Response.json(calls.length===1?{data:[],next_cursor:"page2"}:{data:[order("one")],next_cursor:""});};
 const r=await fetchWalletOpenOrders(account,mock,1794510000);
 assert.equal(r.orders.length,1);assert.equal(r.pages,2);assert.equal(new URL(calls[1].url).searchParams.get("cursor"),"page2");
 assert.equal(calls[0].init.method,"GET");assert.equal(calls[0].init.headers.POLY_READONLY_API_KEY,account.readonlyApiKey);assert.ok(!JSON.stringify(r).includes(account.readonlyApiKey));
});
test("rejects cursor loops, incomplete pages, wrong maker and upstream failure",async()=>{
 for(const fn of [async()=>Response.json({data:[],next_cursor:"same"}),async()=>Response.json({data:[]}),async()=>Response.json({data:[{...order("x"),maker_address:signer}],next_cursor:""}),async()=>new Response("",{status:429})]) await assert.rejects(()=>fetchWalletOpenOrders(account,fn,1794510000));
});
test("requires deposit wallet and authenticated worker; output is not actionable",async()=>{
 assert.throws(()=>parseReadonlyAccount(JSON.stringify({...account,walletType:"safe"})));
 const handler=createReaderHandler(async()=>Response.json({data:[order("x")],next_cursor:""}),()=>1794510000);
 const env={ORDER_READER_TOKEN:"x".repeat(48),CLOB_READONLY_ACCOUNT_1:JSON.stringify(account)};
 assert.equal((await handler(new Request(`https://example.test/orders?wallet=${funder}`),env)).status,401);
 const result=await handler(new Request(`https://example.test/orders?wallet=${funder}`,{headers:{authorization:`Bearer ${env.ORDER_READER_TOKEN}`}}),env);
 const body=await result.json();assert.equal(body.complete,true);assert.equal(body.actionableForTrading,false);assert.equal(body.orders.length,1);
});
