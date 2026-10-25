import { tradeAlert, settlementAlert, settlementKind, walletPusdBalance } from "./notification.mjs";
import { snapshotHoldings, positionAction, winningPayoutForecast } from "./position-lifecycle.mjs";
import { readRedeemableEconomics, settlementNet } from "./settlement-economics.mjs";
import { mergeTradeFills } from "./trade-batch.mjs";
import { drainOutbox } from "./outbox.mjs";
import { dataApiJson } from "./data-client.mjs";
import { primaryV2Positions, primaryV2Activity,
  legacyActivityIdentities, cutoverIdentity } from "./data-api-v2-primary.mjs";
import { compareV2Positions } from "./v2-shadow.mjs";
import { summarizeWalletPositions } from "./asset-digest.mjs";
import { findRedeemReminders, redemptionReminder } from "./redeem-reminders.mjs";
import { inspectPriceRisk, priceRiskMessage } from "./price-risk.mjs";
import { inspectLowApy, lowApyMessage } from "./low-apy.mjs";
const API = "https://data-api.polymarket.com";
const PAGE = 500;
const OVERLAP = 60 * 60; // 60-minute late-indexing overlap for five-minute polling

export function activityKey(a) {
  // A transaction may contain several outcomes and fills. Never dedupe by tx alone.
  return JSON.stringify([a.transactionHash, a.type, a.asset, a.conditionId,
    a.outcomeIndex, a.side, a.timestamp, a.size, a.usdcSize, a.price]);
}

export function positionStatus(p) {
  if (p.redeemable !== true) return "open";
  if (!knownNumber(p.curPrice)) return "unknown";
  if (Number(p.curPrice) === 0) return "lost";
  if (Number(p.curPrice) > 0) return "redeemable";
  return "unknown";
}

const usd = n => "$" + Number(n || 0).toFixed(2);
const label = p => (p.title || p.conditionId || "未知市场") + " / " + (p.outcome || "");
const link = p => p.eventSlug ? "https://polymarket.com/event/" + encodeURIComponent(p.eventSlug) : "";
const num = n => Number.isFinite(Number(n)) ? Number(n) : 0;

// Display names only: the normalized address remains the Durable Object ID.
const WALLET_LABELS = {
  "0x9f7eb5bc88342f01d18754be0439fad79ec282ce": "PigsWallet",
  "0x052f4191cd324a348835a846d34df5b0061e53fb": "ChrisZyy",
  "0x24816c037cdc2c9bd979e69d777541cf560a9b79": "RealChris"
};
export function walletLabel(address) {
  const raw = String(address || "").trim();
  return WALLET_LABELS[raw.toLowerCase()] || raw;
}
const knownNumber = value => value !== undefined && value !== null &&
  value !== "" && Number.isFinite(Number(value));
const shares = value => Number(value).toLocaleString("en-US", { maximumFractionDigits: 8 });
const price = value => "$" + Number(value).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");

export function expectedEnd(raw) {
  if (typeof raw !== "string") return "暂无数据";
  const text = raw.trim();
  if (!text || text.startsWith("1970-01-01") || text.startsWith("0000-00-00")) return "暂无数据";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text + "（仅提供日期）";
  const time = Date.parse(text);
  if (!Number.isFinite(time)) return "暂无数据";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).format(new Date(time)) + "（北京时间）";
}

function matchingPosition(item, positions) {
  // Outcome-token ID is the primary key; never mix holdings of unrelated outcomes.
  const token = item.asset ?? item.tokenId ?? item.token_id;
  if (token !== undefined && token !== null) {
    const exact = positions.find(p => p.asset != null && String(p.asset) === String(token));
    if (exact) return exact;
  }
  const condition = item.conditionId ?? item.condition_id;
  if (!condition) return null;
  const group = positions.filter(p =>
    String(p.conditionId ?? p.condition_id ?? "").toLowerCase() === String(condition).toLowerCase());
  if (item.outcomeIndex !== undefined && item.outcomeIndex !== null) {
    const byIndex = group.filter(p => Number(p.outcomeIndex) === Number(item.outcomeIndex));
    if (byIndex.length === 1) return byIndex[0];
  }
  if (item.outcome) {
    const byOutcome = group.filter(p =>
      String(p.outcome || "").toLowerCase() === String(item.outcome).toLowerCase());
    if (byOutcome.length === 1) return byOutcome[0];
  }
  // Do not substitute the opposite outcome after a full sell-off.
  return token == null && group.length === 1 ? group[0] : null;
}

