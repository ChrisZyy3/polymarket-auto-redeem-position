import assert from "node:assert/strict";
import test from "node:test";

import { formatMarketPercentForTick, priceDecimalsForTick } from "../lib/price-format";

test("uses the tick size precision for quote prices", () => {
  assert.equal(priceDecimalsForTick(0.001), 3);
  assert.equal(formatMarketPercentForTick(0.001, 0.001), "0.1%");
  assert.equal(formatMarketPercentForTick(0.9827, 0.001), "98.3%");
});

test("preserves trailing zeroes when a market uses a wider tick", () => {
  assert.equal(priceDecimalsForTick(0.01), 2);
  assert.equal(formatMarketPercentForTick(0.5, 0.01), "50%");
});

test("uses the theoretical fallback precision without a live tick", () => {
  assert.equal(formatMarketPercentForTick(0.8, null), "80.0%");
  assert.equal(formatMarketPercentForTick(null, null), "—");
});
