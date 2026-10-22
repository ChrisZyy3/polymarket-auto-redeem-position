import { poll, activityKey, positionStatus } from "./monitor.mjs";

const assert = (v, m) => { if (!v) throw new Error(m); };
const env = { WALLET_ADDRESS: "0x052f4191cd324a348835a846d34df5b0061e53fb",
  PUSH_URL: "https://11310.push.ft07.com/send/test.send" };
let positions = [{ asset: "a", conditionId: "c", size: 100, avgPrice: .9,
  initialValue: 90, currentValue: 95, curPrice: .95, redeemable: false }];
let activity = [];
let sent = 0;
let rejectPush = false;
const db = new Map();
const storage = {
  get: async k => db.has(k) ? JSON.parse(JSON.stringify(db.get(k))) : undefined,
  put: async (k, v) => { db.set(k, JSON.parse(JSON.stringify(v))); }
};
const fetcher = async (url, init) => {
  const s = String(url);
  if (s.includes("push.ft07.com")) {
    assert(init.method === "POST", "push uses POST");
    if (rejectPush) return { ok: true, json: async () => ({ code: 1 }) };
    sent++;
    return { ok: true, json: async () => ({ code: 0 }) };
  }
  return { ok: true, json: async () => s.includes("/positions?") ? positions : activity };
};
await poll(storage, env, fetcher, 1000);
assert(sent === 0, "first run must only establish baseline");
activity = [{ transactionHash: "tx", type: "TRADE", asset: "a",
  timestamp: 1020, side: "BUY", size: 5, usdcSize: 4.5, price: .9 }];
let result = await poll(storage, env, fetcher, 1060);
assert(sent === 1 && result.alerts === 1, "new buy sends one notification");
await poll(storage, env, fetcher, 1120);
assert(sent === 1, "same trade is not sent twice");
assert(activityKey(activity[0]) !== activityKey({ ...activity[0], asset: "b" }),
  "different outcomes in same tx remain distinct");
positions = [{ ...positions[0], redeemable: true, curPrice: 0, currentValue: 0 }];
rejectPush = true;
let failed = false;
try { await poll(storage, env, fetcher, 1180); } catch { failed = true; }
assert(failed && db.get("monitor").pending.length === 1,
  "failed push leaves durable pending alert");
positions = [];
rejectPush = false;
await poll(storage, env, fetcher, 1240);
assert(sent === 2 && db.get("monitor").pending.length === 0,
  "zero value loss is delivered even after position disappears");
assert(positionStatus({ redeemable: false, curPrice: 0 }) === "open",
  "open market priced zero is not a settlement loss");
assert(positionStatus({ redeemable: true, curPrice: .5 }) === "redeemable",
  "50/50 settlement is redeemable, not a loss");
positions = [{ asset: "tiny", size: 1, initialValue: .5, currentValue: 0,
  avgPrice: .5, curPrice: 0, redeemable: true }];
await poll(storage, env, fetcher, 1300);
assert(sent === 2, "dust cost below five dollars is excluded");
activity.push({ transactionHash: "redeem", type: "REDEEM", asset: "a",
  timestamp: 1320, size: 100, usdcSize: 100 });
await poll(storage, env, fetcher, 1360);
assert(sent === 3, "actual redemption notification");
const oldCheckpoint = db.get("monitor").checkpoint;
const badApi = async () => ({ ok: false, status: 503 });
try { await poll(storage, env, badApi, 1420); } catch {}
assert(db.get("monitor").checkpoint === oldCheckpoint,
  "failed data fetch cannot advance checkpoint");
const fullPageApi = async () => ({ ok: true,
  json: async () => Array.from({ length: 500 }, () => ({ asset: "x" })) });
failed = false;
try { await poll(storage, env, fullPageApi, 1420); } catch { failed = true; }
assert(failed && db.get("monitor").checkpoint === oldCheckpoint,
  "pagination overflow fails without advancing checkpoint");
console.log("Passed: baseline, trade, dedupe, multi-outcome tx, zero-value loss, failed push retry, disappearing position, resolution gate, 50/50, dust, redemption, API failure, pagination overflow");
