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

export async function push(env, fetcher, title, desp) {
  if (!env.PUSH_URL) throw new Error("PUSH_URL secret is required");
  const url = new URL(env.PUSH_URL);
  if (url.protocol !== "https:" || !/^\d+\.push\.ft07\.com$/.test(url.hostname)) {
    throw new Error("PUSH_URL must be a ServerChan3 HTTPS endpoint");
  }
  const result = await json(fetcher, url.href, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, desp, tags: "Polymarket" }),
    redirect: "error",
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
  // Deliver persisted outbox before requesting new data. Failed sends stay queued.
  const flush = async () => {
    while (state.pending.length) {
      const item = state.pending[0];
      await push(env, fetcher, item.title, "钱包：" + user + "\n\n" + item.desp);
      state.pending.shift();
      await storage.put("monitor", state);
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
      lastSuccessAt: now };
    await storage.put("monitor", state);
    return { initialized: true, positions: Object.keys(tracked).length, alerts: 0 };
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
    const kind = a.type === "TRADE" ? (a.side === "BUY" ? "买入成交" : "卖出成交") : "实际赎回";
    const zeroRedemption = a.type === "REDEEM" && num(a.usdcSize) === 0 && num(a.size) > 0;
    const title = "Polymarket · " + (zeroRedemption ? "零回款赎回" : kind);
    const desp = [label(a), "数量：" + num(a.size),
      (a.type === "TRADE" ? "成交金额：" : "赎回到账：") + usd(a.usdcSize),
      a.type === "TRADE" ? "成交价：" + num(a.price) : "到账金额不等于净利润",
      "北京时间：" + new Date(num(a.timestamp) * 1000).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }),
      a.transactionHash ? "交易：https://polygonscan.com/tx/" + a.transactionHash : "",
      link(a)].filter(Boolean).join("\n\n");
    pending.push({ title, desp });
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
      pending.push({
        title: "Polymarket · " + (status === "lost" ? "仓位结算归零" : "仓位可赎回"),
        desp: [label(p), "持仓：" + num(p.size) + " 份",
          "当前价值：" + usd(p.currentValue),
          "剩余成本（费用口径以 API 为准）：" + usd(p.grossInitialValue ?? p.initialValue),
          status === "lost" ? "Data API 标记可结算，持有结果的结算价格为 0。"
            : "可以赎回；本监控不会替你执行赎回。",
          link(p)].filter(Boolean).join("\n\n")
      });
    }
    tracked[p.asset] = { status, exposure, conditionId: p.conditionId, outcome: p.outcome };
  }
  for (const key of Object.keys(seen)) {
    if (seen[key] < now - OVERLAP) delete seen[key];
  }
  // Persist both detection state and outbox before sending. A crash cannot lose an alert.
  state = { ...state, checkpoint: now, positions: tracked, seen,
    pending, lastSuccessAt: now };
  await storage.put("monitor", state);
  const alertCount = pending.length;
  await flush();
  return { initialized: false, positions: positions.length, alerts: alertCount, checkedAt: now };
}