export function marketContextLines(item, positions) {
  const holding = matchingPosition(item, positions);
  const end = holding?.endDate ?? holding?.end_date ?? item.endDate ?? item.end_date;
  const qty = holding && knownNumber(holding.size)
    ? shares(holding.size) + " 份" : "暂无数据（可能已清仓或尚未同步）";
  const currentValue = holding && knownNumber(holding.currentValue)
    ? usd(holding.currentValue) : "暂无数据";
  const avg = holding && knownNumber(holding.avgPrice) ? price(holding.avgPrice) + " / 份" : "暂无数据";
  return [
    "预计结束：" + expectedEnd(end) + "（仅供参考，实际以市场规则与结算为准）",
    "当前该选项总持仓：" + qty,
    "当前持仓市值：" + currentValue,
    "买入均价：" + avg
  ];
}

// Strip old queued explorer links as well; never send a Polygonscan tx URL.
function removeTransactionUrl(body) {
  return String(body || "").split("\n\n").filter(line =>
    !/^交易\s*[:：]\s*https?:\/\/(?:www\.)?polygonscan\.com\/tx\//i.test(line.trim())
  ).join("\n\n");
}

function newAudit(now) {
  return {
    auditSince: now,
    alertsDetectedCount: 0,
    lastAlertAt: null,
    lastAlertType: null,
    pushCount: 0,
    lastPushAt: null,
    lastPushType: null,
    lastPushAttemptAt: null,
    pushFailureCount: 0,
    lastPushErrorAt: null,
    lastPushError: null,
    lastPollAt: null,
    lastPollAlerts: 0,
    lastPollAccepted: 0,
    consecutivePollFailures: 0,
    lastPollFailureAt: null,
    lastPollError: null,
    healthAlarmActive: false,
    shadowV2LastAttemptAt: null,
    shadowV2LastSuccessAt: null,
    shadowV2LastError: null,
    shadowV2Report: null
  };
}

export function auditSnapshot(state) {
  const a = state?.audit || {};
  return {
    auditSince: a.auditSince ?? null,
    alertsDetectedCount: a.alertsDetectedCount ?? 0,
    lastAlertAt: a.lastAlertAt ?? null,
    lastAlertType: a.lastAlertType ?? null,
    pushCount: a.pushCount ?? 0,
    lastPushAt: a.lastPushAt ?? null,
    lastPushType: a.lastPushType ?? null,
    lastPushAttemptAt: a.lastPushAttemptAt ?? null,
    pushFailureCount: a.pushFailureCount ?? 0,
    lastPushErrorAt: a.lastPushErrorAt ?? null,
    lastPushError: a.lastPushError ?? null,
    lastPollAt: a.lastPollAt ?? null,
    lastPollAlerts: a.lastPollAlerts ?? 0,
    lastPollAccepted: a.lastPollAccepted ?? 0,
    consecutivePollFailures: a.consecutivePollFailures ?? 0,
    lastPollFailureAt: a.lastPollFailureAt ?? null,
    lastPollError: a.lastPollError ?? null,
    healthAlarmActive: a.healthAlarmActive ?? false,
    shadowV2LastAttemptAt: a.shadowV2LastAttemptAt ?? null,
    shadowV2LastSuccessAt: a.shadowV2LastSuccessAt ?? null,
    shadowV2LastError: a.shadowV2LastError ?? null,
    shadowV2Report: a.shadowV2Report ?? null
  };
}

const alertType = title => String(title || "unknown").replace(/^Polymarket\s*\u00b7\s*/, "").slice(0, 64);
const auditLog = (event, wallet, details) => console.info(event, JSON.stringify({ wallet, ...details }));
function safePushError(error) {
  const message = String(error?.message || "");
  return /^(HTTP [1-5][0-9]{2} from [a-zA-Z0-9.-]+|ServerChan rejected notification|PUSH_URL secret is required|PUSH_URL must be a ServerChan3 HTTPS endpoint)$/.test(message)
    ? message : "Push failed (details withheld)";
}

