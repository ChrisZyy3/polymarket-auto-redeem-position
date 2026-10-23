import {
  normalizeV2Position, normalizeV2Activity, primaryV2Positions,
  primaryV2Activity, cutoverIdentity, legacyActivityIdentities
} from "./data-api-v2-primary.mjs";
import { poll, activityKey, positionStatus } from "./monitor.mjs";

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const wallet = "0x052f4191cd324a348835a846d34df5b0061e53fb";
const v2Position = (overrides={}) => ({
  token_id:"id-YES",condition_id:"cond-1",outcome_index:0,outcome:"Yes",
  title:"Will the test outcome win?",event_slug:"test-outcome",
  end_date:"2026-12-31",current_size:120, total_size:300,
  current_price:.95,current_value:114,avg_price:.85,
  entry_cost_usdc:99, entry_fees_usdc:1,total_cost_usdc:100,
  redeemable:false,status:"OPEN",realized_pnl:12,
  unrealized_pnl:15,...overrides
});
const v2Trade = (overrides={}) => ({
  transaction_hash:"tx-old",type:"TRADE",token_id:"id-YES",
  condition_id:"cond-1",outcome_index:0,side:"BUY",
  timestamp:1020,size:5,usdc_size:4.51,price:.9,
  title:"Will the test outcome win?",outcome:"Yes",event_slug:"test-outcome",
  ...overrides
});
const normalized=normalizeV2Position(v2Position());
assert(normalized.asset==="id-YES" && normalized.size===120 &&
  normalized.grossInitialValue===100 && normalized.initialValue===99 &&
  normalized.entryFeesUsdc===1 && normalized.curPrice===.95 &&
  normalized.eventSlug==="test-outcome" && normalized.realizedPnl===12,
  "v2 positions map to stable v1-style monitor fields, including fee basis");
assert(normalized.size!==300,"lifetime total_size never masquerades as current holdings");
assert(normalizeV2Position(v2Position({current_size:null}))===null ? false : true,
  "valid normalizer returns a position"); // Intentionally followed by malformed-row test.
let badPosition=false;
try{normalizeV2Position(v2Position({current_size:null}))}catch{badPosition=true}
assert(badPosition,"invalid missing position size fails rather than looking like zero holdings");
assert(positionStatus(normalizeV2Position(v2Position({current_price:null,redeemable:true})))==="unknown",
  "missing resolution price must NOT be classified as LOSS");
const act=normalizeV2Activity(v2Trade());
assert(act.transactionHash==="tx-old" && act.asset==="id-YES" &&
  act.usdcSize===4.51 && act.timestamp===1020 && act.side==="BUY",
  "v2 activity maps to stable v1 field names");
let badActivity=false;
try{normalizeV2Activity(v2Trade({token_id:null}))}catch{badActivity=true}
assert(badActivity,"v2 activity missing deduplication identity fails safely");
const original={
  transactionHash:"tx-old",type:"TRADE",asset:"id-YES",
  conditionId:"cond-1",outcomeIndex:0,side:"BUY",timestamp:1020,
  size:5,usdcSize:4.5,price:.9
};
const known=legacyActivityIdentities({[activityKey(original)]:1020});
assert(known.has(cutoverIdentity(act))&&cutoverIdentity(original)===cutoverIdentity(act),
  "v1/v2 same fill identity is deduped despite fee-inclusive amount rounding");

let urls=[], mockedCursor=0;
const positionsTwoPages=async(url)=>{
  urls.push(String(url));
  const u=new URL(String(url));
  assert(u.pathname==="/v2/positions"&&u.searchParams.get("user")===wallet,
    "v2 position query scoped to exact wallet");
  assert(u.searchParams.get("status")==="OPEN"&&u.searchParams.get("include_archived")==="true",
    "v2 OPEN includes redeemed-not-yet holdings and archived");
  assert(u.searchParams.get("filter_amount")==="0"&&
    !u.searchParams.has("offset"),"v2 never uses legacy offset or omits dust");
  const second=u.searchParams.get("cursor")==="page-2";
  return {ok:true,json:async()=>({
    data:second?[v2Position({token_id:"id-NO",current_size:50})]:[v2Position()],
    pagination:{next_cursor:second?null:"page-2",has_more:!second}
  })};
};
const positions=await primaryV2Positions(positionsTwoPages,wallet);
assert(positions.length===2 && mockedCursor===0 && urls.length===2 &&
  urls[1].includes("cursor=page-2"),"positions walk signed v2 cursor across pages");
