// Conservative holding reward eligibility. Gamma's market flag is authoritative
// for eligibility; the published 3.25% rate is configurable (not guaranteed).
export const HOLDING_REWARD_APR = 0.0325;
const GAMMA = "https://gamma-api.polymarket.com";
function flag(obj: unknown): boolean | null {
  if (!obj || typeof obj !== "object") return null;
  const value = (obj as { holdingRewardsEnabled?: unknown }).holdingRewardsEnabled;
  if (value === true) return true;
  if (value === false) return false;
  return null;
}
export function rewardEligibility(payload: unknown): boolean | null {
  const rows: unknown[] = Array.isArray(payload) ? payload : [payload];
  const verdicts = rows.flatMap(e => {
    const markets = e && typeof e === "object" && "markets" in e &&
      Array.isArray(e.markets) ? e.markets : [];
    return [flag(e), ...markets.map(flag)];
  }).filter((v): v is boolean => v !== null);
  if (verdicts.includes(true)) return true;
  if (verdicts.includes(false)) return false;
  return null;
}
export async function holdingRewardForSlug(slug: string, fetcher: typeof fetch = fetch, annualRate = HOLDING_REWARD_APR): Promise<{eligible:boolean|null;apr:number}> {
  if (!/^[a-zA-Z0-9_-]{1,180}$/.test(String(slug || ""))) return {eligible:null,apr:0};
  try {
    const response = await fetcher(GAMMA + "/events/slug/" + encodeURIComponent(slug), {
      headers:{accept:"application/json"},
      signal:AbortSignal.timeout(7500)
    });
    if (!response.ok) return {eligible:null,apr:0};
    const eligible = rewardEligibility(await response.json());
    return {eligible,apr: eligible === true ? annualRate : 0};
  } catch {
    return {eligible:null,apr:0};
  }
}
export function combinedHoldingApr(markApr: number | null, rewardApr: number): number | null {
  return markApr === null || !Number.isFinite(markApr) ? null :
    markApr + (Number.isFinite(rewardApr) && rewardApr > 0 ? rewardApr : 0);
}
export function compoundApyFromApr(apr: number | null, days: number): number | null {
  if (apr === null || !Number.isFinite(apr) || !(days > 0)) return null;
  const remainingRoi = apr * days / 365;
  return remainingRoi > -1 ? Math.pow(1 + remainingRoi, 365 / days) - 1 : null;
}
