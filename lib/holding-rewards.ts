// Conservative holding reward eligibility. Gamma's market flag is authoritative
// for eligibility; the published 3.25% rate is configurable (not guaranteed).
export const HOLDING_REWARD_APR = 0.0325;
const GAMMA = "https://gamma-api.polymarket.com";
function flag(obj) {
  if (!obj || typeof obj !== "object") return null;
  if (obj.holdingRewardsEnabled === true) return true;
  if (obj.holdingRewardsEnabled === false) return false;
  return null;
}
export function rewardEligibility(payload) {
  const rows = Array.isArray(payload) ? payload : [payload];
  const verdicts = rows.flatMap(e => [flag(e), ...(Array.isArray(e?.markets) ? e.markets.map(flag) : [])]).filter(v => v !== null);
  if (verdicts.includes(true)) return true;
  if (verdicts.includes(false)) return false;
  return null;
}
export async function holdingRewardForSlug(slug, fetcher = fetch, annualRate = HOLDING_REWARD_APR) {
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
export function combinedHoldingApr(markApr, rewardApr) {
  return markApr === null || !Number.isFinite(markApr) ? null :
    markApr + (Number.isFinite(rewardApr) && rewardApr > 0 ? rewardApr : 0);
}
export function compoundApyFromApr(apr, days) {
  if (apr === null || !Number.isFinite(apr) || !(days > 0)) return null;
  const remainingRoi = apr * days / 365;
  return remainingRoi > -1 ? Math.pow(1 + remainingRoi, 365 / days) - 1 : null;
}
