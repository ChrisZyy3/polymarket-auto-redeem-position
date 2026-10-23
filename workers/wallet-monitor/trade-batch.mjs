// Coalesce fill-style trades for one wallet + outcome + direction + UTC five-minute bucket.
// Called only AFTER activityKey() dedupes individual executions.
export function mergeTradeFills(items, bucketSeconds = 300) {
  const out = [], groups = new Map();
  for (const a of items) {
    const size = Number(a?.size), cost = Number(a?.usdcSize), t = Number(a?.timestamp);
    const asset = a?.asset ?? a?.tokenId;
    if (a?.type !== "TRADE" || !["BUY", "SELL"].includes(a?.side) ||
        !asset || !Number.isFinite(size) || size <= 0 ||
        !Number.isFinite(cost) || cost < 0 || !Number.isFinite(t) || t <= 0) {
      out.push(a);
      continue;
    }
    const bucket = Math.floor(t / bucketSeconds);
    const key = JSON.stringify([String(asset), a.side, bucket]);
    let group = groups.get(key);
    if (!group) {
      group = { ...a, size: 0, usdcSize: 0, tradeCount: 0,
        firstTradeAt: t, timestamp: t, mergeBucket: bucket };
      groups.set(key, group);
      out.push(group);
    }
    group.size += size;
    group.usdcSize += cost;
    group.tradeCount += 1;
    group.firstTradeAt = Math.min(group.firstTradeAt, t);
    group.timestamp = Math.max(group.timestamp, t);
    group.price = group.size > 0 ? group.usdcSize / group.size : 0;
    // Preserve first fill's market metadata; never use transactionHash to dedupe.
  }
  return out;
}
