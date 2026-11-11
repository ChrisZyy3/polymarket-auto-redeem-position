import { ceilToTick } from "./poly-yield/yield";
import type { PositionQuote } from "./position-quote";

export type AutoSellPlanStatus =
  | "ready" | "would_cross" | "theoretical_only" | "invalid_window"
  | "invalid_position" | "unreachable_tick" | "invalid_target";

export interface MarkAutoSellPlan {
  mode: "dry-run";
  basis: "mark-apr";
  status: AutoSellPlanStatus;
  targetAprPercent: number;
  theoreticalTargetPrice: number | null;
  proposedLimitPrice: number | null;
  priceAtLimitAprPercent: number | null;
  currentMarkAprPercent: number | null;
  quantity: number;
  estimatedGrossProceeds: number | null;
  estimatedProfitVsAvgCost: number | null;
  bestBid: number | null;
  bidCrossesLimit: boolean | null;
  estimatedDays: number | null;
  reason: string;
}

/**
 * Proposed SELL limit is the cheapest tick >= the theoretical price that
 * compresses the remaining simple Mark APR to targetPct or below.
 * No down-rounding: a lower tick would retain more yield than requested.
 * This is a hypothetical plan; it does not inspect active orders/allowance.
 */
export function buildMarkAutoSellPlan(input: {
  quote: PositionQuote | null;
  targetAprPercent: number;
  quantity: number;
  avgPrice: number;
  redeemable?: boolean;
}): MarkAutoSellPlan {
  const {quote,targetAprPercent,quantity,avgPrice,redeemable=false}=input;
  const days=quote?.daysToSettle ?? null;
  const mark=quote?.currentPrice ?? null;
  const mkApr=days!==null && days>0 && mark!==null && mark>0 && mark<=1
    ? ((1/mark-1)*365/days)*100 : null;
  const base:MarkAutoSellPlan={
    mode:"dry-run",basis:"mark-apr",status:"theoretical_only",targetAprPercent,
    theoreticalTargetPrice:null,proposedLimitPrice:null,
    priceAtLimitAprPercent:null,currentMarkAprPercent:mkApr,
    quantity,estimatedGrossProceeds:null,estimatedProfitVsAvgCost:null,
    bestBid:quote?.bestBid??null,bidCrossesLimit:null,estimatedDays:days,
    reason:""
  };
  if(!Number.isFinite(targetAprPercent)||targetAprPercent<=0||targetAprPercent>10000) {
    return {...base,status:"invalid_target",reason:"invalid_target"};
  }
  if(!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(avgPrice)||avgPrice<0||avgPrice>1||redeemable) {
    return {...base,status:"invalid_position",reason:"not_active_holdings"};
  }
  if(days===null||!Number.isFinite(days)||days<=0) {
    return {...base,status:"invalid_window",reason:"settlement_date_missing_or_passed"};
  }
  const theoretical=1/(1+targetAprPercent/100*days/365);
  if(!Number.isFinite(theoretical)||theoretical<=0||theoretical>=1) {
    return {...base,status:"invalid_window",reason:"invalid_theoretical_price"};
  }
  base.theoreticalTargetPrice=theoretical;
  const tick=quote?.tickSize;
  if(!quote?.orderBookAvailable||tick===null||tick===undefined||
      !Number.isFinite(tick)||tick<=0||tick>=1||quote.tickVerified===false) {
    return {...base,status:"theoretical_only",reason:"orderbook_or_tick_unverified"};
  }
  const limit=ceilToTick(theoretical,tick);
  // Market order rules do not permit prices at $1. Never clamp down to a
  // lower price: that would violate the APR-based seller floor.
  if(!Number.isFinite(limit)||limit<=0||limit>=1 || limit>1-tick+1e-10){
    return {...base,status:"unreachable_tick",reason:"target_above_highest_legal_price"};
  }
  const apr=(1/limit-1)*365/days*100;
  const crosses=base.bestBid===null?null:base.bestBid>=limit-1e-10;
  return {...base,status:crosses===true?"would_cross":"ready",
    proposedLimitPrice:limit,priceAtLimitAprPercent:apr,
    estimatedGrossProceeds:limit*quantity,
    estimatedProfitVsAvgCost:(limit-avgPrice)*quantity,
    bidCrossesLimit:crosses,
    reason:crosses===true?"market_bid_would_cross":"waiting_for_target_price"};
}
