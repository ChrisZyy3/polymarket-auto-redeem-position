import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("single main table provides yield and SELL planning modes",()=>{
 const page=readFileSync("app/page.tsx","utf8");
 assert.equal((page.match(/<table\b/g)??[]).length,1);
 assert.match(page,/tradeMode==='yield'/);
 assert.match(page,/tradeMode==='sell'/);
 assert.match(page,/SellPlanRow/);
 assert.doesNotMatch(page,/PortfolioSellSummary|AutoSellPlannerPanel/);
});
test("signing stays in guarded review drawer; order table is lazy in order center",()=>{
 const review=readFileSync("app/components/manual-sell-review.tsx","utf8");
 const clob=readFileSync("app/components/browser-clob-panel.tsx","utf8");
 assert.doesNotMatch(review,/<table\b/);
 assert.match(review,/reviewRequest/);
 assert.match(review,/loadSellReview/);
 assert.match(review,/matchingLiveSellOrder/);
 assert.match(clob,/orderCenterOpen&&/);
 assert.match(clob,/OpenOrdersTable/);
 assert.match(clob,/ordersReady/);
});
