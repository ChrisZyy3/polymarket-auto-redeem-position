import type { QueueRecord } from './manual-sell-queue';
import { nextReviewAsset } from './manual-sell-queue';
import { daysUntilSettlement, simpleRemainingAprPercent } from './apr';

/** Only the exact currently displayed settlement date may be treated as confirmed. */
export function settlementConfirmedForDate(confirmed:string|undefined,date:string|null|undefined):boolean {
 return typeof date==='string' && date.trim().length>0 && confirmed===date;
}

/** Review can advance only following an exact authenticated LIVE SELL read-back.
 * This never signs or sends an order for the next item.
 */
export function nextAfterVerifiedSell(selected:string[],records:Record<string,QueueRecord>,current:string,verified:boolean):string|null {
 if(!verified||!selected.includes(current))return null;
 const updated={...records,[current]:{status:'open' as const,updatedAt:Date.now()}};
 const next=nextReviewAsset(selected,updated,current);
 return next===current?null:next;
}

/** Fingerprint all user-visible inputs: stale APR/size cannot authorize old review. */
export function sellReviewConfigKey(v:{asset:string;apr:string;quantity:string;coverage:boolean;settlementConfirmed:boolean;endDate:string|null|undefined}):string{
 return JSON.stringify([v.asset,v.apr.trim(),v.quantity.trim(),v.coverage,v.settlementConfirmed,v.endDate??null]);
}
export function sellQuantityForPercent(unreserved:number|null,pct:25|50|100):string{
 if(unreserved===null||!Number.isFinite(unreserved)||unreserved<=0)return '';
 const micros=Math.floor((unreserved*1000000+1e-5)*pct/100);
 if(!Number.isSafeInteger(micros)||micros<=0)return '';
 const whole=Math.floor(micros/1000000),fraction=String(micros%1000000).padStart(6,'0').replace(/0+$/,'');
 return fraction?whole+'.'+fraction:String(whole);
}
export function sellLimitSummary(price:number,quantity:number,avgPrice:number,endDate:string|null,now:Date=new Date()){
 const days=daysUntilSettlement(endDate,now),apr=simpleRemainingAprPercent(price,days);
 const valid=Number.isFinite(price)&&price>0&&price<1&&Number.isFinite(quantity)&&quantity>0;
 return {limitAprPercent:apr,grossProceeds:valid?price*quantity:null,
 profitVsAvgCost:valid&&Number.isFinite(avgPrice)&&avgPrice>=0&&avgPrice<=1?(price-avgPrice)*quantity:null,
 estimatedDays:Number.isFinite(days)&&days>0?days:null};
}
