import type { ClobOrder } from './browser-clob';

/** An absent open order has an unknown terminal state; never infer cancellation or fill. */
export function openOrderStatus(order: ClobOrder): 'open' | 'partially_filled' {
  return Number(order.size_matched) > 0 ? 'partially_filled' : 'open';
}

/** The caller must separately verify order coverage and balance before trading. */
export function observedSellShares(orders: ClobOrder[], asset: string): number {
  return orders.filter(order => order.asset_id === asset && order.side === 'SELL')
    .reduce((sum, order) => sum + Number(order.original_size) - Number(order.size_matched), 0);
}


export type OrderLifecycle = 'open' | 'partially_filled' | 'matched_pending' | 'filled' | 'canceled' | 'expired' | 'unknown';

/** Only explicit CLOB statuses can establish terminal outcomes.
 * A missing order, HTTP timeout or empty open-order list NEVER means canceled/filled.
 */
export function verifiedOrderLifecycle(order: {status?:unknown;original_size?:unknown;size_matched?:unknown}|null): OrderLifecycle {
  if (!order || typeof order.status !== 'string') return 'unknown';
  const status=order.status.toUpperCase();
  const total=Number(order.original_size), matched=Number(order.size_matched);
  if(status==='CANCELED'||status==='CANCELLED')return 'canceled';
  if(status==='EXPIRED')return 'expired';
  if(status==='FILLED')return 'filled';
  if(status==='MATCHED')return 'matched_pending';
  if(status!=='LIVE' && status!=='OPEN')return 'unknown';
  if(!Number.isFinite(total)||total<=0||!Number.isFinite(matched)||matched<0||matched>total)return 'unknown';
  if(matched>=total)return 'matched_pending';
  return matched>0?'partially_filled':'open';
}
