// Durable-object outbox independent of Data API polling. No secrets are logged.
// A failed ServerChan call never prevents subsequent trade ingestion.
const LIMIT = 15;
const minRetryMs = 30_000;
const maxRetryMs = 30 * 60_000;
const kind = title => String(title || "unknown")
  .replace(/^Polymarket\s*\u00b7\s*/, "").slice(0, 64);
const log = (type, wallet, details) =>
  console.info(type, JSON.stringify({ wallet, ...details }));
const safeError = error => {
  const message = String(error?.message || "");
  return /^(HTTP [1-5][0-9]{2} from [a-zA-Z0-9.-]+|ServerChan rejected notification|PUSH_URL secret is required|PUSH_URL must be a ServerChan3 HTTPS endpoint)$/.test(message)
    ? message : "Push failed (details withheld)";
};

async function setRetryAlarm(storage, ms) {
  if (typeof storage.setAlarm !== "function") return;
  const when = Date.now() + ms;
  const previous = typeof storage.getAlarm === "function"
    ? await storage.getAlarm() : null;
  if (previous === null || previous === undefined || previous > when)
    await storage.setAlarm(when);
}

export async function drainOutbox(storage, at, send, { origin = "poll" } = {}) {
  let state = await storage.get("monitor");
  if (!state) return { accepted: 0, pending: 0, failed: false };
  state.pending ??= [];
  state.audit ??= {};
  const wallet = state.user;
  let accepted = 0, failed = false;
  for (let i = 0; i < LIMIT && state.pending.length; i++) {
    const item = state.pending[0];
    const type = kind(item.title);
    state.audit.lastPushAttemptAt = at;
    await storage.put("monitor", state);
    log("push_attempted", wallet, { at, type, pending: state.pending.length, origin });
    try {
      await send(item, wallet);
    } catch (error) {
      failed = true;
      state.deliveryFailureStreak = (state.deliveryFailureStreak || 0) + 1;
      state.audit.pushFailureCount = (state.audit.pushFailureCount || 0) + 1;
      state.audit.lastPushErrorAt = at;
      state.audit.lastPushError = safeError(error);
      await storage.put("monitor", state);
      log("push_failed", wallet, { at, type, reason: state.audit.lastPushError,
        origin, pending: state.pending.length });
      break;
    }
    state.pending.shift();
    state.deliveryFailureStreak = 0;
    state.audit.pushCount = (state.audit.pushCount || 0) + 1;
    state.audit.lastPushAt = at;
    state.audit.lastPushType = type;
    if (origin === "poll") state.audit.lastPollAccepted = (state.audit.lastPollAccepted || 0) + 1;
    accepted++;
    await storage.put("monitor", state);
    log("push_accepted", wallet, { at, type, pushCount: state.audit.pushCount,
      pending: state.pending.length, origin });
  }
  if (state.pending.length) {
    // Retry even during long ServerChan outages, but never busy-loop.
    const failures = Math.min(state.deliveryFailureStreak || 0, 7);
    const delay = failed ? Math.min(maxRetryMs, minRetryMs * 2 ** Math.max(0, failures - 1)) : 1_000;
    await setRetryAlarm(storage, delay);
  } else if (origin !== "alarm" && typeof storage.deleteAlarm === "function") {
    await storage.deleteAlarm();
  }
  return { accepted, pending: state.pending.length, failed };
}
