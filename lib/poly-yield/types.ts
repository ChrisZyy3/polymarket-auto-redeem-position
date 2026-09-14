export type Strategy = { name: string; tokenId: string; endTime: string; targetApy: number; amountUsd: number; minExternalLevelUsd?: number; tickSize?: number };
export type BookLevel = { price: string; size: string };
export type OrderBook = { bids: BookLevel[]; asks: BookLevel[]; tick_size: string };
