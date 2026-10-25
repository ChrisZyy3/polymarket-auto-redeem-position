// Wallet-position lifecycle based on two successfully indexed snapshots.
// Do not infer an OPEN/EXIT from a missing row alone; corroborate with fills.
const EPS = 0.000001;
const finite = value => value != null && value !== "" && Number.isFinite(Number(value));

export function snapshotHoldings(positions) {
  const snap = {};
  for (const p of positions || []) {
    if (p?.asset == null || !finite(p.size) || Number(p.size) <= EPS) continue;
    snap[String(p.asset)] = { size: Number(p.size) };
  }
  return snap;
}

export function positionAction(fill, grouped, beforeSnapshots, currentSnapshots) {
  if (!beforeSnapshots || !currentSnapshots || fill?.type !== "TRADE" ||
      !["BUY", "SELL"].includes(fill.side) || fill.asset == null ||
      !finite(fill.size) || Number(fill.size) <= 0) return null;
  const token = String(fill.asset);
  // Mixing two sides or multiple five-minute buckets makes start/end attribution ambiguous.
  const sameToken = grouped.filter(a =>
    a?.type === "TRADE" && String(a.asset) === token);
  if (sameToken.length !== 1) return null;

  const previous = Number(beforeSnapshots[token]?.size || 0);
  const current = Number(currentSnapshots[token]?.size || 0);
  const signedFill = Number(fill.size) * (fill.side === "BUY" ? 1 : -1);
  const change = current - previous;
  // Reconcile with total new fills: transfers, indexing lag or partial API data
  // must never be classified as an actual OPEN/EXIT.
  const tolerance = Math.max(0.02, Math.abs(signedFill) * 0.002);
  if (!Number.isFinite(change) || Math.abs(change - signedFill) > tolerance ||
      Math.abs(change) <= EPS) return null;

  let kind = null;
  if (fill.side === "BUY" && change > 0)
    kind = previous <= EPS ? "OPEN" : "ADD";
  if (fill.side === "SELL" && change < 0 && previous > EPS)
    kind = current <= EPS ? "EXIT" : "TRIM";
  return kind ? { kind, previousSize: previous, currentSize: current,
    deltaSize: change, deltaPercent: previous > EPS ? change / previous * 100 : null } : null;
}

function endTimestamp(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const s = raw.trim();
  if (s.startsWith("1970-01-01") || s.startsWith("0000-00-00")) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [year, month, day] = s.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month ||
        date.getUTCDate() !== day) return null;
    // Without a timestamp, assume end of that UTC calendar date, not a promised settlement.
    return Date.UTC(year, month - 1, day + 1);
  }
  const parsed = Date.parse(s);
  return Number.isFinite(parsed) ? parsed : null;
}

export function winningPayoutForecast(position, nowSeconds) {
  const price = Number(position?.avgPrice);
  const size = Number(position?.size);
  if (!finite(position?.avgPrice) || price <= 0 || price > 1 ||
      !finite(position?.size) || size <= EPS) return null;
  const grossROI = (1 / price - 1) * 100;
  const grossProfit = size * (1 - price);
  const payout = size; // Each winning binary outcome share redeems for $1.
  const timestamp = endTimestamp(position?.endDate ?? position?.end_date);
  const now = Number(nowSeconds);
  const days = timestamp != null && Number.isFinite(now)
    ? (timestamp - now * 1000) / 86_400_000 : null;
  const apr = days != null && days >= 1 ? grossROI * 365 / days : null;
  return {
    avgPrice: price, shares: size, payout, grossProfit, grossROI,
    simpleAPR: Number.isFinite(apr) ? apr : null,
    remainingDays: days > 0 ? days : null,
    aprUnavailableReason: timestamp == null ? "缺少有效结束日期" :
      days == null || days <= 0 ? "预计结束日期已过" :
      days < 1 ? "距离预计结束不足一天" : null,
    dateOnly: /^\d{4}-\d{2}-\d{2}$/.test(
      String(position?.endDate ?? position?.end_date ?? ""))
  };
}
