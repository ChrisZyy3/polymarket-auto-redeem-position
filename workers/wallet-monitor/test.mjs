import { poll, activityKey, positionStatus, auditSnapshot, walletLabel, expectedEnd, marketContextLines, recordPollFailure, auditV2Shadow } from "./monitor.mjs";
import { compareV2Positions } from "./v2-shadow.mjs";
import { dataApiJson, retryAfterMs } from "./data-client.mjs";
import { drainOutbox } from "./outbox.mjs";
import { tradeAlert, settlementAlert, settlementKind, estimatePnl, walletPusdBalance } from "./notification.mjs";
import { snapshotHoldings, positionAction, winningPayoutForecast } from "./position-lifecycle.mjs";
import { settlementNet, readRedeemableEconomics } from "./settlement-economics.mjs";
import { mergeTradeFills } from "./trade-batch.mjs";
import worker, { walletAddresses, WalletMonitor } from "./worker.mjs";
import { healthSummary, HEALTH_STALE_SECONDS } from "./health.mjs";

const assert = (v, m) => { if (!v) throw new Error(m); };
const env = { WALLET_ADDRESS: "0x052f4191cd324a348835a846d34df5b0061e53fb",
  PUSH_URL: "https://11310.push.ft07.com/send/test.send" };
let positions = [{ asset: "a", conditionId: "c", size: 100, avgPrice: .9,
  initialValue: 90, currentValue: 95, curPrice: .95, redeemable: false,
  title: "Sample market", outcome: "Yes", endDate: "2026-12-31", eventSlug: "sample-market" }];
