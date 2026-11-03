import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, test } from "node:test";
import { config } from "../lib/config";

const address = "0x052f4191cd324A348835A846d34dF5b0061e53fb";
const row = {
  proxy_wallet: address, token_id: "123", condition_id: "0xabc",
  current_size: 10, avg_price: 0.8, entry_cost_usdc: 8,
  current_value: 9, unrealized_pnl: 1, percent_pnl: 12.5,
  total_size: 15, realized_pnl: -2, total_pnl: -1,
  percent_realized_pnl: -20, current_price: 0.9,
  redeemable: false, mergeable: false, title: "Example", slug: "example",
  icon: "icon", event_slug: "event", outcome: "Yes", outcome_index: 0,
  opposite_outcome: "No", opposite_token_id: "456", end_date: "2027-01-01",
  negative_risk: false,
};
let requests: URL[] = [];
let pages: unknown[] = [];
const server = createServer((req, res) => {
  const url = new URL(req.url!, "http://localhost");
  res.setHeader("content-type", "application/json");
  if (req.method === "POST") {
    res.end(JSON.stringify({ result: "0xf4240" }));
    return;
  }
  requests.push(url);
  if (url.pathname !== "/v2/positions") {
    res.statusCode = 410;
    res.end(JSON.stringify({ error: "Data API v1 has been retired" }));
    return;
  }
  res.end(JSON.stringify(pages.shift()));
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as { port: number }).port;
config.polymarketDataApiBaseUrl = `http://127.0.0.1:${port}`;
config.polygonRpcUrl = config.polymarketDataApiBaseUrl;
const { fetchCurrentPositions, fetchRedeemablePositions } = await import("../lib/polymarket");
const { GET } = await import("../app/api/positions/route");
const { NextRequest } = await import("next/server");
after(() => new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())));

function setup(data: unknown[], next_cursor: string | null = null) {
  return { data, pagination: { has_more: next_cursor !== null, next_cursor } };
}

test("v2 cursor pages preserve position fields and apply the existing share threshold", async () => {
  requests = [];
  pages = [setup([row, { ...row, current_size: 0.09 }], "opaque+cursor="),
    setup([{ ...row, token_id: "789", redeemable: true }])];
  const positions = await fetchCurrentPositions(address);
  assert.equal(positions.length, 2);
  assert.deepEqual(positions[0], {
    proxyWallet: address, asset: "123", conditionId: "0xabc", size: 10,
    avgPrice: 0.8, initialValue: 8, currentValue: 9, cashPnl: 1,
    percentPnl: 12.5, totalBought: 15, realizedPnl: -2, percentRealizedPnl: -20,
    curPrice: 0.9, redeemable: false, mergeable: false, title: "Example",
    slug: "example", icon: "icon", eventSlug: "event", outcome: "Yes",
    outcomeIndex: 0, oppositeOutcome: "No", oppositeAsset: "456",
    endDate: "2027-01-01", negativeRisk: false,
  });
  assert.equal(positions[1].redeemable, true);
  assert.equal(requests.length, 2); // A short page still has a next cursor.
  assert.equal(requests[1].searchParams.get("cursor"), "opaque+cursor=");
  for (const url of requests) {
    assert.equal(url.searchParams.get("user"), address);
    assert.equal(url.searchParams.get("status"), "OPEN");
    assert.equal(url.searchParams.get("filter_amount"), "0");
    assert.equal(url.searchParams.has("offset"), false);
    assert.equal(url.searchParams.has("sizeThreshold"), false);
  }
});

test("redeemable lookup uses v2 status and follows every cursor", async () => {
  requests = [];
  pages = [setup([{ ...row, redeemable: true }], "next"),
    setup([{ ...row, token_id: "789", redeemable: true }])];
  assert.equal((await fetchRedeemablePositions(address)).length, 2);
  assert.equal(requests[0].searchParams.get("status"), "REDEEMABLE");
});

test("an empty wallet succeeds and unavailable numbers are not invented as zero", async () => {
  pages = [setup([])];
  assert.deepEqual(await fetchCurrentPositions(address), []);
  pages = [setup([{ ...row, unrealized_pnl: null }])];
  assert.ok(Number.isNaN((await fetchCurrentPositions(address))[0].cashPnl));
});

test("invalid pages and repeated cursors fail instead of returning partial portfolios", async () => {
  pages = [{ data: [] }];
  await assert.rejects(fetchCurrentPositions(address), /invalid positions page/);
  pages = [setup([row], "same"), setup([row], "same")];
  await assert.rejects(fetchCurrentPositions(address), /repeated a positions cursor/);
});

test("the reported route returns 200 on v2 even when Gamma is unavailable", async () => {
  pages = [setup([row, { ...row, token_id: "dust", current_value: 0.99 }])];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Gamma unavailable"); };
  try {
    const response = await GET(new NextRequest(`http://localhost/api/positions?address=${address}&aprThreshold=12&minValue=1`));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.positions.length, 1);
    assert.equal(body.summary.availableBalance, 1);
    assert.equal(body.positions[0].holdingRewardEligible, null);
    assert.equal(body.positions[0].holdingRewardApr, 0);
    assert.equal(body.positions[0].holdApr, body.positions[0].markApr);
    assert.equal(body.positions[0].cashPnl, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
