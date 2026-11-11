import { poll, push, auditSnapshot, deliverPending, recordPollFailure, walletLabel } from "./monitor.mjs";
import { walletPusdBalance } from "./notification.mjs";
import { digestDate, digestWindow, composeDailyDigest,
  validDailySnapshots, enqueueDigest } from "./asset-digest.mjs";
import { healthSummary, HEALTH_STALE_SECONDS } from "./health.mjs";
import { healthTransition, healthNotification } from "./monitor-health.mjs";

// One configured wallet per Durable Object. Preserve the legacy address as a fallback.
export function walletAddresses(env) {
  const raw = String(env.WALLET_ADDRESSES ?? "").trim();
  const values = raw ? (raw.startsWith("[") ? JSON.parse(raw) : raw.split(/[\s,;，、；]+/)) : [env.WALLET_ADDRESS];
  if (!Array.isArray(values) || values.length === 0 || values.length > 20) {
    throw new Error("WALLET_ADDRESSES must contain 1-20 wallet addresses");
  }
  const unique = [];
  const seen = new Set();
  for (const value of values) {
    const address = String(value ?? "").trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(address)) throw new Error("Invalid wallet address in WALLET_ADDRESSES");
    if (!seen.has(address)) {
      seen.add(address);
      unique.push(address);
    }
  }
  return unique;
}

