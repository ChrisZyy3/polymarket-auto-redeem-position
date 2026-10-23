// Public /health is intentionally low-information: no wallets, addresses,
// checkpoints, pending notifications, push URL, errors or secrets are exposed.
// It is intended for external monitoring that does not possess MONITOR_SECRET.
export const HEALTH_STALE_SECONDS = 20 * 60;

export function healthSummary(wallets, nowSeconds = Math.floor(Date.now() / 1000),
  staleAfterSeconds = HEALTH_STALE_SECONDS) {
  if (!Array.isArray(wallets) || wallets.length === 0)
    return { ok: false, checked: 0 };

  const valid = wallets.every(item => {
    const last = Number(item?.lastSuccessAt);
    return item?.ok === true && item?.initialized === true &&
      Number.isFinite(last) && last > 0 &&
      last <= nowSeconds + 60 && nowSeconds - last <= staleAfterSeconds;
  });
  return { ok: valid, checked: wallets.length };
}
