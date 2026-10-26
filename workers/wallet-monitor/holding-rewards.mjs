const ROOT="https://gamma-api.polymarket.com";
export const HOLDING_REWARD_APR=0.0325;
function flag(obj) {
  if (!obj || typeof obj!=="object") return null;
  return obj.holdingRewardsEnabled===true?true:obj.holdingRewardsEnabled===false?false:null;
}
export function rewardEligibility(payload) {
  const rows=Array.isArray(payload)?payload:[payload];
  const flags=rows.map(flag).filter(x=>x!==null);
  return flags.includes(true)?true:flags.includes(false)?false:null;
}
export async function holdingRewardForSlug(slug,fetcher=fetch,annualRate=HOLDING_REWARD_APR) {
  if (!/^[a-zA-Z0-9_-]{1,180}$/.test(String(slug||"")))return {eligible:null,apr:0};
  try{
    const r=await fetcher(ROOT+"/events/slug/"+encodeURIComponent(slug),{
      headers:{accept:"application/json"},signal:AbortSignal.timeout(7500)
    });
    if(!r.ok)return {eligible:null,apr:0};
    const eligible=rewardEligibility(await r.json());
    return {eligible,apr:eligible===true?annualRate:0};
  }catch{return {eligible:null,apr:0};}
}
export async function rewardMapForPositions(positions,fetcher=fetch,annualRate=HOLDING_REWARD_APR) {
  const slugs=[...new Set((positions||[]).map(p=>p.eventSlug).filter(Boolean))];
  const results=await Promise.all(slugs.map(async slug=>[slug,await holdingRewardForSlug(slug,fetcher,annualRate)]));
  return new Map(results);
}
