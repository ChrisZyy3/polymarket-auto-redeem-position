import type { ClobOrder } from './browser-clob';
import type { EnrichedPosition } from './types';
import { shortenTokenId, type OrderMarketMetadata } from './order-market';

export type DisplayOrder = {order:ClobOrder;outcome:string;tokenLabel:string};
export type OpenOrderGroup={key:string;title:string;slug:string|null;items:DisplayOrder[]};
export function groupOpenOrders(orders:ClobOrder[],positions:EnrichedPosition[],metadata:Record<string,OrderMarketMetadata>):OpenOrderGroup[]{
 const byAsset=new Map(positions.map(p=>[p.asset,p]));
 const groups=new Map<string,OpenOrderGroup>();
 for(const order of orders){
  const held=byAsset.get(order.asset_id);
  const resolved=metadata[order.asset_id];
  const condition=held?.conditionId||resolved?.conditionId;
  const key=condition||order.asset_id;
  const title=held?.title||resolved?.title||'Unidentified market';
  let group=groups.get(key);
  if(!group){group={key,title,slug:held?.eventSlug||held?.slug||resolved?.slug||null,items:[]};groups.set(key,group);}
  if(group.title==='Unidentified market'&&title!=='Unidentified market'){group.title=title;group.slug=held?.eventSlug||held?.slug||resolved?.slug||null;}
  group.items.push({order,outcome:held?.outcome||resolved?.outcome||'',tokenLabel:shortenTokenId(order.asset_id)});
 }
 return [...groups.values()];
}
