import type { EnrichedPosition } from "./types";

/** Existing per-token entries are retained as SELL overrides for backward compatibility. */
export const SELL_TARGET_APR_STORAGE_KEY = "polymarket-dashboard-target-apr-by-asset-v1";
export const BUY_TARGET_APR_STORAGE_KEY = "polymarket-dashboard-buy-target-apr-by-asset-v1";
export const DEFAULT_BUY_TARGET_APR = 12;

export type SellTargetAprInput = {value:string;source:"global"|"custom"};

export function resolveSellTargetAprInput(
  asset:string,
  overrides:Readonly<Record<string,string>>,
  holdAprThreshold:number
):SellTargetAprInput {
  const own = Object.prototype.hasOwnProperty.call(overrides,asset);
  return {value:own ? overrides[asset] : String(holdAprThreshold),source:own ? "custom" : "global"};
}

export type HoldDecision = "consider_exit"|"continue_holding"|"unavailable";

/**
 * A watch-only signal based on the *combined* holding APR. It must never be
 * passed to a SELL order price calculation: that exclusively uses Mark APR.
 */
export function holdDecisionForApr(
  combinedApr:number|null,
  holdAprThresholdPercent:number
):HoldDecision {
  if(combinedApr===null||!Number.isFinite(combinedApr)||
    !Number.isFinite(holdAprThresholdPercent)||holdAprThresholdPercent<0) return "unavailable";
  return combinedApr*100<=holdAprThresholdPercent ? "consider_exit" : "continue_holding";
}

export function holdDecisionForPosition(
  position:Pick<EnrichedPosition,"holdApr">,
  holdAprThresholdPercent:number
):HoldDecision {
  return holdDecisionForApr(position.holdApr,holdAprThresholdPercent);
}
