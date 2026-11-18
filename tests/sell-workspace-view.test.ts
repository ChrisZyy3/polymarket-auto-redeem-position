import test from "node:test";
import assert from "node:assert/strict";
import { getSellWorkspaceNumbers } from "../app/components/sell-plan-row";

test("unconnected account is dry-run only and never fabricates open sells",()=>{
 const p={asset:"123",size:100,redeemable:false,avgPrice:0.9} as Parameters<typeof getSellWorkspaceNumbers>[0];
 const d=getSellWorkspaceNumbers(p,null,"12",undefined,null,false);
 assert.equal(d.openSell,null);assert.equal(d.indicative,null);assert.equal(d.quantity,"100");assert.equal(d.plan,null);
});
test("invalid APR and quantity suppress executable-looking simulations",()=>{
 const p={asset:"123",size:100,redeemable:false,avgPrice:0.9} as Parameters<typeof getSellWorkspaceNumbers>[0];
 assert.equal(getSellWorkspaceNumbers(p,null,"",undefined,null,false).validApr,false);
 assert.equal(getSellWorkspaceNumbers(p,null,"12","",null,false).validQuantity,false);
});

test('a successful LIVE sell reserving all shares disables accidental duplicate review',()=>{
 const position={asset:'123',size:11,redeemable:false,avgPrice:.9} as Parameters<typeof getSellWorkspaceNumbers>[0];
 const order={id:'live1',asset_id:'123',maker_address:'0x'+'1'.repeat(40),side:'SELL' as const,status:'LIVE',price:'0.986',original_size:'11',size_matched:'0'};
 const result=getSellWorkspaceNumbers(position,null,'12','11',[order],true);
 assert.equal(result.indicative,0);
 assert.equal(result.openSell,11);
 assert.equal(result.noUnreserved,true);
 assert.equal(result.canReview,false);
});
test('small and over-allocated review quantities are blocked in the table before preflight',()=>{
 const p={asset:'123',size:11,redeemable:false,avgPrice:.9} as Parameters<typeof getSellWorkspaceNumbers>[0];
 assert.equal(getSellWorkspaceNumbers(p,null,'12','0.001',[],true).canReview,false);
 assert.equal(getSellWorkspaceNumbers(p,null,'12','11.01',[],true).canReview,false);
 assert.equal(getSellWorkspaceNumbers(p,null,'12','11',[],true).canReview,true);
});
