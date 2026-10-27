import { summarizeWalletPositions,composeDailyDigest,digestDate,digestWindow,
  validDailySnapshots, walletBalanceAmount,enqueueDigest } from "./asset-digest.mjs";
import { findRedeemReminders,redemptionReminder } from "./redeem-reminders.mjs";
import { inspectPriceRisk,priceRiskMessage } from "./price-risk.mjs";
import { poll } from "./monitor.mjs";
import { runDailyDigest,WalletMonitor } from "./worker.mjs";
const assert=(value,label)=>{if(!value)throw Error(label)};
const walletA="0x052f4191cd324a348835a846d34df5b0061e53fb";
const walletB="0x24816c037cdc2c9bd979e69d777541cf560a9b79";
const walletC="0x9f7eb5bc88342f01d18754be0439fad79ec282ce";
const now=Math.floor(Date.parse("2026-10-24T00:00:00Z")/1000);
const market={
  asset:"outcome-yes",conditionId:"condition-a",size:100,avgPrice:.9,
  curPrice:.95,currentValue:95,initialValue:90,redeemable:false,
  title:"Test market",outcome:"Yes",eventSlug:"test-market",endDate:"2026-10-25"
};
const ready={...market,asset:"outcome-redeem",size:50,curPrice:1,currentValue:50,
  redeemable:true,title:"Resolved market",eventSlug:"resolved-market"};
const worthless={...market,asset:"outcome-loss",size:20,curPrice:0,currentValue:0,redeemable:true};

const aggregate=summarizeWalletPositions([market,ready,worthless],now);
assert(aggregate.openCount===1&&aggregate.openValue===95,"daily open valuation without double count");
assert(aggregate.pendingCount===1&&aggregate.pendingRedeemValue===50,
  "settled winner is counted only in redeemable amount; loss has no cash");
assert(aggregate.openGrossPnl===5,"daily estimated gross floating PnL is 95-90");
assert(aggregate.upcoming.length===1&&aggregate.pending.length===1,
  "daily upcoming and redeemable shortlist are distinct");
assert(walletBalanceAmount("1,234.56 pUSD")===1234.56&&
  walletBalanceAmount("暂时无法获取")===null,"known balances parsed, missing never zero");
const ms=Date.parse("2026-10-24T00:00:00Z");
assert(digestWindow(ms)&&digestDate(ms)==="2026-10-24"&&
  !digestWindow(ms-5*60_000)&&!digestWindow(ms+60*60_000),
  "daily window maps Beijing 08:00 to UTC 00:00");
assert(!digestWindow(Date.parse("2026-10-24T01:00:00Z")),
  "former Beijing 09:00 window no longer sends a digest");
const report=composeDailyDigest("2026-10-24",[
  {label:"ChrisZyy",balance:"100.00 pUSD",snapshot:aggregate},
  {label:"RealChris",balance:"200.00 pUSD",snapshot:summarizeWalletPositions([],now)},
  {label:"PigsWallet",balance:"300.00 pUSD",snapshot:summarizeWalletPositions([],now)}
]);
assert(report.title.includes("DAILY")&&report.skipBalanceFooter &&
  report.desp.includes("745.00")&&report.desp.includes("155.00")===false&&
  report.desp.includes("待赎回预计金额")&&
  report.desp.includes("未结算持仓估算市值")&&
  report.desp.includes("ChrisZyy")&&report.desp.includes("PigsWallet"),
  "daily summary combines wallet cash+live+claimable without double counting");
const reportWithMissing=composeDailyDigest("2026-10-24",[
  {label:"ChrisZyy",balance:null,snapshot:aggregate},
  {label:"RealChris",balance:"0.00 pUSD",snapshot:summarizeWalletPositions([],now)}
]);
assert(reportWithMissing.desp.includes("暂不能完整估算") &&
  !reportWithMissing.desp.includes("估算资产合计**：**$"),"missing cash never invented");
const snapshotRows=[{snapshot:aggregate,lastSuccessAt:now}];
assert(validDailySnapshots(snapshotRows,now+500)&&
  !validDailySnapshots(snapshotRows,now+1400)&&!validDailySnapshots([],now),
  "stale or missing wallet snapshot blocks the daily summary");
const dailyMap=new Map();
const digestStorage={
  get:async key=>structuredClone(dailyMap.get(key)),
  put:async(key,v)=>{dailyMap.set(key,structuredClone(v))}
};
assert((await enqueueDigest(digestStorage,"2026-10-24",report,now)).queued,
  "daily digest is committed to persistent outbox");
assert(!(await enqueueDigest(digestStorage,"2026-10-24",report,now+300)).queued&&
  dailyMap.get("monitor").pending.length===1,
  "same day never enqueues duplicate report even if Cron repeats");
assert((await enqueueDigest(digestStorage,"2026-10-25",report,now+86400)).queued&&
  dailyMap.get("monitor").pending.length===2,
  "next day may enqueue again");

// Redeem reminder: no old-position spam; six-hour delay and 24h cooldown.
const settle= {...ready,asset:"r2",currentValue:90,size:90,curPrice:1};
const first=findRedeemReminders([settle],null,now);
assert(first.due.length===0&&first.trackers.r2.firstSeenAt===now,
  "first sighting creates a baseline only");
