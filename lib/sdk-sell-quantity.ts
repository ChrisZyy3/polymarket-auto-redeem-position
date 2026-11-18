/**
 * @polymarket/client 0.20.0 computeLimitOrderAmounts rounds the share size
 * DOWN to two decimal places for every supported tick. Normalize before the
 * user sees/approves a SELL, never after they sign.
 */
export function normalizeSdkSellShares(requested:number):number|null{
 if(!Number.isFinite(requested)||requested<=0)return null;
 const value=String(requested);
 if(!/^\d+(?:\.\d{1,6})?$/.test(value))return null;
 const [whole,fraction='']=value.split('.');
 try{
  const cents=BigInt(whole)*100n+BigInt((fraction+'00').slice(0,2));
  if(cents<=0n||cents>BigInt(Number.MAX_SAFE_INTEGER))return null;
  return Number(cents)/100;
 }catch{return null;}
}
