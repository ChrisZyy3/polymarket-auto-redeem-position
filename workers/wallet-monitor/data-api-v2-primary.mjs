import { dataApiJson } from "./data-client.mjs";

// Official Data API v2 data are paginated with opaque signed cursors, not
// offset. Normalize snake_case results into the existing monitor contract so
// wallet checkpoints, alert rules, notifications and DO storage remain intact.
const ROOT = "https://data-api.polymarket.com";
const PAGE_SIZE = 300;
const MAX_POSITION_PAGES = 24;
const MAX_ACTIVITY_PAGES = 24;

function walletAddress(value) {
  const addr = String(value || "").trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(addr)) throw new Error("Invalid v2 wallet");
  return addr;
}
const validNumber = v => v !== null && v !== undefined && v !== "" &&
  Number.isFinite(Number(v));
const numberOrNull = v => validNumber(v) ? Number(v) : null;

export function normalizeV2Position(row) {
  if (!row || typeof row !== "object" ||
      row.token_id === undefined || row.token_id === null ||
      !validNumber(row.current_size) || Number(row.current_size) < 0)
    throw new Error("Incomplete Data API v2 position");
  const size = Number(row.current_size);
  // v2 total_size is lifetime bought shares, NOT current holdings.
  return {
    asset: String(row.token_id),
    conditionId: row.condition_id ?? null,
    outcomeIndex: numberOrNull(row.outcome_index),
    outcome: row.outcome ?? "",
    title: row.title ?? "",
    eventSlug: row.event_slug ?? row.slug ?? "",
    endDate: row.end_date ?? null,
    size,
    curPrice: numberOrNull(row.current_price),
    currentValue: numberOrNull(row.current_value),
    avgPrice: numberOrNull(row.avg_price),
    initialValue: numberOrNull(row.entry_cost_usdc),
    grossInitialValue: numberOrNull(row.total_cost_usdc),
    entryFeesUsdc: numberOrNull(row.entry_fees_usdc),
    realizedPnl: numberOrNull(row.realized_pnl),
    unrealizedPnl: numberOrNull(row.unrealized_pnl),
    redeemable: row.redeemable === true,
    status: row.status ?? null
  };
}

export function normalizeV2Activity(row) {
  if (!row || typeof row !== "object" ||
      typeof row.type !== "string" ||
      !validNumber(row.timestamp) || Number(row.timestamp) <= 0)
    throw new Error("Incomplete Data API v2 activity");
  // Even a small buy or REDEEM must have a stable token and transaction
  // identity; otherwise we cannot safely dedupe an overlapping fetch.
  if (["TRADE", "REDEEM"].includes(row.type) &&
      (row.token_id == null || !row.transaction_hash))
    throw new Error("Missing Data API v2 activity identity");
  return {
    transactionHash: row.transaction_hash ?? null,
    type: row.type,
    asset: row.token_id == null ? null : String(row.token_id),
    conditionId: row.condition_id ?? null,
    outcomeIndex: numberOrNull(row.outcome_index),
    side: row.side || "",
    timestamp: Number(row.timestamp),
    size: numberOrNull(row.size),
    usdcSize: numberOrNull(row.usdc_size),
    price: numberOrNull(row.price),
    title: row.title ?? "",
    outcome: row.outcome ?? "",
    eventSlug: row.event_slug ?? row.slug ?? "",
  };
}

async function walkV2(fetcher, endpoint, params, normalize, maxPages) {
  const rows = [], cursors = new Set();
  let cursor = null;
  for (let page = 0; page < maxPages; page++) {
    const args = new URLSearchParams(params);
    if (cursor) args.set("cursor", cursor);
    const payload = await dataApiJson(fetcher, ROOT + endpoint + "?" + args.toString());
    if (!payload || !Array.isArray(payload.data) ||
        typeof payload.pagination !== "object" || payload.pagination === null)
      throw new Error("Invalid Data API v2 envelope: " + endpoint);
    for (const row of payload.data) {
      const item = normalize(row);
      // OPEN is the held-visibility superset. Dust/zero quantity can be
      // returned by v2 but wasn't part of the wallet's active position book.
      if (endpoint === "/v2/positions" && !(item.size > 0)) continue;
      rows.push(item);
    }
    const next = payload.pagination.next_cursor;
    if (!next) {
      if (payload.pagination.has_more === true)
        throw new Error("Incomplete Data API v2 cursor: " + endpoint);
      return rows;
    }
    if (typeof next !== "string" || cursors.has(next))
      throw new Error("Repeated Data API v2 cursor: " + endpoint);
    cursors.add(next);
    cursor = next;
  }
  // Never advance the per-wallet checkpoint on a truncated feed.
  throw new Error("Pagination cap reached: " + endpoint);
}

export async function primaryV2Positions(fetcher, wallet) {
  return walkV2(fetcher, "/v2/positions", {
    user: walletAddress(wallet),
    status: "OPEN",
    include_archived: "true",
    filter_type: "TOKENS",
    filter_amount: "0",
    sort_by: "TOKENS",
    sort_direction: "DESC",
    limit: String(PAGE_SIZE)
  }, normalizeV2Position, MAX_POSITION_PAGES);
}

export async function primaryV2Activity(fetcher, wallet, since) {
  if (!Number.isFinite(Number(since)) || Number(since) < 1)
    throw new Error("Invalid v2 activity starting timestamp");
  return walkV2(fetcher, "/v2/activity", {
    user: walletAddress(wallet),
    type: "TRADE,REDEEM",
    start: String(Math.max(1, Math.floor(Number(since)))),
    sort_by: "TIMESTAMP",
    sort_direction: "DESC",
    limit: String(PAGE_SIZE)
  }, normalizeV2Activity, MAX_ACTIVITY_PAGES);
}

// Backwards-compatible once-only cutover bridge: v1 and v2 may differ in
// usdc_size precision (e.g. taker fees). Deduplicate old seen activities by
// their stable on-chain transaction/token/timestamp/side/size only when the
// existing Durable Object switches from v1 to v2.
// This does NOT replace the normal full activityKey for subsequent v2 polls.
const identitySize = value => validNumber(value)
  ? Number(value).toFixed(6) : null;
export function cutoverIdentity(a) {
  return JSON.stringify([
    String(a?.transactionHash || "").toLowerCase(),
    String(a?.type || ""),
    String(a?.asset ?? ""),
    String(a?.side || ""),
    numberOrNull(a?.timestamp),
    identitySize(a?.size)
  ]);
}
export function legacyActivityIdentities(seen) {
  const known = new Set();
  for (const key of Object.keys(seen || {})) {
    try {
      const parts = JSON.parse(key);
      if (!Array.isArray(parts) || parts.length !== 10) continue;
      known.add(cutoverIdentity({
        transactionHash: parts[0],type:parts[1],asset:parts[2],
        side:parts[5],timestamp:parts[6],size:parts[7]
      }));
    } catch {
      // Malformed old legacy entries must not block new data.
    }
  }
  return known;
}
