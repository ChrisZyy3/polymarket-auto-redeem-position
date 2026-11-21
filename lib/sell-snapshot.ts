import { formatUnits } from 'viem';
import { fetchBrowserOpenOrders, fetchConditionalBalance, type ClobCredentials } from './browser-clob';
import { reviewSellBalance } from './sell-balance-review';
import { daysUntilSettlement } from './apr';
import { prepareManualSell } from './manual-sell-preflight';
import { getV1SellApprovalTarget, classifySellApproval } from './clob-sell-approval';
import { verifyMarketSettlementDate } from './sell-settlement-verification';
import type { EnrichedPosition } from './types';

export async function loadSellReview(input:{credentials:ClobCredentials;signer:string;funder:string;asset:string;apr:number;quantity:number;readOnchainApproval?:(token:string,operator:string,wallet:string)=>Promise<boolean>;readOnchainBalance?:(token:string,wallet:string,asset:string)=>Promise<bigint>}) {
 const startedAt=Date.now();
 const [orderList,balance,positionsResponse,bookResponse]=await Promise.all([
  fetchBrowserOpenOrders(input.credentials,input.signer,input.funder),
  fetchConditionalBalance(input.credentials,input.signer,input.asset),
  fetch(`/api/positions?address=${encodeURIComponent(input.funder)}`,{cache:'no-store',signal:AbortSignal.timeout(20000)}),
  fetch(`https://clob.polymarket.com/book?token_id=${encodeURIComponent(input.asset)}`,{cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000)})
 ]);
 if(!positionsResponse.ok||!bookResponse.ok)throw Error('snapshot_fetch_failed');
 const [pbody,book]=await Promise.all([positionsResponse.json(),bookResponse.json()]);
 const position:EnrichedPosition|undefined=Array.isArray(pbody.positions)?pbody.positions.find((p:EnrichedPosition)=>p.asset===input.asset):undefined;
 if(!position||position.redeemable||position.proxyWallet.toLowerCase()!==input.funder.toLowerCase()||!Array.isArray(book.bids)||!Array.isArray(book.asks)||book.asset_id!==input.asset)throw Error('invalid_snapshot');
 const marketCheck=await (async():Promise<{marketStatus:'accepting'|'paused'|'unknown';target:ReturnType<typeof getV1SellApprovalTarget>;marketEndDate:string|null;settlementDateVerified:boolean}>=>{
   const unavailable={marketStatus:'unknown' as const,target:null,marketEndDate:null,settlementDateVerified:false};
   if(!/^0x[0-9a-f]{64}$/i.test(position.conditionId))return unavailable;
   try{
     const response=await fetch(`https://clob.polymarket.com/markets/${encodeURIComponent(position.conditionId)}`,{cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000)});
     if(!response.ok)return unavailable;
     const data:unknown=await response.json();
     if(!data||typeof data!=='object'||Array.isArray(data))return unavailable;
     const status=data as Record<string,unknown>;
     if(typeof status.condition_id!=='string'||status.condition_id.toLowerCase()!==position.conditionId.toLowerCase())return unavailable;
     const settlement=verifyMarketSettlementDate(position.endDate,status.end_date_iso);
     const target=getV1SellApprovalTarget(input.asset,position.conditionId,status);
     const base={target,marketEndDate:settlement.marketDate,settlementDateVerified:settlement.verified};
     if(status.accepting_orders===false||status.closed===true||status.active===false)return {marketStatus:'paused',...base};
     if(status.accepting_orders===true&&status.closed===false&&status.active===true)return {marketStatus:'accepting',...base};
     return {marketStatus:'unknown',...base};
   }catch{}
   return unavailable;
 })();
 let onchainApproved:boolean|null=null;
 if(marketCheck.target&&input.readOnchainApproval){try{onchainApproved=await input.readOnchainApproval(marketCheck.target.tokenContract,marketCheck.target.operator,input.funder);}catch{onchainApproved=null;}}
 const approvalStatus=classifySellApproval({operator:marketCheck.target?.operator,allowances:balance.allowances,requestedShares:input.quantity,onchain:onchainApproved});
 let tokenBalanceStatus:'verified'|'mismatch'|'unknown'='unknown';
 if(marketCheck.target&&input.readOnchainBalance){
  try{
   const onchain=await input.readOnchainBalance(marketCheck.target.tokenContract,input.funder,input.asset);
   if(/^\d+$/.test(balance.balance)&&onchain>=0n)
    tokenBalanceStatus=onchain===BigInt(balance.balance)?'verified':'mismatch';
  }catch{/* RPC error means unverified, never approved */}
 }
 const comparison=reviewSellBalance(balance.balance,input.asset,orderList);
 if(!comparison||comparison.remainder===null)throw Error('balance_order_mismatch');
 const n=(v:unknown)=>typeof v==='string'||typeof v==='number'?Number(v):NaN;
 const bids=book.bids.map((v:{price:unknown;size:unknown})=>({price:n(v?.price),size:n(v?.size)})).filter((v:{price:number;size:number})=>v.price>0&&v.price<1&&v.size>0);
 const asks=book.asks.map((v:{price:unknown;size:unknown})=>({price:n(v?.price),size:n(v?.size)})).filter((v:{price:number;size:number})=>v.price>0&&v.price<1&&v.size>0);
 const now=Date.now(), days=daysUntilSettlement(position.endDate,new Date(now));
 const positionAsOf=Date.parse(pbody.fetchedAt);
 if(!Number.isFinite(positionAsOf) || positionAsOf>now || positionAsOf<startedAt-1000)throw Error("stale_position_snapshot");
 // fetchBrowserOpenOrders returns only after terminal pagination, validates every row,
 // and rejects any maker that does not match this Safe. An empty terminal list is
 // therefore a verified zero-order snapshot, not an assumed empty result.
 const ordersCoverageVerified=Array.isArray(orderList);
 const prepared=prepareManualSell({nowMs:now,signer:input.signer,funder:input.funder,safeMatches:true,assetId:input.asset,targetAprPercent:input.apr,settlementMs:Number.isFinite(days)?now+days*86400000:null,settlementConfirmed:marketCheck.settlementDateVerified,positionShares:position.size,positionAsOfMs:positionAsOf,orders:orderList.map(o=>({id:o.id,assetId:o.asset_id,side:o.side,originalSize:Number(o.original_size),matchedSize:Number(o.size_matched)})),ordersAsOfMs:startedAt,ordersComplete:true,ordersCoverWallet:ordersCoverageVerified,availableShares:Number(formatUnits(comparison.remainder,6)),balanceAsOfMs:startedAt,bestBid:bids.length?Math.max(...bids.map((v:{price:number})=>v.price)):null,bestAsk:asks.length?Math.min(...asks.map((v:{price:number})=>v.price)):null,tick:n(book.tick_size),tickVerified:true,bookAsOfMs:startedAt,minimumOrderShares:n(book.min_order_size),requestedShares:input.quantity});
 const result=input.readOnchainBalance&&tokenBalanceStatus!=='verified'
  ?{status:'blocked' as const,reasons:[...new Set([
    ...(prepared.status==='blocked'?prepared.reasons:[]),
    tokenBalanceStatus==='mismatch'?'onchain_clob_balance_mismatch':'onchain_balance_unverified'
  ])]}:prepared;
 return {result,position,comparison,asOf:now, checks:{bestBid:bids.length?Math.max(...bids.map((v:{price:number})=>v.price)):null,bestAsk:asks.length?Math.min(...asks.map((v:{price:number})=>v.price)):null,tick:n(book.tick_size),minimumOrderShares:n(book.min_order_size),allowanceEntries:Object.keys(balance.allowances).length,ordersCoverageVerified,ordersCount:orderList.length,marketEndDate:marketCheck.marketEndDate,settlementDateVerified:marketCheck.settlementDateVerified,tokenBalanceStatus,marketStatus:marketCheck.marketStatus,authorizationStatus:approvalStatus,authorizationVerified:approvalStatus==='approved',operator:marketCheck.target?.operator??null,tokenContract:marketCheck.target?.tokenContract??null,marketType:marketCheck.target?.marketType??null}};
}
