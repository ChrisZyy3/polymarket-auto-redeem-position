import assert from "node:assert/strict";
import {healthTransition,healthNotification} from "./monitor-health.mjs";
import {WalletMonitor,coordinateMonitorHealth} from "./worker.mjs";
import {DataApiRequestError} from "./data-client.mjs";

const A="0x9f7eb5bc88342f01d18754be0439fad79ec282ce";
const B="0x24816c037cdc2c9bd979e69d777541cf560a9b79";
const C="0x052f4191cd324a348835a846d34df5b0061e53fb";
const wallets=[A,B,C];
const row=(wallet,patch={})=>({
  wallet,label:wallet===A?"PigsWallet":wallet===B?"RealChris":"ChrisZyy",
  initialized:true,lastSuccessAt:9000,consecutivePollFailures:0,
  consecutivePollSuccesses:5,firstPollFailureAt:null,lastPollFailureAt:null,
  lastPollErrorKind:null,lastPollErrorStatus:null,lastPollErrorEndpoint:null,
  lastPollTraceId:null,lastPollRetryAfterSeconds:null,nextAllowedPollAt:null,
  ...patch
});
const ok=wallets.map(a=>row(a));
const limited=[
  row(A,{consecutivePollFailures:6,consecutivePollSuccesses:0,
    lastSuccessAt:9000,lastPollErrorKind:"rate_limit",lastPollErrorStatus:429,
    lastPollErrorEndpoint:"/v2/positions",lastPollTraceId:"abcd1234-XYZ",
    lastPollRetryAfterSeconds:120,firstPollFailureAt:9000,lastPollFailureAt:10700}),
  row(B,{consecutivePollFailures:6,consecutivePollSuccesses:0,
    lastSuccessAt:9000,lastPollErrorKind:"rate_limit",lastPollErrorStatus:429,
    lastPollErrorEndpoint:"/v2/activity",firstPollFailureAt:9000,lastPollFailureAt:10700}),
  row(C,{lastSuccessAt:10700})
];
// Neither 2 rate-limit failures nor 5 when last success was recent is actionable.
const partial=limited.map(r=>r===limited[2]?r:{...r,
  consecutivePollFailures:2,lastSuccessAt:10300});
const early=healthTransition(null,partial,10800);
assert.equal(early.event,null);
const warning=healthTransition(early.state,limited,10810);
assert.equal(warning.event,"warning");
assert.equal(warning.affected.length,2);
const msg=healthNotification(warning.event,warning.affected,10810);
assert.ok(msg.title.includes("汇总异常 · 2 个钱包"));
assert.ok(msg.desp.includes("PigsWallet")&&msg.desp.includes("RealChris"));
assert.ok(msg.desp.includes("/v2/positions")&&msg.desp.includes("429"));
assert.ok(!msg.desp.includes("undefined"));
const repeat=healthTransition(warning.state,limited,11110);
assert.equal(repeat.event,null);
const duplicate=healthTransition(warning.state,limited,10810);
assert.equal(duplicate.skipped,"duplicate");
assert.equal(duplicate.event,null);

// A transient success must not trigger recovery.
const once=healthTransition(repeat.state,ok.map(r=>({...r,
  lastSuccessAt:11410,consecutivePollSuccesses:1})),11410);
assert.equal(once.event,null);
const twice=healthTransition(once.state,ok.map(r=>({...r,
  lastSuccessAt:11710,consecutivePollSuccesses:2})),11710);
assert.equal(twice.event,null);
const thrice=healthTransition(twice.state,ok.map(r=>({...r,
  lastSuccessAt:12010,consecutivePollSuccesses:3})),12010);
assert.equal(thrice.event,"recovery");
assert.equal(thrice.affected.length,3);
assert.ok(healthNotification("recovery",thrice.affected,12010).title.includes("3 个钱包"));
assert.equal(healthTransition(thrice.state,ok.map(r=>({...r,
  lastSuccessAt:12310,consecutivePollSuccesses:4})),12310).event,null);

// Flapping within 6 hours does not send a new MONITOR alert or recovery.
const flap=healthTransition(thrice.state,limited,12610);
assert.equal(flap.event,null);
assert.equal(flap.state.active,true);
assert.equal(flap.state.notified,false);
const flapHealthy=healthTransition(flap.state,ok.map(r=>({...r,
  lastSuccessAt:13000,consecutivePollSuccesses:3})),13000);
assert.equal(flapHealthy.event,null);
const sixHoursLater=healthTransition(flapHealthy.state,limited,10810+21601);
assert.equal(sixHoursLater.event,"warning");

// Single 429 with long Retry-After: escalation is based on last-success age.
const longPause=healthTransition(null,[
  row(A,{consecutivePollFailures:1,consecutivePollSuccesses:0,
    lastSuccessAt:10000,lastPollErrorKind:"rate_limit",
    lastPollRetryAfterSeconds:3600,nextAllowedPollAt:13600}),
  row(B,{lastSuccessAt:11880}),
  row(C,{lastSuccessAt:11880})
],11880);
assert.equal(longPause.event,"warning");

