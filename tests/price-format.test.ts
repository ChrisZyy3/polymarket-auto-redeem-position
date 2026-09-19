import assert from "node:assert/strict";
import test from "node:test";

import { formatPriceForTick, priceDecimalsForTick } from "../lib/price-format";

test("uses the tick size precision for quote prices", () => {
  assert.equal(priceDecimalsForTick(0.001), 3);
  assert.equal(formatPriceForTick(0.001, 0.001), "$0.001");
  assert.equal(formatPriceForTick(0.9827, 0.001), "$0.983");
});

test("preserves trailing zeroes when a market uses a wider tick", () => {
  assert.equal(priceDecimalsForTick(0.01), 2);
  assert.equal(formatPriceForTick(0.5, 0.01), "$0.50");
});

test("uses the theoretical fallback precision without a live tick", () => {
  assert.equal(formatPriceForTick(0.8, null), "$0.800");
  assert.equal(formatPriceForTick(null, null), "—");
});
