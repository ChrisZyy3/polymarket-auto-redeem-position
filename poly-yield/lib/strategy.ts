import type { OrderBook, Strategy } from "./types";
import { apyForPrice, floorToTick, priceForTargetApy } from "./yield";

export function decideOrder(strategy: Strategy, book: OrderBook, now = new Date()) {
  const tick = strategy.tickSize ?? Number(book.tick_size);
  const minExternal = strategy.minExternalLevelUsd ?? 500;
  const maxPrice = floorToTick(priceForTargetApy(strategy.targetApy, strategy.endTime, now), tick);
  const bids = [...book.bids].sort((a, b) => Number(b.price) - Number(a.price));
  const effective = bids.find((level) => Number(level.price) * Number(level.size) >= minExternal);
  const bestExternalBid = effective ? Number(effective.price) : null;
  const asks = [...book.asks].sort((a, b) => Number(a.price) - Number(b.price));
  const bestAsk = asks.length ? Number(asks[0].price) : null;
  let desired = bestExternalBid == null ? maxPrice : Math.min(maxPrice, bestExternalBid + tick);
  if (bestAsk != null) desired = Math.min(desired, bestAsk - tick);
  desired = floorToTick(desired, tick);
  return {
    desiredPrice: desired,
    conditionalApy: apyForPrice(desired, strategy.endTime, now),
    maxPriceForTargetApy: maxPrice,
    effectiveBestExternalBid: bestExternalBid,
    bestAsk,
    desiredShares: strategy.amountUsd / desired,
  };
}
