import assert from "node:assert/strict";
import test from "node:test";

import { filterPositionsByMinimumValue, parseCashBalanceResponse } from "../lib/polymarket";

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

test("filterPositionsByMinimumValue excludes positions worth less than one dollar", () => {
  const positions = [
    { currentValue: 0.99 },
    { currentValue: 1 },
    { currentValue: 12.5 },
    { currentValue: Number.NaN },
  ];

  assert.deepEqual(filterPositionsByMinimumValue(positions, 1), [
    { currentValue: 1 },
    { currentValue: 12.5 },
  ]);
});
