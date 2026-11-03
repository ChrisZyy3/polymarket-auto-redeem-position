import axios from "axios";
import { config } from "./config";

import type { Position } from "./types";

const client = axios.create({
  baseURL: config.polymarketDataApiBaseUrl,
  timeout: 15000,
});

export function isValidEvmAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

export interface JsonRpcBalanceResponse {
  result?: string;
  error?: { code: number; message: string };
}

export function parseCashBalanceResponse(response: JsonRpcBalanceResponse): number {
  if (response.error) {
    throw new Error(`Polygon RPC error ${response.error.code}: ${response.error.message}`);
  }
  if (!response.result || !/^0x[0-9a-f]+$/i.test(response.result)) {
    throw new Error("Polygon RPC returned no valid cash balance");
  }
  return Number(BigInt(response.result)) / 1e6;
}

export function filterPositionsByMinimumValue<T extends Pick<Position, "currentValue">>(
  positions: T[],
  minimumValueUsd: number,
): T[] {
  return positions.filter(
    (position) => Number.isFinite(position.currentValue) && position.currentValue >= minimumValueUsd,
  );
}

// Keep the dashboard contract stable while adapting Data API v2's envelope,
// snake_case fields and cursor-only pagination at the network boundary.
interface DataApiPosition {
  proxy_wallet: string;
  token_id: string;
  condition_id: string;
  current_size: number | null;
  avg_price: number | null;
  entry_cost_usdc: number | null;
  current_value: number | null;
  unrealized_pnl: number | null;
  percent_pnl: number | null;
  total_size: number | null;
  realized_pnl: number | null;
  percent_realized_pnl: number | null;
  current_price: number | null;
  redeemable: boolean;
  mergeable: boolean;
  title: string;
  slug: string;
  icon: string;
  event_slug: string;
  outcome: string;
  outcome_index: number;
  opposite_outcome: string;
  opposite_token_id: string;
  end_date: string | null;
  negative_risk: boolean;
}

function toPosition(row: DataApiPosition): Position {
  // v2 null economics mean unavailable, never a zero balance or zero P&L.
  const numeric = (value: number | null): number =>
    typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
  return {
    proxyWallet: row.proxy_wallet,
    asset: row.token_id,
    conditionId: row.condition_id,
    size: numeric(row.current_size),
    avgPrice: numeric(row.avg_price),
    initialValue: numeric(row.entry_cost_usdc),
    currentValue: numeric(row.current_value),
    // The UI shows current holding P&L, separately from realized trade P&L.
    cashPnl: numeric(row.unrealized_pnl),
    percentPnl: numeric(row.percent_pnl),
    totalBought: numeric(row.total_size),
    realizedPnl: numeric(row.realized_pnl),
    percentRealizedPnl: numeric(row.percent_realized_pnl),
    curPrice: numeric(row.current_price),
    redeemable: row.redeemable,
    mergeable: row.mergeable,
    title: row.title,
    slug: row.slug,
    icon: row.icon,
    eventSlug: row.event_slug,
    outcome: row.outcome,
    outcomeIndex: row.outcome_index,
    oppositeOutcome: row.opposite_outcome,
    oppositeAsset: row.opposite_token_id,
    endDate: row.end_date,
    negativeRisk: row.negative_risk,
  };
}

async function fetchPositionPages(userAddress: string, status: "OPEN" | "REDEEMABLE"): Promise<Position[]> {
  if (!isValidEvmAddress(userAddress)) {
    throw new Error(`Invalid EVM address: ${userAddress}`);
  }
  const positions: Position[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const response = await client.get<{
      data: DataApiPosition[];
      pagination: { next_cursor: string | null };
    }>("/v2/positions", {
      params: {
        user: userAddress, status, limit: 500, cursor,
        filter_type: "TOKENS", filter_amount: 0,
      },
    });
    const page = response.data;
    if (!Array.isArray(page.data) || !page.pagination ||
        !(page.pagination.next_cursor === null || typeof page.pagination.next_cursor === "string")) {
      throw new Error("Data API v2 returned an invalid positions page");
    }
    positions.push(...page.data.map(toPosition));
    cursor = page.pagination.next_cursor ?? undefined;
    if (cursor !== undefined) {
      if (!cursor || seenCursors.has(cursor)) throw new Error("Data API v2 repeated a positions cursor");
      seenCursors.add(cursor);
    }
  } while (cursor !== undefined);
  return positions;
}

export async function fetchCurrentPositions(
  userAddress: string,
  minPositionSize = config.minPositionSize,
): Promise<Position[]> {
  const positions = await fetchPositionPages(userAddress, "OPEN");
  return positions.filter((position) => position.size >= minPositionSize);
}

export async function fetchCashBalance(userAddress: string): Promise<number> {
  if (!isValidEvmAddress(userAddress)) {
    throw new Error(`Invalid EVM address: ${userAddress}`);
  }
  const data = `0x70a08231000000000000000000000000${userAddress.slice(2).toLowerCase()}`;
  const response = await axios.post<JsonRpcBalanceResponse>(
    config.polygonRpcUrl,
    { jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: config.pusdAddress, data }, "latest"] },
    { timeout: 15000 }
  );
  return parseCashBalanceResponse(response.data);
}

export async function fetchRedeemablePositions(userAddress: string): Promise<Position[]> {
  const positions = await fetchPositionPages(userAddress, "REDEEMABLE");
  return positions.filter((p) => p.redeemable && p.size >= (config.minPositionSize || 0.1));
}