export class WalletMonitor {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.running = null;
  }

  async alarm() {
    // Alarm is a separate delivery channel. Existing pending messages are
    // retried independently of Polymarket Data API availability.
    if (this.running) await this.running;
    if (!this.running) {
      this.running = deliverPending(this.ctx.storage, this.env, fetch, undefined, "alarm")
        .finally(() => { this.running = null; });
    }
    await this.running;
  }

  async fetch(request) {
    const url = new URL(request.url);
    // These endpoints are reachable only through this Worker binding, not the
    // public HTTP router. Use a dedicated DO name, never a monitored wallet ID.
    if(url.pathname==="/digest-state"){
      const state=await this.ctx.storage.get("monitor");
      return Response.json({ok:true,date:state?.lastDailyDate??null});
    }
    if(url.pathname==="/digest-enqueue" && request.method==="POST"){
      try{
        const body=await request.json();
        const queued=await enqueueDigest(this.ctx.storage,body.day,body.item,body.now);
        if(queued.queued){
          // All writes happen before the push. Alarm retries deferred messages.
          const sent=await deliverPending(this.ctx.storage,this.env,fetch,body.now,"digest");
          return Response.json({...queued,accepted:sent.accepted,pending:sent.pending});
        }
        return Response.json({...queued,accepted:0});
      }catch(error){
        console.error("wallet_digest_queue_failed",String(error?.message||"error").slice(0,140));
        return Response.json({ok:false,error:"Digest enqueue failure"},{status:502});
      }
    }
    // Dedicated account-wide health coordinator uses its own DO ID and
    // independently persisted outbox. It must not share per-wallet checkpoints
    // or the daily-digest coordinator's storage.
    if (url.pathname==="/monitor-health-batch" && request.method==="POST") {
      if(this.running) await this.running;
      const job=(async()=>{
        const {tick,wallets}=await request.json();
        const now=Number(tick);
        if(!Number.isFinite(now)||now<=0||!Array.isArray(wallets)||
           wallets.length<1||wallets.length>20)
          return Response.json({ok:false,error:"Invalid health batch"},{status:400});
        let saved=await this.ctx.storage.get("monitor");
        if(!saved) saved={user:"_system_monitor_health_v1",pending:[],
          audit:{pushCount:0,pushFailureCount:0}};
        const transition=healthTransition(saved.healthState,wallets,now,{
          rateLimitFailures:Number(this.env.MONITOR_429_FAILURE_ROUNDS??6),
          otherFailures:Number(this.env.MONITOR_OTHER_FAILURE_ROUNDS??3),
          rateLimitSeconds:Number(this.env.MONITOR_429_ALERT_MINUTES??30)*60,
          recoverSuccesses:Number(this.env.MONITOR_RECOVERY_SUCCESS_ROUNDS??3),
          cooldownSeconds:Number(this.env.MONITOR_ALERT_COOLDOWN_HOURS??6)*3600
        });
        saved.healthState=transition.state;
        let queued=0;
        const note=healthNotification(transition.event,transition.affected,now);
        if(note){
          saved.pending??=[];
          saved.pending.push(note);
          queued=1;
        }
        await this.ctx.storage.put("monitor",saved);
        const delivery=await deliverPending(this.ctx.storage,this.env,fetch,now,"health");
        console.info("wallet_health_aggregate",JSON.stringify({
          at:now,event:transition.event||"none",
          affected:transition.affected?.length||0,
          queued,accepted:delivery.accepted,pending:delivery.pending
        }));
        return Response.json({ok:true,event:transition.event,
          queued,accepted:delivery.accepted,pending:delivery.pending});
      })();
      this.running=job.finally(()=>{this.running=null});
      try{return await this.running;}
      catch(error){
        console.error("wallet_health_aggregate_failed",String(error?.message||"error").slice(0,150));
        return Response.json({ok:false,error:"Health coordinator failed"},{status:502});
      }
    }
    if(url.pathname==="/monitor-health-status" && request.method==="GET"){
      const saved=await this.ctx.storage.get("monitor");
      return Response.json({ok:true,state:saved?.healthState||null,
        pending:saved?.pending?.length||0,
        sent:saved?.audit?.pushCount||0});
    }
    const wallet = url.searchParams.get("wallet");
    if (!wallet || !/^0x[a-f0-9]{40}$/.test(wallet)) {
      return Response.json({ ok: false, error: "Invalid wallet" }, { status: 400 });
    }
    if (url.pathname === "/health") {
      const s = await this.ctx.storage.get("monitor");
      return Response.json({ ok: true, initialized: Boolean(s),
        lastSuccessAt: s?.lastSuccessAt ?? null });
    }
    if (url.pathname === "/digest-snapshot" && request.method === "GET") {
      const state=await this.ctx.storage.get("monitor");
      return Response.json({ok:Boolean(state?.dailySnapshot),
        lastSuccessAt:state?.lastSuccessAt??null,
        snapshot:state?.dailySnapshot??null});
    }
    if (url.pathname === "/status") {
      const s = await this.ctx.storage.get("monitor");
      return Response.json({
        initialized: !!s,
        checkpoint: s?.checkpoint,
        lastSuccessAt: s?.lastSuccessAt,
        pending: s?.pending?.length ?? 0,
        ...auditSnapshot(s)
      });
    }
    if (url.pathname !== "/poll") return new Response("Not found", { status: 404 });
    // Each wallet has its own DO and checkpoint; overlapping invocations coalesce.
    if (!this.running) {
      this.running = poll(this.ctx.storage, this.env, fetch, undefined, wallet)
        .finally(() => { this.running = null; });
    }
    try {
      return Response.json({ ok: true, ...await this.running });
    } catch (error) {
      // Best-effort health tracking must not obscure the original failure.
      let diagnosis=null;
      try {
        diagnosis=await recordPollFailure(this.ctx.storage,this.env,fetch,
          Math.floor(Date.now()/1000),error);
      } catch (healthError) {
        console.error("Wallet health bookkeeping failed for " + wallet,
          healthError?.message || "Unknown error");
      }
      // Do not log request URLs: PUSH_URL contains the send key.
      console.error("Wallet poll failed for " + wallet, error?.message || "Unknown error");
      return Response.json({ok:false,
        error:"Poll failed; check Worker logs",
        initialized:diagnosis?.initialized??false,
        lastSuccessAt:diagnosis?.lastSuccessAt??null,
        consecutivePollFailures:diagnosis?.consecutivePollFailures??0,
        consecutivePollSuccesses:0,
        firstPollFailureAt:diagnosis?.firstPollFailureAt??null,
        lastPollFailureAt:diagnosis?.lastPollFailureAt??null,
        lastPollErrorKind:diagnosis?.lastPollErrorKind??"other",
        lastPollErrorStatus:diagnosis?.lastPollErrorStatus??null,
        lastPollErrorEndpoint:diagnosis?.lastPollErrorEndpoint??null,
        lastPollTraceId:diagnosis?.lastPollTraceId??null,
        lastPollRetryAfterSeconds:diagnosis?.lastPollRetryAfterSeconds??null,
        nextAllowedPollAt:diagnosis?.nextAllowedPollAt??null
      },{status:502});
    }
  }
}

