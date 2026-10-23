// Compact, fee-cautious, read-only wallet snapshot for the daily 09:00 Beijing digest.
// Store aggregates and a small shortlist, not raw account histories.
const valid = v => v !== undefined && v !== null && v !== "" && Number.isFinite(Number(v));
const dollar = v => "$" + Number(v).toLocaleString("en-US",{
  minimumFractionDigits:2,maximumFractionDigits:2
});
const label = s => String(s || "未知市场").replace(/[\r\n]+/g," ")
  .replace(/([\\_*[\]~<>])/g,"\\$1").slice(0,120);
const dateKey = ms => new Date(ms + 8*3600*1000).toISOString().slice(0,10);
export const DAILY_DIGEST_HOUR = 9; // Asia/Shanghai never observes DST.
export function digestDate(ms) { return dateKey(ms); }
export function digestWindow(ms) {
  const shifted = new Date(ms + 8*3600*1000);
  return shifted.getUTCHours() === DAILY_DIGEST_HOUR;
}
function valueOf(p) {
  if (valid(p.currentValue) && Number(p.currentValue)>=0)
    return Number(p.currentValue);
  if (valid(p.size) && valid(p.curPrice))
    return Math.max(0,Number(p.size)*Number(p.curPrice));
  return null;
}
function expiryTime(raw) {
  if (typeof raw!=="string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const ms=Date.parse(raw+"T23:59:59Z");
  return Number.isFinite(ms) ? ms:null;
}
export function summarizeWalletPositions(positions, checkedAt) {
  const result={
    checkedAt, openCount:0,openValue:0,pendingCount:0,pendingRedeemValue:0,
    openGrossPnl:0,openValueIncomplete:false,openPnlIncomplete:false,
    pending:[ ],upcoming:[ ]
  };
  for (const p of positions || []) {
    const size=Number(p?.size);
    if (!valid(p?.size)||size<=0) continue;
    const redeemed = p.redeemable === true;
    if (redeemed) {
      // A losing/zero-value resolution is not cash that can actually be claimed.
      const payout=valid(p.curPrice)?size*Math.max(0,Number(p.curPrice)):null;
      if (payout===null||!Number.isFinite(payout)||payout<=0)continue;
      result.pendingCount++;
      result.pendingRedeemValue+=payout;
      result.pending.push({
        title:String(p.title||p.conditionId||"未知市场").slice(0,100),
        outcome:String(p.outcome||"").slice(0,20),
        value:payout,
        eventSlug:String(p.eventSlug||"").slice(0,160)
      });
    } else {
      result.openCount++;
      const value=valueOf(p);
      if(value===null){result.openValueIncomplete=true;result.openPnlIncomplete=true}
      else {
        result.openValue+=value;
        // v1 initialValue is only a gross basis, not an all-in fee-inclusive cost.
        const cost=valid(p.initialValue)?Number(p.initialValue):
          valid(p.avgPrice)?size*Number(p.avgPrice):null;
        if(cost!=null&&cost>=0)result.openGrossPnl+=value-cost;
        else result.openPnlIncomplete=true;
      }
      const expiration=expiryTime(p.endDate);
      if(expiration!==null && expiration>=checkedAt*1000 &&
        expiration-checkedAt*1000 <= 7*86400*1000){
        result.upcoming.push({
          title:String(p.title||p.conditionId||"未知市场").slice(0,100),
          outcome:String(p.outcome||"").slice(0,20),
          value:value??0,
          date:p.endDate,
          eventSlug:String(p.eventSlug||"").slice(0,160)
        });
      }
    }
  }
  result.pending.sort((a,b)=>b.value-a.value);
  result.upcoming.sort((a,b)=>a.date.localeCompare(b.date));
  result.pending=result.pending.slice(0,5);
  result.upcoming=result.upcoming.slice(0,5);
  // Correct stale roundoff in a sum of many shares.
  for(const key of ["openValue","pendingRedeemValue","openGrossPnl"])
    result[key]=Number(result[key].toFixed(6));
  return result;
}
export function validDailySnapshots(rows, now, staleSeconds=20*60){
  return Array.isArray(rows)&&rows.length>0&&rows.every(row=>
    row && row.snapshot && row.lastSuccessAt &&
    now-row.lastSuccessAt>=-60 && now-row.lastSuccessAt<=staleSeconds &&
    row.snapshot.checkedAt===row.lastSuccessAt
  );
}
export function walletBalanceAmount(balance) {
  if (typeof balance!=="string")return null;
  const m=/^([0-9][0-9,]*\.[0-9]{2}) pUSD$/.exec(balance);
  return m?Number(m[1].replace(/,/g,"")):null;
}
export function composeDailyDigest(day, wallets) {
  const knownBalances=wallets.map(w=>walletBalanceAmount(w.balance));
  const completeBalances=knownBalances.every(v=>v!==null);
  const completePositions=wallets.every(w=>!w.snapshot.openValueIncomplete);
  const open=wallets.reduce((n,w)=>n+w.snapshot.openValue,0);
  const pending=wallets.reduce((n,w)=>n+w.snapshot.pendingRedeemValue,0);
  const free=knownBalances.reduce((n,v)=>n+(v??0),0);
  const total=completeBalances&&completePositions?free+open+pending:null;
  const hasGross=wallets.every(w=>!w.snapshot.openPnlIncomplete);
  const gross=wallets.reduce((n,w)=>n+w.snapshot.openGrossPnl,0);
  const lines=[
    "### 📊 Polymarket · 三钱包资产日报",
    "**日期：** "+day+"（北京时间 09:00 左右）",
    "",
    "#### 💰 资产概况",
    "- **链上 pUSD**："+(completeBalances?dollar(free):"部分钱包余额暂不可用"),
    "- **未结算持仓估算市值**："+(completePositions?dollar(open):"部分仓位市值缺失"),
    "- **待赎回预计金额**："+dollar(pending),
    "- **估算资产合计**："+(total==null?"暂不能完整估算": "**"+dollar(total)+"**"),
    "- **未结算持仓估算毛浮盈亏**："+(hasGross?dollar(gross):"成本或价格数据不足"),
    "",
    "> 资产合计 = 链上 pUSD + 未结算市值 + 待赎回金额，避免已结算仓位重复计算。",
    "> 链上 pUSD 未扣挂单占用；市值取 Data API 价格估算，不代表可立即成交的金额。",
    "> 毛浮盈亏不含手续费、Gas，也不等于账户已实现净利润。",
    ""
  ];
  for(const w of wallets){
    const p=w.snapshot;
    lines.push("---","#### 💼 "+label(w.label),
      "- 链上 pUSD："+(w.balance??"暂时无法获取"),
      "- 未结算："+p.openCount+" 个选项 · 市值 "+
        (p.openValueIncomplete?"部分数据缺失":dollar(p.openValue)),
      "- 待赎回："+p.pendingCount+" 个选项 · 预计 "+dollar(p.pendingRedeemValue),
      "- 估算毛浮盈亏："+(p.openPnlIncomplete?"暂无完整成本数据":dollar(p.openGrossPnl)));
    if(p.pending.length){
      lines.push("**💰 优先处理的待赎回仓位**");
      for(const entry of p.pending.slice(0,3)){
        const title=label(entry.title)+" / "+label(entry.outcome);
        const href=/^[a-zA-Z0-9_-]+$/.test(entry.eventSlug)
          ? "https://polymarket.com/event/"+entry.eventSlug:null;
        lines.push("- "+(href?"["+title+"]("+href+")":title)+" · "+dollar(entry.value));
      }
    }
    if(p.upcoming.length){
      lines.push("**⏳ 未来七天预计结束**");
      for(const entry of p.upcoming.slice(0,2))
        lines.push("- "+label(entry.title)+" / "+label(entry.outcome)+
          " · "+entry.date+"（日期不等于赎回到账）");
    }
    lines.push("");
  }
  return {formatVersion:3,skipBalanceFooter:true,
    title:"📊 DAILY · Polymarket · "+day,
    short:wallets.length+" 钱包 · 活跃 "+dollar(open)+" · 待赎回 "+dollar(pending),
    desp:lines.join("\n")};
}
// Dedicated coordinator Durable Object. Both date marker and pending message must
// commit in the same DO storage.put so a crashed Cron cannot duplicate a digest.
export async function enqueueDigest(storage, day, item, now){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(day)) ||
    item?.formatVersion!==3||item?.skipBalanceFooter!==true||
    typeof item.title!=="string"||typeof item.desp!=="string" ||
    item.desp.length>50000)throw Error("Invalid digest");
  const state=await storage.get("monitor") || {
    user:"DailyDigest",pending:[],audit:{},checkpoint:now,startedAt:now
  };
  if(state.lastDailyDate===day)return {ok:true,queued:false};
  state.pending??=[];
  state.pending.push(item);
  state.lastDailyDate=day;
  await storage.put("monitor",state);
  return {ok:true,queued:true};
}
