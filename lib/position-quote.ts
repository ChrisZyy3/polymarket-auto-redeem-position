import { daysUntilSettlement } from "./apr";
import { ceilToTick, floorToTick } from "./poly-yield/yield";
import { isOrderBook, type BookLevel, type OrderBook } from "./poly-yield/types";

const DEFAULT_TICK_SIZE = 0.001;

export type PositionQuoteAction = "buy" | "sell" | "unavailable";

export interface PositionQuoteInput {
  currentPrice: number;
  endDate: string | null;
  thresholdAprPercent: number;
  orderBook: OrderBook | null;
  now?: Date;
}

export interface PositionQuote {
  action: PositionQuoteAction;
  currentPrice: number | null;
  currentApr: number | null;
  thresholdAprPercent: number;
  daysToSettle: number | null;
  thresholdPrice: number | null;
  recommendedBuyPrice: number | null;
  recommendedSellPrice: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  bestBidApr: number | null;
  bestAskApr: number | null;
  tickSize: number | null;
  orderBookAvailable: boolean;
  note?: string;
}

function isValidPrice(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value < 1;
}

function parseLevelPrice(level: BookLevel): number | null {
  if (typeof level !== "object" || level === null) return null;
  const price = Number(level.price);
  const size = Number(level.size);
  return isValidPrice(price) && Number.isFinite(size) && size > 0 ? price : null;
}

function bestLevelPrice(levels: BookLevel[], priority: "highest" | "lowest"): number | null {
  return levels.reduce<number | null>((best, level) => {
    const price = parseLevelPrice(level);
    if (price === null) return best;
    if (best === null) return price;
    return priority === "highest"
      ? Math.max(best, price)
      : Math.min(best, price);
  }, null);
}

function parseTickSize(orderBook: OrderBook | null): number {
  if (!orderBook) return DEFAULT_TICK_SIZE;
  const tick = Number(orderBook.tick_size);
  return Number.isFinite(tick) && tick > 0 && tick < 1 ? tick : DEFAULT_TICK_SIZE;
}

function clampLimitPrice(value: number, tick: number): number {
  const minimum = tick;
  const maximum = Math.max(minimum, 1 - tick);
  return Math.min(maximum, Math.max(minimum, value));
}

function priceForTargetApr(targetAprPercent: number, daysToSettle: number): number | null {
  if (!Number.isFinite(targetAprPercent) || targetAprPercent < 0 || !Number.isFinite(daysToSettle) || daysToSettle <= 0) {
    return null;
  }

  const denominator = 1 + (targetAprPercent / 100) * (daysToSettle / 365);
  if (!Number.isFinite(denominator) || denominator <= 0) return null;

  const price = 1 / denominator;
  return price > 0 && price <= 1 ? price : null;
}

function aprForPrice(price: number, daysToSettle: number): number | null {
  if (!isValidPrice(price) || !Number.isFinite(daysToSettle) || daysToSettle <= 0) return null;
  return ((1 - price) / price) * (365 / daysToSettle);
}

function buildNote(input: PositionQuoteInput, daysToSettle: number, currentApr: number | null): string | undefined {
  const notes: string[] = [];
  if (!input.endDate) {
    notes.push("缺少结算日期");
  } else if (!Number.isFinite(daysToSettle)) {
    notes.push("结算日期无法解析");
  } else if (daysToSettle <= 0) {
    notes.push("已过结算日");
  }
  if (!Number.isFinite(input.thresholdAprPercent) || input.thresholdAprPercent < 0) {
    notes.push("目标 APR 必须是非负数");
  }
  if (currentApr === null && Number.isFinite(daysToSettle) && daysToSettle > 0) {
    notes.push("当前价格没有可用套利空间");
  }
  if (!input.orderBook) notes.push("盘口暂不可用，仅显示理论价格");
  return notes.length > 0 ? notes.join("；") : undefined;
}

export function buildPositionQuote(input: PositionQuoteInput): PositionQuote {
  const now = input.now ?? new Date();
  const usableOrderBook = isOrderBook(input.orderBook) ? input.orderBook : null;
  const rawDaysToSettle = daysUntilSettlement(input.endDate, now);
  const daysToSettle = Number.isFinite(rawDaysToSettle) ? rawDaysToSettle : null;
  const currentPrice = isValidPrice(input.currentPrice) ? input.currentPrice : null;
  const currentApr = daysToSettle !== null ? aprForPrice(input.currentPrice, daysToSettle) : null;
  const thresholdPrice = daysToSettle !== null
    ? priceForTargetApr(input.thresholdAprPercent, daysToSettle)
    : null;
  const orderBookAvailable = usableOrderBook !== null;
  const tickSize = orderBookAvailable ? parseTickSize(usableOrderBook) : null;
  const roundingTick = parseTickSize(usableOrderBook);
  const bid = usableOrderBook ? bestLevelPrice(usableOrderBook.bids, "highest") : null;
  const ask = usableOrderBook ? bestLevelPrice(usableOrderBook.asks, "lowest") : null;
  const bestBidApr = daysToSettle !== null && bid !== null ? aprForPrice(bid, daysToSettle) : null;
  const bestAskApr = daysToSettle !== null && ask !== null ? aprForPrice(ask, daysToSettle) : null;
  const normalizedInput = { ...input, orderBook: usableOrderBook };

  if (thresholdPrice === null || currentApr === null || !Number.isFinite(input.thresholdAprPercent) || input.thresholdAprPercent < 0) {
    return {
      action: "unavailable",
      currentPrice,
      currentApr,
      thresholdAprPercent: input.thresholdAprPercent,
      daysToSettle,
      thresholdPrice,
      recommendedBuyPrice: null,
      recommendedSellPrice: null,
      bestBid: bid,
      bestAsk: ask,
      bestBidApr,
      bestAskApr,
      tickSize,
      orderBookAvailable,
      note: buildNote(normalizedInput, rawDaysToSettle, currentApr),
    };
  }

  const buyLimit = clampLimitPrice(floorToTick(thresholdPrice, roundingTick), roundingTick);
  const sellFloor = clampLimitPrice(ceilToTick(thresholdPrice, roundingTick), roundingTick);
  const recommendedBuyPrice = ask !== null && ask <= buyLimit ? ask : buyLimit;
  const recommendedSellPrice = bid !== null && bid >= sellFloor ? bid : sellFloor;
  const action = currentApr <= input.thresholdAprPercent / 100 ? "sell" : "buy";

  return {
    action,
    currentPrice,
    currentApr,
    thresholdAprPercent: input.thresholdAprPercent,
    daysToSettle,
    thresholdPrice,
    recommendedBuyPrice,
    recommendedSellPrice,
    bestBid: bid,
    bestAsk: ask,
    bestBidApr,
    bestAskApr,
    tickSize,
    orderBookAvailable,
    note: buildNote(normalizedInput, rawDaysToSettle, currentApr),
  };
}