function instance(env, wallet) {
  // Same ID as the original single-wallet worker: keeps its existing state.
  return env.MONITOR.get(env.MONITOR.idFromName(wallet));
}

async function runAll(env, route) {
  const wallets = walletAddresses(env);
  const results = await Promise.all(wallets.map(async (wallet, index) => {
    // Spread API calls over ~5-6 seconds to reduce Data API rate-limit bursts.
    if (route==="poll" && index>0){
      await new Promise(resolve=>setTimeout(resolve,index*2500+
        Math.floor(Math.random()*600)));
    }
    try {
      const response = await instance(env, wallet).fetch(
        "https://internal/" + route + "?wallet=" + wallet,
        { method: route === "status" || route === "health" ? "GET" : "POST" }
      );
      const body = await response.json();
      return { wallet, ...body, ok: response.ok && body.ok !== false };
    } catch (error) {
      console.error("Wallet " + route + " request failed for " + wallet, error?.message || "Unknown error");
      return { wallet, ok: false, error: "Worker request failed" };
    }
  }));
  return { ok: results.every(r => r.ok), wallets: results };
}


// One coordinator DO combines all three wallets' health transitions per
// scheduled tick. It owns the only MONITOR alert/recovery outbox.
export async function coordinateMonitorHealth(env, pollResult, tickMs=Date.now()) {
  const coordinator=env.MONITOR.get(env.MONITOR.idFromName("_system_monitor_health_v1"));
  const now=Math.floor(tickMs/1000);
  const body={tick:now,wallets:pollResult.wallets.map(row=>({
    wallet:row.wallet,
    label:walletLabel(row.wallet),
    initialized:row.initialized===true,
    lastSuccessAt:row.lastSuccessAt??null,
    consecutivePollFailures:row.consecutivePollFailures??0,
    consecutivePollSuccesses:row.consecutivePollSuccesses??0,
    firstPollFailureAt:row.firstPollFailureAt??null,
    lastPollFailureAt:row.lastPollFailureAt??null,
    lastPollErrorKind:row.lastPollErrorKind??null,
    lastPollErrorStatus:row.lastPollErrorStatus??null,
    lastPollErrorEndpoint:row.lastPollErrorEndpoint??null,
    lastPollTraceId:row.lastPollTraceId??null,
    lastPollRetryAfterSeconds:row.lastPollRetryAfterSeconds??null,
    nextAllowedPollAt:row.nextAllowedPollAt??null
  }))};
  const r=await coordinator.fetch("https://internal/monitor-health-batch",{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify(body)
  });
  if(!r.ok)throw new Error("MONITOR coordinator request failed");
  return r.json();
}

