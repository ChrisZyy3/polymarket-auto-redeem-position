import { parseUnits } from "viem";
import type { ClobOrder } from "./browser-clob";

/** Snapshot comparison only: neither order coverage nor approvals are established here. */
export function reviewSellBalance(rawBalance: string, asset: string, orders: ClobOrder[]) {
  if (!/^\d+$/.test(rawBalance)) return null;
  let reserved = 0n;
  const sells = orders.filter(order => order.asset_id === asset && order.side === "SELL");
  try {
    for (const order of sells) {
      if (!/^\d+(?:\.\d{1,6})?$/.test(order.original_size) || !/^\d+(?:\.\d{1,6})?$/.test(order.size_matched)) return null;
      const remaining = parseUnits(order.original_size, 6) - parseUnits(order.size_matched, 6);
      if (remaining < 0n) return null;
      reserved += remaining;
    }
    const balance = BigInt(rawBalance);
    if (reserved > balance) return { reserved, remainder: null, count: sells.length };
    return { reserved, remainder: balance - reserved, count: sells.length };
  } catch { return null; }
}
