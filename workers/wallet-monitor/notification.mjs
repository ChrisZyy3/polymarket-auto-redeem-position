// Pure rendering helpers for ServerChan3 trade/settlement notification cards.
const known = v => v != null && v !== "" && Number.isFinite(Number(v));
const money = v => "$" + Number(v).toFixed(2);
const price = v => "$" + Number(v).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
const qty = v => Number(v).toLocaleString("en-US", { maximumFractionDigits: 8 }) + " 份";
const safe = v => String(v ?? "").replace(/[\r\n]+/g, " ")
  .replace(/([\\_*[\]~<>])/g, "\\$1").trim();
const short = (v, limit = 42) => {
  const s = String(v || "未知市场").replace(/\s+/g, " ").trim();
  return s.length > limit ? s.slice(0, limit - 1) + "…" : s;
};
const sign = v => (v >= 0 ? "+" : "-") + money(Math.abs(v));
const pct = v => (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
const row = (k, v) => "- **" + k + "**：" + v;
const time = sec => Number.isFinite(Number(sec)) && Number(sec) > 0
  ? new Date(Number(sec) * 1000).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })
  : "暂无数据";

function common(market, lines, timestamp, marketUrl) {
  return [
    "---",
    "#### 💼 当前持仓",
    ...lines.filter(s => !s.startsWith("预计结束：")).map(s => "- " + safe(s)),
    "",
    "📅 **" + safe(lines.find(s => s.startsWith("预计结束：")) || "预计结束：暂无数据") + "**",
    "> 预计结束时间仅供参考，实际以市场规则为准。",
    "",
    "🕒 北京时间：" + time(timestamp),
    marketUrl ? "[🔗 查看 Polymarket 市场](" + marketUrl + ")" : ""
  ].join("\n");
}

export function tradeAlert(a, market, lines, walletLabel, marketUrl, options = {}) {
  const redeem = a.type === "REDEEM";
  const lifecycle = !redeem ? options.lifecycle : null;
  const kind = redeem ? "REDEEM" : lifecycle?.kind || (a.side === "BUY" ? "BUY" : "SELL");
  const icons = { OPEN:"🆕", ADD:"📈", TRIM:"📉", EXIT:"🚪", BUY:"🟢", SELL:"🟠", REDEEM:"💰" };
  const names = { OPEN:"首次建仓", ADD:"加仓", TRIM:"减仓", EXIT:"清仓", BUY:"买入成交", SELL:"卖出成交" };
  const icon = icons[kind] || "🔔";
  const zeroRedeem = redeem && Number(a.usdcSize) === 0 && Number(a.size) > 0;
  const word = redeem ? zeroRedeem ? "零回款赎回" : "实际赎回" : names[kind];
  const amount = known(a.usdcSize) ? money(a.usdcSize) : "暂无数据";
  const shares = known(a.size) ? qty(a.size) : "暂无数据";
  const unit = known(a.price) ? price(a.price) : "暂无数据";
  const count = Number(a.tradeCount) || 1;
  const merged = count > 1;
  const forecast = a.type === "TRADE" && a.side === "BUY" ? options.forecast : null;
  const currentLines = lifecycle?.kind === "EXIT"
    ? lines.map(line => line.startsWith("当前该选项总持仓：")
      ? "当前该选项总持仓：0 份（已确认清仓）" : line)
    : lines;
  const sizeDelta = lifecycle && known(lifecycle.currentSize) && known(lifecycle.previousSize) ? [
    "#### 📊 持仓变化",
    row("持仓份数", qty(lifecycle.previousSize) + " → **" + qty(lifecycle.currentSize) + "**"),
    lifecycle.deltaPercent != null
      ? row("净变动", (lifecycle.deltaPercent >= 0 ? "+" : "") +
        lifecycle.deltaPercent.toFixed(2) + "%")
      : row("净变动", "首次建立仓位"),
    ""
  ] : [];
  const earnings = forecast ? [
    "#### 🎯 全额获胜情景（毛收益）",
    row("每份假设赎回", "$1.00"),
    row("剩余持仓预计毛利润", "**" + money(forecast.grossProfit) + "**"),
    row("预估 ROI", "**" + forecast.grossROI.toFixed(2) + "%**"),
    row("预估 APR（简单年化）", forecast.simpleAPR != null
      ? "**" + forecast.simpleAPR.toFixed(2) + "%**"
      : "无法估算（" + forecast.aprUnavailableReason + "）"),
    forecast.remainingDays != null
      ? row("至预计结束", forecast.remainingDays.toFixed(2) + " 天") : "",
    "> ROI/APR 仅是假设此选项最终按每份 $1 兑现的条件收益，不代表获胜概率或保证收益。",
    forecast.dateOnly
      ? "> 仅有结束日期，APR 按该 UTC 日期末估算；实际结算、赎回可能更晚。"
      : "> APR 假设在预计结束时兑现；实际结算、赎回时间可能不同。",
    "> 以上毛收益未扣除交易手续费、Gas 或其他成本。",
    ""
  ] : (a.type === "TRADE" && a.side === "BUY" ? [
    "#### 🎯 全额获胜情景",
    "> 当前持仓成本或份数不可核实，暂无法计算 ROI/APR。",
    ""
  ] : []);
  return {
    formatVersion: 2,
    title: icon + " " + kind + " · " + walletLabel + " · " + amount,
    short: short(market.title) + " · " + (market.outcome || "未知") +
      " · " + (redeem ? "到账 " + amount :
        (merged ? count + "笔合并 · " : "") + shares + " @ " + unit) +
      (forecast ? " · ROI " + forecast.grossROI.toFixed(1) + "%" : ""),
    desp: [
      "### " + icon + " " + kind + " · " + word,
      "**" + safe(market.title || market.conditionId || "未知市场") + "**",
      "**账户：** " + safe(walletLabel),
      "**选择：** " + safe(market.outcome || "未知选项"),
      "",
      "#### " + (redeem ? "💰 赎回到账" : "💵 本次成交"),
      row(redeem ? "实际到账" : "成交金额", "**" + amount + "**"),
      row(redeem ? "赎回数量" : "成交数量", shares),
      merged ? row("合并明细", count + " 笔，按同方向/同市场结果/5分钟分组") : "",
      redeem ? "> 赎回到账不等于全部净利润。" : row("成交价格", unit + " / 份"),
      "",
      ...sizeDelta,
      ...earnings,
      common(market, currentLines, a.timestamp, marketUrl)
    ].join("\n")
  };
}

