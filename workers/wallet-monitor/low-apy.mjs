const CLOB_BOOK_URL = "https://clob.polymarket.com/book";
const SETTLEMENT_TIME_ZONE = "America/New_York";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const STATE_BASIS = "combined-apr-holding-v4";
import { rewardMapForPositions } from "./holding-rewards.mjs";

const DEFAULTS = {
  thresholdPct: 10,
  recoverPct: 12,
  cooldownHours: 24,
  checkMinutes: 30,
  minUsd: 5,
  timeoutMs: 8000,
};

const num = v => v !== undefined && v !== null && v !== "" && Number.isFinite(Number(v));
const safe = s => String(s || "未知市场").replace(/[\r\n]+/g, " ")
  .replace(/([\\_*[\]~<>])/g, "\\$1").slice(0, 120);
const usd = n => "$" + Number(n).toLocaleString("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
const pr = n => "$" + Number(n).toFixed(4);

function getTimeZoneOffsetMinutes(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.filter(({type}) => type !== "literal").map(({type,value}) => [type,value])
  );
  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );
  if (!Number.isFinite(asUtc)) return 0;
  return Math.round((asUtc - date.getTime()) / 60000);
}

function endOfDaySettlementUtcMs(dateStr) {
  const startUtc = Date.parse(dateStr + "T00:00:00.000Z");
  if (!Number.isFinite(startUtc)) return null;
  const endUtc = startUtc + MS_PER_DAY - 1;
  let settlementUtc = endUtc;
  for (let attempt = 0; attempt < 2; attempt++) {
    const offset = getTimeZoneOffsetMinutes(new Date(settlementUtc), SETTLEMENT_TIME_ZONE);
    settlementUtc = endUtc - offset * 60000;
  }
  return settlementUtc;
}