async function json(fetcher, url, init) {
  const r = await fetcher(url, { ...init, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error("HTTP " + r.status + " from " + new URL(url).hostname);
  return r.json();
}

async function pages(fetcher, path, params, cap) {
  const rows = [];
  for (let offset = 0; offset <= cap; offset += PAGE) {
    const q = new URLSearchParams({ ...params, offset: String(offset), limit: String(PAGE) });
    const page = await dataApiJson(fetcher, API + path + "?" + q);
    if (!Array.isArray(page)) throw new Error("Invalid Data API response: " + path);
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
  // Do not advance a checkpoint after truncating a feed.
  throw new Error("Pagination cap reached: " + path + "; split the time window before continuing");
}

export async function push(env, fetcher, title, desp, short) {
  if (!env.PUSH_URL) throw new Error("PUSH_URL secret is required");
  const url = new URL(env.PUSH_URL);
  if (url.protocol !== "https:" || !/^\d+\.push\.ft07\.com$/.test(url.hostname)) {
    throw new Error("PUSH_URL must be a ServerChan3 HTTPS endpoint");
  }
  const result = await json(fetcher, url.href, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, desp, tags: "Polymarket", ...(short ? { short } : {}) }),
    redirect: "manual",
  });
  if (result.code !== 0 && result.data?.error !== "SUCCESS") {
    throw new Error("ServerChan rejected notification");
  }
}


export async function deliverPending(storage, env, fetcher = fetch,
  now = Math.floor(Date.now() / 1000), origin = "poll") {
  let cash;
  return drainOutbox(storage, now, async (item, user) => {
    // Consolidated daily reports already contain per-wallet pUSD balances.
    // Never append the legacy individual-wallet footer or query a fake wallet ID.
    if (item.skipBalanceFooter === true) {
      await push(env, fetcher, item.title, item.desp, item.short);
      return;
    }
    const base = item.formatVersion === 2 ? item.desp :
      "钱包：" + walletLabel(user) + "\n\n" + removeTransactionUrl(item.desp);
    if (cash === undefined) cash = await walletPusdBalance(fetcher, user);
    const footer = "\n\n---\n\n**💳 钱包余额（链上 pUSD）：" +
      (cash == null ? "暂时无法获取" : cash) +
      "**\n\n> 未扣除挂单占用，不等于可下单 Available balance。";
    await push(env, fetcher, item.title, base + footer, item.short);
  }, { origin });
}


function safePollError(error) {
  const message = String(error?.message || "");
  return /^(HTTP [1-5][0-9]{2} from data-api\.polymarket\.com|Network\/timeout error from data-api\.polymarket\.com|Pagination cap reached: .*?)$/.test(message)
    ? message.slice(0, 160) : "Polymarket query failed (details withheld)";
}

// Record failures separately from healthy data checkpoints.
// After 3 consecutive failed 5-minute rounds, enqueue one health warning.
// Successful polling enqueues a single recovery notice.
export async function recordPollFailure(storage, env, fetcher = fetch,
  now = Math.floor(Date.now() / 1000), error = null) {
  const state = await storage.get("monitor");
  if (!state) return { alerted: false, failures: 0 };
  state.audit ??= newAudit(now);
  state.audit.consecutivePollFailures = (state.audit.consecutivePollFailures || 0) + 1;
  state.audit.lastPollFailureAt = now;
  state.audit.lastPollError = safePollError(error);
  const failures = state.audit.consecutivePollFailures;
  let alerted = false;
  if (failures >= 3 && !state.audit.healthAlarmActive) {
    alerted = true;
    state.audit.healthAlarmActive = true;
    state.pending ??= [];
    state.pending.push({
      formatVersion: 2,
      title: "⚠️ MONITOR · " + walletLabel(state.user),
      short: "连续 " + failures + " 次轮询失败；检查 Data API 与 Cloudflare 日志",
      desp: [
        "### ⚠️ 钱包监控异常",
        "**账户：** " + walletLabel(state.user),
        "**连续失败：** " + failures + " 次（5分钟轮询）",
        "**最后成功时间：** " + (state.lastSuccessAt
          ? new Date(state.lastSuccessAt * 1000).toLocaleString("zh-CN", {timeZone:"Asia/Shanghai"})
          : "暂无"),
        "**错误：** " + state.audit.lastPollError,
        "",
        "> 系统会继续轮询，恢复后自动发送恢复通知。"
      ].join("\n")
    });
    state.audit.alertsDetectedCount = (state.audit.alertsDetectedCount || 0) + 1;
    state.audit.lastAlertAt = now;
    state.audit.lastAlertType = "MONITOR_UNHEALTHY";
  }
  await storage.put("monitor", state);
  auditLog("wallet_poll_failure", state.user,
    {at: now, failures, error: state.audit.lastPollError, alerted});
  if (alerted) await deliverPending(storage, env, fetcher, now, "alarm");
  return { alerted, failures };
}