const descending=async(url)=>{
  const u=new URL(String(url));
  assert(u.pathname==="/v2/activity"&&
    u.searchParams.get("type")==="TRADE,REDEEM" &&
    u.searchParams.get("start")==="1000"&&
    u.searchParams.get("sort_by")==="TIMESTAMP"&&
    u.searchParams.get("sort_direction")==="DESC"&&
    !u.searchParams.has("offset"),"v2 activity uses keyset cursor and the exact types");
  const second=u.searchParams.get("cursor")==="older";
  return {ok:true,json:async()=>({
    data:second?[v2Trade({timestamp:1100,transaction_hash:"tx-earlier"})]:
      [v2Trade({timestamp:1300,transaction_hash:"tx-later"})],
    pagination:{has_more:!second,next_cursor:second?null:"older"}
  })};
};
const chronological=await primaryV2Activity(descending,wallet,1000);
assert(chronological.length===2 && chronological[0].timestamp===1100 &&
  chronological[1].timestamp===1300,"v2 DESC seek results displayed in chronological order");
let loopRejected=false;
try{
 await primaryV2Activity(async()=>({ok:true,json:async()=>({
    data:[v2Trade()],pagination:{has_more:true,next_cursor:"repeat"}
  })}),wallet,1000);
}catch{loopRejected=true}
assert(loopRejected,"repeated cursor prevents advancing checkpoint after truncated feed");
let inconsistentRejected=false;
try{
 await primaryV2Positions(async()=>({ok:true,json:async()=>({
   data:[],pagination:{has_more:true,next_cursor:null}
 })}),wallet);
}catch{inconsistentRejected=true}
assert(inconsistentRejected,"inconsistent cursor/has_more prevents silent data loss");
let invalidEnvelope=false;
try{await primaryV2Positions(async()=>({ok:true,json:async()=>({data:[]})}),wallet)}
catch{invalidEnvelope=true}
assert(invalidEnvelope,"invalid v2 envelope cannot be mistaken for an empty wallet");

// Full per-wallet cutover: existing v1 wallet state is NOT reset and a
// previously notified fill isn't duplicated despite differing cash size.
// Only v2 endpoints are used after setting DATA_API_PRIMARY=v2.
const state=new Map(), pushed=[],clock={now:1000},called=[];
const storage={
  get:async key=>structuredClone(state.get(key)),
  put:async (key,value)=>{state.set(key,structuredClone(value))}
};
const envV1={WALLET_ADDRESS:wallet,PUSH_URL:"https://12345.push.ft07.com/send/fake.send",
  MIN_POSITION_USD:"5",V2_SHADOW_ENABLED:"false",RISK_ALERT_ENABLED:"false",
  REDEEM_REMINDER_ENABLED:"false"};
let priorPosition=[{
  asset:"id-YES",conditionId:"cond-1",outcomeIndex:0,side:"Yes",
  size:100,avgPrice:.85,curPrice:.95,currentValue:95,initialValue:85,
  title:"Will the test outcome win?",outcome:"Yes",eventSlug:"test-outcome",
  endDate:"2026-12-31",redeemable:false
}],pastActivities=[];
let currentV2=[v2Position({current_size:100,total_size:200,
  current_value:95,entry_cost_usdc:85,total_cost_usdc:85,avg_price:.85})];
let currentV2Events=[];
const fetcher=async (url, init)=>{
  const str=String(url);called.push(str);
  if(str.includes("push.ft07.com")){
    const p=JSON.parse(init.body);
    pushed.push(p);
    return {ok:true,json:async()=>({code:0})};
  }
  if(str.includes("polygon-bor-rpc.publicnode.com")||
     str.includes("polygon.drpc.org"))
    return {ok:true,json:async()=>({result:"0x0"})};
  const u=new URL(str);
  if(u.pathname==="/positions")
    return {ok:true,json:async()=>priorPosition};
  if(u.pathname==="/activity")
    return {ok:true,json:async()=>pastActivities};
  if(u.pathname==="/v2/positions")
    return {ok:true,json:async()=>({data:currentV2,
      pagination:{has_more:false,next_cursor:null}})};
  if(u.pathname==="/v2/activity")
    return {ok:true,json:async()=>({data:currentV2Events,
      pagination:{has_more:false,next_cursor:null}})};
  throw new Error("Unexpected endpoint "+u.pathname);
};
await poll(storage,envV1,fetcher,1000);
assert(state.get("monitor").dataApiPrimary==="v1"&&pushed.length===0,
  "initial v1 wallet has stable checkpoint and no initial alerts");
