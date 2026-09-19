export type Strategy = { name: string; tokenId: string; endTime: string; targetApy: number; amountUsd: number; minExternalLevelUsd?: number; tickSize?: number };
export type BookLevel = { price: string; size: string };
export type OrderBook = { bids: BookLevel[]; asks: BookLevel[]; tick_size: string };

export function isOrderBook(value: unknown): value is OrderBook {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { bids?: unknown; asks?: unknown };
  return Array.isArray(candidate.bids) && Array.isArray(candidate.asks);
}
