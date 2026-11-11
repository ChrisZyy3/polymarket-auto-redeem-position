import assert from "node:assert/strict";
import { positionCircuitGate, positionCircuitUpdate,
  beforePositionQuery,afterPositionQuery } from "./position-circuit.mjs";
import { dataApiJson } from "./data-client.mjs";
import { WalletMonitor } from "./worker.mjs";
import { poll, activityKey } from "./monitor.mjs";

// Pure state machine must honor retry and prevent concurrent recovery probes.
const g0=positionCircuitGate(null,1000,()=>0);
assert.equal(g0.allowed,true);
const failed=positionCircuitUpdate(g0.state,"429",1000,{random:()=>0});
assert.equal(failed.consecutive429,1);
assert.equal(failed.blockedUntil,1300);
assert.equal(positionCircuitGate(failed,1200).allowed,false);
const probe=positionCircuitGate(failed,1301,()=>0);
assert.equal(probe.allowed,true);
assert.equal(probe.reason,"recovery_probe");
assert.equal(positionCircuitGate(probe.state,1310).allowed,false);
const escalate=positionCircuitUpdate(probe.state,"429",1310,{random:()=>0});
assert.equal(escalate.blockedUntil,1910); // 10-minute next backoff.
const header=positionCircuitUpdate(escalate,"429",1920,{retryAfterMs:3_600_000,random:()=>0});
assert.equal(header.blockedUntil,5520);
const reset=positionCircuitUpdate(header,"ok",5521);
assert.equal(reset.consecutive429,0);
assert.equal(positionCircuitGate(reset,5522).allowed,true);
assert.equal(positionCircuitUpdate(escalate,"other",2000).probeLeaseUntil,0);

// Dedicated DO retains a single shared circuit; no global/static memory.
const circuitStore=new Map();
const circuitContext={storage:{
  get:async k=>structuredClone(circuitStore.get(k)),
  put:async(k,v)=>circuitStore.set(k,structuredClone(v))
}};
const circuitDO=new WalletMonitor(circuitContext,{});
const monitorStub={
  idFromName:name=>name,
  get:id=>{assert.equal(id,"_system_position_circuit_v1");return circuitDO;}
};
const circuitEnv={MONITOR:monitorStub};
const first=await beforePositionQuery(circuitEnv,10000);
assert.equal(first.allowed,true);
const reported=await afterPositionQuery(circuitEnv,10000,"429",600_000);
assert.equal(reported.consecutive429,1);
assert.equal((await beforePositionQuery(circuitEnv,10300)).allowed,false);
const gateData=await (await circuitDO.fetch(new Request("https://internal/position-circuit-status"))).json();
assert(gateData.state.blockedUntil>=10600);
assert.equal(circuitStore.has("monitor"),false,"rate circuit must not touch wallet state");

// V2 API diagnostics: official x-trace-id is captured, wallet URL is excluded.
let error;
try {
  await dataApiJson(async()=>({
    ok:false,status:429,
    headers:{get:name=>name==="retry-after"?"120":
      name==="x-trace-id"?"abcdef123456":null},
    json:async()=>({code:"rate_limited",trace_id:"other-12345"})
  }),"https://data-api.polymarket.com/v2/positions?user=0x1234",{
    random:()=>0,sleep:async()=>{throw Error("Retry-After must defer")}
  });
}catch(e){error=e}
assert.equal(error.status,429);
assert.equal(error.traceId,"abcdef123456");
assert.equal(error.errorCode,"rate_limited");
assert.equal(error.retryAfterMs,120000);
assert(!error.message.includes("0x1234"));
console.log("Passed: shared 429 circuit, probe lease, Retry-After, official x-trace-id");

// Full baseline followed by a 429: trade feed still sends verified fills,
// without changing the position checkpoint or firing settlement/risk alerts.
const wallet="0x052f4191cd324a348835a846d34df5b0061e53fb";
const walletStore=new Map(),notifications=[];
const storage={
  get:async k=>structuredClone(walletStore.get(k)),
  put:async(k,v)=>walletStore.set(k,structuredClone(v))
};
const env={WALLET_ADDRESS:wallet,DATA_API_PRIMARY:"v2",
  PUSH_URL:"https://12345.push.ft07.com/send/fake.send",
  MIN_POSITION_USD:"5",MIN_ACTIVITY_ALERT_USD:"100",
  RISK_ALERT_ENABLED:"false",LOW_APR_ALERT_ENABLED:"false",
  REDEEM_REMINDER_ENABLED:"false",MONITOR:monitorStub};
