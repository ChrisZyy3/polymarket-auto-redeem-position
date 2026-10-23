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
  ].filter(Boolean).join("\n");
}

export function tradeAlert(a, market, lines, walletLabel, marketUrl) {
  const redeem = a.type === "REDEEM";
  const kind = redeem ? "REDEEM" : a.side === "BUY" ? "BUY" : "SELL";
  const icon = redeem ? "💰" : kind === "BUY" ? "🟢" : "🟠";
  const zeroRedeem = redeem && Number(a.usdcSize) === 0 && Number(a.size) > 0;
  const word = redeem ? zeroRedeem ? "零回款赎回" : "实际赎回" :
    kind === "BUY" ? "买入成交" : "卖出成交";
  const amount = known(a.usdcSize) ? money(a.usdcSize) : "暂无数据";
  const shares = known(a.size) ? qty(a.size) : "暂无数据";
  const unit = known(a.price) ? price(a.price) : "暂无数据";
  return {
    formatVersion: 2,
    title: icon + " " + kind + " · " + walletLabel + " · " + amount,
    short: short(market.title) + " · " + (market.outcome || "未知") +
      " · " + (redeem ? "到账 " + amount : shares + " @ " + unit),
    desp: [
      "### " + icon + " " + kind + " · " + word,
      "**" + safe(market.title || market.conditionId || "未知市场") + "**",
      "**账户：** " + safe(walletLabel),
      "**选择：** " + safe(market.outcome || "未知选项"),
      "",
      "#### " + (redeem ? "💰 赎回到账" : "💵 本次成交"),
      row(redeem ? "实际到账" : "成交金额", "**" + amount + "**"),
      row(redeem ? "赎回数量" : "成交数量", shares),
      redeem ? "> 赎回到账不等于全部净利润。" : row("成交价格", unit + " / 份"),
      "",
      common(market, lines, a.timestamp, marketUrl)
    ].filter(Boolean).join("\n")
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

export function settlementAlert(p, lines, walletLabel, checkedAt, marketUrl) {
  const kind = settlementKind(p);
  if (!kind) return null;
  const icon = kind === "WIN" ? "🏆" : kind === "LOSS" ? "🔴" : "🟣";
  const word = kind === "WIN" ? "结算获胜 · 待赎回" :
    kind === "LOSS" ? "结算归零" : "部分回款 · 待赎回";
  const payout = known(p.size) && known(p.curPrice)
    ? Number(p.size) * Number(p.curPrice) : null;
  const estimate = estimatePnl(p);
  return {
    formatVersion: 2,
    title: icon + " " + kind + " · " + walletLabel +
      (estimate ? " · " + sign(estimate.pnl) : payout != null ? " · " + money(payout) : ""),
    short: short(p.title) + " · " + (p.outcome || "未知") +
      (estimate ? " · 预估盈亏 " + sign(estimate.pnl) :
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
      estimate ? row("剩余仓位成本", money(estimate.basis)) : "",
      estimate ? row("预估盈亏", "**" + sign(estimate.pnl) +
        "（" + pct(estimate.percent) + "）**") : "",
      estimate ? "> 仅基于剩余持仓及 API 成本估算，不代表全部历史净收益。" :
        "> API 未提供可靠剩余成本，因此不计算盈亏。",
      kind === "WIN" ? "> 需实际赎回后资金才会进入钱包。" :
        kind === "LOSS" ? "> 该持有结果归零。" : "> 部分回款，不能等同全额 WIN。",
      "",
      common(p, lines, checkedAt, marketUrl)
    ].filter(Boolean).join("\n")
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
