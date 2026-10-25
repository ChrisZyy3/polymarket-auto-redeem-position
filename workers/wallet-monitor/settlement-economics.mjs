import { dataApiJson } from "./data-client.mjs";

// Query only after detecting new settlement transitions. v2 is not an event source.
const API = "https://data-api.polymarket.com/v2/positions";
const numeric = v => v != null && v !== "" && Number.isFinite(Number(v));

export async function readRedeemableEconomics(fetcher, wallet) {
  const normalized = String(wallet || "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(normalized)) throw new Error("Invalid economics wallet");
  const byToken = new Map();
  let cursor = null;
  const visited = new Set();
  for (let page = 0; page < 5; page++) {
    const params = new URLSearchParams({
      user: normalized, status: "REDEEMABLE",
      include_archived: "true", filter_type: "TOKENS", filter_amount: "0",
      limit: "300"
    });
    if (cursor) params.set("cursor", cursor);
    // Important: v2 errors or rate limits cannot interrupt the normal outbox.
    const response = await dataApiJson(fetcher, API + "?" + params.toString(),
      { retries: 1, timeoutMs: 4500 });
    if (!Array.isArray(response?.data) || !response?.pagination)
      throw new Error("Invalid Data API v2 economics envelope");
    for (const p of response.data) {
      if (p.token_id != null) byToken.set(String(p.token_id), p);
    }
    const next = response.pagination.next_cursor;
    if (!next) return byToken;
    if (typeof next !== "string" || visited.has(next))
      throw new Error("Invalid/repeating Data API v2 economics cursor");
    visited.add(next);
    cursor = next;
  }
  throw new Error("Data API v2 economics pagination cap reached");
}

export function settlementNet(position, v2) {
  if (!v2 || String(v2.token_id ?? "") !== String(position?.asset ?? "") ||
      !numeric(position?.size) || Number(position.size) <= 0 ||
      !numeric(position?.curPrice)) return null;
  const size = Number(position.size);
  if (!numeric(v2.current_size) ||
      Math.abs(Number(v2.current_size) - size) > Math.max(0.02, size * 0.002))
    return null; // Different indexer watermark: don't cross-match stale economics.
  // Documented fee-inclusive remaining basis; no double-subtraction of entry_fees_usdc.
  const basis = numeric(v2.total_cost_usdc) ? Number(v2.total_cost_usdc) :
    numeric(v2.entry_cost_usdc) && numeric(v2.entry_fees_usdc)
      ? Number(v2.entry_cost_usdc) + Number(v2.entry_fees_usdc) : null;
  if (basis == null || basis < 0) return null;
  const payout = size * Number(position.curPrice);
  if (![basis, payout].every(Number.isFinite)) return null;
  const net = payout - basis;
  return {
    basis, payout, net,
    roi: basis > 0 ? net / basis * 100 : null,
    buyFees: numeric(v2.entry_fees_usdc) ? Number(v2.entry_fees_usdc) : null,
    realizedPnl: numeric(v2.realized_pnl) ? Number(v2.realized_pnl) : null,
    source: "Polymarket Data API v2, total_cost_usdc",
    // This is the remaining position's net PnL including attributed buy fees,
    // but not wallet gas, transfers or off-platform expenses.
  };
}
