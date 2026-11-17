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
