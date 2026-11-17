import type { QueueRecord } from './manual-sell-queue';
import { nextReviewAsset } from './manual-sell-queue';

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
