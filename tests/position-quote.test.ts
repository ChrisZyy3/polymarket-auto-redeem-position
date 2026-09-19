import assert from "node:assert/strict";
import test from "node:test";

import { buildPositionQuote } from "../lib/position-quote";
import { getOrderBook, OrderBookRequestError } from "../lib/poly-yield/polymarket";
import type { OrderBook } from "../lib/poly-yield/types";

const now = new Date("2026-01-01T00:00:00.000Z");

function book(overrides: Partial<OrderBook> = {}): OrderBook {
  return {
    bids: [{ price: "0.990", size: "1000" }],
    asks: [{ price: "0.995", size: "1000" }],
    tick_size: "0.001",
    ...overrides,
  };
}

test("recommends a buy when the current APR is above the target", () => {
  const quote = buildPositionQuote({
    currentPrice: 0.8,
    endDate: "2027-01-01",
    thresholdAprPercent: 20,
    orderBook: book({
      bids: [{ price: "0.810", size: "1000" }],
      asks: [{ price: "0.820", size: "1000" }],
    }),
    now,
  });

  assert.equal(quote.action, "buy");
  assert.ok(quote.currentApr !== null && quote.currentApr > 0.2);
  assert.ok(quote.thresholdPrice !== null);
  assert.equal(quote.recommendedBuyPrice, 0.82);
  assert.ok(quote.recommendedBuyPrice <= quote.thresholdPrice);
  assert.equal(quote.recommendedSellPrice, 0.833);
});

test("recommends a sell when the current APR is at or below the target", () => {
  const quote = buildPositionQuote({
    currentPrice: 0.999,
    endDate: "2026-02-01",
    thresholdAprPercent: 8,
    orderBook: book({
      bids: [{ price: "0.998", size: "1000" }],
      asks: [{ price: "0.999", size: "1000" }],
    }),
    now,
  });

  assert.equal(quote.action, "sell");
  assert.ok(quote.currentApr !== null && quote.currentApr < 0.08);
  assert.ok(quote.recommendedSellPrice !== null);
  assert.equal(quote.recommendedSellPrice, 0.998);
  assert.ok(quote.recommendedBuyPrice !== null);
  assert.ok(quote.recommendedBuyPrice < quote.recommendedSellPrice);
});

test("selects the highest valid bid and lowest valid ask from an unsorted book", () => {
  const quote = buildPositionQuote({
    currentPrice: 0.8,
    endDate: "2027-01-01",
    thresholdAprPercent: 20,
    orderBook: book({
      bids: [
        { price: "0.790", size: "1000" },
        { price: "0.810", size: "1000" },
        { price: "0.820", size: "0" },
      ],
      asks: [
        { price: "0.840", size: "1000" },
        { price: "0.820", size: "1000" },
        { price: "0.800", size: "0" },
      ],
    }),
    now,
  });

  assert.equal(quote.bestBid, 0.81);
  assert.equal(quote.bestAsk, 0.82);
  assert.ok(quote.bestBidApr !== null && quote.bestBidApr > quote.bestAskApr!);
  assert.ok(quote.bestAskApr !== null && quote.bestAskApr > 0);
});

test("keeps the theoretical target price when the order book is unavailable", () => {
  const quote = buildPositionQuote({
    currentPrice: 0.8,
    endDate: "2027-01-01",
    thresholdAprPercent: 20,
    orderBook: null,
    now,
  });

  assert.equal(quote.action, "buy");
  assert.equal(quote.bestBid, null);
  assert.equal(quote.bestAsk, null);
  assert.equal(quote.bestBidApr, null);
  assert.equal(quote.bestAskApr, null);
  assert.ok(quote.thresholdPrice !== null);
  assert.ok(quote.recommendedBuyPrice !== null);
  assert.ok(quote.recommendedSellPrice !== null);
  assert.match(quote.note ?? "", /盘口/);
});

test("returns an unavailable quote for a position without a valid settlement window", () => {
  const quote = buildPositionQuote({
    currentPrice: 0.8,
    endDate: null,
    thresholdAprPercent: 20,
    orderBook: book(),
    now,
  });

  assert.equal(quote.action, "unavailable");
  assert.equal(quote.thresholdPrice, null);
  assert.equal(quote.recommendedBuyPrice, null);
  assert.equal(quote.recommendedSellPrice, null);
  assert.equal(quote.currentApr, null);
  assert.equal(quote.note, "缺少结算日期");
});

test("treats a malformed successful order-book response as unavailable", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ bids: null, asks: "not-an-array", tick_size: "0.001" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    await assert.rejects(
      () => getOrderBook("token"),
      (error: unknown) => {
        assert.ok(error instanceof OrderBookRequestError);
        assert.equal(error.kind, "invalid-response");
        assert.equal(error.message, "book response had an invalid order-book shape");
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("builds a theoretical quote when the supplied order book has invalid arrays", () => {
  const quote = buildPositionQuote({
    currentPrice: 0.8,
    endDate: "2027-01-01",
    thresholdAprPercent: 20,
    orderBook: { bids: null, asks: "not-an-array", tick_size: "0.001" } as unknown as OrderBook,
    now,
  });

  assert.equal(quote.orderBookAvailable, false);
  assert.equal(quote.bestBid, null);
  assert.equal(quote.bestAsk, null);
  assert.ok(quote.thresholdPrice !== null);
  assert.ok(quote.recommendedBuyPrice !== null);
  assert.ok(quote.recommendedSellPrice !== null);
  assert.match(quote.note ?? "", /盘口/);
});
