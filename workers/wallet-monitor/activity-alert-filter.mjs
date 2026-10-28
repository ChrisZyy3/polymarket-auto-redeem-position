// Suppress low-value *activity notifications* only. Data ingestion, seen keys,
// position snapshots, settlement/risk/health alerts and outbox are unaffected.
// Run this after mergeTradeFills so a single batch of small fills may exceed
// the threshold and send one useful notification.
const finite = value => value !== null && value !== undefined &&
  value !== "" && Number.isFinite(Number(value));

export function activityNotionalUsd(event) {
  if (!event || !["TRADE", "REDEEM"].includes(event.type)) return null;
  if (finite(event.usdcSize) && Number(event.usdcSize) >= 0)
    return Number(event.usdcSize);
  // Partial/legacy records may omit usdcSize. Only use an estimated notional
  // when both share count and execution price are valid.
  if (finite(event.size) && Number(event.size) > 0 &&
      finite(event.price) && Number(event.price) >= 0)
    return Number(event.size) * Number(event.price);
  return null;
}

export function shouldNotifyActivity(event, minimumUsd = 0) {
  if (!Number.isFinite(minimumUsd) || minimumUsd < 0)
    throw new Error("Invalid MIN_ACTIVITY_ALERT_USD");
  if (minimumUsd === 0) return true;
  const notional = activityNotionalUsd(event);
  // Incomplete activity must remain visible rather than silently discarded.
  return notional === null || notional >= minimumUsd;
}