const currentPosition=()=>({
  token_id:"test-token",condition_id:"test-condition",outcome_index:0,
  title:"Monitor resilience test",event_slug:"monitor-test",
  outcome:"No",current_size:200,current_price:.90,current_value:180,
  avg_price:.80,entry_cost_usdc:160,total_cost_usdc:160,
  end_date:"2026-12-31",status:"OPEN",redeemable:false
});
const trade=(tx,ts,usd)=>({
  transaction_hash:tx,type:"TRADE",token_id:"test-token",
  condition_id:"test-condition",outcome_index:0,side:"BUY",
  timestamp:ts,size:usd/.9,usdc_size:usd,price:.9,
  title:"Monitor resilience test",outcome:"No",event_slug:"monitor-test"
});
let position429=false,events=[],positionCalls=0,activityCalls=0;
const fetcher=async(url,init)=>{
  const u=new URL(String(url));
  if(u.hostname.includes("push.ft07.com")){
    notifications.push(JSON.parse(init.body));
    return {ok:true,json:async()=>({code:0})};
  }
  if(u.hostname.includes("publicnode.org")||u.hostname.includes("drpc.org"))
    return {ok:true,json:async()=>({result:"0x0"})};
  if(u.pathname==="/v2/positions"){
    positionCalls++;
    if(position429)return {ok:false,status:429,
      headers:{get:key=>key==="retry-after"?"3600":key==="x-trace-id"?"aabbccdd0011":null},
      json:async()=>({code:"rate_limited"})};
    return {ok:true,json:async()=>({data:[currentPosition()],
      pagination:{next_cursor:null,has_more:false}})};
  }
  if(u.pathname==="/v2/activity"){
    activityCalls++;
    return {ok:true,json:async()=>({data:events,
      pagination:{next_cursor:null,has_more:false}})};
  }
  throw new Error("Unexpected URL: "+u.pathname);
};
await poll(storage,env,fetcher,20000,wallet);
assert.equal(walletStore.get("monitor").checkpoint,20000);
assert.equal(walletStore.get("monitor").lastSuccessAt,20000);
position429=true;
events=[trade("first-trade",20200,120)];
const down=await poll(storage,env,fetcher,20300,wallet);
assert.equal(down.positionsStale,true);
assert.equal(down.activitySynced,true);
assert.equal(down.lastPollErrorStatus,429);
assert.equal(down.lastPollErrorCode,"rate_limited");
assert.equal(down.lastPollTraceId,"aabbccdd0011");
assert.equal(walletStore.get("monitor").checkpoint,20000);
assert.equal(walletStore.get("monitor").lastSuccessAt,20000);
assert.equal(walletStore.get("monitor").activityCheckpoint,20300);
assert.equal(notifications.length,1);
assert(notifications[0].title.startsWith("🟢 BUY"));
assert(notifications[0].desp.includes("持仓接口限流"));
assert(!notifications[0].title.includes("OPEN"),"stale snapshots never infer OPEN");

// Next tick must NOT query positions until global backoff, but still detect
// another trade. The older trade must be deduped after overlapping read.
const countBefore=positionCalls;
events=[trade("first-trade",20200,120),trade("second-trade",20500,110)];
const blocked=await poll(storage,env,fetcher,20600,wallet);
assert.equal(blocked.positionsStale,true);
assert.equal(blocked.activitySynced,true);
assert.equal(positionCalls,countBefore,"no position queries during Retry-After");
assert.equal(activityCalls,2);
assert.equal(notifications.length,2);
assert(notifications[1].title.includes("$110.00"));
assert.equal(walletStore.get("monitor").checkpoint,20000);
assert.equal(walletStore.get("monitor").activityCheckpoint,20600);

// Recovery re-reads the full position book and activity overlap; no replay.
position429=false;
const restored=await poll(storage,env,fetcher,24000,wallet);
assert.equal(restored.positionsStale,undefined);
assert.equal(walletStore.get("monitor").checkpoint,24000);
assert.equal(walletStore.get("monitor").activityCheckpoint,24000);
assert.equal(walletStore.get("monitor").lastSuccessAt,24000);
assert.equal(walletStore.get("monitor").audit.consecutivePollFailures,0);
assert.equal(notifications.length,2,"recovery must not duplicate already sent trades");
assert(walletStore.get("monitor").seen[activityKey({
  transactionHash:"second-trade",type:"TRADE",asset:"test-token",
  conditionId:"test-condition",outcomeIndex:0,side:"BUY",
  timestamp:20500,size:110/.9,usdcSize:110,price:.9
})]!==undefined);
console.log("Passed: activity-only fallback preserves 100% of verified trades, retries, and checkpoints");