let activity = [];
let sent = 0;
const delivered = [];
let rpcCalls = 0;
let rejectPush = false;
const auditEvents = [];
const priorConsoleInfo = console.info;
console.info = (...args) => { auditEvents.push(args.map(String).join(" ")); };
const db = new Map();
const storage = {
  get: async k => db.has(k) ? JSON.parse(JSON.stringify(db.get(k))) : undefined,
  put: async (k, v) => { db.set(k, JSON.parse(JSON.stringify(v))); }
};
const fetcher = async (url, init) => {
  const s = String(url);
  if (s.includes("polygon-bor-rpc.publicnode.com") || s.includes("polygon.drpc.org")) {
    rpcCalls++;
    const rpcRequest = JSON.parse(init.body);
    assert(rpcRequest.method === "eth_call", "chain balance read is eth_call");
    assert(rpcRequest.params[0].to.toLowerCase() === "0xc011a7e12a19f7b1f670d46f03b03f3342e82dfb",
      "Polymarket pUSD contract used");
    assert(rpcRequest.params[0].data.endsWith(env.WALLET_ADDRESS.slice(2).toLowerCase()),
      "wallet address encoded");
    return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result: "0x075bcd15" }) };
  }
  if (s.includes("push.ft07.com")) {
    assert(init.method === "POST", "push uses POST");
    assert(init.redirect === "manual", "Worker fetch uses supported redirect policy");
    if (rejectPush) return { ok: true, json: async () => ({ code: 1 }) };
    delivered.push(JSON.parse(init.body));
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
assert(delivered[0].title.startsWith("🟢 BUY · ChrisZyy"), "rich notification title");
assert(delivered[0].desp.includes("账户：** ChrisZyy"), "wallet in detailed notification");
assert(delivered[0].short.includes("5 份 @ $0.9"), "short mobile preview includes fill");
assert(delivered[0].desp.includes("**💳 钱包余额（链上 pUSD）：123.46 pUSD**"),
  "correct Polygon pUSD balance in footer");
assert(rpcCalls === 1, "balance is queried only when an alert exists");
assert(delivered[0].desp.includes("预计结束：2026-12-31"), "end date populated");
assert(delivered[0].desp.includes("当前该选项总持仓：100 份"), "total shares not trade fill");
assert(delivered[0].desp.includes("当前持仓市值：$95.00"), "current USD holdings");
assert(delivered[0].desp.includes("买入均价：$0.9 / 份"), "position weighted entry average");
assert(delivered[0].desp.includes("https://polymarket.com/event/sample-market"), "market link stays");
assert(!delivered[0].desp.includes("交易：") && !delivered[0].desp.includes("polygonscan.com/tx"),
  "tx explorer link removed");
await poll(storage, env, fetcher, 1120);
assert(sent === 1, "same trade is not sent twice");
assert(rpcCalls === 1, "no needless chain queries without alerts");
assert(activityKey(activity[0]) !== activityKey({ ...activity[0], asset: "b" }),
  "different outcomes in same tx remain distinct");
positions = [{ ...positions[0], redeemable: true, curPrice: 0, currentValue: 0 }];
rejectPush = true;
let failed = false;
const lossPoll = await poll(storage, env, fetcher, 1180);
assert(lossPoll.deliveryDeferred === true &&
  db.get("monitor").pending.length === 1,
  "failed push leaves durable pending alert without blocking successful ingest");
assert(db.get("monitor").checkpoint === 1180,
  "push failure must NOT block activity checkpoint advancement");
positions = [];
rejectPush = false;
await poll(storage, env, fetcher, 1240);
assert(sent === 2 && db.get("monitor").pending.length === 0,
  "zero value loss is delivered even after position disappears");
assert(delivered[1].title.startsWith("🔴 LOSS · ChrisZyy"), "loss title is visually distinct");
assert(delivered[1].desp.includes("-$90.00"), "loss inferred only using remaining entry basis");
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


// Multi-wallet routing: de-dupe mixed case, preserve the pre-upgrade DO identity.
const originals = [
  "0x9f7eb5bc88342f01d18754be0439fad79ec282ce",
  "0x24816c037cdc2c9bd979e69d777541cf560a9b79",
  "0x052f4191cd324a348835a846d34df5b0061e53fb"
];
const multi = { WALLET_ADDRESSES: originals.join(",") + "," + originals[2].toUpperCase().replace(/^0X/, "0x") };
assert(JSON.stringify(walletAddresses(multi)) === JSON.stringify(originals), "multi-wallet parsing and case insensitive dedup");
assert(JSON.stringify(walletAddresses({ WALLET_ADDRESS: originals[2] })) === JSON.stringify([originals[2]]), "legacy wallet fallback");
let invalid = false;
try { walletAddresses({ WALLET_ADDRESSES: "not-an-address" }); } catch { invalid = true; }
assert(invalid, "invalid wallet rejected");

const polled = [];
const objectStub = {
  idFromName: name => name,
  get: name => ({
    fetch: async (url) => {
      polled.push({ name, url: String(url) });
      return Response.json({ ok: true, initialized: true });
    }
  })
};
const protectedEnv = { ...multi, MONITOR: objectStub, MONITOR_SECRET: "unit-test-secret" };
const authorized = new Request("https://example.com/status", { headers: { authorization: "Bearer unit-test-secret" } });
const status = await worker.fetch(authorized, protectedEnv);
const statusData = await status.json();
assert(status.status === 200 && statusData.ok && statusData.wallets.length === 3, "all wallets appear in status");
assert(polled.map(p => p.name).join(",") === originals.join(","), "DO ids preserve address ordering and legacy identity");
const unauthorized = await worker.fetch(new Request("https://example.com/status"), protectedEnv);
assert(unauthorized.status === 401, "status endpoint is protected");
let scheduled = null;
worker.scheduled({ scheduledTime: Date.UTC(2026,9,23,3,0,0) }, protectedEnv, { waitUntil: task => { scheduled = task; } });
await scheduled;
assert(polled.length === 6, "single Cron checks each wallet once");
console.log("Passed: multi-wallet parser, duplicate elimination, single-wallet fallback, validation, authorization, independent DO routing, Cron fan-out");


// Durable receipt accounting: existing retry tests above exercise the complete lifecycle.
const audit = auditSnapshot(db.get("monitor"));
assert(audit.auditSince === 1000, "audit start timestamp tracks first audited run");
assert(audit.alertsDetectedCount === 3, "three actual alerts detected");
assert(audit.pushCount === 3, "only successfully accepted messages counted");
assert(audit.pushFailureCount === 1, "failed delivery attempt was counted");
assert(audit.lastPushAt === 1360 && audit.lastPollAt === 1360, "persistent timestamps");
assert(audit.lastPollAlerts === 1 && audit.lastPollAccepted === 1, "last successful poll counters");
assert(audit.lastAlertType === audit.lastPushType, "last alert is last successful delivery");
assert(audit.lastPushErrorAt === 1180 && !audit.lastPushError.includes("test.send"),
  "failed delivery is persisted without secret leakage");
const expectedEvents = ["wallet_poll_success", "wallet_alert_detected", "push_attempted",
  "push_accepted", "push_failed"];
for (const name of expectedEvents) {
  assert(auditEvents.some(line => line.startsWith(name + " ")), "audit log emitted: " + name);
}
assert(!auditEvents.some(line => line.includes("test.send")), "push secret not logged");

// The Durable Object status route must surface audit fields without extra storage reads.
const monitorObject = new WalletMonitor({ storage }, env);
const objectStatus = await monitorObject.fetch(
  new Request("https://internal/status?wallet=" + env.WALLET_ADDRESS));
const objectView = await objectStatus.json();
assert(objectStatus.status === 200 && objectView.pushCount === 3 &&
  objectView.alertsDetectedCount === 3 && objectView.pending === 0,
  "authorized per-wallet status provides durable audit counts");

// A legacy wallet gains an audit record without losing its previous checkpoint.
const legacyMap = new Map();
const legacyState = structuredClone(db.get("monitor"));
delete legacyState.audit;
legacyState.startedAt = 1500;
legacyState.checkpoint = 1500;
legacyState.lastSuccessAt = 1500;
legacyState.seen = {};
legacyState.pending = [];
legacyState.positions = {};
legacyMap.set("monitor", legacyState);
const legacyStorage = {
  get: async key => structuredClone(legacyMap.get(key)),
  put: async (key, value) => { legacyMap.set(key, structuredClone(value)); }
};
await poll(legacyStorage, env, fetcher, 1550);
const migrated = legacyMap.get("monitor");
assert(migrated.checkpoint === 1550 && migrated.startedAt === 1500,
  "legacy checkpoints and start timestamps are preserved");
assert(migrated.audit.auditSince === 1550 && migrated.audit.pushCount === 0,
  "legacy wallet starts a new audit period without invented history");
console.info = priorConsoleInfo;
console.log("Passed: audit counts, push retries, safe structured logs, authenticated status and legacy migration");


// Labels and safe end-date/position fallbacks.
assert(walletLabel("0x9f7eb5bc88342f01d18754be0439fad79ec282ce") === "PigsWallet", "PigsWallet label");
assert(walletLabel("0x24816C037CDc2c9BD979e69d777541cF560A9b79") === "RealChris", "RealChris mixed case");
assert(walletLabel("0x052f4191cd324A348835A846d34dF5b0061e53fb") === "ChrisZyy", "ChrisZyy mixed case");
const unknownWallet = "0x0000000000000000000000000000000000000123";
assert(walletLabel(unknownWallet) === unknownWallet, "unknown wallet fallback");
assert(expectedEnd("1970-01-01") === "暂无数据", "invalid sentinel excluded");
assert(expectedEnd(undefined) === "暂无数据", "missing end date explicit");
assert(expectedEnd("2026-12-31T16:00:00Z").includes("2027/01/01 00:00"),
  "market end time formatted in Asia/Shanghai");
const missingHoldings = marketContextLines({ asset: "missing", conditionId: "missing" }, positions);
assert(missingHoldings.some(line => line.includes("暂无数据")), "missing holdings not invented");
const ambiguousContext = marketContextLines({ conditionId: "ambiguous" }, [
  { asset: "one", conditionId: "ambiguous", outcome: "Yes", size: 12, avgPrice: 0.2 },
  { asset: "two", conditionId: "ambiguous", outcome: "No", size: 6, avgPrice: 0.9 }
]);
assert(ambiguousContext.some(line => line.includes("暂无数据")), "different outcomes are not merged");
assert(delivered.every(m => !m.desp.includes("交易：") &&
  !m.desp.includes("polygonscan.com/tx")), "all notifications lack tx explorer links");
console.log("Passed: wallet labels, planned end, holding summaries, unknown market, tx URL removal");


// Rich event card generator tests. A redeemable price of 0.5 is PARTIAL, not WIN.
const market = { asset: "z", conditionId: "zz", title: "Will Z happen?",
  outcome: "Yes", endDate: "2026-12-31", eventSlug: "will-z-happen",
  size: 100, currentValue: 100, avgPrice: 0.82, grossInitialValue: 82,
  initialValue: 82, redeemable: true, curPrice: 1 };
const lines = marketContextLines(market, [market]);
const marketLink = "https://polymarket.com/event/will-z-happen";
const won = settlementAlert(market, lines, "RealChris", 1900, marketLink);
assert(settlementKind(market) === "WIN" && won.title.startsWith("🏆 WIN · RealChris"),
  "100% payout classified as WIN");
assert(won.desp.includes("+ $18.00") === false && won.desp.includes("+$18.00"),
  "WIN expected position profit");
assert(won.desp.includes("+21.95%"), "profit ROI based on remaining cost");
assert(won.short.includes("估算毛盈亏 +$18.00"), "fallback never calls unchecked gross PnL net");
const partial = settlementAlert({ ...market, curPrice: 0.5 }, lines, "PigsWallet", 1900, marketLink);
assert(partial.title.startsWith("🟣 PARTIAL · PigsWallet") &&
  partial.desp.includes("部分回款"), "partial resolution never classified as WIN");
const loss = settlementAlert({ ...market, curPrice: 0, currentValue: 0,
  grossInitialValue: 24, initialValue: 24 }, lines, "PigsWallet", 1900, marketLink);
assert(loss.title.startsWith("🔴 LOSS · PigsWallet") &&
  loss.desp.includes("-$24.00"), "LOSS and remaining-cost estimate");
assert(settlementKind({ ...market, redeemable: false, curPrice: 0 }) === null,
  "open mark at zero is not resolved loss");
const noBasis = { ...market, grossInitialValue: null, initialValue: null };
assert(estimatePnl(noBasis) === null &&
  settlementAlert(noBasis, lines, "RealChris", 1900, marketLink).desp.includes("暂无法核实"),
  "missing cost never fabricates a profit");
const sold = tradeAlert({ ...activity[0], side: "SELL", title: market.title,
  outcome: "Yes", usdcSize: 4.5 }, market, lines, "PigsWallet", marketLink);
assert(sold.title.startsWith("🟠 SELL · PigsWallet") &&
  sold.short.includes("份 @ "), "SELL card and short preview");
const redemption = tradeAlert({ transactionHash: "redeem", type: "REDEEM",
  asset: "z", title: market.title, outcome: "Yes", size: 10, usdcSize: 10, timestamp: 1910 },
  market, lines, "RealChris", marketLink);
assert(redemption.title.startsWith("💰 REDEEM · RealChris") &&
  redemption.short.includes("到账 $10.00"), "REDEEM card and preview");
const zeroRedemption = tradeAlert({ type: "REDEEM", size: 10, usdcSize: 0, timestamp: 1910 },
  market, lines, "RealChris", marketLink);
assert(zeroRedemption.desp.includes("零回款赎回"), "zero payout redemption clearly labeled");

// The balance query is optional; public RPC failure must not interfere with push.
const noRpc = async () => ({ ok: false, status: 503 });
assert(await walletPusdBalance(noRpc, env.WALLET_ADDRESS) === null,
  "RPC outage returns unavailable rather than a fabricated zero");
const rpcFallback = async (url) => ({
  ok: String(url).includes("polygon.drpc.org"),
  json: async () => ({ result: "0x0" })
});
assert(await walletPusdBalance(rpcFallback, env.WALLET_ADDRESS) === "0.00 pUSD",
  "secondary RPC fallback reads an actual zero balance");
// Legacy queued message is reformatted safely at send time without resetting checkpoints.
const beforeLegacy = delivered.length;
const legacyStored = legacyMap.get("monitor");
legacyStored.pending = [{ title: "Polymarket · 买入成交",
  desp: "Old market\n\n交易：https://polygonscan.com/tx/0xlegacy\n\nOld body" }];
legacyMap.set("monitor", legacyStored);
await poll(legacyStorage, env, fetcher, 1600);
assert(delivered.length === beforeLegacy + 1 &&
  delivered[beforeLegacy].desp.includes("钱包：ChrisZyy") &&
  delivered[beforeLegacy].desp.includes("💳 钱包余额") &&
  !delivered[beforeLegacy].desp.includes("polygonscan.com/tx"),
  "old queued alerts retain wallet labels, gain balance, and strip explorer URLs");
console.log("Passed: BUY SELL WIN LOSS PARTIAL REDEEM, short, Markdown, RPC balance and fallback");


// Five-minute fill aggregation preserves individual activity deduplication and settlement events.
const fills = [
  {type:"TRADE",side:"BUY",asset:"asset-a",timestamp:1800,size:10,usdcSize:8,price:0.8},
  {type:"TRADE",side:"BUY",asset:"asset-a",timestamp:1810,size:20,usdcSize:18,price:0.9},
  {type:"TRADE",side:"SELL",asset:"asset-a",timestamp:1820,size:5,usdcSize:4,price:0.8},
  {type:"TRADE",side:"BUY",asset:"asset-b",timestamp:1825,size:5,usdcSize:4.5,price:0.9},
  {type:"TRADE",side:"BUY",asset:"asset-a",timestamp:2100,size:10,usdcSize:9,price:0.9},
  {type:"REDEEM",asset:"asset-a",timestamp:1830,size:10,usdcSize:10}
];
const combined=mergeTradeFills(fills);
assert(combined.length===5,"merge only same token, side and 5-minute interval");
assert(combined[0].tradeCount===2 && combined[0].size===30 &&
  combined[0].usdcSize===26 && Math.abs(combined[0].price-26/30)<1e-9,
  "aggregated fills have correct weighted execution price");
assert(combined[1].side==="SELL" && combined[4].type==="REDEEM",
  "sell and redeemed positions never merge into buy trades");
const groupedAlert=tradeAlert(combined[0], {...market,title:"Merged market",outcome:"Yes"},
  lines,"ChrisZyy",marketLink);
assert(groupedAlert.desp.includes("合并明细") && groupedAlert.short.includes("2笔合并"),
  "aggregation count visible in detailed and short notifications");
console.log("Passed: five-minute fill aggregation, no cross-market/cross-side merging");


// 429/503 API retries, backoff, Retry-After, and fail-fast on permanent errors.
let attempts=0, waits=[];
const retryResponse=async () => {
  attempts++;
  return attempts === 1
    ? {ok:false,status:429,headers:{get:k=>k.toLowerCase()==="retry-after"?"1":null}}
    : attempts === 2
      ? {ok:false,status:503,headers:{get:k=>k.toLowerCase()==="retry-after"?"0":null}}
      : {ok:true,json:async()=>({data:[]})};
};
const retried=await dataApiJson(retryResponse,"https://data-api.polymarket.com/positions",
  {sleep:async ms=>{waits.push(ms)},random:()=>0});
assert(attempts===3 && waits.length===2 && waits[0]===1000 && waits[1]===0 &&
  Array.isArray(retried.data), "API honors Retry-After and retries transient errors");
assert(retryAfterMs({get:()=>null})===null,"absent Retry-After handled");
let tooLong=false, longAttempts=0;
try{
  await dataApiJson(async()=>{
    longAttempts++;return {ok:false,status:429,headers:{get:()=> "30"}}},
    "https://data-api.polymarket.com/activity",
    {sleep:async()=>{throw Error("must not wait 30 seconds")},random:()=>0});
}catch{tooLong=true}
assert(tooLong && longAttempts===1,"long Retry-After defers to later Cron without busy wait");
let bad400=0;
try{
  await dataApiJson(async()=>{bad400++;return {ok:false,status:400}}, 
    "https://data-api.polymarket.com/activity",{sleep:async()=>{},random:()=>0});
}catch{}
assert(bad400===1,"permanent 400 failures are not retried");

// Durable outbox: persistent item, scheduled alarm, recovery, and no false debit.
const pendingMap=new Map();
let nextAlarm=null, retryCalls=0;
const queueStorage={
  get:async k=>structuredClone(pendingMap.get(k)),
  put:async(k,v)=>{pendingMap.set(k,structuredClone(v))},
  getAlarm:async()=>nextAlarm,
  setAlarm:async t=>{nextAlarm=t},
  deleteAlarm:async()=>{nextAlarm=null}
};
pendingMap.set("monitor",{user:env.WALLET_ADDRESS,
  pending:[{title:"🟢 BUY · ChrisZyy · $6.00",short:"fill",desp:"Test"}],
  audit:{pushCount:0,pushFailureCount:0,lastPollAccepted:0}});
const deferred=await drainOutbox(queueStorage,2000,async()=>{throw Error("ServerChan rejected notification")});
assert(deferred.failed && deferred.pending===1 && nextAlarm>Date.now(),
  "failed push stores pending message and schedules alarm");
const succeeded=await drainOutbox(queueStorage,2030,async()=>{retryCalls++},{origin:"alarm"});
assert(succeeded.accepted===1 && succeeded.pending===0 &&
  pendingMap.get("monitor").audit.pushCount===1 && retryCalls===1,
  "alarm retry delivers durable message and clears outbox");

// API health warning and recovery are emitted once, even through ongoing failures.
const beforeHealth=delivered.length;
await recordPollFailure(storage,env,fetcher,2100,new Error("HTTP 429 from data-api.polymarket.com"));
await recordPollFailure(storage,env,fetcher,2400,new Error("HTTP 429 from data-api.polymarket.com"));
assert(delivered.length===beforeHealth && db.get("monitor").audit.consecutivePollFailures===2,
  "no premature health notification");
await recordPollFailure(storage,env,fetcher,2700,new Error("HTTP 429 from data-api.polymarket.com"));
assert(delivered.length===beforeHealth+1 &&
  delivered[beforeHealth].title.includes("MONITOR") &&
  db.get("monitor").audit.healthAlarmActive,
  "exactly one health warning after three failed five-minute rounds");
await recordPollFailure(storage,env,fetcher,3000,new Error("HTTP 429 from data-api.polymarket.com"));
assert(delivered.length===beforeHealth+1,"no repeated outage warning while still unhealthy");
const recovered=await poll(storage,env,fetcher,3300);
assert(delivered.length===beforeHealth+2 &&
  delivered[beforeHealth+1].title.includes("MONITOR 恢复") &&
  recovered.deliveryDeferred===false && db.get("monitor").audit.consecutivePollFailures===0 &&
  db.get("monitor").audit.healthAlarmActive===false,
  "recovery notification emitted only after full successful wallet poll");
console.log("Passed: bounded 429/503 retries, durable alarm retry, streak health warning and recovery");


// Data API v2 read-only comparison (cursor pages) without any side effects.
const v1Fixtures=[{asset:"101",size:3},{asset:"202",size:5},{asset:"303",size:0}];
let v2Reads=0;
const v2Response=async url=>{
  v2Reads++;
  const parsed=new URL(url);
  assert(parsed.pathname==="/v2/positions", "shadow uses only public v2 positions");
  assert(parsed.searchParams.get("user")===env.WALLET_ADDRESS,"shadow user is same proxy wallet");
  const second=Boolean(parsed.searchParams.get("cursor"));
  return {ok:true,json:async()=>({
    data:second
      ? [{token_id:"404",current_size:7}]
      : [{token_id:"101",current_size:3}],
    pagination:{has_more:!second,next_cursor:second?null:"next-signed-cursor"}
  })};
};
const v2Report=await compareV2Positions(v2Response,env.WALLET_ADDRESS,v1Fixtures);
assert(v2Report.pages===2 && v2Report.v1Count===2 && v2Report.v2Count===2 &&
  v2Report.matched===1 && v2Report.onlyV1===1 && v2Report.onlyV2===1 &&
  v2Report.advice==="investigate_data_freshness", "shadow compares complete cursor-paginated data");
const shadowState=new Map();
shadowState.set("monitor", {user:env.WALLET_ADDRESS, audit:{}, pending:[], checkpoint:5400});
const shadowStorage={
  get:async k=>structuredClone(shadowState.get(k)),
  put:async (k,v)=>{shadowState.set(k,structuredClone(v))}
};
let beforeReads=v2Reads;
const firstCompare=await auditV2Shadow(shadowStorage,
  {V2_SHADOW_ENABLED:"true"},v2Response,env.WALLET_ADDRESS,v1Fixtures,60_000);
assert(firstCompare.ok && v2Reads===beforeReads+2 &&
  shadowState.get("monitor").audit.shadowV2Report.v2Count===2,
  "shadow report saved without changing native checkpoint");
beforeReads=v2Reads;
const skippedShadow=await auditV2Shadow(shadowStorage,
  {V2_SHADOW_ENABLED:"true"},v2Response,env.WALLET_ADDRESS,v1Fixtures,60_000+3600);
assert(skippedShadow.skipped==="interval" && v2Reads===beforeReads &&
  shadowState.get("monitor").checkpoint===5400,"only one shadow scan every six hours");
const disabledShadow=await auditV2Shadow(shadowStorage,
  {V2_SHADOW_ENABLED:"false"},v2Response,env.WALLET_ADDRESS,v1Fixtures,100_000);
assert(disabledShadow.skipped==="disabled","shadow flag disables all v2 queries");
const failShadow=await auditV2Shadow(shadowStorage,
  {V2_SHADOW_ENABLED:"true"},async()=>{throw Error("v2 provider down")},
  env.WALLET_ADDRESS,v1Fixtures,100_000);
assert(failShadow.ok===false && shadowState.get("monitor").checkpoint===5400 &&
  shadowState.get("monitor").audit.shadowV2LastError,
  "v2 provider failures are isolated and do not advance/checkpoint legacy state");
console.log("Passed: Data API v2 shadow pagination, cooldown, opt-in and error isolation");


// V2 position lifecycle and ROI / APR acceptance tests (2026-10-23).
const EPS2=1e-8;
const now2=Math.floor(Date.parse("2026-10-23T06:00:00Z") / 1000);
const position2={
  asset:"token-position-1",conditionId:"0x1234567812345678123456781234567812345678123456781234567812345678",
  size:100,avgPrice:0.8,initialValue:80,currentValue:80,curPrice:0.8,
  endDate:"2026-12-31",title:"Sample 2026 market",outcome:"Yes",eventSlug:"sample-2026-market",
  redeemable:false
};
const projected=winningPayoutForecast(position2,now2);
assert(Math.abs(projected.grossROI-25)<EPS2 && Math.abs(projected.grossProfit-20)<EPS2 &&
  projected.simpleAPR>0 && projected.simpleAPR<150,"full-win gross ROI=25% and APR uses future date");
const shownProjection=tradeAlert(
  {type:"TRADE",side:"BUY",size:100,usdcSize:80,price:.8,timestamp:now2},
  position2,marketContextLines(position2,[position2]),
  "ChrisZyy","https://polymarket.com/event/sample-2026-market",
  {lifecycle:{kind:"OPEN",previousSize:0,currentSize:100,deltaSize:100,deltaPercent:null},forecast:projected});
assert(shownProjection.title.startsWith("🆕 OPEN · ChrisZyy") &&
  shownProjection.desp.includes("预估 ROI") &&
  shownProjection.desp.includes("25.00%") &&
  shownProjection.desp.includes("预估 APR") &&
  shownProjection.desp.includes("100 份") &&
  shownProjection.desp.includes("该 UTC 日期末估算"),
  "OPEN alert includes conditional ROI/APR, share count and correct date assumption");
assert(winningPayoutForecast({...position2,endDate:"1970-01-01"},now2).simpleAPR===null &&
  winningPayoutForecast({...position2,endDate:"1970-01-01"},now2).grossROI===25,
  "missing end date omits APR but preserves ROI");
assert(winningPayoutForecast({...position2,endDate:"2020-01-01"},now2).simpleAPR===null,
  "expired end date never annualizes past expiration");
assert(winningPayoutForecast({...position2,avgPrice:0},now2)===null,
  "zero cost must not generate infinite APR");

const baseShot=snapshotHoldings([position2]);
const nextShot=snapshotHoldings([{...position2,size:150}]);
const fillA={type:"TRADE",side:"BUY",asset:position2.asset,size:50};
const addClass=positionAction(fillA,[fillA],baseShot,nextShot);
assert(addClass.kind==="ADD"&&addClass.previousSize===100&&addClass.currentSize===150&&
  Math.abs(addClass.deltaPercent-50)<EPS2,"corroborated add from exact previous shares");
const sellA={type:"TRADE",side:"SELL",asset:position2.asset,size:50};
assert(positionAction(sellA,[sellA],nextShot,baseShot).kind==="TRIM",
  "partial reduction classified as TRIM");
const exitFill={...sellA,size:100};
assert(positionAction(exitFill,[exitFill],baseShot,{}).kind==="EXIT",
  "SELL to zero classified as EXIT");
assert(positionAction({...fillA,size:100},[{...fillA,size:100}],{},baseShot).kind==="OPEN",
  "OPEN requires zero previous shares and a matching buy");
assert(positionAction(fillA,[fillA],null,nextShot)===null,
  "legacy wallet without size snapshots cannot be falsely called OPEN");
assert(positionAction(fillA,[fillA],baseShot,baseShot)===null,
  "index lag or a wallet transfer cannot be called ADD");
assert(positionAction(fillA,[fillA,sellA],baseShot,baseShot)===null,
  "mixed buy/sell activity cannot be misclassified");
assert(positionAction(fillA,[fillA,fillA],baseShot,nextShot)===null,
  "two distinct five-minute fill buckets prevent false add sizing");
assert(positionAction(sellA,[sellA],baseShot,{})===null,
  "unexplained disappearance without matching full sell cannot be called EXIT");

// Net settlement uses v2 fee-INCLUSIVE remaining basis exactly once.
const economicsFixture={
  token_id:position2.asset,current_size:100,entry_cost_usdc:82,
  entry_fees_usdc:0.5,total_cost_usdc:82.5,realized_pnl:4
};
const settlementPosition={...position2,redeemable:true,curPrice:1};
const netResult=settlementNet(settlementPosition,economicsFixture);
assert(Math.abs(netResult.net-17.5)<EPS2&&Math.abs(netResult.roi-(17.5/82.5*100))<EPS2&&
  netResult.buyFees===.5&&netResult.realizedPnl===4,
  "v2 fee-inclusive net=$17.50, not the unadjusted gross $18");
const winNetAlert=settlementAlert(settlementPosition,marketContextLines(settlementPosition,[settlementPosition]),
  "ChrisZyy",now2,"https://polymarket.com/event/sample-2026-market",{net:netResult});
assert(winNetAlert.title.startsWith("🏆 WIN · ChrisZyy · +$17.50")&&
  winNetAlert.desp.includes("该剩余仓位预计净收益")&&
  winNetAlert.desp.includes("+$17.50")&&
  winNetAlert.desp.includes("已包含的买入手续费")&&
  winNetAlert.desp.includes("历史已实现盈亏（另列）"),
  "settlement card shows net, accounted buy fee and separately reported realized PnL");
const netLossPosition={...settlementPosition,curPrice:0};
const netLoss=settlementNet(netLossPosition,economicsFixture);
const netLossAlert=settlementAlert(netLossPosition,
  marketContextLines(netLossPosition,[netLossPosition]),
  "PigsWallet",now2,"https://polymarket.com/event/sample-2026-market",
  {net:netLoss});
assert(Math.abs(netLoss.net+82.5)<EPS2 &&
  netLossAlert.title.startsWith("🔴 LOSS · PigsWallet · -$82.50") &&
  netLossAlert.desp.includes("该剩余仓位预计净收益") &&
  netLossAlert.desp.includes("-$82.50"),
  "LOSS uses same fee-inclusive basis and reports remaining net loss");
const ambiguousTrade=tradeAlert(fillA,position2,marketContextLines(position2,[position2]),
  "ChrisZyy",marketLink,{reconciliationAttempted:true});
assert(ambiguousTrade.title.startsWith("🟢 BUY")&&
  ambiguousTrade.desp.includes("暂不能与本轮成交一一对应"),
  "unsynced positions keep a generic BUY instead of false OPEN/ADD");
assert(settlementNet(settlementPosition,{...economicsFixture,current_size:99})===null,
  "indexing drift makes settlement net unavailable instead of using stale basis");
assert(settlementNet(settlementPosition,{...economicsFixture,total_cost_usdc:null,
  entry_cost_usdc:null,entry_fees_usdc:null})===null,
  "missing gross cost never treated as zero");
const unavailable=settlementAlert(settlementPosition,marketContextLines(settlementPosition,[settlementPosition]),
  "ChrisZyy",now2,"https://polymarket.com/event/sample-2026-market");
assert(unavailable.desp.includes("暂无法核实")&&unavailable.desp.includes("估算毛盈亏"),
  "v2 outage never mislabels legacy estimate as net profit");

let v2NetCalls=0;
const netMock=async url=>{
  v2NetCalls++;
  const u=new URL(url);
  assert(u.pathname==="/v2/positions"&&u.searchParams.get("status")==="REDEEMABLE" &&
    u.searchParams.get("user")===env.WALLET_ADDRESS,"net request uses exact wallet redeemable cohort");
  return {ok:true,json:async()=>({data:[economicsFixture],
    pagination:{next_cursor:null,has_more:false}})};
};
const netMap=await readRedeemableEconomics(netMock,env.WALLET_ADDRESS);
assert(v2NetCalls===1&&Math.abs(settlementNet(settlementPosition,
  netMap.get(position2.asset)).net-17.5)<EPS2,"economics collection only one v2 request");

// Simulate real per-wallet transition through initialized DO snapshots and original outbox.
const lifecycleDB=new Map(),lifecycleSent=[];
const lifecycleStorage={
  get:async key=>structuredClone(lifecycleDB.get(key)),
  put:async(key,value)=>{lifecycleDB.set(key,structuredClone(value))}
};
const lifecycleEnv={WALLET_ADDRESS:env.WALLET_ADDRESS,MIN_POSITION_USD:"5",
  PUSH_URL:env.PUSH_URL,V2_SHADOW_ENABLED:"false"};
let positionsNow=[],activityNow=[];
const lifecycleFetcher=async(url,init)=>{
  const addr=String(url);
  if(addr.includes("push.ft07.com")){
    lifecycleSent.push(JSON.parse(init.body));
    return {ok:true,json:async()=>({code:0})};
  }
  if(addr.includes("polygon-bor-rpc.publicnode.com"))
    return {ok:true,json:async()=>({result:"0x0"})};
  if(addr.includes("/v2/positions?"))
    return {ok:true,json:async()=>({
      data:[{...economicsFixture,current_size:positionsNow[0]?.size||100,
        total_cost_usdc:positionsNow[0]?.size===50 ? 41.25 : 82.5}],
      pagination:{next_cursor:null,has_more:false}})};
  return {ok:true,json:async()=>addr.includes("/positions?")?positionsNow:activityNow};
};
const fillAt=(tx,side,size,cost,ts)=>({
  type:"TRADE",transactionHash:tx,asset:position2.asset,conditionId:position2.conditionId,
  title:position2.title,eventSlug:position2.eventSlug,outcome:"Yes",side,
  size,usdcSize:cost,price:cost/size,timestamp:ts
});
let clock=now2;
// Start from empty holdings.
await poll(lifecycleStorage,lifecycleEnv,lifecycleFetcher,clock);
assert(lifecycleDB.get("monitor").positionSnapshots!=null,
  "new wallet initializes complete positive-balance snapshot");
// Open with 100 shares.
clock+=300;positionsNow=[{...position2}];
activityNow.push(fillAt("open-tx","BUY",100,80,clock-12));
await poll(lifecycleStorage,lifecycleEnv,lifecycleFetcher,clock);
assert(lifecycleSent.at(-1).title.startsWith("🆕 OPEN"),"opening trade is classified in real poll");
assert(lifecycleSent.at(-1).desp.includes("预估 APR"),"real opening push includes APR");
// Add 50 shares.
clock+=300;positionsNow=[{...position2,size:150,avgPrice:.82,initialValue:123,currentValue:123}];
activityNow.push(fillAt("add-tx","BUY",50,43,clock-12));
await poll(lifecycleStorage,lifecycleEnv,lifecycleFetcher,clock);
assert(lifecycleSent.at(-1).title.startsWith("📈 ADD") &&
  lifecycleSent.at(-1).desp.includes("100 份 → **150 份**"),
  "real poll sends ADD with before-after holding shares");
// Reduce 50 shares.
clock+=300;positionsNow=[{...position2,size:100,avgPrice:.82,initialValue:82,currentValue:82}];
activityNow.push(fillAt("trim-tx","SELL",50,43,clock-12));
await poll(lifecycleStorage,lifecycleEnv,lifecycleFetcher,clock);
assert(lifecycleSent.at(-1).title.startsWith("📉 TRIM"),"real poll sends TRIM");
// Exit all.
clock+=300;positionsNow=[];
activityNow.push(fillAt("exit-tx","SELL",100,81,clock-12));
await poll(lifecycleStorage,lifecycleEnv,lifecycleFetcher,clock);
assert(lifecycleSent.at(-1).title.startsWith("🚪 EXIT") &&
  lifecycleSent.at(-1).desp.includes("0 份（已确认清仓）") &&
  lifecycleDB.get("monitor").positionSnapshots[position2.asset]===undefined,
  "real poll sends EXIT and clears snapshot without wiping checkpoint");

// Seed separate wallet with positive open holding and test PARTIAL -> WIN.
const settlesDB=new Map(), settleSent=[];
const settleStorage={
  get:async k=>structuredClone(settlesDB.get(k)),
  put:async(k,v)=>{settlesDB.set(k,structuredClone(v))}
};
let settledNow=[{...position2}],settledEvents=[];
const settlesFetcher=async(url,init)=>{
  const str=String(url);
  if(str.includes("push.ft07.com")){
    settleSent.push(JSON.parse(init.body));
    return {ok:true,json:async()=>({code:0})};
  }
  if(str.includes("polygon-bor-rpc.publicnode.com"))
    return {ok:true,json:async()=>({result:"0x0"})};
  if(str.includes("/v2/positions?"))
    return {ok:true,json:async()=>({data:[economicsFixture],
      pagination:{has_more:false,next_cursor:null}})};
  return {ok:true,json:async()=>str.includes("/positions?")?settledNow:settledEvents};
};
await poll(settleStorage,lifecycleEnv,settlesFetcher,now2);
settledNow=[{...position2,redeemable:true,curPrice:0.5}];
await poll(settleStorage,lifecycleEnv,settlesFetcher,now2+300);
assert(settleSent.length===1&&settleSent[0].title.startsWith("🟣 PARTIAL") &&
  settleSent[0].desp.includes("预计净收益")&&settleSent[0].desp.includes("-$32.50"),
  "real settlement uses v2 net once, even for PARTIAL");
settledNow=[{...position2,redeemable:true,curPrice:1}];
await poll(settleStorage,lifecycleEnv,settlesFetcher,now2+600);
assert(settleSent.length===2&&settleSent[1].title.startsWith("🏆 WIN") &&
  settleSent[1].desp.includes("+$17.50"),
  "PARTIAL -> WIN status transition emits new correctly netted alert");
await poll(settleStorage,lifecycleEnv,settlesFetcher,now2+900);
assert(settleSent.length===2,"stable settled position is not double-notified");
console.log("Passed: real OPEN/ADD/TRIM/EXIT, full-win ROI/APR, fee-inclusive net WIN/PARTIAL and no replay");


// Compatibility with migrated Durable Objects: never invent OPEN on first upgraded
// poll, and never duplicate existing WIN/LOSS that was alerted by the old status enum.
const legacyWalletState=structuredClone(lifecycleDB.get("monitor"));
delete legacyWalletState.positionSnapshots;
const migrateDB=new Map([["monitor",legacyWalletState]]);
const migrateStorage={
  get:async key=>structuredClone(migrateDB.get(key)),
  put:async(key,value)=>{migrateDB.set(key,structuredClone(value))}
};
positionsNow=[{...position2,size:15,avgPrice:0.85,currentValue:12.75,initialValue:12.75}];
activityNow.push(fillAt("migration-buy","BUY",15,12.75,clock+290));
const oldSentCount=lifecycleSent.length;
await poll(migrateStorage,lifecycleEnv,lifecycleFetcher,clock+300);
assert(lifecycleSent.length===oldSentCount+1 &&
  lifecycleSent.at(-1).title.startsWith("🟢 BUY") &&
  migrateDB.get("monitor").positionSnapshots[position2.asset].size===15,
  "legacy checkpoint seeds a snapshot without an incorrect OPEN label");
const prevResolved=structuredClone(settlesDB.get("monitor"));
delete prevResolved.positions[position2.asset].resolutionKind;
prevResolved.positions[position2.asset].status="redeemable";
settlesDB.set("monitor",prevResolved);
await poll(settleStorage,lifecycleEnv,settlesFetcher,now2+1200);
assert(settleSent.length===2 &&
  settlesDB.get("monitor").positions[position2.asset].resolutionKind==="WIN",
  "old redeemable status is migrated without replaying settlement");
console.log("Passed: migrated snapshots do not invent OPEN and legacy settlement is not replayed");


// External-only availability watchdog: /health is a privacy-preserving aggregate.
// It needs no MONITOR_SECRET and never starts a poll or exposes wallet addresses.
const hsNow=12345678;
assert(HEALTH_STALE_SECONDS===1200, "20-minute failure threshold for five-minute Cron");
assert(healthSummary([{ok:true,initialized:true,lastSuccessAt:hsNow-300}],
  hsNow).ok, "recently polled wallet healthy");
assert(!healthSummary([{ok:true,initialized:true,lastSuccessAt:hsNow-1300}],
  hsNow).ok, "stale wallet fails");
assert(!healthSummary([
  {ok:true,initialized:true,lastSuccessAt:hsNow-50},
  {ok:false,initialized:true,lastSuccessAt:hsNow-10}
],hsNow).ok,"one failed wallet makes aggregate status fail");
assert(!healthSummary([{ok:true,initialized:false,lastSuccessAt:null}],hsNow).ok,
  "uninitialized DO fails health");
assert(!healthSummary([],hsNow).ok,"zero wallets never healthy");
assert(!healthSummary([{ok:true,initialized:true,lastSuccessAt:hsNow+800}],hsNow).ok,
  "invalid future timestamp does not produce fake freshness");
let internalHealthReads=0;
const healthMockBase=Math.floor(Date.now()/1000);
const healthMock={
  idFromName: address=>address,
  get: address=>({
    fetch:async(request)=>{
      assert(new URL(String(request)).pathname==="/health","health never initiates polling");
      internalHealthReads++;
      return Response.json({
        ok:true,initialized:true,
        lastSuccessAt:healthMockBase-240
      });
    }
  })
};
const healthEnv={WALLET_ADDRESSES:originals.join(","),MONITOR:healthMock};
const publicHealthResponse=await worker.fetch(
  new Request("https://example.com/health"),healthEnv);
const healthBody=await publicHealthResponse.json();
assert(publicHealthResponse.status===200 && healthBody.ok===true &&
  healthBody.checked===3 && internalHealthReads===3,
  "anonymous GET /health returns only aggregate freshness without authorization");
assert(publicHealthResponse.headers.get("cache-control")==="no-store",
  "health response cannot be publicly cached");
assert(!JSON.stringify(healthBody).includes("0x") &&
  !JSON.stringify(healthBody).includes("lastSuccessAt") &&
  !JSON.stringify(healthBody).includes("push"),
  "public health never reveals wallets, checkpoint, push details or secrets");
const unauthorizedProtected=await worker.fetch(
  new Request("https://example.com/status"),healthEnv);
assert(unauthorizedProtected.status===401,"full authenticated /status remains protected");
const staleHealthEnv={...healthEnv,MONITOR:{
  idFromName:v=>v,
  get:v=>({fetch:async()=>Response.json({
    ok:true,initialized:true,lastSuccessAt:healthMockBase-2200
  })})
}};
const staleResult=await worker.fetch(
  new Request("https://example.com/health"),staleHealthEnv);
assert(staleResult.status===503 && (await staleResult.json()).ok===false,
  "stale data returns HTTP 503 for independent external watchdog");
const noWalletHealth=await worker.fetch(
  new Request("https://example.com/health"),{WALLET_ADDRESSES:"",MONITOR:healthMock});
assert(noWalletHealth.status===503,"invalid monitor configuration is never healthy");
const objectHealth=await new WalletMonitor({storage},env).fetch(
  new Request("https://internal/health?wallet="+env.WALLET_ADDRESS));
assert(objectHealth.status===200 && (await objectHealth.json()).initialized===true,
  "internal DO health reads current stored checkpoint without altering it");
console.log("Passed: independent /health fresh/stale, no secrets or wallet leakage, status auth preserved");