function endMs(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const text = raw.trim();
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? endOfDaySettlementUtcMs(text)
    : Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function remainingYears(endDate, nowSec) {
  const maturity = endMs(endDate);
  const nowMs = Number(nowSec) * 1000;
  if (maturity === null || !Number.isFinite(nowMs) || maturity <= nowMs) return null;
  return (maturity - nowMs) / (365 * MS_PER_DAY);
}

export function effectiveApy(price, endDate, nowSec) {
  if (!num(price) || Number(price) <= 0 || Number(price) > 1) return null;
  if (Number(price) === 1) return 0;
  const years = remainingYears(endDate, nowSec);
  if (years === null || years <= 0) return null;
  const apy = Math.pow(1 / Number(price), 1 / years) - 1;
  return Number.isFinite(apy) && apy >= 0 ? apy : null;
}

export function simpleApr(price, endDate, nowSec) {
  if (!num(price) || Number(price) <= 0 || Number(price) > 1) return null;
  if (Number(price) === 1) return 0;
  const years = remainingYears(endDate, nowSec);
  if (years === null || years <= 0) return null;
  const apr = ((1 / Number(price)) - 1) / years;
  return Number.isFinite(apr) && apr >= 0 ? apr : null;
}

function bestBid(book) {
  if (!book || !Array.isArray(book.bids)) return null;
  let best = null;
  for (const level of book.bids) {
    const price = Number(level?.price), size = Number(level?.size);
    if (!Number.isFinite(price) || price <= 0 || price > 1 ||
        !Number.isFinite(size) || size <= 0) continue;
    if (!best || price > best.price) best = {price, size};
  }
  return best;
}

async function orderBook(fetcher, tokenId, timeoutMs) {
  const url = CLOB_BOOK_URL + "?token_id=" + encodeURIComponent(String(tokenId));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {
      headers: {accept:"application/json"},
      signal: controller.signal
    });
    if (!response.ok) throw new Error("CLOB HTTP " + response.status);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function positionExposure(p) {
  const values = [
    num(p.currentValue) ? Number(p.currentValue) : 0,
    num(p.initialValue) ? Number(p.initialValue) : 0,
    num(p.grossInitialValue) ? Number(p.grossInitialValue) : 0,
    num(p.size) && num(p.avgPrice) ? Number(p.size) * Number(p.avgPrice) : 0,
  ];
  return Math.max(...values);
}

function validateConfig(config) {
  const v = {...DEFAULTS, ...config};
  for (const key of ["thresholdPct","recoverPct","cooldownHours","checkMinutes","minUsd","timeoutMs"]) {
    if (!Number.isFinite(Number(v[key])) || Number(v[key]) < 0)
      throw new Error("Invalid low-APY config: " + key);
  }
  if (Number(v.thresholdPct) <= 0 ||
      Number(v.recoverPct) <= Number(v.thresholdPct))
    throw new Error("LOW_APY_RECOVER_PCT must be greater than LOW_APY_THRESHOLD_PCT");
  return Object.fromEntries(Object.entries(v).map(([k,val]) => [k, Number(val)]));
}

export async function inspectLowApy(positions, previous, now, fetcher=fetch, config={}) {
  const v = validateConfig(config);
  const compatible = previous?.basis === STATE_BASIS;
  const priorState = compatible && previous && typeof previous === "object" ? previous : {};
  const lastCheckedAt = Number(priorState.lastCheckedAt || 0);

  if (lastCheckedAt > 0 && now - lastCheckedAt < v.checkMinutes * 60) {
    return {state: priorState, raised: [], skipped:"interval", checked:0, errors:0};
  }

  const priorTokens = priorState.tokens && typeof priorState.tokens === "object"
    ? priorState.tokens : {};
  const eligiblePositions=(positions||[]).filter(p=>p?.asset != null &&
    p.redeemable !== true && num(p.size) && Number(p.size)>0 &&
    positionExposure(p)>=v.minUsd && num(p.curPrice) &&
    Number(p.curPrice)>0 && Number(p.curPrice)<=1);
  const rewardMap=await rewardMapForPositions(eligiblePositions,fetcher);
  const nextTokens = {};
  const raised = [];
  let checked = 0, errors = 0;

  for (const p of positions || []) {
    if (p?.asset == null || p.redeemable === true ||
        !num(p.size) || Number(p.size) <= 0) continue;
    if (positionExposure(p) < v.minUsd) continue;
    if (!num(p.curPrice) || Number(p.curPrice) <= 0 || Number(p.curPrice) > 1) continue;

    const markPrice = Number(p.curPrice);
    const markApy = effectiveApy(markPrice, p.endDate, now);
    const markApr = simpleApr(markPrice, p.endDate, now);
    if (markApy === null || markApr === null) continue;
    checked++;

    const id = String(p.asset);
    const prior = priorTokens[id] || null;
    const markApyPct = markApy * 100;
    const markAprPct = markApr * 100;
    const reward = rewardMap.get(p.eventSlug) ?? {eligible:null,apr:0};
    // Unknown reward eligibility must never be silently represented as confirmed 0.
    // Defer yield alerts until eligibility can be verified.
    if (reward.eligible===null) {
      if (priorTokens[id]) nextTokens[id]=priorTokens[id];
      errors++;
      continue;
    }
    const holdingRewardAprPct = reward.apr * 100;
    const combinedAprPct = markAprPct + holdingRewardAprPct;
    const priorBelow = prior?.below === true;
    const below = priorBelow
      ? combinedAprPct < v.recoverPct
      : combinedAprPct < v.thresholdPct;
    const lastAlertAt = Number(prior?.lastAlertAt || 0);
    const canRepeat = !lastAlertAt || now - lastAlertAt >= v.cooldownHours * 3600;

    const entry = {
      below,
      lastAlertAt,
      markPrice,
      markApyPct,
      markAprPct,
      holdingRewardAprPct,
      combinedAprPct
    };

    if (below && (!priorBelow || canRepeat)) {
      entry.lastAlertAt = now;
      const size = Number(p.size);
      let bid = null;
      let executableApyPct = null;
      let executableAprPct = null;

      try {
        bid = bestBid(await orderBook(fetcher, id, v.timeoutMs));
        if (bid) {
          const executableApy = effectiveApy(bid.price, p.endDate, now);
          const executableApr = simpleApr(bid.price, p.endDate, now);
          executableApyPct = executableApy === null ? null : executableApy * 100;
          executableAprPct = executableApr === null ? null : executableApr * 100;
        }
      } catch {
        errors++;
      }

      raised.push({
        id,
        title: String(p.title || p.conditionId || "未知市场"),
        outcome: String(p.outcome || "未知选项"),
        eventSlug: String(p.eventSlug || ""),
        endDate: p.endDate,
        size,
        avgPrice: num(p.avgPrice) ? Number(p.avgPrice) : null,
        markPrice,
        markApyPct,
        markAprPct,
        holdingRewardAprPct,
        combinedAprPct,
        holdingRewardEligible:reward.eligible,
        markPositionValueUsd: num(p.currentValue)
          ? Number(p.currentValue)
          : size * markPrice,
        markRemainingRoiPct: (1 / markPrice - 1) * 100,
        bestBid: bid?.price ?? null,
        bidSize: bid?.size ?? null,
        bidDepthUsd: bid ? bid.price * bid.size : null,
        executableApyPct,
        executableAprPct,
        executableRemainingRoiPct: bid ? (1 / bid.price - 1) * 100 : null,
        executableFullPositionValueUsd: bid ? size * bid.price : null,
      });
    }

    nextTokens[id] = entry;
  }

  raised.sort((a,b) => a.combinedAprPct - b.combinedAprPct);
  return {
    state: {basis:STATE_BASIS,lastCheckedAt:now,tokens:nextTokens},
    raised,
    checked,
    errors
  };
}

export function lowApyMessage(walletLabel, raised, thresholdPct, now) {
  if (!raised?.length) return null;
  const time = new Date(now*1000).toLocaleString("zh-CN", {timeZone:"Asia/Shanghai"});
  const lines = [
    "### 💸 Polymarket · 综合持有 APR 过低 / 可考虑卖出",
    "**钱包：** " + safe(walletLabel),
    "**触发阈值：** 综合持有 APR < " + Number(thresholdPct).toFixed(1) + "%",
    "**触发仓位：** " + raised.length + " 个",
    "**北京时间：** " + time,
    "",
  ];

  for (const a of raised.slice(0,6)) {
    const text = safe(a.title) + " / " + safe(a.outcome);
    const url = /^[a-zA-Z0-9_-]+$/.test(a.eventSlug)
      ? "https://polymarket.com/event/" + a.eventSlug
      : null;

    lines.push(
      "#### " + (url ? "[" + text + "](" + url + ")" : text),
      "**机会成本（Mark / Current）**",
      "- Mark 参考价：**" + pr(a.markPrice) + "**",
      "- Mark APY（复利）：**" + a.markApyPct.toFixed(2) + "%**",
      "- Mark APR（简单年化）：" + a.markAprPct.toFixed(2) + "%",
      "- Holding Rewards APR：" + a.holdingRewardAprPct.toFixed(2) + "%",
      "- **综合持有 APR：** **" + a.combinedAprPct.toFixed(2) + "%**",
      "- 持有到 $1 的剩余 ROI：" + a.markRemainingRoiPct.toFixed(2) + "%",
      "- 当前持仓价值：**" + usd(a.markPositionValueUsd) + "**",
      "",
      "**实际退出（CLOB 买一）**",
      a.bestBid != null ? "- 当前可卖买一：**" + pr(a.bestBid) + "**" :
        "- 当前可卖买一：**暂不可用**",
      a.executableApyPct != null ? "- 可执行 APY（复利）：**" +
        a.executableApyPct.toFixed(2) + "%**" :
        "- 可执行 APY：暂不可用",
      a.executableAprPct != null ? "- 可执行 APR（简单年化）：" +
        a.executableAprPct.toFixed(2) + "%" : "",
      a.executableRemainingRoiPct != null ? "- 买一价对应剩余 ROI：" +
        a.executableRemainingRoiPct.toFixed(2) + "%" : "",
      a.bidDepthUsd != null ? "- 买一档深度：" + usd(a.bidDepthUsd) : "",
      a.executableFullPositionValueUsd != null
        ? "- 按买一估算全仓价值（假设深度足够）：" +
          usd(a.executableFullPositionValueUsd)
        : "",
      "",
      "- 当前持仓：" + a.size.toLocaleString("en-US",{maximumFractionDigits:8}) + " 份",
      a.avgPrice != null ? "- 买入均价：" + pr(a.avgPrice) : "",
      "- 预计结束：" + safe(a.endDate || "暂无数据"),
      ""
    );
  }

  if (raised.length > 6)
    lines.push("另有 " + (raised.length - 6) + " 个低综合持有 APR 仓位已折叠。","");

  lines.push(
    "> 触发条件：综合持有 APR = Mark APR + 官方已确认可领取的 Holding Rewards APR。",
    "> 与 Dashboard 的综合持有 APR 口径一致；Mark APY 仅保留作复利参考。奖励率可能变更，实际到账以官方采样及发放为准。",
    "> CLOB 买一仅用于说明真实退出条件，不参与是否触发低 APR 提醒。",
    "> 买一价只代表当前第一档；若买一深度小于持仓，整笔卖出的实际均价可能更低。",
    "> 若市场实际结算晚于 endDate，真实年化会更低。"
  );

  const first = raised[0];
  return {
    formatVersion: 2,
    title: "💸 LOW COMBINED APR · " + walletLabel + " · " + raised.length + " 个仓位",
    short: safe(first.title).slice(0,30) + " · Hold APR " +
      first.combinedAprPct.toFixed(1) + "%" +
      (first.executableAprPct != null
        ? " · Bid APR " + first.executableAprPct.toFixed(1) + "%"
        : ""),
    desp: lines.filter(Boolean).join("\n")
  };
}