const early=findRedeemReminders([settle],first.trackers,now+6*3600-1);
assert(early.due.length===0,"redeemable before six hours not notified");
const mature=findRedeemReminders([settle],first.trackers,now+6*3600);
assert(mature.due.length===1&&mature.due[0].amount===90,
  "redeemable after six hours notified");
const reminder=redemptionReminder("ChrisZyy",mature.due,now+6*3600);
assert(reminder.title.startsWith("💰 CLAIM")&&
  reminder.desp.includes("Resolved market")&&
  reminder.desp.includes("$90.00"),"claim grouping and funds amount");
assert(findRedeemReminders([settle],mature.trackers,now+7*3600).due.length===0,
  "claim reminder not repeated inside cooldown");
assert(findRedeemReminders([settle],mature.trackers,now+30*3600).due.length===1,
  "claim reminder may repeat after 24-hour cooldown");
assert(Object.keys(findRedeemReminders([],mature.trackers,now+8*3600).trackers).length===0,
  "claimed or disappeared position clears timer");
assert(findRedeemReminders([{...settle,curPrice:0}],null,now+86400).due.length===0,
  "losing positions are never shown as reclaimable cash");
assert(findRedeemReminders([{...settle,size:3}],null,now+86400).due.length===0,
  "small redeemable dust is excluded by default");

// Price risk: alerts on transitions and rapid drops, not on rollout.
const atPrice=p=>({...market,curPrice:p,currentValue:100*p,avgPrice:.95});
const baseline=inspectPriceRisk([atPrice(.96)],null,now);
assert(baseline.raised.length===0,"first upgraded monitoring tick is silent");
const falling=inspectPriceRisk([atPrice(.89)],baseline.trackers,now+300);
assert(falling.raised.length===1&&falling.raised[0].reasons.length>=2,
  "fall below 0.90 + cost drawdown + fast fall merged into one risk event");
const riskMessage=priceRiskMessage("ChrisZyy",falling.raised,now+300);
assert(riskMessage.title.startsWith("🚨 RISK")&&
  riskMessage.desp.includes("0.9600")&&riskMessage.desp.includes("0.8900"),
  "price risk notification includes before/after marks");
const recovery=inspectPriceRisk([atPrice(.96)],falling.trackers,now+600);
const recross=inspectPriceRisk([atPrice(.89)],recovery.trackers,now+900);
assert(recross.raised.length===0,"24-hour price alert cooldown suppresses recross");
const nextDayUp=inspectPriceRisk([atPrice(.96)],recross.trackers,now+25*3600);
const nextDayDown=inspectPriceRisk([atPrice(.89)],nextDayUp.trackers,now+25*3600+300);
assert(nextDayDown.raised.length===1,"new risk crossing after cooldown alerts again");
assert(inspectPriceRisk([atPrice(.80)],null,now).raised.length===0,
  "already below threshold at upgrade is not backfilled as an alert");
assert(inspectPriceRisk([ready],null,now).raised.length===0,
  "redeemable positions are not treated as live market risk");

// Integration: live poll writes both trackers, sends RISK once, and still dedupes.
const database=new Map();
const storage={
 get:async k=>structuredClone(database.get(k)),
 put:async(k,v)=>{database.set(k,structuredClone(v))}
};
let positions=[atPrice(.96)],activity=[],notifications=[];
const env={WALLET_ADDRESS:walletA,
  MIN_POSITION_USD:"5",PUSH_URL:"https://11310.push.ft07.com/send/test.send",
  V2_SHADOW_ENABLED:"false",REDEEM_REMINDER_ENABLED:"true"};
const fakeFetch=async(url,init)=>{
  const s=String(url);
  if(s.includes("push.ft07.com")){
    notifications.push(JSON.parse(init.body));
    return {ok:true,json:async()=>({code:0})};
  }
  if(s.includes("polygon-bor-rpc.publicnode.com")||s.includes("polygon.drpc.org"))
    return {ok:true,json:async()=>({result:"0x0"})};
  return {ok:true,json:async()=>s.includes("/positions?")?positions:activity};
};
await poll(storage,env,fakeFetch,now);
assert(database.get("monitor").dailySnapshot?.openCount===1&&
  database.get("monitor").priceRiskTrackers?.[market.asset],
  "new wallet baseline persists digest and risk without sending");
positions=[atPrice(.89)];
await poll(storage,env,fakeFetch,now+300);
assert(notifications.length===1&&notifications[0].title.startsWith("🚨 RISK") &&
  database.get("monitor").dailySnapshot.openValue===89,
  "real poll enqueues price alert and latest valuation together");
