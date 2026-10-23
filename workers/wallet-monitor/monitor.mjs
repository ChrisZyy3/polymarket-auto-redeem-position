import { tradeAlert, settlementAlert, walletPusdBalance } from "./notification.mjs";
const API = "https://data-api.polymarket.com";
const PAGE = 500;
const OVERLAP = 15 * 60;

export function activityKey(a) {
  // A transaction may contain several outcomes and fills. Never dedupe by tx alone.
  return JSON.stringify([a.transactionHash, a.type, a.asset, a.conditionId,
    a.outcomeIndex, a.side, a.timestamp, a.size, a.usdcSize, a.price]);
}

export function positionStatus(p) {
  if (p.redeemable !== true) return "open";
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
    lastPollAccepted: 0
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
    lastPollAccepted: a.lastPollAccepted ?? 0
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
    const page = await json(fetcher, API + path + "?" + q);
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

export async function poll(storage, env, fetcher = fetch, now = Math.floor(Date.now() / 1000), walletAddress = env.WALLET_ADDRESS) {
  const user = (walletAddress || "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(user)) throw new Error("Invalid WALLET_ADDRESS");
  if (!env.PUSH_URL) throw new Error("PUSH_URL secret is required");
  const minimum = Number(env.MIN_POSITION_USD ?? 5);
  if (!Number.isFinite(minimum) || minimum < 0) throw new Error("Invalid MIN_POSITION_USD");
  let state = await storage.get("monitor");
  if (state && state.user !== user) throw new Error("Wallet changed: use a new Durable Object instance");
  // Existing wallets retain their checkpoints and queues; only audit fields are new.
  if (state) {
    state.audit ??= newAudit(now);
    state.audit.lastPollAccepted = 0;
  }
  let pushedThisPoll = 0;
  let cashInfo; // one optional Polygon RPC read per round with notifications
  // Persist the outbox and per-wallet push receipt together.
  const flush = async () => {
    while (state.pending.length) {
      const item = state.pending[0];
      const type = alertType(item.title);
      state.audit.lastPushAttemptAt = now;
      await storage.put("monitor", state);
      auditLog("push_attempted", user, { at: now, type, pending: state.pending.length });
      try {
        const base = item.formatVersion === 2 ? item.desp :
          "钱包：" + walletLabel(user) + "\n\n" + removeTransactionUrl(item.desp);
        if (cashInfo === undefined) cashInfo = await walletPusdBalance(fetcher, user);
        const footer = "\n\n---\n\n**💳 钱包余额（链上 pUSD）：" +
          (cashInfo == null ? "暂时无法获取" : cashInfo) +
          "**\n\n> 未扣除挂单占用，不等于可下单 Available balance。";
        await push(env, fetcher, item.title, base + footer, item.short);
      } catch (error) {
        state.audit.pushFailureCount += 1;
        state.audit.lastPushErrorAt = now;
        state.audit.lastPushError = safePushError(error);
        await storage.put("monitor", state);
        auditLog("push_failed", user, { at: now, type, reason: state.audit.lastPushError });
        throw error;
      }
      state.pending.shift();
      state.audit.pushCount += 1;
      state.audit.lastPushAt = now;
      state.audit.lastPushType = type;
      state.audit.lastPollAccepted += 1;
      pushedThisPoll += 1;
      await storage.put("monitor", state);
      auditLog("push_accepted", user, { at: now, type, pushCount: state.audit.pushCount,
        pending: state.pending.length });
    }
  };
  if (state) await flush();
  const positions = await pages(fetcher, "/positions", {
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
    state = { user, startedAt: now, checkpoint: now, positions: tracked, seen: {}, pending: [],
      lastSuccessAt: now, audit: { ...newAudit(now), lastPollAt: now } };
    await storage.put("monitor", state);
    auditLog("wallet_poll_success", user, { at: now, initialized: true,
      positions: Object.keys(tracked).length, alertsDetected: 0, pushesAccepted: 0, pending: 0 });
    return { initialized: true, positions: Object.keys(tracked).length, alerts: 0, pushesAccepted: 0 };
  }
  const activity = await pages(fetcher, "/activity", {
    user, type: "TRADE,REDEEM", start: String(Math.max(state.startedAt, state.checkpoint - OVERLAP)),
    end: String(now), sortBy: "TIMESTAMP", sortDirection: "ASC"
  }, 5000);
  const pending = [];
  const seen = { ...state.seen };
  for (const a of activity) {
    const key = activityKey(a);
    if (seen[key] !== undefined || num(a.timestamp) < state.startedAt) continue;
    seen[key] = num(a.timestamp);
    if (!["TRADE", "REDEEM"].includes(a.type)) continue;
    // Trade alerts have no value floor: a large order can fill in tiny pieces.
    const holding = matchingPosition(a, positions);
    const market = { ...holding, ...a, title: a.title || holding?.title,
      outcome: a.outcome || holding?.outcome,
      eventSlug: a.eventSlug || holding?.eventSlug,
      endDate: holding?.endDate ?? a.endDate };
    pending.push(tradeAlert(a, market, marketContextLines(a, positions),
      walletLabel(user), link(market)));
  }
  const tracked = { ...state.positions };
  for (const p of positions) {
    if (!p.asset || num(p.size) <= 0) continue;
    const before = tracked[p.asset];
    // Keep cost/prior exposure: a losing position's current value is zero.
    const exposure = Math.max(num(p.currentValue), num(p.initialValue),
      num(p.grossInitialValue), num(p.size) * num(p.avgPrice), num(before?.exposure));
    if (exposure < minimum) continue;
    const status = positionStatus(p);
    if (["lost", "redeemable"].includes(status) && before?.status !== status) {
      const item = settlementAlert(p, marketContextLines(p, positions), walletLabel(user),
        now, link(p));
      if (item) pending.push(item);
    }
    tracked[p.asset] = { status, exposure, conditionId: p.conditionId, outcome: p.outcome };
  }
  for (const key of Object.keys(seen)) {
    if (seen[key] < now - OVERLAP) delete seen[key];
  }
  // Persist both detection state and outbox before sending. A crash cannot lose an alert.
  const alertCount = pending.length;
  state = { ...state, checkpoint: now, positions: tracked, seen, pending, lastSuccessAt: now,
    audit: {
      ...state.audit,
      lastPollAt: now,
      lastPollAlerts: alertCount,
      lastPollAccepted: pushedThisPoll,
      alertsDetectedCount: state.audit.alertsDetectedCount + alertCount,
      lastAlertAt: alertCount ? now : state.audit.lastAlertAt,
      lastAlertType: alertCount ? alertType(pending[alertCount - 1].title) : state.audit.lastAlertType
    }
  };
  // Persist detection before sending so a process crash cannot erase alerts.
  await storage.put("monitor", state);
  if (alertCount) {
    const types = {};
    for (const item of pending) {
      const type = alertType(item.title);
      types[type] = (types[type] || 0) + 1;
    }
    auditLog("wallet_alert_detected", user, { at: now, alerts: alertCount, types });
  }
  await flush();
  auditLog("wallet_poll_success", user, { at: now, initialized: false,
    positions: positions.length, alertsDetected: alertCount, pushesAccepted: pushedThisPoll,
    pending: state.pending.length });
  return { initialized: false, positions: positions.length,
    alerts: alertCount, pushesAccepted: pushedThisPoll, checkedAt: now };
}