export async function auditV2Shadow(storage, env, fetcher, user, v1Positions, now) {
  if (String(env.DATA_API_PRIMARY || "v1") === "v2") return { skipped: "primary_v2" };
  if (String(env.V2_SHADOW_ENABLED || "false") !== "true") return { skipped: "disabled" };
  const state = await storage.get("monitor");
  if (!state || Number(state.shadowV2AttemptAt || 0) > now - 6 * 3600)
    return { skipped: "interval" };
  state.shadowV2AttemptAt = now;
  state.audit ??= newAudit(now);
  state.audit.shadowV2LastAttemptAt = now;
  await storage.put("monitor", state);
  try {
    const result = await compareV2Positions(fetcher, user, v1Positions);
    const updated = await storage.get("monitor");
    updated.audit ??= newAudit(now);
    updated.audit.shadowV2LastSuccessAt = now;
    updated.audit.shadowV2LastError = null;
    updated.audit.shadowV2Report = result;
    await storage.put("monitor", updated);
    auditLog("wallet_v2_shadow_success", user, { at: now, ...result });
    return { ok: true, ...result };
  } catch (error) {
    const updated = await storage.get("monitor");
    updated.audit ??= newAudit(now);
    updated.audit.shadowV2LastError = "Read-only v2 comparison unavailable";
    await storage.put("monitor", updated);
    auditLog("wallet_v2_shadow_failed", user, { at: now, reason: "v2_comparison_unavailable" });
    return { ok: false };
  }
}

