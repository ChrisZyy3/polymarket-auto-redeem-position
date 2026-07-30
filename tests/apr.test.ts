import assert from "node:assert/strict";
import test from "node:test";

import { calcApr } from "../lib/apr";
import type { Position } from "../lib/types";

function position(overrides: Partial<Position> = {}): Position {
  return {
    proxyWallet: "0x1111111111111111111111111111111111111111",
    asset: "asset",
    conditionId: "condition",
    size: 10,
    avgPrice: 0.5,
    initialValue: 5,
    currentValue: 5,
    cashPnl: 0,
    percentPnl: 0,
    totalBought: 10,
    realizedPnl: 0,
    percentRealizedPnl: 0,
    curPrice: 0.5,
    redeemable: false,
    mergeable: false,
    title: "Market",
    slug: "market",
    icon: "",
    eventSlug: "market",
    outcome: "Yes",
    outcomeIndex: 0,
    oppositeOutcome: "No",
    oppositeAsset: "opposite",
    endDate: "2026-11-01",
    negativeRisk: false,
    ...overrides,
  };
}

test("calcApr handles a missing settlement date", () => {
  const result = calcApr(position({ endDate: null }));

  assert.equal(result.note, "缺少结算日期");
  assert.equal(result.holdApr, null);
  assert.ok(Number.isNaN(result.daysToSettle));
});

test("calcApr resolves settlement at the correct DST offset", () => {
  const result = calcApr(position(), new Date("2026-11-01T04:00:00.000Z"));

  // 2026-11-01 ends at 23:59:59.999 ET after the fall-back transition.
  assert.ok(Math.abs(result.daysToSettle - 1.0416666667) < 1e-6);
});
