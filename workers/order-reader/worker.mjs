import { isAddress, parseAccountSecret } from "./clob-auth.mjs";
import { fetchOpenOrders, OrderReaderError } from "./clob-orders.mjs";

// Isolated read-only service: no mutation routes, no order signing, no wallet key.
const json=(payload,status=200)=>new Response(JSON.stringify(payload),{
  status,headers:{
    "content-type":"application/json; charset=utf-8",
    "cache-control":"no-store",
    "x-content-type-options":"nosniff",
    "referrer-policy":"no-referrer"
  }
});
function credentialsFromEnv(env) {
  const accounts=[];
  for(const key of ["CLOB_ACCOUNT_1","CLOB_ACCOUNT_2","CLOB_ACCOUNT_3"]){
    if(env[key]!==undefined&&env[key]!==null&&env[key]!==""){
      const a=parseAccountSecret(env[key]);
      if(accounts.some(x=>x.funderAddress===a.funderAddress))
        throw new Error("duplicate_account_funder");
      accounts.push(a);
    }
  }
  return accounts;
}
function allowed(req,env){
  // Never allow a placeholder/short default token to authorize account data.
  const expected=env.ORDER_READER_TOKEN;
  if(typeof expected!=="string"||expected.length<32)return false;
  return req.headers.get("authorization")==="Bearer "+expected;
}
export function createReaderHandler(fetcher=fetch,clock=()=>Math.floor(Date.now()/1000)){
  return async function handle(request,env){
    if(request.method!=="GET")return json({error:"read_only_get_required"},405);
    const url=new URL(request.url);
    if(url.pathname==="/health")
      return json({ok:true,mode:"read-only",liveTrading:false});
    if(url.pathname!=="/orders"&&url.pathname!=="/status")
      return json({error:"not_found"},404);
    if(!allowed(request,env))return json({error:"unauthorized"},401);
    let accounts;
    try{accounts=credentialsFromEnv(env);}
    catch{return json({error:"invalid_account_config"},503);}
    if(url.pathname==="/status")return json({
      mode:"read-only",configuredCount:accounts.length,enabled:accounts.length>0,
      funderAddresses:accounts.map(a=>a.funderAddress),
      tradingRoutesEnabled:false
    });
    const wallet=url.searchParams.get("wallet");
    if(!isAddress(wallet))return json({error:"invalid_wallet"},400);
    const account=accounts.find(a=>a.funderAddress===wallet.toLowerCase());
    if(!account)return json({error:"wallet_not_configured"},404);
    try{
      const snapshot=await fetchOpenOrders(account,fetcher,clock());
      // matchingMakerObserved may be false for legitimate empty accounts.
      // Treat zero matching orders as unverified funder mapping before an
      // execution adapter is ever allowed to act on this result.
      return json({ok:true,mode:"read-only",...snapshot,
        mappingStatus:snapshot.matchingMakerObserved?"observed":"unconfirmed",
        actionableForTrading:false});
    }catch(e){
      const code=e instanceof OrderReaderError?e.code:"order_reader_internal_failure";
      const status=e instanceof OrderReaderError?e.httpStatus:503;
      return json({ok:false,error:code,complete:false},status);
    }
  };
}
export default {fetch:createReaderHandler()};
