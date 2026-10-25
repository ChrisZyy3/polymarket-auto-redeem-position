const CLOB_BOOK_URL = "https://clob.polymarket.com/book";
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
const usd = n => "$" + Number(n).toLocaleString("en-US", {minimumFractionDigits:2,maximumFractionDigits:2});
const pr = n => "$" + Number(n).toFixed(4);

function endMs(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const text = raw.trim();
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? Date.parse(text + "T23:59:59Z")
    : Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

export function effectiveApy(price, endDate, nowSec) {
  if (!num(price) || Number(price) <= 0 || Number(price) >= 1)
    return Number(price) === 1 ? 0 : null;
  const maturity = endMs(endDate);
  const nowMs = Number(nowSec) * 1000;
  if (maturity === null || !Number.isFinite(nowMs) || maturity <= nowMs) return null;
  const years = (maturity - nowMs) / (365 * 24 * 3600 * 1000);
  const apy = Math.pow(1 / Number(price), 1 / years) - 1;
  return Number.isFinite(apy) && apy >= 0 ? apy : null;
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
      headers:{accept:"application/json"},
      signal:controller.signal
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
  const priorState = previous && typeof previous === "object" ? previous : {};
  const lastCheckedAt = Number(priorState.lastCheckedAt || 0);
  if (lastCheckedAt > 0 && now - lastCheckedAt < v.checkMinutes * 60) {
    return {state: priorState, raised: [], skipped:"interval", checked:0, errors:0};
  }

  const priorTokens = priorState.tokens && typeof priorState.tokens === "object"
    ? priorState.tokens : {};
  const nextTokens = {};
  const raised = [];
  let checked = 0, errors = 0;

  for (const p of positions || []) {
    if (p?.asset == null || p.redeemable === true ||
        !num(p.size) || Number(p.size) <= 0) continue;
    if (positionExposure(p) < v.minUsd) continue;
    const maturity = endMs(p.endDate);
    if (maturity === null || maturity <= now * 1000) continue;

    const id = String(p.asset);
    const prior = priorTokens[id] || null;
    try {
      const book = await orderBook(fetcher, id, v.timeoutMs);
      const bid = bestBid(book);
      if (!bid) continue;
      checked++;
      const apy = effectiveApy(bid.price, p.endDate, now);
      if (apy === null) continue;

      const apyPct = apy * 100;
      const priorBelow = prior?.below === true;
      const below = priorBelow ? apyPct < v.recoverPct : apyPct < v.thresholdPct;
      const lastAlertAt = Number(prior?.lastAlertAt || 0);
      const canRepeat = !lastAlertAt || now - lastAlertAt >= v.cooldownHours * 3600;
      const entry = {
        below, lastAlertAt, apyPct,
        bestBid:bid.price, bidSize:bid.size
      };

      if (below && (!priorBelow || canRepeat)) {
        entry.lastAlertAt = now;
        const size = Number(p.size);
        raised.push({
          id,
          title:String(p.title || p.conditionId || "未知市场"),
          outcome:String(p.outcome || "未知选项"),
          eventSlug:String(p.eventSlug || ""),
          endDate:p.endDate,
          size,
          avgPrice:num(p.avgPrice) ? Number(p.avgPrice) : null,
          bestBid:bid.price,
          bidSize:bid.size,
          bidDepthUsd:bid.price * bid.size,
          positionValueUsd:size * bid.price,
          remainingRoiPct:(1 / bid.price - 1) * 100,
          apyPct,
        });
      }
      nextTokens[id] = entry;
    } catch {
      errors++;
      if (prior) nextTokens[id] = prior;
    }
  }

  raised.sort((a,b) => a.apyPct - b.apyPct);
  return {
    state:{lastCheckedAt:now,tokens:nextTokens},
    raised, checked, errors
  };
}

export function lowApyMessage(walletLabel, raised, thresholdPct, now) {
  if (!raised?.length) return null;
  const time = new Date(now*1000).toLocaleString("zh-CN", {timeZone:"Asia/Shanghai"});
  const lines = [
    "### 💸 Polymarket · 低 APY / 可考虑卖出",
    "**钱包：** " + safe(walletLabel),
    "**阈值：** 有效 APY < " + Number(thresholdPct).toFixed(1) + "%",
    "**触发仓位：** " + raised.length + " 个",
    "**北京时间：** " + time,
    "",
  ];

  for (const a of raised.slice(0,6)) {
    const text=safe(a.title)+" / "+safe(a.outcome);
    const url=/^[a-zA-Z0-9_-]+$/.test(a.eventSlug)
      ? "https://polymarket.com/event/"+a.eventSlug : null;
    lines.push(
      "#### "+(url?"["+text+"]("+url+")":text),
      "- 当前可卖买一：**"+pr(a.bestBid)+"**",
      "- 剩余有效 APY：**"+a.apyPct.toFixed(2)+"%**",
      "- 持有到 $1 的剩余 ROI："+a.remainingRoiPct.toFixed(2)+"%",
      "- 当前持仓："+a.size.toLocaleString("en-US",{maximumFractionDigits:8})+" 份",
      "- 按买一估算持仓价值：**"+usd(a.positionValueUsd)+"**",
      "- 买一档深度："+usd(a.bidDepthUsd),
      a.avgPrice!=null?"- 买入均价："+pr(a.avgPrice):"",
      "- 预计结束："+safe(a.endDate||"暂无数据"),
      ""
    );
  }

  if (raised.length>6)
    lines.push("另有 "+(raised.length-6)+" 个低 APY 仓位已折叠。","");

  lines.push(
    "> 有效 APY 按当前 CLOB 买一价与预计结束时间计算：APY = (1 / 买一价)^(365 / 剩余天数) - 1。",
    "> 买一价只保证该档当前存在，不代表整笔持仓都能以该价成交；请结合“买一档深度”判断实际可卖规模。",
    "> 若市场实际结算晚于 endDate，真实年化会更低，因此该提醒偏乐观。",
    "> 这是机会成本提醒：剩余年化低于阈值时，可考虑卖出并切换到收益/确定性更好的仓位。"
  );

  const first=raised[0];
  return {
    formatVersion:2,
    title:"💸 LOW APY · "+walletLabel+" · "+raised.length+" 个仓位",
    short:safe(first.title).slice(0,34)+" · APY "+
      first.apyPct.toFixed(1)+"% · "+usd(first.positionValueUsd),
    desp:lines.filter(Boolean).join("\n")
  };
}