export async function runDailyDigest(env, fetcher=fetch, ms=Date.now()) {
  if(String(env.DAILY_REPORT_ENABLED??"true")!=="true")
    return {skipped:"disabled"};
  if(!digestWindow(ms))return {skipped:"outside_window"};
  const day=digestDate(ms),now=Math.floor(ms/1000);
  const coordinator=env.MONITOR.get(env.MONITOR.idFromName("_system_daily_digest_v1"));
  const statusResp=await coordinator.fetch("https://internal/digest-state");
  if(!statusResp.ok)throw Error("Daily digest coordinator unavailable");
  const status=await statusResp.json();
  if(status.date===day)return {skipped:"already_queued",day};
  const rows=await Promise.all(walletAddresses(env).map(async wallet=>{
    const response=await instance(env,wallet).fetch(
      "https://internal/digest-snapshot?wallet="+wallet,{method:"GET"});
    if(!response.ok)throw Error("Daily digest wallet snapshot request failed");
    const row=await response.json();
    return {...row,label:walletLabel(wallet),balance:null,wallet};
  }));
  if(!validDailySnapshots(rows,now))
    throw Error("Daily digest wallet data incomplete or stale; retry next five-minute tick");
  // Balances do NOT determine whether the report is sent. A failed RPC shows
  // unavailable, never a fabricated zero.
  await Promise.all(rows.map(async row=>{
    row.balance=await walletPusdBalance(fetcher,row.wallet);
  }));
  const item=composeDailyDigest(day,rows);
  const done=await coordinator.fetch("https://internal/digest-enqueue",{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({day,item,now})
  });
  if(!done.ok)throw Error("Daily digest coordinator failed to queue report");
  const result=await done.json();
  console.info("wallet_daily_digest",JSON.stringify({
    day,queued:result.queued===true,wallets:rows.length,
    accepted:result.accepted??0,pending:result.pending??0
  }));
  return result;
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil((async () => {
      const result = await runAll(env,"poll");
      try {
        await coordinateMonitorHealth(env,result,
          Number.isFinite(_event?.scheduledTime)?_event.scheduledTime:Date.now());
      } catch (error) {
        // A coordinator outage must not erase the successful wallet checkpoint.
        // Next scheduled tick retries from persistent per-wallet audits.
        console.error("wallet_health_coordinator_deferred",
          String(error?.message||"error").slice(0,150));
      }
      if (!result.ok) {
        const failed = result.wallets.filter(r => !r.ok).map(r => r.wallet);
        throw new Error("Wallet monitor poll failed for: " + failed.join(", "));
      }
      // Existing five-minute Cron doubles as the Beijing 08:00 daily scheduler.
      // A singleton coordinator DO makes every tick safely idempotent.
      try {
        await runDailyDigest(env,fetch,Number.isFinite(_event?.scheduledTime) ? _event.scheduledTime : Date.now());
      } catch {
        // The next five-minute tick within the 08:00 hour will retry.
        // Never fail healthy wallet polling because of a digest/RPC outage.
        console.error("wallet_daily_digest_deferred",JSON.stringify({
          at:Math.floor(Date.now()/1000),reason:"snapshot_or_provider_unavailable"
        }));
      }
    })());
  },

  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    // Independent external watchdog: intentionally exposes only aggregate
    // health and count. All other routes remain fully authenticated.
    if (request.method === "GET" && path === "/health") {
      try {
        const result = await runAll(env, "health");
        const publicHealth = healthSummary(result.wallets);
        return Response.json(publicHealth, {
          status: publicHealth.ok ? 200 : 503,
          headers: { "cache-control": "no-store" }
        });
      } catch {
        return Response.json({ ok: false, checked: 0 }, {
          status: 503,
          headers: { "cache-control": "no-store" }
        });
      }
    }
    if (!env.MONITOR_SECRET ||
        request.headers.get("authorization") !== "Bearer " + env.MONITOR_SECRET) {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    if(path==="/monitor-health-status" && request.method==="GET"){
      const coordinator=env.MONITOR.get(env.MONITOR.idFromName("_system_monitor_health_v1"));
      return coordinator.fetch("https://internal/monitor-health-status",{method:"GET"});
    }
    if (path === "/status" && request.method === "GET") {
      return Response.json(await runAll(env, "status"));
    }
    if (path === "/poll" && request.method === "POST") {
      const result = await runAll(env, "poll");
      return Response.json(result, { status: result.ok ? 200 : 502 });
    }
    if (path === "/test" && request.method === "POST") {
      try {
        await push(env, fetch, "Polymarket · 推送测试", "多钱包地址监控通知通道测试成功。");
        console.info("push_accepted", JSON.stringify({ kind: "test", provider: "serverchan",
          at: Math.floor(Date.now() / 1000) }));
        return Response.json({ ok: true });
      } catch {
        return Response.json({ ok: false, error: "Push failed" }, { status: 502 });
      }
    }
    return new Response("Not found", { status: 404 });
  }
};
