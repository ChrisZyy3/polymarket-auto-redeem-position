import assert from "node:assert/strict";
import test from "node:test";
import { positionBaselineDates, selectPositionBaseline } from "../lib/position-baseline";
import { calculateDailyPriceChange, type DailyPositionHistory } from "../lib/position-change";

const NOW = new Date("2026-11-18T04:15:00Z"); // Beijing Nov 18
const WALLET = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
function history(date: string, address = WALLET): DailyPositionHistory {
  return {
    version: 1,
    date,
    wallets: [{
      address,
      recordedAt: date + "T07:55:04.954Z",
      positions: [{ tokenId: "token-no", price: .96, size: 10, value: 9.6 }],
    }],
  };
}

test("seven-day Beijing calendar lookback excludes today and survives year boundaries", () => {
  assert.deepEqual(positionBaselineDates(NOW), [
    "2026-11-17", "2026-11-16", "2026-11-15", "2026-11-14",
    "2026-11-13", "2026-11-12", "2026-11-11",
  ]);
  assert.deepEqual(
    positionBaselineDates(new Date("2027-01-01T00:30:00Z"), 3),
    ["2026-12-31", "2026-12-30", "2026-12-29"],
  );
  assert.throws(() => positionBaselineDates(NOW, 8), /lookback/);
});

test("yesterday's wallet data remains D1 and takes priority over older days", async () => {
  const visited: string[] = [];
  const result = await selectPositionBaseline(WALLET, NOW, async date => {
    visited.push(date);
    return date === "2026-11-17" ? history(date) : history("2026-11-16");
  });
  assert.deepEqual(visited, ["2026-11-17"]);
  assert.equal(result.status, "ok");
  assert.equal(result.referenceKind, "yesterday");
  assert.equal(result.baselineDate, "2026-11-17");
});

test("missing yesterday uses Nov 16 but never calls it D1", async () => {
  const visited: string[] = [];
  const result = await selectPositionBaseline(WALLET.toUpperCase(), NOW, async date => {
    visited.push(date);
    return date === "2026-11-16" ? history(date) : null;
  });
  assert.deepEqual(visited, ["2026-11-17", "2026-11-16"]);
  assert.equal(result.status, "ok");
  assert.equal(result.expectedDate, "2026-11-17");
  assert.equal(result.baselineDate, "2026-11-16");
  assert.equal(result.referenceKind, "recent");
  assert.equal(result.positions[0].price, .96);
  assert.equal(calculateDailyPriceChange(.97, result.positions[0], true).kind, "ok");
});

test("wallet missing from recent file falls back to nearest actual wallet snapshot", async () => {
  const result = await selectPositionBaseline(WALLET, NOW, async date => {
    if (date === "2026-11-17") return history(date, OTHER);
    if (date === "2026-11-16") return history(date);
    return null;
  });
  assert.equal(result.status, "ok");
  assert.equal(result.referenceKind, "recent");
  assert.equal(result.baselineDate, "2026-11-16");
});

test("bad recordedAt in otherwise valid file is not used as historical evidence", async () => {
  const bad = history("2026-11-17");
  bad.wallets[0].recordedAt = "2026-11-18T04:15:00Z";
  const result = await selectPositionBaseline(WALLET, NOW, async date =>
    date === "2026-11-17" ? bad : date === "2026-11-16" ? history(date) : null,
  );
  assert.equal(result.baselineDate, "2026-11-16");
});

test("no valid wallet history produces missing, not a false NEW token", async () => {
  const result = await selectPositionBaseline(WALLET, NOW, async () => null);
  assert.equal(result.status, "missing");
  assert.equal(result.referenceKind, null);
  assert.deepEqual(result.positions, []);
  assert.equal(calculateDailyPriceChange(.9, undefined, false).kind, "missing");
});

test("network and format errors fail closed; caller should report unavailable", async () => {
  await assert.rejects(selectPositionBaseline(WALLET, NOW, async () => {
    throw new Error("GitHub raw read failed 500");
  }), /GitHub/);
  await assert.rejects(selectPositionBaseline(WALLET, NOW, async date => history("2026-11-16")), /Invalid position snapshot/);
});

