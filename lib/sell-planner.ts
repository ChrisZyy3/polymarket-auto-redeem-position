import { buildMarkAutoSellPlan } from './auto-sell-plan';
import { ceilToTick } from './poly-yield/yield';
import type { PositionQuote } from './position-quote';

/** A maker-oriented price suggestion only; it never confirms that an order can be placed. */
export function makerSellSuggestion(quote: PositionQuote | null, targetAprPercent: number, quantity: number, avgPrice: number, redeemable = false) {
  const plan = buildMarkAutoSellPlan({ quote, targetAprPercent, quantity, avgPrice, redeemable });
  if (plan.proposedLimitPrice === null || !quote || quote.bestAsk === null || quote.bestBid === null || !quote.tickVerified || !quote.tickSize) {
    return { plan, price: null, reason: plan.proposedLimitPrice === null ? plan.reason : 'missing_bid_or_ask' };
  }
  const price = ceilToTick(Math.max(plan.proposedLimitPrice, quote.bestAsk), quote.tickSize);
  if (!Number.isFinite(price) || price >= 1 || price > 1 - quote.tickSize + 1e-10 || price <= quote.bestBid + 1e-10) {
    return { plan, price: null, reason: 'invalid_or_crossed_book' };
  }
  return { plan, price, reason: 'maker_suggestion' };
}
