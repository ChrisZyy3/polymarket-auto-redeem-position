import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateDailyPriceChange, mergeDailyPositionHistory,
  previousShanghaiCalendarDay, shanghaiCalendarDay,
  type DailyWalletPositionSnapshot,
} from "../lib/position-change";
import { positionHistoryPath } from "../lib/position-history-file";

const WALLET_A = "0x1111111111111111111111111111111111111111";
const WALLET_B = "0x2222222222222222222222222222222222222222";
const sample = (
  address: string, tokenId: string, price: number | null, date = "2026-11-11T01:10:00.000Z",
): DailyWalletPositionSnapshot => ({
  address, recordedAt: date,
  positions: [{ tokenId, price, size: 100, value: price === null ? null : 100 * price }],
});

test("Asia/Shanghai calendar day and yesterday work around midnight UTC", () => {
  assert.equal(shanghaiCalendarDay(new Date("2026-11-10T15:59:59Z")), "2026-11-10");
  assert.equal(shanghaiCalendarDay(new Date("2026-11-10T16:00:00Z")), "2026-11-11");
  assert.equal(previousShanghaiCalendarDay(new Date("2026-11-10T16:00:00Z")), "2026-11-10");
  assert.equal(previousShanghaiCalendarDay(new Date("2027-01-01T01:00:00Z")), "2026-12-31");
});

test("daily file path uses one file per Beijing calendar day", () => {
  assert.match(positionHistoryPath("2026-11-11"), /data[/\\]position-history[/\\]2026-11-11\.json$/);
  assert.throws(() => positionHistoryPath("../../secret"), /Invalid position history date/);
});

test("daily merge preserves all wallets, stable token IDs and replaces rerun for same day", () => {
  const first = mergeDailyPositionHistory(null, "2026-11-11", [
    sample(WALLET_A, "yes-token", .95),
    sample(WALLET_B, "yes-token", .82),
  ]);
  assert.equal(first.wallets.length, 2);
  assert.notEqual(first.wallets[0].address, first.wallets[1].address);
  const updated = mergeDailyPositionHistory(first, "2026-11-11", [
    sample(WALLET_A.toUpperCase().replace("0X", "0x"), "yes-token", .97),
  ]);
  assert.equal(updated.wallets.length, 2);
  assert.equal(updated.wallets.find(w => w.address === WALLET_A)?.positions[0].price, .97);
  assert.equal(updated.wallets.find(w => w.address === WALLET_B)?.positions[0].price, .82);
  assert.throws(() => mergeDailyPositionHistory(first, "2026-11-12", []), /mismatched/);
});

test("invalid prices, duplicate tokens or empty/zero quantities are rejected", () => {
  assert.throws(() => mergeDailyPositionHistory(null, "2026-11-11", [
    sample(WALLET_A, "yes-token", 1.1),
  ]), /Invalid position/);
  const duplicates = sample(WALLET_A, "yes-token", .5);
  duplicates.positions.push({ ...duplicates.positions[0] });
  assert.throws(() => mergeDailyPositionHistory(null, "2026-11-11", [duplicates]), /Duplicate/);
  const tiny = sample(WALLET_A, "tiny-token", 0);
  tiny.positions[0].size = .000000001;
  assert.equal(mergeDailyPositionHistory(null, "2026-11-11", [tiny]).wallets.length, 1);
});

test("yesterday price change measures token price, not portfolio value or buy/sell flows", () => {
  const baseline = {tokenId:"no",price:.951,size:100,value:95.1};
  const gain = calculateDailyPriceChange(.965, baseline, true);
  assert.equal(gain.kind, "ok");
  assert.ok(Math.abs(gain.rate! - .014/.951) < 1e-12);
  assert.ok(Math.abs(gain.cents! - 1.4) < 1e-12);
  const loss = calculateDailyPriceChange(.93, baseline, true);
  assert.equal(loss.kind, "ok");
  assert.ok(loss.rate! < 0 && loss.cents! < 0);
  const unchanged = calculateDailyPriceChange(.951, baseline, true);
  assert.equal(unchanged.rate, 0);
  assert.equal(unchanged.cents, 0);
  const changedSize = calculateDailyPriceChange(.965, {...baseline, size:1000,value:965}, true);
  assert.equal(changedSize.rate, gain.rate);
});

test("no yesterday capture must NOT show NEW; newly bought token must show NEW", () => {
  assert.equal(calculateDailyPriceChange(.8, undefined, false).kind, "missing");
  assert.equal(calculateDailyPriceChange(.8, undefined, true).kind, "new");
  assert.equal(calculateDailyPriceChange(Number.NaN, {tokenId:"no",price:.9,size:1,value:1}, true).kind, "missing");
  assert.equal(calculateDailyPriceChange(.9, {tokenId:"no",price:null,size:1,value:null}, true).kind, "missing");
});

test("zero-price reference is undefined percentage, never infinity or fabricated 100%", () => {
  const change = calculateDailyPriceChange(.1, {tokenId:"no",price:0,size:1,value:0}, true);
  assert.equal(change.kind, "zero-reference");
  assert.equal(change.rate, null);
  assert.equal(change.cents, 10);
  assert.equal(calculateDailyPriceChange(0, {tokenId:"no",price:0,size:1,value:0}, true).rate, null);
});