// Unexpected errors preserve faster 3-round warning.
const other=healthTransition(null,[
  row(A,{lastPollErrorKind:"data_validation",consecutivePollFailures:3,
    consecutivePollSuccesses:0,lastSuccessAt:9000}),
  row(B,{lastSuccessAt:9500}),row(C,{lastSuccessAt:9500})
],9600);
assert.equal(other.event,"warning");

// Retry metadata remains structured; the wallet/query is never in the message.
const error=new DataApiRequestError({host:"data-api.polymarket.com",
  endpoint:"/v2/positions",status:429,retryAfterMs:45_000,traceId:"abcde-1234"});
assert.equal(error.status,429);
assert.equal(error.kind,"rate_limit");
assert.equal(error.endpoint,"/v2/positions");
assert.equal(error.retryAfterMs,45_000);
assert.ok(!error.message.includes("0x"));
console.log("Passed: aggregated 429/other failures, 6h cooldown, 3-success recovery, 429 pause, safe diagnostics");

// Verify the durable coordinator queues and sends once per event, then retries
// ServerChan failures through its existing outbox alarm.
const map=new Map(), sends=[];
let shouldReject=false, alarmAt=null;
const storage={
 get:async key=>structuredClone(map.get(key)),
 put:async(key,value)=>map.set(key,structuredClone(value)),
 getAlarm:async()=>alarmAt,
 setAlarm:async value=>{alarmAt=value;},
 deleteAlarm:async()=>{alarmAt=null;}
};
const oldFetch=globalThis.fetch;
globalThis.fetch=async url=>{
  if(!String(url).includes("push.ft07.com"))throw Error("Unexpected network destination");
  sends.push(true);
  return {ok:true,json:async()=>({code:shouldReject?1:0})};
};
try {
 const object=new WalletMonitor({storage},{
   PUSH_URL:"https://11310.push.ft07.com/send/test.send"
 });
 const batch=async(tick,rows)=>{
   const r=await object.fetch(new Request("https://internal/monitor-health-batch",{
     method:"POST",headers:{"content-type":"application/json"},
     body:JSON.stringify({tick,wallets:rows})
   }));
   assert.equal(r.status,200);
   return r.json();
 };
 shouldReject=true;
 const first=await batch(10810,limited);
 assert.equal(first.event,"warning");
 assert.equal(first.queued,1);
 assert.equal(map.get("monitor").pending.length,1);
 assert.ok(alarmAt!==null,"failed notification persisted and retry alarm set");
 // A repeated scheduler tick must not queue a duplicate.
 await batch(10810,limited);
 assert.equal(map.get("monitor").pending.length,1);
 shouldReject=false;
 await object.alarm();
 assert.equal(map.get("monitor").pending.length,0);
 assert.equal(map.get("monitor").audit.pushCount,1);
 assert.equal(map.get("monitor").audit.pushFailureCount,1);
 await batch(11110,limited);
 assert.equal(map.get("monitor").audit.pushCount,1);
 await batch(11410,ok.map(r=>({...r,
   lastSuccessAt:11410,consecutivePollSuccesses:1})));
 await batch(11710,ok.map(r=>({...r,
   lastSuccessAt:11710,consecutivePollSuccesses:2})));
 const recovered=await batch(12010,ok.map(r=>({...r,
   lastSuccessAt:12010,consecutivePollSuccesses:3})));
 assert.equal(recovered.event,"recovery");
 assert.equal(map.get("monitor").audit.pushCount,2);
 const current=await object.fetch(new Request("https://internal/monitor-health-status"));
 const st=await current.json();
 assert.equal(st.pending,0);
 assert.equal(st.state.active,false);
}finally{
 globalThis.fetch=oldFetch;
}
console.log("Passed: Durable Object coordinator single push, idempotency, retries, single recovery");


// Existing poll() returns "initialized:false" on every non-baseline SUCCESS;
// do not treat it as an uninitialized DO when summarizing account health.
const batches=[];
const coordinatorStub={
  idFromName:name=>name,
  get:name=>({fetch:async(_url,opts)=>{
    assert.equal(name,"_system_monitor_health_v1");
    batches.push(JSON.parse(opts.body));
    return Response.json({ok:true,event:null});
  }})
};
const integrated=await coordinateMonitorHealth({MONITOR:coordinatorStub},{
  wallets:[
    {wallet:A,initialized:false,lastSuccessAt:20000,consecutivePollSuccesses:4},
    {wallet:B,initialized:false,lastSuccessAt:20000,consecutivePollSuccesses:4},
    {wallet:C,initialized:false,lastSuccessAt:20000,consecutivePollSuccesses:4}
  ]
},20_000_000);
assert.equal(batches.length,1);
assert.equal(batches[0].wallets.length,3);
assert(batches[0].wallets.every(w=>w.initialized===true),
  "successful non-baseline polls are initialized wallet states for recovery");
console.log("Passed: account coordinator receives correct wallet initialization semantics");
