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
