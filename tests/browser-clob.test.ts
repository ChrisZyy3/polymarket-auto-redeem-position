import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { deriveClobCredentials, fetchBrowserOpenOrders } from "../lib/browser-clob";
const signer="0x1111111111111111111111111111111111111111",funder="0x2222222222222222222222222222222222222222";
const creds={apiKey:"test-key-123",secret:Buffer.from("1234567890secretkey").toString("base64"),passphrase:"p"};
const order={id:"one",asset_id:"123",maker_address:funder,side:"SELL",status:"LIVE",price:"0.99",original_size:"10",size_matched:"1"};
test("derive reads existing key, never creates a key",async()=>{
 const calls:string[]=[];const mock=(async (url,init)=>{calls.push(`${init?.method} ${url}`);return Response.json(creds);}) as typeof fetch;
 assert.deepEqual(await deriveClobCredentials(signer,"0xsig",123,mock),creds);assert.deepEqual(calls,["GET https://clob.polymarket.com/auth/derive-api-key"]);
});
test("reads all pages using authenticated GET and correct HMAC",async()=>{
 let count=0;const mock=(async (url,init)=>{count++;const h=new Headers(init?.headers);assert.equal(init?.method,"GET");const t=h.get("POLY_TIMESTAMP");assert.equal(h.get("POLY_SIGNATURE"),createHmac("sha256",Buffer.from(creds.secret,"base64")).update(`${t}GET/data/orders`).digest("base64url")+"=");return Response.json(count===1?{data:[],next_cursor:"page2"}:{data:[order],next_cursor:"LTE="});}) as typeof fetch;
 const result=await fetchBrowserOpenOrders(creds,signer,funder,mock);assert.equal(count,2);assert.equal(result.length,1);
});
test("rejects unauthenticated, CORS, unpaginated and wrong-maker responses",async()=>{
 await assert.rejects(()=>deriveClobCredentials(signer,"0xsig",1,(async()=>{throw new TypeError("network")}) as typeof fetch),/connection_or_cors/);
 await assert.rejects(()=>fetchBrowserOpenOrders(creds,signer,funder,(async()=>Response.json([order])) as typeof fetch),/incomplete_pagination/);
 await assert.rejects(()=>fetchBrowserOpenOrders(creds,signer,funder,(async()=>Response.json({data:[{...order,maker_address:signer}],next_cursor:"LTE="})) as typeof fetch),/maker_mismatch/);
 await assert.rejects(()=>fetchBrowserOpenOrders(creds,signer,funder,(async()=>new Response("",{status:429})) as typeof fetch),/rate_limited/);
});

test("conditional balance uses Safe signature type and signs the correct path",async()=>{
 const {fetchConditionalBalance}=await import("../lib/browser-clob");
 const mock=(async (url,init)=>{const u=new URL(String(url));const h=new Headers(init?.headers);assert.equal(u.pathname,"/balance-allowance");assert.equal(u.searchParams.get("asset_type"),"CONDITIONAL");assert.equal(u.searchParams.get("token_id"),"123");assert.equal(u.searchParams.get("signature_type"),"2");assert.equal(h.get("POLY_SIGNATURE"),createHmac("sha256",Buffer.from(creds.secret,"base64")).update(`${h.get("POLY_TIMESTAMP")}GET/balance-allowance`).digest("base64url")+"=");return Response.json({balance:"10000000",allowances:{[funder]:"999999999"}});}) as typeof fetch;
 const data=await fetchConditionalBalance(creds,signer,"123",mock);assert.equal(data.balance,"10000000");
});
test("conditional balance rejects invalid identifiers, payloads and upstream failure",async()=>{
 const {fetchConditionalBalance}=await import("../lib/browser-clob");
 await assert.rejects(()=>fetchConditionalBalance(creds,signer,"bad",fetch),/invalid_asset/);
 await assert.rejects(()=>fetchConditionalBalance(creds,signer,"123",(async()=>Response.json({balance:"5"})) as typeof fetch),/invalid_balance/);
 await assert.rejects(()=>fetchConditionalBalance(creds,signer,"123",(async()=>new Response("",{status:429})) as typeof fetch),/rate_limited/);
});
