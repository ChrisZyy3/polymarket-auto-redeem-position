import assert from "node:assert/strict";
import test from "node:test";

import {
  appendSnapshot,
  calculateHistoryMetrics,
  type PortfolioHistory,
  type PortfolioSnapshot,
} from "../lib/portfolio-history";

const ADDRESS = "0x1111111111111111111111111111111111111111";

function snapshot(recordedAt: string, totalBalance: number): PortfolioSnapshot {
  return {
    recordedAt,
    address: ADDRESS,
    totalBalance,
    positionsValue: totalBalance - 10,
    availableBalance: 10,
    positionCount: 2,
  };
}

test("appendSnapshot replaces an existing snapshot from the same UTC day", () => {
  const history: PortfolioHistory = {
    version: 1,
    snapshots: [snapshot("2026-07-15T01:00:00.000Z", 100)],
  };

  const updated = appendSnapshot(history, snapshot("2026-07-15T12:00:00.000Z", 105));

  assert.equal(updated.snapshots.length, 1);
  assert.equal(updated.snapshots[0]?.totalBalance, 105);
  assert.equal(updated.snapshots[0]?.recordedAt, "2026-07-15T12:00:00.000Z");
});

test("appendSnapshot keeps different wallets and orders snapshots chronologically", () => {
  const anotherWallet = {
    ...snapshot("2026-07-16T01:00:00.000Z", 90),
    address: "0x2222222222222222222222222222222222222222",
  };
  const history: PortfolioHistory = { version: 1, snapshots: [anotherWallet] };

  const updated = appendSnapshot(history, snapshot("2026-07-14T01:00:00.000Z", 80));

  assert.deepEqual(updated.snapshots.map((item) => item.recordedAt), [
    "2026-07-14T01:00:00.000Z",
    "2026-07-16T01:00:00.000Z",
  ]);
});

test("calculateHistoryMetrics uses the nearest snapshot at or before each lookback", () => {
  const snapshots = [
    snapshot("2026-06-14T00:00:00.000Z", 100),
    snapshot("2026-07-07T00:00:00.000Z", 108),
    snapshot("2026-07-14T00:00:00.000Z", 110),
  ];

  const metrics = calculateHistoryMetrics(snapshots);

  assert.ok(metrics.changeSinceStart !== null);
  assert.ok(Math.abs(metrics.changeSinceStart - 0.1) < 1e-12);
  assert.ok(metrics.annualized7d !== null);
  assert.ok(Math.abs(metrics.annualized7d - 1.603291266635761) < 1e-10);
  assert.ok(metrics.annualized30d !== null);
  assert.ok(Math.abs(metrics.annualized30d - 2.188680476905306) < 1e-10);
});

test("calculateHistoryMetrics returns null rates when history is too short", () => {
  const metrics = calculateHistoryMetrics([snapshot("2026-07-14T00:00:00.000Z", 110)]);

  assert.equal(metrics.changeSinceStart, 0);
  assert.equal(metrics.annualized7d, null);
  assert.equal(metrics.annualized30d, null);
});
