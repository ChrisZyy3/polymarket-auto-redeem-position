// Shared /v2/positions circuit: conserves one expensive query across wallets.
// Entirely separate from per-wallet checkpoints or the MONITOR notification DO.
const finite = n => Number.isFinite(Number(n)) && Number(n)>=0;
export const DEFAULT_BASE_SECONDS = 5*60;
export const MAX_BACKOFF_SECONDS = 60*60;
const normalize=(state)=>({
  consecutive429:Math.max(0,Math.floor(Number(state?.consecutive429)||0)),
  blockedUntil:Math.max(0,Number(state?.blockedUntil)||0),
  probeLeaseUntil:Math.max(0,Number(state?.probeLeaseUntil)||0),
  last429At:Math.max(0,Number(state?.last429At)||0),
  lastSuccessAt:Math.max(0,Number(state?.lastSuccessAt)||0),
  lastEndpoint:"/v2/positions"
});
const randomJitter=(random,span)=>Math.floor(Math.max(0,Math.min(0.99999,Number(random())||0))*span);
export function positionCircuitGate(previous,now,random=Math.random){
  if(!Number.isFinite(now)||now<=0) throw new Error("Invalid position circuit timestamp");
  const state=normalize(previous);
  if(now<state.blockedUntil || now<state.probeLeaseUntil)
    return {allowed:false,state,reason:now<state.blockedUntil?"backoff":"probe_in_flight",
      nextAllowedAt:Math.max(state.blockedUntil,state.probeLeaseUntil)};
  if(state.consecutive429>0){
    const until=now+45; // One probe globally; never multiple concurrent recovery probes.
    return {allowed:true,state:{...state,probeLeaseUntil:until},reason:"recovery_probe",nextAllowedAt:until};
  }
  return {allowed:true,state,reason:"healthy",nextAllowedAt:null};
}
export function positionCircuitUpdate(previous,event,now,{
  retryAfterMs=null,random=Math.random
}={}){
  if(!Number.isFinite(now)||now<=0)throw new Error("Invalid position circuit timestamp");
  const state=normalize(previous);
  if(event==="ok") return {...state,consecutive429:0,blockedUntil:0,
    probeLeaseUntil:0,lastSuccessAt:now};
  if(event==="other")return {...state,probeLeaseUntil:0};
  if(event!=="429")throw new Error("Unsupported circuit event");
  const consecutive429=Math.min(20,state.consecutive429+1);
  const exponential=Math.min(MAX_BACKOFF_SECONDS,DEFAULT_BASE_SECONDS*(2**Math.min(8,consecutive429-1)));
  const headerSeconds=finite(retryAfterMs)&&Number(retryAfterMs)>0
    ? Math.ceil(Number(retryAfterMs)/1000):0;
  const seconds=Math.min(6*3600,Math.max(exponential,headerSeconds));
  // Retry-After is a floor, not a ceiling. Add a brief random offset so
  // multiple environments do not all hit upstream at the same second.
  const blockedUntil=now+seconds+randomJitter(random,30);
  return {...state,consecutive429,blockedUntil,probeLeaseUntil:0,last429At:now};
}
