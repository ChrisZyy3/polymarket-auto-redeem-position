// Per-wallet redeemable cash reminders. Initialize on first observation to avoid
// flooding legacy wallets. Persist clocks atomically with the notification outbox.
const okNumber = n=>n!==undefined&&n!==null&&n!==""&&Number.isFinite(Number(n));
const fmt=n=>"$"+Number(n).toLocaleString("en-US",{
  minimumFractionDigits:2,maximumFractionDigits:2
});
const esc=v=>String(v||"未知市场").replace(/[\r\n]+/g," ")
  .replace(/([\\_*[\]~<>])/g,"\\$1").slice(0,115);
const DEFAULTS={delayHours:6,cooldownHours:24,minUsd:5};
export function findRedeemReminders(positions, previous, now, custom={}){
  const opts={...DEFAULTS,...custom};
  const active={},due=[];
  const minUsd=Math.max(0,Number(opts.minUsd)||0);
  const delay=Math.max(1,Number(opts.delayHours)||6)*3600;
  const cooldown=Math.max(1,Number(opts.cooldownHours)||24)*3600;
  for(const p of positions||[]){
    const asset=p?.asset;
    if(asset==null||p.redeemable!==true||!okNumber(p.size)||
       !okNumber(p.curPrice)||Number(p.size)<=0||Number(p.curPrice)<=0)continue;
    const amount=Number(p.size)*Number(p.curPrice);
    if(!Number.isFinite(amount)||amount<=0)continue;
    const before=previous?.[String(asset)];
    const mark={
      firstSeenAt:before?.firstSeenAt>0&&before.firstSeenAt<=now
        ? before.firstSeenAt:now,
      lastReminderAt:before?.lastReminderAt>0&&before.lastReminderAt<=now
        ? before.lastReminderAt:null
    };
    active[String(asset)]=mark;
    if(amount < minUsd)continue;
    if(now-mark.firstSeenAt<delay)continue;
    if(mark.lastReminderAt!=null && now-mark.lastReminderAt<cooldown)continue;
    due.push({
      asset:String(asset),amount,
      title:String(p.title||p.conditionId||"未知市场"),
      outcome:String(p.outcome||"未知选项"),
      eventSlug:String(p.eventSlug||"")
    });
    mark.lastReminderAt=now; // Outbox is persisted in the same state write.
  }
  due.sort((a,b)=>b.amount-a.amount);
  return {trackers:active,due};
}
export function redemptionReminder(walletLabel, due, now){
  if(!due?.length)return null;
  const total=due.reduce((n,p)=>n+p.amount,0);
  const stamp=new Date(now*1000).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"});
  const details=due.slice(0,8).map((p,i)=>{
    const ttl=esc(p.title)+" / "+esc(p.outcome);
    const url=/^[a-zA-Z0-9_-]+$/.test(p.eventSlug)
      ?"https://polymarket.com/event/"+p.eventSlug:null;
    return (i+1)+". "+(url?"["+ttl+"]("+url+")":ttl)+" · **"+fmt(p.amount)+"**";
  });
  if(due.length>details.length)details.push("另有 "+(due.length-details.length)+" 个选项未展开");
  return {
    formatVersion:2,
    title:"💰 CLAIM · "+walletLabel+" · "+fmt(total),
    short:due.length+" 个选项已可赎回 ≥6小时；预计 "+fmt(total),
    desp:[
      "### 💰 待赎回资金提醒",
      "**钱包：** "+esc(walletLabel),
      "**当前已到提醒时限：** "+due.length+" 个选项",
      "**预计可赎回合计：** **"+fmt(total)+"**",
      "**检查时间：** "+stamp+"（北京时间）",
      "",...details,"",
      "> 持仓 API 的 redeemable 标志和结算价仅用于估算；资金到账以实际 REDEEM 为准。",
      "> 此提醒不会执行赎回；同一结果下次催办至少相隔 24 小时。"
    ].join("\n")
  };
}
