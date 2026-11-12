import assert from "node:assert/strict";
import test from "node:test";
import { createHmac,randomBytes } from "node:crypto";
import { isReadPath, l2Headers,parseAccountSecret,signL2Request } from "./clob-auth.mjs";
import { fetchOpenOrders } from "./clob-orders.mjs";
import { createReaderHandler } from "./worker.mjs";

const addr="0x1111111111111111111111111111111111111111";
const second="0x2222222222222222222222222222222222222222";
const secret=Buffer.from("test-hmac-secret-key-material-123").toString("base64");
const account={signerAddress:addr,funderAddress:second,apiKey:"1234567890-a",
  secret,passphrase:"long-passphrase"};
const credentialSecret=JSON.stringify(account),token="X".repeat(52);
const order=(id,additional={})=>({
 id,asset_id:"123456789123456789",maker_address:second,
 side:"SELL",status:"LIVE",price:"0.990",
 original_size:"100",size_matched:"25",order_type:"GTD",
 expiration:"1893456000",...additional
});
const page=(data,next="LTE=",count=data.length)=>({
 data,next_cursor:next,total_count:count
});
const goodResponse=data=>Response.json(data);
const request=(path,auth=token,method="GET")=>new Request(
 "https://reader.example.test"+path,
 {method,headers:{"authorization":"Bearer "+auth}}
);

test("official L2 HMAC signs timestamp + GET + path, excluding query",async()=>{
 const timestamp=1794510000;
 const sig=await signL2Request({secret,method:"GET",path:"/data/orders",timestamp});
 const reference=createHmac("sha256",Buffer.from(secret,"base64"))
   .update(String(timestamp)+"GET"+"/data/orders")
   .digest("base64").replace(/\+/g,"-").replace(/\//g,"_");
 assert.equal(sig,reference);
 const headers=await l2Headers(account,"/data/orders",timestamp);
 assert.equal(headers.POLY_SIGNATURE,sig);
 assert.equal(headers.POLY_ADDRESS,addr);
 assert.equal(headers.POLY_TIMESTAMP,String(timestamp));
 assert.ok(isReadPath("/data/orders"));
 assert.ok(isReadPath("/data/trades"));
 assert.ok(isReadPath("/data/order/"+"a".repeat(64).padStart(66,"0x")));
 assert.equal(isReadPath("/order"),false);
 await assert.rejects(()=>signL2Request({secret,method:"POST",path:"/order",timestamp}),
    /clob_read_only_policy/);
});

test("credential parser enforces signer/funder address mapping",()=>{
 assert.equal(parseAccountSecret(credentialSecret).funderAddress,second);
 assert.throws(()=>parseAccountSecret(JSON.stringify({...account,signerAddress:"bad"})),
    /invalid_fields/);
 assert.throws(()=>parseAccountSecret("not-json"),/invalid_json/);
});

test("full two-page cursor accounting with exact GET-only headers",async()=>{
 const queried=[],mock=async(url,init)=>{
   queried.push({url,method:init.method,headers:init.headers});
   const u=new URL(url);
   if(!u.searchParams.has("next_cursor"))return goodResponse(page([order("o1")],"MQ==",2));
   assert.equal(u.searchParams.get("next_cursor"),"MQ==");
   return goodResponse(page([order("o2",{size_matched:"10"})],"LTE=",2));
 };
 const snap=await fetchOpenOrders(account,mock,1794510000);
 assert.equal(snap.complete,true);
 assert.equal(snap.orders.length,2);
 assert.equal(snap.pages,2);
 assert.equal(snap.rawOrderCount,2);
 assert.equal(snap.matchingMakerObserved,true);
 assert.equal(queried.length,2);
 assert.ok(queried.every(x=>x.method==="GET"));
 assert.ok(queried.every(x=>x.headers.POLY_SIGNATURE===queried[0].headers.POLY_SIGNATURE),
   "CLOB HMAC signs the path not the query cursor");
 assert.ok(!JSON.stringify(snap).includes(account.secret));
 assert.ok(!JSON.stringify(snap).includes(account.passphrase));
});

test("foreign-maker orders are not assigned to wrong Polymarket wallet",async()=>{
 const fetcher=async()=>goodResponse(page([order("foreign",{maker_address:addr})]));
 const snap=await fetchOpenOrders(account,fetcher,1794510000);
 assert.equal(snap.complete,true);
 assert.equal(snap.foreignMakerOrderCount,1);
 assert.equal(snap.matchingMakerObserved,false);
 assert.deepEqual(snap.orders,[]);
});

test("missing pagination, HTTP errors and malformed order fields fail closed",async()=>{
 const cases=[
  [()=>goodResponse([order("array")]),"unpaginated_orders_response_unverified"],
  [()=>goodResponse({data:[order("no-cursor")]}),"order_pagination_not_verifiable"],
  [()=>new Response(null,{status:429}),"clob_orders_rate_limited"],
  [()=>new Response(null,{status:401}),"clob_l2_authorization_failed"],
  [()=>goodResponse(page([order("bad",{original_size:"NaN"})])),"invalid_clob_order_schema"],
  [()=>goodResponse(page([order("same"),order("same")])),"repeated_open_order_id"],
  [()=>goodResponse(page([order("1")],"LTE=",2)),"clob_orders_total_count_mismatch"],
  [()=>goodResponse(page([order("1")],"MQ==",1)),"repeated_order_cursor"]
 ];
 for(const [handler,code] of cases){
   let calls=0;
   await assert.rejects(()=>fetchOpenOrders(account,async()=>{calls++;return handler();},
     1794510000),err=>err.code===code);
   assert.ok(calls<=3);
 }
});

test("authenticated Worker exposes only GET and no unconfigured wallet data",async()=>{
 const handler=createReaderHandler(async()=>goodResponse(page([order("yes")])),
   ()=>1794510000);
 const env={ORDER_READER_TOKEN:token,CLOB_ACCOUNT_1:credentialSecret};
 assert.equal((await handler(request("/health",""),env)).status,200);
 assert.equal((await handler(request("/orders?wallet="+second,"wrong"),env)).status,401);
 assert.equal((await handler(request("/orders?wallet="+second,token,"POST"),env)).status,405);
 assert.equal((await handler(request("/order?wallet="+second),env)).status,404);
 assert.equal((await handler(request("/orders?wallet="+addr),env)).status,404);
 const status=await (await handler(request("/status"),env)).json();
 assert.equal(status.configuredCount,1);
 assert.equal(status.tradingRoutesEnabled,false);
 const result=await (await handler(request("/orders?wallet="+second),env)).json();
 assert.equal(result.ok,true);
 assert.equal(result.mode,"read-only");
 assert.equal(result.orders[0].id,"yes");
 assert.equal(result.actionableForTrading,false);
 assert.ok(!JSON.stringify(result).includes(secret));
 assert.ok(!JSON.stringify(result).includes("long-passphrase"));
 assert.equal((await handler(request("/orders?wallet="+second),
   {ORDER_READER_TOKEN:token})).status,404);
 assert.equal((await handler(request("/orders?wallet="+second),{})).status,401);
});

test("never convert API 429 into a false empty order book",async()=>{
 const handler=createReaderHandler(async()=>new Response(null,{status:429}),()=>1794510000);
 const res=await handler(request("/orders?wallet="+second),{
   ORDER_READER_TOKEN:token,CLOB_ACCOUNT_1:credentialSecret
 });
 assert.equal(res.status,503);
 const body=await res.json();
 assert.equal(body.complete,false);
 assert.equal(body.error,"clob_orders_rate_limited");
 assert.equal(body.orders,undefined);
});
