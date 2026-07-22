import assert from "node:assert/strict";
import test from "node:test";

import { parseCashBalanceResponse } from "../lib/polymarket";

test("parseCashBalanceResponse decodes six-decimal token balances", () => {
  assert.equal(parseCashBalanceResponse({ result: "0xf4240" }), 1);
  assert.equal(parseCashBalanceResponse({ result: "0x0" }), 0);
});

test("parseCashBalanceResponse rejects JSON-RPC errors instead of recording zero", () => {
  assert.throws(
    () =>
      parseCashBalanceResponse({
        error: { code: -32000, message: "upstream unavailable" },
      }),
    /Polygon RPC error -32000/,
  );
});

test("parseCashBalanceResponse rejects missing or malformed results", () => {
  assert.throws(() => parseCashBalanceResponse({}), /no valid cash balance/);
  assert.throws(
    () => parseCashBalanceResponse({ result: "not-hex" }),
    /no valid cash balance/,
  );
});
