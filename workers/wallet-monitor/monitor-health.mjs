// Account-wide MONITOR health transitions. Three wallets share one Durable
// Object coordinator and one durable notification outbox. Pure functions are
// deliberately independent of wallet polling, trades, or settlement state.
export const DEFAULT_HEALTH_CONFIG = Object.freeze({
  rateLimitFailures:6,
  otherFailures:3,
  rateLimitSeconds:30*60,
  recoverSuccesses:3,
  cooldownSeconds:6*60*60,
  healthyMaxAgeSeconds:20*60
});

const valid = n => Number.isFinite(Number(n)) && Number(n)>0;
const clampText = s => String(s??"").replace(/[\r\n<>]/g," ").slice(0,140);
const timestamp = seconds => valid(seconds) ?
  new Date(Number(seconds)*1000).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"}) : "暂无";
const elapsed = (now,then) => valid(then) ? Math.max(0,Math.floor((now-then)/60)) : null;
const safeList = rows => (Array.isArray(rows)?rows:[]).filter(row=>
  row && typeof row==="object" && typeof row.wallet==="string" &&
  row.wallet.length>0
);

export function healthTransition(previous, rows, now, overrides={}) {
  const conf = {...DEFAULT_HEALTH_CONFIG,...overrides};
  const old = previous && typeof previous==="object" ? previous:{};
  const list = safeList(rows);
  if (!Number.isFinite(now) || now<=0) throw new Error("Invalid health tick");
  if (valid(old.lastTick) && now<=old.lastTick)
    return {state:old,event:null,affected:[],skipped:"duplicate"};
  if (!list.length) return {state:{...old,lastTick:now},event:null,affected:[],skipped:"no-wallets"};

  const degraded = list.filter(row=>{
    if (!row.initialized) return false;
    const failures=Number(row.consecutivePollFailures||0);
    if(failures<=0)return false;
    if(row.lastPollErrorKind==="rate_limit"){
      const lastOk=Number(row.lastSuccessAt || row.firstPollFailureAt);
      return failures>=conf.rateLimitFailures ||
        (valid(lastOk) && now-lastOk>=conf.rateLimitSeconds);
    }
    return failures>=conf.otherFailures;
  });

  const allStable=list.every(row=>row.initialized===true &&
    Number(row.consecutivePollSuccesses||0)>=conf.recoverSuccesses &&
    valid(row.lastSuccessAt) &&
    now-Number(row.lastSuccessAt)<=conf.healthyMaxAgeSeconds);
  const next={...old,lastTick:now};
  let event=null;
  let affected=degraded;
  if(old.active){
    if(allStable){
      next.active=false;
      next.lastRecoveredAt=now;
      if(old.notified){
        event="recovery";
        affected=list;
      }
      next.notified=false;
      next.affectedWallets=[];
    }else{
      next.active=true;
      next.affectedWallets=[...new Set([
        ...(Array.isArray(old.affectedWallets)?old.affectedWallets:[]),
        ...degraded.map(r=>r.wallet)
      ])];
      // If the initial warning was suppressed by the 6h cooldown, send one
      // consolidated notice only if the outage is still present after cooldown.
      if(!old.notified && degraded.length &&
          (!valid(old.lastAlertAt)||now-old.lastAlertAt>=conf.cooldownSeconds)){
        next.notified=true;
        next.lastAlertAt=now;
        event="warning";
      }
    }
  }else if(degraded.length){
    next.active=true;
    next.startedAt=now;
    next.affectedWallets=degraded.map(r=>r.wallet);
    const allowed=!valid(old.lastAlertAt)||now-old.lastAlertAt>=conf.cooldownSeconds;
    next.notified=allowed;
    if(allowed){
      next.lastAlertAt=now;
      event="warning";
    }
  }else{
    next.active=false;
    next.notified=false;
  }
  return {state:next,event,affected,skipped:null};
}

export function healthNotification(event, affected, now, lastState={}) {
  if(event!=="warning"&&event!=="recovery") return null;
  const list=safeList(affected);
  const body=[
    "### "+(event==="warning"?"⚠️ Polymarket 数据监控异常":"✅ Polymarket 数据监控恢复"),
    "**范围：** 多钱包监控汇总 · "+list.length+" 个钱包",
    "**北京时间：** "+timestamp(now),
    ""
  ];
  for(const row of list){
    const wallet=clampText(row.label || row.wallet);
    if(event==="warning"){
      const failures=Number(row.consecutivePollFailures||0);
      const age=elapsed(now,Number(row.lastSuccessAt));
      const type=row.lastPollErrorKind==="rate_limit"?"HTTP 429 限流":
        row.lastPollErrorKind==="network"?"网络/超时":
        row.lastPollErrorKind==="data_validation"?"上游数据校验异常":
        row.lastPollErrorKind==="upstream"?"上游 HTTP 5xx":"请求处理异常";
      body.push("#### "+wallet,
        "- 类型："+type,
        "- 连续失败："+failures+" 次（Cron 每 5 分钟）",
        "- 最后成功："+timestamp(row.lastSuccessAt)+(age!==null?"（约 "+age+" 分钟前）":""),
        row.lastPollErrorEndpoint?"- 端点：\`"+clampText(row.lastPollErrorEndpoint)+"\`":"",
        row.lastPollErrorCode?"- 上游错误码：\`"+clampText(row.lastPollErrorCode)+"\`":"",
        Number(row.lastPollErrorStatus)>0?"- HTTP 状态："+Number(row.lastPollErrorStatus):"",
        Number(row.lastPollRetryAfterSeconds)>0?"- Retry-After："+Math.round(row.lastPollRetryAfterSeconds)+" 秒":"",
        row.lastPollTraceId?"- Trace ID：\`"+clampText(row.lastPollTraceId)+"\`":"",
        valid(row.lastActivitySuccessAt)?
          "- 成交活动最近成功："+timestamp(row.lastActivitySuccessAt):"",
        row.activitySynced===true?"- 当前状态：**成交活动仍在同步，持仓快照暂不可用**":"",
        valid(row.nextAllowedPollAt) && row.nextAllowedPollAt>now?
          "- 下次允许重试："+timestamp(row.nextAllowedPollAt):"",
        "");
    }else{
      body.push("- **"+wallet+"**：连续 "+Math.round(row.consecutivePollSuccesses||0)+
        " 次成功；最新成功 "+timestamp(row.lastSuccessAt));
    }
  }
  body.push(event==="warning"
    ? "> 仅数据同步受到影响，不代表仓位异常；轮询继续按 Retry-After 退避，失败期间不会推进活动检查点。"
    : "> 所有监控钱包已连续成功 3 次。活动数据会从保留的检查点补查；仍应以实际链上交易及结算为准。");
  return {
    formatVersion:2,
    // Account-wide alert has no single wallet to query for pUSD.
    skipBalanceFooter:true,
    title:event==="warning"?
      "⚠️ MONITOR · 汇总异常 · "+list.length+" 个钱包":
      "✅ MONITOR 恢复 · "+list.length+" 个钱包",
    short:event==="warning"?
      "钱包监控异常，已合并多个钱包的同一轮故障":
      "多个钱包连续恢复正常；活动补查继续",
    desp:body.filter(Boolean).join("\n")
  };
}