pastActivities=[original];
await poll(storage,envV1,fetcher,1060);
assert(pushed.length===1&&state.get("monitor").checkpoint===1060,
  "v1 notified old trade and persisted seen identity");
const envV2={...envV1,DATA_API_PRIMARY:"v2",V2_SHADOW_ENABLED:"true"};
const oldV2=v2Trade({usdc_size:4.51});
const newer=v2Trade({transaction_hash:"tx-new",timestamp:1350,size:20,
  usdc_size:17,price:.85});
currentV2=[v2Position()];
currentV2Events=[newer,oldV2]; // reverse, as served by v2 DESC feed
const beforeCutover=called.length;
const cut=await poll(storage,envV2,fetcher,1380);
const sinceMigration=called.slice(beforeCutover);
assert(cut.alerts===1&&pushed.length===2&&
  pushed[1].title.startsWith("📈 ADD") &&
  state.get("monitor").checkpoint===1380 &&
  state.get("monitor").dataApiPrimary==="v2",
  "cutover preserves old state, suppresses old fill and sends new ADD exactly once");
assert(sinceMigration.every(u=>!new URL(u).pathname.match(/^\/(positions|activity)$/)) &&
  sinceMigration.some(u=>u.includes("/v2/activity?")),
  "primary v2 fetch never calls retired v1 endpoints");
assert(state.get("monitor").seen[activityKey(normalizeV2Activity(oldV2))]===1020,
  "previously notified legacy activity is stored under normalized v2 key");
await poll(storage,envV2,fetcher,1500);
assert(pushed.length===2,"overlapping v2 poll doesn't resend any converted fills");

// Real settlement and auto-redemption still work entirely on v2.
currentV2=[v2Position({current_price:1,current_value:120,
  status:"REDEEMABLE",redeemable:true})];
const resolved=await poll(storage,envV2,fetcher,1620);
assert(resolved.alerts===1&&pushed.length===3 &&
  pushed[2].title.startsWith("🏆 WIN") &&
  pushed[2].desp.includes("该剩余仓位预计净收益") &&
  pushed[2].desp.includes("+$20.00"),
  "v2 OPEN held winner triggers once, economics fetched from v2 with fee-inclusive basis");
currentV2=[];
currentV2Events=[v2Trade({transaction_hash:"tx-redeem",type:"REDEEM",
  timestamp:1880,size:120,usdc_size:120,price:0,side:""}),newer,oldV2];
const redeem=await poll(storage,envV2,fetcher,1920);
assert(redeem.alerts===1 && pushed.length===4 &&
  pushed[3].title.startsWith("💰 已赎回") &&
  pushed[3].desp.includes("$120.00"),
  "v2 activity REDEEM provides one positive-payout notification");
await poll(storage,envV2,fetcher,1980);
assert(pushed.length===4,"v2 redeem replay dedupes");
assert(state.get("monitor").audit.lastPollAt===1980,
  "existing audit and durability retained");

// Malformed v2 page must not update previously durable checkpoint.
const checkpointBefore=state.get("monitor").checkpoint;
let failed=false;
const breakFetcher=async(url,init)=>{
  if(String(url).includes("/v2/positions?"))
    return {ok:true,json:async()=>({data:[],pagination:{has_more:true,next_cursor:null}})};
  return fetcher(url,init);
};
try{await poll(storage,envV2,breakFetcher,2080)}catch{failed=true}
assert(failed && state.get("monitor").checkpoint===checkpointBefore,
  "v2 cursor corruption fails closed and preserves last valid checkpoint");

console.log("Passed: v2 cursor positions/activity, fee basis and PnL, one-time v1 cutover, ADD, WIN, REDEEM, no replay");
