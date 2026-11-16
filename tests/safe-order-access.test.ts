import test from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { orderAccessMessage, safeAddressForSigner, verifyOrderAccess } from "../lib/safe-order-access";
import { POST } from "../app/api/safe-open-orders/route";
import { NextRequest } from "next/server";
const account=privateKeyToAccount(`0x${"01".repeat(32)}`);
const signer=account.address, funder=safeAddressForSigner(signer), now=1794510000000;
const proof={signer,funder,origin:"https://example.com",issuedAt:now,nonce:"ab".repeat(16)};

test("safe address derivation matches known Polymarket account",()=>{
 assert.equal(safeAddressForSigner("0x7648FbF5799D3a2F6A0aEf231855506D8D1a6904").toLowerCase(),"0x24816c037cdc2c9bd979e69d777541cf560a9b79");
});
test("only a fresh wallet signature bound to signer, Safe and origin is accepted",async()=>{
 const signature=await account.signMessage({message:orderAccessMessage(proof)});
 assert.equal(await verifyOrderAccess({...proof,signature},now),true);
 assert.equal(await verifyOrderAccess({...proof,origin:"https://other.example",signature},now),false);
 assert.equal(await verifyOrderAccess({...proof,funder:signer,signature},now),false);
 assert.equal(await verifyOrderAccess({...proof,signature},now+120001),false);
});
test("unauthorized requests are refused before accessing the order reader",async()=>{
 const response=await POST(new NextRequest("https://example.com/api/safe-open-orders",{method:"POST",headers:{origin:"https://evil.example"},body:"{}"}));
 assert.equal(response.status,403);
});

test("valid proof fails closed without configured reader",async()=>{
 const data={...proof,issuedAt:Date.now()};
 const signature=await account.signMessage({message:orderAccessMessage(data)});
 const oldUrl=process.env.ORDER_READER_URL,oldToken=process.env.ORDER_READER_TOKEN;
 delete process.env.ORDER_READER_URL;delete process.env.ORDER_READER_TOKEN;
 try {
  const response=await POST(new NextRequest("https://example.com/api/safe-open-orders",{method:"POST",headers:{origin:"https://example.com","content-type":"application/json"},body:JSON.stringify({...data,signature})}));
  assert.equal(response.status,503);assert.equal((await response.json()).error,"reader_not_configured");
 } finally {if(oldUrl!==undefined)process.env.ORDER_READER_URL=oldUrl;if(oldToken!==undefined)process.env.ORDER_READER_TOKEN=oldToken;}
});

test("authorized read verifies account and snapshot without exposing the bearer token",async()=>{
 const data={...proof,issuedAt:Date.now()};const signature=await account.signMessage({message:orderAccessMessage(data)});
 const oldFetch=globalThis.fetch,oldUrl=process.env.ORDER_READER_URL,oldToken=process.env.ORDER_READER_TOKEN;
 process.env.ORDER_READER_URL="https://polymarket-order-reader.chriszyy3.workers.dev";
 process.env.ORDER_READER_TOKEN="z".repeat(48);
 globalThis.fetch=(async (url,init)=>{
  assert.equal(new URL(String(url)).searchParams.get("wallet"),funder);
  assert.equal(new Headers(init?.headers).get("authorization"),`Bearer ${"z".repeat(48)}`);
  return Response.json({complete:true,actionableForTrading:false,accountFunder:funder,signerAddress:signer,asOf:Math.floor(Date.now()/1000),mappingStatus:"observed",orders:[]});
 }) as typeof fetch;
 try {
  const response=await POST(new NextRequest("https://example.com/api/safe-open-orders",{method:"POST",headers:{origin:"https://example.com","content-type":"application/json"},body:JSON.stringify({...data,signature})}));
  const text=await response.text();assert.equal(response.status,200);assert.equal(JSON.parse(text).complete,true);assert.ok(!text.includes("z".repeat(48)));
 } finally {globalThis.fetch=oldFetch;if(oldUrl===undefined)delete process.env.ORDER_READER_URL;else process.env.ORDER_READER_URL=oldUrl;if(oldToken===undefined)delete process.env.ORDER_READER_TOKEN;else process.env.ORDER_READER_TOKEN=oldToken;}
});