await poll(storage,env,fakeFetch,now+600);
assert(notifications.length===1,"no duplicate risk messages while below threshold");
const rpStorage={
 get:async k=>structuredClone(rpMap.get(k)),
 put:async(k,v)=>rpMap.set(k,structuredClone(v))
};
const rpMap=new Map();positions=[settle];notifications=[];
await poll(rpStorage,env,fakeFetch,now);
await poll(rpStorage,env,fakeFetch,now+6*3600+300);
assert(notifications.length===1&&notifications[0].title.startsWith("💰 CLAIM") &&
  rpMap.get("monitor").redeemTrackers.r2.lastReminderAt===now+6*3600+300,
  "actual poll emits delayed claim reminder with saved cooldown state");


// Automatic-redemption accounts: suppress pending-claim notifications but
// send exactly one real redemption alert upon a new REDEEM activity.
const disabledDB=new Map(), disabledStorage={
  get:async key=>structuredClone(disabledDB.get(key)),
  put:async(key,value)=>{disabledDB.set(key,structuredClone(value))}
};
const autoEnv={...env,REDEEM_REMINDER_ENABLED:"false"};
positions=[settle];activity=[];notifications=[];
await poll(disabledStorage,autoEnv,fakeFetch,now);
await poll(disabledStorage,autoEnv,fakeFetch,now+6*3600+300);
assert(notifications.length===0,"auto-redeem wallets do not receive matured CLAIM");
positions=[];activity=[{
  type:"REDEEM",asset:"r2",conditionId:settle.conditionId,
  title:settle.title,outcome:settle.outcome,eventSlug:settle.eventSlug,
  transactionHash:"auto-redeem-tx",timestamp:now+6*3600+500,
  size:90,usdcSize:90
}];
await poll(disabledStorage,autoEnv,fakeFetch,now+6*3600+600);
assert(notifications.length===1 &&
  notifications[0].title.startsWith("💰 已赎回 · ChrisZyy · $90.00") &&
  notifications[0].desp.includes("实际到账"),
  "actual REDEEM delivers one confirmed redemption notification");
await poll(disabledStorage,autoEnv,fakeFetch,now+6*3600+900);
assert(notifications.length===1,"same redeemed activity never sends twice");

// Daily worker integration: three independent DO snapshots and one coordinator.
// Simulate internal Cloudflare DO routing without any external pushes.
const labels=[walletA,walletB,walletC];
const simMap=new Map();
const last=now-240;
let queuedCount=0;
const summary=summarizeWalletPositions([market,ready],last);
const simulation={
  idFromName:name=>name,
  get:id=>({
    fetch:async(url,init)=>{
      const pathname=new URL(String(url)).pathname;
      if(id==="_system_daily_digest_v1"){
        if(pathname==="/digest-state")
          return Response.json({ok:true,date:simMap.get("date")||null});
        if(pathname==="/digest-enqueue"){
          const body=JSON.parse(init.body);
          if(simMap.get("date")===body.day)
            return Response.json({ok:true,queued:false,accepted:0});
          simMap.set("date",body.day);
          simMap.set("item",body.item);
          queuedCount++;
          return Response.json({ok:true,queued:true,accepted:1,pending:0});
        }
        throw Error("Unexpected digest coordinator path");
      }
      assert(labels.includes(id),"only configured wallets queried");
      if(pathname==="/digest-snapshot")
        return Response.json({ok:true,snapshot:summary,lastSuccessAt:last});
      throw Error("Unexpected wallet digest route");
    }
  })
};
const digestEnv={WALLET_ADDRESSES:labels.join(","),MONITOR:simulation,
  DAILY_REPORT_ENABLED:"true"};
const rpc=async()=>({ok:true,json:async()=>({result:"0x0"})});
const dayMs=Date.parse("2026-10-24T00:00:00Z");
const processed=await runDailyDigest(digestEnv,rpc,dayMs);
assert(processed.queued&&queuedCount===1&&
  simMap.get("item").skipBalanceFooter&&
  simMap.get("item").desp.includes("RealChris"),
  "real daily orchestration aggregates three wallets into one account-aware report");
const duplicate=await runDailyDigest(digestEnv,rpc,dayMs+5*60_000);
assert(duplicate.skipped==="already_queued"&&queuedCount===1,
  "five-minute Cron retries never duplicate a daily report");
assert((await runDailyDigest(digestEnv,rpc,dayMs-5*60_000)).skipped==="outside_window",
  "outside 08:00 Beijing no reports");
const staleEnv={...digestEnv,MONITOR:{
  idFromName:n=>n,
  get:id=>({fetch:async(url)=>{
    if(new URL(String(url)).pathname==="/digest-state")
      return Response.json({ok:true,date:null});
    return Response.json({ok:true,snapshot:summary,lastSuccessAt:now-3000});
  }})
}};
let staleBlocked=false;
try{await runDailyDigest(staleEnv,rpc,dayMs)}catch{staleBlocked=true}
assert(staleBlocked,"stale wallet state blocks misleading daily report");
const object=new WalletMonitor({storage},{});
const snapResponse=await object.fetch(
  new Request("https://internal/digest-snapshot?wallet="+walletA));
assert(snapResponse.status===200&&(await snapResponse.json()).snapshot.openCount===1,
  "per-wallet DO read-only summary endpoint returns persisted snapshot");
console.log("Passed: daily 08:00 three-wallet digest, claim reminder/cooldown, price risk/cooldown and end-to-end polling");