export async function poll(storage, env, fetcher = fetch, now = Math.floor(Date.now() / 1000), walletAddress = env.WALLET_ADDRESS) {
  const user = (walletAddress || "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(user)) throw new Error("Invalid WALLET_ADDRESS");
  if (!env.PUSH_URL) throw new Error("PUSH_URL secret is required");
  const apiVersion = String(env.DATA_API_PRIMARY || "v1");
  if (!["v1","v2"].includes(apiVersion)) throw new Error("Invalid DATA_API_PRIMARY");
  const useV2 = apiVersion === "v2";
  const minimum = Number(env.MIN_POSITION_USD ?? 5);
  if (!Number.isFinite(minimum) || minimum < 0) throw new Error("Invalid MIN_POSITION_USD");
  let state = await storage.get("monitor");
  if (state && state.user !== user) throw new Error("Wallet changed: use a new Durable Object instance");
  // Existing wallets retain their checkpoints and queues; only audit fields are new.
  if (state) {
    state.audit ??= newAudit(now);
    state.audit.lastPollAccepted = 0;
  }
  const positions = useV2 ? await primaryV2Positions(fetcher, user) :
    await pages(fetcher, "/positions", {
      user, sizeThreshold: "0", includeArchived: "true", sortBy: "TOKENS", sortDirection: "DESC"
    }, 10000);
  if (!state) {
    const tracked = {};
    for (const p of positions) {
      const exposure = Math.max(num(p.currentValue), num(p.initialValue),
        num(p.grossInitialValue), num(p.size) * num(p.avgPrice));
      if (num(p.size) > 0 && exposure >= minimum) tracked[p.asset] = {
        status: positionStatus(p), exposure, conditionId: p.conditionId, outcome: p.outcome
      };
    }
    state = { user, startedAt: now, checkpoint: now, dataApiPrimary: apiVersion,
      positions: tracked,
      positionSnapshots: snapshotHoldings(positions),
      dailySnapshot: summarizeWalletPositions(positions,now),
      redeemTrackers: findRedeemReminders(positions,null,now).trackers,
      priceRiskTrackers: inspectPriceRisk(positions,null,now).trackers,
      lowApyState: { lastCheckedAt: now, tokens: {} },
      seen: {}, pending: [],
      lastSuccessAt: now, audit: { ...newAudit(now), lastPollAt: now } };
    await storage.put("monitor", state);
    auditLog("wallet_poll_success", user, { at: now, initialized: true,
      positions: Object.keys(tracked).length, alertsDetected: 0, pushesAccepted: 0, pending: 0 });
    return { initialized: true, positions: Object.keys(tracked).length, alerts: 0, pushesAccepted: 0 };
  }
  // Unknown before snapshots (legacy wallets) deliberately suppress classification
  // for this first upgraded poll. Existing checkpoints and sent notifications stay intact.
  const previousSnapshots = state.positionSnapshots ?? null;
  const currentSnapshots = snapshotHoldings(positions);
  const since = Math.max(state.startedAt, state.checkpoint - OVERLAP);
  const activity = useV2 ? await primaryV2Activity(fetcher, user, since) :
    await pages(fetcher, "/activity", {
      user, type: "TRADE,REDEEM", start: String(since),
      end: String(now), sortBy: "TIMESTAMP", sortDirection: "ASC"
    }, 5000);
  const migration = useV2 && state.dataApiPrimary !== "v2";
  const legacyIdentities = migration ? legacyActivityIdentities(state.seen) : null;
  let bridgedActivities = 0;
  const newEvents = [];
  const seen = { ...state.seen };
  for (const a of activity) {
    const key = activityKey(a);
    if (seen[key] !== undefined || num(a.timestamp) < state.startedAt) continue;
    // Suppress old v1 activities already notified before the API cutover.
    // Stable tx/token/side/timestamp/size match survives fee/amount rounding.
    if (legacyIdentities?.has(cutoverIdentity(a))) {
      seen[key] = num(a.timestamp);
      bridgedActivities++;
      continue;
    }
    seen[key] = num(a.timestamp);
    if (!["TRADE", "REDEEM"].includes(a.type)) continue;
    // Trade alerts have no value floor: a large order can fill in tiny pieces.
    const holding = matchingPosition(a, positions);
    const market = { ...holding, ...a, title: a.title || holding?.title,
      outcome: a.outcome || holding?.outcome,
      eventSlug: a.eventSlug || holding?.eventSlug,
      endDate: holding?.endDate ?? a.endDate };
    newEvents.push(market);
  }
  const mergedTrades = mergeTradeFills(newEvents);
  const pending = mergedTrades.map(a => {
    const holding = matchingPosition(a, positions);
    const lifecycle = positionAction(a, mergedTrades, previousSnapshots, currentSnapshots);
    const forecast = a.type === "TRADE" && a.side === "BUY" && holding
      ? winningPayoutForecast(holding, now) : null;
    return tradeAlert(a, a, marketContextLines(a, positions),
      walletLabel(user), link(a), { lifecycle, forecast, reconciliationAttempted: previousSnapshots !== null });
  });
  const recovering = Boolean(state.audit.healthAlarmActive);
  if (recovering) {
    pending.push({
      formatVersion: 2,
      title: "✅ MONITOR 恢复 · " + walletLabel(user),
      short: "钱包监控已恢复正常，交易数据检查点保持连续",
      desp: "### ✅ 钱包监控恢复\n\n**账户：** " + walletLabel(user) +
        "\n\n**北京时间：** " + new Date(now * 1000).toLocaleString("zh-CN", {timeZone:"Asia/Shanghai"}) +
        "\n\n> 已恢复正常查询，历史活动仍通过重叠窗口补查。"
    });
  }
  state.audit.consecutivePollFailures = 0;
  state.audit.healthAlarmActive = false;
  const tracked = { ...state.positions };
  const settlementCandidates = [];
  for (const p of positions) {
    if (!p.asset || num(p.size) <= 0) continue;
    const before = tracked[p.asset];
    // Keep cost/prior exposure: a losing position's current value is zero.
    const exposure = Math.max(num(p.currentValue), num(p.initialValue),
      num(p.grossInitialValue), num(p.size) * num(p.avgPrice), num(before?.exposure));
    if (exposure < minimum) continue;
    const status = positionStatus(p);
    const resolutionKind = settlementKind(p);
    // Previously stored states lacked the precise kind; do not replay old
    // WIN/PARTIAL/LOSS alerts while migrating. New PARTIAL -> WIN transitions do alert.
    const lastResolution = before?.resolutionKind ??
      (before?.status === "lost" ? "LOSS" :
        before?.status === "redeemable" ? resolutionKind : null);
    if (resolutionKind && lastResolution !== resolutionKind)
      settlementCandidates.push(p);
    tracked[p.asset] = { status, resolutionKind, exposure,
      conditionId: p.conditionId, outcome: p.outcome };
  }
  if (settlementCandidates.length) {
    let economicsByToken = null;
    try {
      economicsByToken = await readRedeemableEconomics(fetcher, user);
    } catch {
      // Never block actual settlement notifications when v2 economics is late.
      auditLog("wallet_settlement_net_unavailable", user,
        { at: now, count: settlementCandidates.length });
    }
    for (const p of settlementCandidates) {
      const net = settlementNet(p, economicsByToken?.get(String(p.asset)));
      const item = settlementAlert(p, marketContextLines(p, positions),
        walletLabel(user), now, link(p), { net });
      if (item) pending.push(item);
    }
  }
  // Both rule engines are stateful and noise-conscious. First upgraded poll only
  // seeds baselines; old open/redeemable holdings must not flood notifications.
  const reminders = findRedeemReminders(positions,state.redeemTrackers,now,{
    delayHours:Number(env.REDEEM_DELAY_HOURS??6),
    cooldownHours:Number(env.REDEEM_COOLDOWN_HOURS??24),
    minUsd:Number(env.MIN_REDEEM_USD??5)
  });
  if(String(env.REDEEM_REMINDER_ENABLED??"false")==="true"){
    const item = redemptionReminder(walletLabel(user),reminders.due,now);
    if(item)pending.push(item);
  }
  const risks = inspectPriceRisk(positions, migration ? null : state.priceRiskTrackers, now,{
    floor:Number(env.PRICE_ALERT_FLOOR??0.90),
    drawdownPct:Number(env.COST_DRAWDOWN_PCT??5),
    rapidPoints:Number(env.RAPID_DROP_POINTS??0.05),
    cooldownHours:Number(env.RISK_COOLDOWN_HOURS??24),
    minUsd:minimum
  });
  if(String(env.RISK_ALERT_ENABLED??"true")==="true"){
    const item = priceRiskMessage(walletLabel(user),risks.raised,now);
    if(item)pending.push(item);
  }
  const lowApyEnabled = String(env.LOW_APY_ALERT_ENABLED??"false")==="true";
  const lowApy = lowApyEnabled
    ? await inspectLowApy(positions, state.lowApyState, now, fetcher, {
      thresholdPct:Number(env.LOW_APY_THRESHOLD_PCT??10),
      recoverPct:Number(env.LOW_APY_RECOVER_PCT??12),
      cooldownHours:Number(env.LOW_APY_COOLDOWN_HOURS??24),
      checkMinutes:Number(env.LOW_APY_CHECK_MINUTES??30),
      minUsd:minimum
    })
    : { state: state.lowApyState ?? null, raised: [], skipped: "disabled", checked: 0, errors: 0 };
  if(lowApyEnabled){
    const item = lowApyMessage(walletLabel(user), lowApy.raised,
      Number(env.LOW_APY_THRESHOLD_PCT??10), now);
    if(item)pending.push(item);
  }
  const dailySnapshot = summarizeWalletPositions(positions,now);
  for (const key of Object.keys(seen)) {
    if (seen[key] < now - OVERLAP) delete seen[key];
  }
  // Persist both detection state and outbox before sending. A crash cannot lose an alert.
  const alertCount = pending.length;
  state = { ...state, checkpoint: now, dataApiPrimary: apiVersion,
    positions: tracked,
    positionSnapshots: currentSnapshots, seen,
    redeemTrackers: reminders.trackers,
    priceRiskTrackers: risks.trackers,
    lowApyState: lowApy.state,
    dailySnapshot,
    pending: [...(state.pending || []), ...pending], lastSuccessAt: now,
    audit: {
      ...state.audit,
      lastPollAt: now,
      lastPollAlerts: alertCount,
      lastPollAccepted: 0,
      alertsDetectedCount: state.audit.alertsDetectedCount + alertCount,
      lastAlertAt: alertCount ? now : state.audit.lastAlertAt,
      lastAlertType: alertCount ? alertType(pending[alertCount - 1].title) : state.audit.lastAlertType
    }
  };
  // Persist detection before sending so a process crash cannot erase alerts.
  await storage.put("monitor", state);
  if (migration) {
    auditLog("wallet_data_api_cutover", user,
      {at:now,version:apiVersion,bridgedActivities});
  }
  if (alertCount) {
    const types = {};
    for (const item of pending) {
      const type = alertType(item.title);
      types[type] = (types[type] || 0) + 1;
    }
    auditLog("wallet_alert_detected", user, { at: now, alerts: alertCount, types });
  }
  const delivery = await deliverPending(storage, env, fetcher, now, "poll");
  // Shadow reads never drive push events, PnL or legacy checkpoints.
  await auditV2Shadow(storage, env, fetcher, user, positions, now);
  auditLog("wallet_poll_success", user, { at: now, initialized: false,
    positions: positions.length, apiVersion, alertsDetected: alertCount, pushesAccepted: delivery.accepted,
    pending: delivery.pending, pushDeferred: delivery.failed });
  return { initialized: false, positions: positions.length,
    alerts: alertCount, pushesAccepted: delivery.accepted, pending: delivery.pending,
    deliveryDeferred: delivery.failed, checkedAt: now };
}
