import { dataApiJson } from "./data-client.mjs";

const ROOT = "https://data-api.polymarket.com/v2/positions";
const PAGE_SIZE = 300;
const MAX_PAGES = 12;
const positive = v => Number.isFinite(Number(v)) && Number(v) > 0;

// Read-only reconciliation. These fields never drive trade detection or notifications.
export async function compareV2Positions(fetcher, user, oldPositions) {
  const wallet = String(user || "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(wallet)) throw new Error("Invalid shadow wallet");
  const fresh = new Map(), cursors = new Set();
  let next = null, pages = 0;
  do {
    if (++pages > MAX_PAGES) throw new Error("Data API v2 shadow pagination cap reached");
    const params = new URLSearchParams({
      user: wallet, status: "OPEN", include_archived: "true",
      filter_type: "TOKENS", filter_amount: "0", limit: String(PAGE_SIZE)
    });
    if (next) params.set("cursor", next);
    const payload = await dataApiJson(fetcher, ROOT + "?" + params);
    if (!Array.isArray(payload?.data) || !payload.pagination) {
      throw new Error("Unexpected Data API v2 envelope");
    }
    for (const row of payload.data) {
      const token = row.token_id ?? row.tokenId;
      if (token != null && positive(row.current_size))
        fresh.set(String(token), Number(row.current_size));
    }
    const nextCursor = payload.pagination.next_cursor;
    if (nextCursor != null && typeof nextCursor !== "string") {
      throw new Error("Invalid Data API v2 cursor");
    }
    if (nextCursor && (cursors.has(nextCursor) || nextCursor === next)) {
      throw new Error("Repeated Data API v2 cursor");
    }
    next = nextCursor || null;
    if (next) cursors.add(next);
  } while (next);

  const previous = new Map();
  for (const p of oldPositions) {
    if (p.asset != null && positive(p.size))
      previous.set(String(p.asset), Number(p.size));
  }
  let matched = 0, sizeDrift = 0, onlyV1 = 0, onlyV2 = 0;
  for (const [asset, size] of previous) {
    if (!fresh.has(asset)) {onlyV1++;continue}
    matched++;
    if (Math.abs(size - fresh.get(asset)) > 0.01) sizeDrift++;
  }
  for (const asset of fresh.keys()) if (!previous.has(asset)) onlyV2++;
  return {
    api: "v2", pages, v1Count: previous.size, v2Count: fresh.size,
    matched, onlyV1, onlyV2, sizeDrift,
    // Differences may be due to separate indexing watermarks. Do not trade on them.
    advice: onlyV1 + onlyV2 + sizeDrift ? "investigate_data_freshness" : "matching"
  };
}
