import assert from "node:assert/strict";
import test from "node:test";
import { getOrderBook, OrderBookRequestError } from "../lib/poly-yield/polymarket";
import { decideOrder } from "../lib/poly-yield/strategy";
import { apyForPrice, priceForTargetApy } from "../lib/poly-yield/yield";

const now = new Date("2026-01-01T00:00:00.000Z");
const endTime = "2027-01-01T00:00:00.000Z";

test("converts one-year target APY into a maximum bid price", () => {
  assert.equal(priceForTargetApy(0.2, endTime, now), 1 / 1.2);
  assert.ok(Math.abs(apyForPrice(1 / 1.2, endTime, now) - 0.2) < 1e-12);
});

test("prices one tick above the best sufficiently deep bid without crossing the ask", () => {
  const result = decideOrder(
    {
      name: "example",
      tokenId: "token",
      endTime,
      targetApy: 0.2,
      amountUsd: 100,
      minExternalLevelUsd: 50,
      tickSize: 0.001,
    },
    {
      bids: [
        { price: "0.820", size: "100" },
        { price: "0.840", size: "10" },
      ],
      asks: [{ price: "0.900", size: "100" }],
      tick_size: "0.001",
    },
    now,
  );

  assert.equal(result.effectiveBestExternalBid, 0.82);
  assert.equal(result.desiredPrice, 0.821);
  assert.ok(result.conditionalApy > 0.2);
});

test("caps the desired price one tick below a nearby ask", () => {
  const result = decideOrder(
    {
      name: "example",
      tokenId: "token",
      endTime,
      targetApy: 0.2,
      amountUsd: 100,
      minExternalLevelUsd: 50,
      tickSize: 0.001,
    },
    {
      bids: [{ price: "0.820", size: "100" }],
      asks: [{ price: "0.821", size: "100" }],
      tick_size: "0.001",
    },
    now,
  );

  assert.equal(result.desiredPrice, 0.82);
});

test("surfaces CLOB network causes and request timeouts", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () => {
      const error = new TypeError("fetch failed");
      Object.defineProperty(error, "cause", { value: new Error("ECONNRESET") });
      throw error;
    };

    await assert.rejects(
      () => getOrderBook("token", { timeoutMs: 50 }),
      (error: unknown) => {
        assert.ok(error instanceof OrderBookRequestError);
        assert.equal(error.kind, "network");
        assert.match(error.causeMessage ?? "", /ECONNRESET/);
        return true;
      },
    );

    globalThis.fetch = async (_input, init) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          },
          { once: true },
        );
      });

    await assert.rejects(
      () => getOrderBook("token", { timeoutMs: 5 }),
      (error: unknown) => {
        assert.ok(error instanceof OrderBookRequestError);
        assert.equal(error.kind, "timeout");
        assert.match(error.message, /timed out after 5ms/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
