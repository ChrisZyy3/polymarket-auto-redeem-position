// Risk alert on observed changes, not an investment recommendation.
// The Data API 'curPrice' is a reference/mark, NOT an executable bid or guarantee.
const num=v=>v!==undefined&&v!==null&&v!==""&&Number.isFinite(Number(v));
const safe=s=>String(s||"未知市场").replace(/[\r\n]+/g," ")
  .replace(/([\\_*[\]~<>])/g,"\\$1").slice(0,120);
const usd=n=>"$"+Number(n).toFixed(2);
const pr=n=>"$"+Number(n).toFixed(4);
const settings={
  floor:.90, drawdownPct:5, rapidPoints:.05, cooldownHours:24, minUsd:5
};
export function inspectPriceRisk(positions,previous,now,config={}){
  const v={...settings,...config}, next={},raised=[];
  const floor=Number(v.floor), drawdown=Number(v.drawdownPct),
    rapid=Number(v.rapidPoints),cooldown=Number(v.cooldownHours)*3600,
    minimum=Number(v.minUsd);
  if(!Number.isFinite(floor)||floor<=0||floor>=1||
     !Number.isFinite(drawdown)||drawdown<=0||drawdown>100||
     !Number.isFinite(rapid)||rapid<=0||rapid>=1||
     !Number.isFinite(cooldown)||cooldown<0||
     !Number.isFinite(minimum)||minimum<0)throw Error("Invalid price-risk settings");
  for(const p of positions||[]){
    if(p?.asset==null||p.redeemable===true||!num(p.size)||
       Number(p.size)<=0||!num(p.curPrice)||!num(p.avgPrice))continue;
    const price=Number(p.curPrice),avg=Number(p.avgPrice),size=Number(p.size);
    if(price<0||price>1||avg<=0||avg>1)continue;
    const exposure=Math.max(size*price,size*avg,
      num(p.initialValue)?Number(p.initialValue):0);
    if(exposure<minimum)continue;
    const id=String(p.asset),prior=previous?.[id];
    const belowFloor=price<floor;
    const belowEntry=price<=avg*(1-drawdown/100);
    const lastAlertAt=prior?.lastAlertAt>0&&prior.lastAlertAt<=now?
      prior.lastAlertAt:null;
    const entry={price,belowFloor,belowEntry,lastAlertAt};
    next[id]=entry;
    if(!prior||!num(prior.price))continue; // seed all existing positions silently
    const reasons=[];
    if(belowFloor&&!prior.belowFloor)
      reasons.push("参考价格向下跌破 "+pr(floor));
    if(belowEntry&&!prior.belowEntry)
      reasons.push("相对持仓均价下跌达到 "+drawdown.toFixed(1)+"%");
    if(Number(prior.price)-price>=rapid-1e-9)
      reasons.push("单轮参考价格下跌 "+pr(Number(prior.price)-price)+"（至少 "+pr(rapid)+"）");
    if(!reasons.length)continue;
    if(lastAlertAt!=null&&now-lastAlertAt<cooldown)continue;
    entry.lastAlertAt=now; // A queued alert cannot be requeued each tick.
    raised.push({
      id,title:String(p.title||p.conditionId||"未知市场"),
      outcome:String(p.outcome||"未知选项"),
      eventSlug:String(p.eventSlug||""),
      price,avg,priorPrice:Number(prior.price),size,
      positionValue:size*price,
      relativePct:(price/avg-1)*100,reasons
    });
  }
  raised.sort((a,b)=>a.relativePct-b.relativePct);
  return {trackers:next,raised};
}
export function priceRiskMessage(walletLabel,raised,now){
  if(!raised?.length)return null;
  const time=new Date(now*1000).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"});
  const lines=[
    "### 🚨 Polymarket · 持仓价格风险",
    "**钱包：** "+safe(walletLabel),
    "**触发选项：** "+raised.length+" 个",
    "**北京时间：** "+time,
    "",
  ];
  for(const a of raised.slice(0,6)){
    const text=safe(a.title)+" / "+safe(a.outcome);
    const url=/^[a-zA-Z0-9_-]+$/.test(a.eventSlug)?
      "https://polymarket.com/event/"+a.eventSlug:null;
    lines.push("#### "+(url?"["+text+"]("+url+")":text),
      "- 参考价："+pr(a.priorPrice)+" → **"+pr(a.price)+"**",
      "- 持仓均价："+pr(a.avg),
      "- 相对均价变化："+a.relativePct.toFixed(2)+"%",
      "- 当前仓位估算市值："+usd(a.positionValue),
      "- 触发原因："+a.reasons.map(safe).join("；"),
      "");
  }
  if(raised.length>6)lines.push("另有 "+(raised.length-6)+" 个选项触发，已折叠。","");
  lines.push(
    "> 价格来自 Data API 的 curPrice，可能滞后，未必是能以该价格卖出的报价。",
    "> 仅为价格阈值提醒，不代表预测结果概率、清算信号或交易建议。",
    "> 每个结果选项的风险告警至少间隔 24 小时。");
  const first=raised[0];
  return {formatVersion:2,
    title:"🚨 RISK · "+walletLabel+" · "+raised.length+" 个选项",
    short:safe(first.title).slice(0,36)+" · "+pr(first.priorPrice)+
      " → "+pr(first.price)+" · "+first.relativePct.toFixed(1)+"%",
    desp:lines.join("\n")
  };
}