export function settlementKind(p) {
  if (p.redeemable !== true || !known(p.curPrice)) return null;
  const v = Number(p.curPrice);
  if (v === 0) return "LOSS";
  if (v > 0 && v >= 0.999999 && v <= 1.000001) return "WIN";
  return v > 0 ? "PARTIAL" : null;
}

export function estimatePnl(p) {
  const rawBasis = p.grossInitialValue ?? p.initialValue;
  if (!known(rawBasis) || Number(rawBasis) <= 0 || !known(p.size) || !known(p.curPrice))
    return null;
  const basis = Number(rawBasis), proceeds = Number(p.size) * Number(p.curPrice);
  const pnl = proceeds - basis, percent = pnl / basis * 100;
  return [pnl, percent, proceeds].every(Number.isFinite)
    ? { basis, proceeds, pnl, percent } : null;
}

export function settlementAlert(p, lines, walletLabel, checkedAt, marketUrl, options = {}) {
  const kind = settlementKind(p);
  if (!kind) return null;
  const icon = kind === "WIN" ? "🏆" : kind === "LOSS" ? "🔴" : "🟣";
  const word = kind === "WIN" ? "结算获胜 · 待赎回" :
    kind === "LOSS" ? "结算归零" : "部分回款 · 待赎回";
  const payout = known(p.size) && known(p.curPrice)
    ? Number(p.size) * Number(p.curPrice) : null;
  const gross = estimatePnl(p);
  const net = options.net || null;
  const shown = net ? net.net : gross ? gross.pnl : null;
  const hint = net ? "预计净收益" : gross ? "估算毛盈亏" : "预计回款";
  return {
    formatVersion: 2,
    title: icon + " " + kind + " · " + walletLabel +
      (shown != null ? " · " + sign(shown) : payout != null ? " · " + money(payout) : ""),
    short: short(p.title) + " · " + (p.outcome || "未知") +
      (shown != null ? " · " + hint + " " + sign(shown) :
        " · 预计回款 " + (payout == null ? "暂无数据" : money(payout))),
    desp: [
      "### " + icon + " " + kind + " · " + word,
      "**" + safe(p.title || p.conditionId || "未知市场") + "**",
      "**账户：** " + safe(walletLabel),
      "**选择：** " + safe(p.outcome || "未知选项"),
      "",
      "#### 🏁 结算结果",
      row("每份结算价格", price(p.curPrice)),
      row("预计可赎回", "**" + (payout == null ? "暂无数据" : money(payout)) + "**"),
      net ? row("剩余仓位成本（含买入费）", money(net.basis)) :
        gross ? row("剩余成本粗估（未核对费用）", money(gross.basis)) : "",
      net ? row("该剩余仓位预计净收益", "**" + sign(net.net) +
        (net.roi != null ? "（" + pct(net.roi) + "）" : "") + "**") :
        row("该剩余仓位预计净收益", "**暂无法核实**"),
      net?.buyFees != null ? row("已包含的买入手续费", money(net.buyFees)) : "",
      net?.realizedPnl != null ? row("该结果历史已实现盈亏（另列）",
        sign(net.realizedPnl)) : "",
      !net && gross ? row("估算毛盈亏（未扣手续费）", "**" + sign(gross.pnl) +
        "（" + pct(gross.percent) + "）**") : "",
      net ? "> 净收益来自 Data API v2：预计回款减去当前剩余仓位的含买入费成本；未扣 Gas、其他链外费用。"
        : "> Data API v2 成本缺失、滞后或无法访问；不能将估算毛盈亏称为净收益。",
      "> 历史已实现盈亏是另一项指标，不能直接当成此次剩余仓位的净收益。",
      kind === "WIN" ? "> 需实际赎回后资金才会进入钱包。" :
        kind === "LOSS" ? "> 该持有结果归零。" : "> 部分回款，不能等同全额 WIN。",
      "",
      common(p, lines, checkedAt, marketUrl)
    ].join("\n")
  };
}

const PUSD = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB";
const RPC = ["https://polygon-bor-rpc.publicnode.com", "https://polygon.drpc.org"];
export async function walletPusdBalance(fetcher, wallet) {
  const address = String(wallet || "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) return null;
  const data = "0x70a08231" + address.slice(2).padStart(64, "0");
  for (const rpc of RPC) {
    try {
      const res = await fetcher(rpc, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_call", id: 1,
          params: [{ to: PUSD, data }, "latest"] }),
        signal: AbortSignal.timeout(5000)
      });
      if (!res.ok) continue;
      const json = await res.json();
      if (typeof json?.result !== "string" || !/^0x[0-9a-f]+$/i.test(json.result))
        continue;
      const cents = (BigInt(json.result) + 5000n) / 10000n;
      return (cents / 100n).toLocaleString("en-US") + "." +
        (cents % 100n).toString().padStart(2, "0") + " pUSD";
    } catch {
      // Wallet context cannot block order notifications.
    }
  }
  return null;
}
