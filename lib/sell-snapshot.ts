import { formatUnits } from 'viem';
import { fetchBrowserOpenOrders, fetchConditionalBalance, type ClobCredentials } from './browser-clob';
import { reviewSellBalance } from './sell-balance-review';
import { daysUntilSettlement } from './apr';
import { prepareManualSell } from './manual-sell-preflight';
import type { EnrichedPosition } from './types';

export async function loadSellReview(input:{credentials:ClobCredentials;signer:string;funder:string;asset:string;apr:number;quantity:number;coverageConfirmed:boolean;settlementConfirmed:boolean}) {
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
 const comparison=reviewSellBalance(balance.balance,input.asset,orderList);
 if(!comparison||comparison.remainder===null)throw Error('balance_order_mismatch');
 const n=(v:unknown)=>typeof v==='string'||typeof v==='number'?Number(v):NaN;
 const bids=book.bids.map((v:{price:unknown;size:unknown})=>({price:n(v?.price),size:n(v?.size)})).filter((v:{price:number;size:number})=>v.price>0&&v.price<1&&v.size>0);
 const asks=book.asks.map((v:{price:unknown;size:unknown})=>({price:n(v?.price),size:n(v?.size)})).filter((v:{price:number;size:number})=>v.price>0&&v.price<1&&v.size>0);
 const now=Date.now(), days=daysUntilSettlement(position.endDate,new Date(now));
 const positionAsOf=Date.parse(pbody.fetchedAt);
 if(!Number.isFinite(positionAsOf) || positionAsOf>now || positionAsOf<startedAt-1000)throw Error("stale_position_snapshot");
 const result=prepareManualSell({nowMs:now,signer:input.signer,funder:input.funder,safeMatches:true,assetId:input.asset,targetAprPercent:input.apr,settlementMs:Number.isFinite(days)?now+days*86400000:null,settlementConfirmed:input.settlementConfirmed,positionShares:position.size,positionAsOfMs:positionAsOf,orders:orderList.map(o=>({id:o.id,assetId:o.asset_id,side:o.side,originalSize:Number(o.original_size),matchedSize:Number(o.size_matched)})),ordersAsOfMs:startedAt,ordersComplete:true,ordersCoverWallet:input.coverageConfirmed,availableShares:Number(formatUnits(comparison.remainder,6)),balanceAsOfMs:startedAt,bestBid:bids.length?Math.max(...bids.map((v:{price:number})=>v.price)):null,bestAsk:asks.length?Math.min(...asks.map((v:{price:number})=>v.price)):null,tick:n(book.tick_size),tickVerified:true,bookAsOfMs:startedAt,minimumOrderShares:n(book.min_order_size),requestedShares:input.quantity});
 return {result,position,comparison,asOf:now};
}
