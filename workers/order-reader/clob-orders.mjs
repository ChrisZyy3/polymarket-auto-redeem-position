import { CLOB_ORIGIN, l2Headers } from "./clob-auth.mjs";

const MAX_PAGES=30,MAX_ORDERS=6000,TERMINAL_CURSOR="LTE=";

export class OrderReaderError extends Error {
  constructor(code,status=502){super(code);this.code=code;this.httpStatus=status;}
}
const number = value => value!==undefined&&value!==null&&value!=="" &&
  Number.isFinite(Number(value))&&Number(value)>=0;
const addr = value => typeof value==="string"&&/^0x[a-fA-F0-9]{40}$/.test(value);
function normalizeOrder(o) {
  if(!o||typeof o!=="object"||typeof o.id!=="string"||
     typeof o.asset_id!=="string"||!addr(o.maker_address)||
     !["SELL","BUY"].includes(String(o.side??"").toUpperCase())||
     typeof o.status!=="string"||!number(o.original_size)||
     !number(o.size_matched)||Number(o.size_matched)>Number(o.original_size)||
     !number(o.price)||Number(o.price)>=1||Number(o.price)<=0||
     typeof o.order_type!=="string"||!number(o.expiration??0)) {
    throw new OrderReaderError("invalid_clob_order_schema");
  }
  return {
    id:o.id,asset_id:o.asset_id,maker_address:o.maker_address.toLowerCase(),
    side:o.side.toUpperCase(),status:o.status.toUpperCase(),
    price:String(o.price),original_size:String(o.original_size),
    size_matched:String(o.size_matched),order_type:o.order_type.toUpperCase(),
    expiration:String(o.expiration??0)
  };
}
function parsePage(body){
  if(Array.isArray(body))throw new OrderReaderError("unpaginated_orders_response_unverified");
  if(!body||typeof body!=="object"||!Array.isArray(body.data))
    throw new OrderReaderError("invalid_clob_orders_page");
  if(!Object.hasOwn(body,"next_cursor")&&!Object.hasOwn(body,"has_more"))
    throw new OrderReaderError("order_pagination_not_verifiable");
  const cursor=body.next_cursor;
  if(cursor!==null&&cursor!==undefined&&
     (typeof cursor!=="string"||cursor.length>512))
    throw new OrderReaderError("invalid_order_cursor");
  const hasMore=body.has_more;
  if(hasMore!==undefined&&typeof hasMore!=="boolean")
    throw new OrderReaderError("invalid_order_has_more");
  const terminal=cursor===TERMINAL_CURSOR||(
    (cursor===null||cursor===undefined||cursor==="")&&hasMore===false
  );
  if(!terminal&&(typeof cursor!=="string"||cursor.length===0))
    throw new OrderReaderError("order_cursor_missing");
  if(hasMore===true&&terminal)throw new OrderReaderError("order_pagination_conflict");
  return {rows:body.data,cursor,terminal,
    totalCount:Number.isSafeInteger(body.total_count)?body.total_count:null};
}

/**
 * Fetches the fully paginated L2 open-order account snapshot. The auth HMAC
 * signs the route PATH (/data/orders), explicitly excluding query params,
 * following Polymarket's official L2 wire specification.
 *
 * Never returns a successful empty array on failed/incomplete HTTP reads.
 * Callers must treat a missing or stale result as UNKNOWN rather than zero.
 */
export async function fetchOpenOrders(account, fetcher=fetch, nowSec=Math.floor(Date.now()/1000)){
  if(!Number.isInteger(nowSec)||nowSec<=0)
    throw new OrderReaderError("invalid_read_timestamp",400);
  const seenCursors=new Set(),seenIds=new Set(),all=[];
  let cursor=null,pageCount=0,fullCount=null;
  for(;pageCount<MAX_PAGES;pageCount++){
    const path="/data/orders";
    const url=new URL(CLOB_ORIGIN+path);
    if(cursor!==null)url.searchParams.set("next_cursor",cursor);
    const headers=await l2Headers(account,path,nowSec);
    let response;
    try{
      response=await fetcher(url.toString(),{
        method:"GET",headers,redirect:"error",signal:AbortSignal.timeout(12000)
      });
    }catch{throw new OrderReaderError("clob_orders_network_failure",503);}
    if(!response?.ok){
      if(response?.status===429)throw new OrderReaderError("clob_orders_rate_limited",503);
      if([401,403].includes(response?.status))
        throw new OrderReaderError("clob_l2_authorization_failed",503);
      throw new OrderReaderError("clob_orders_upstream_failed",503);
    }
    let raw;
    try{raw=await response.json();}catch{throw new OrderReaderError("clob_orders_invalid_json");}
    const page=parsePage(raw);
    if(page.totalCount!==null){
      if(fullCount!==null&&page.totalCount!==fullCount)
        throw new OrderReaderError("clob_orders_total_count_changed");
      fullCount=page.totalCount;
    }
    for(const item of page.rows){
      const order=normalizeOrder(item);
      if(seenIds.has(order.id))throw new OrderReaderError("repeated_open_order_id");
      seenIds.add(order.id);
      all.push(order);
      if(all.length>MAX_ORDERS)throw new OrderReaderError("too_many_open_orders");
    }
    if(page.terminal){
      // The last page may report an account-wide count; never mistake a
      // truncated result for a verified complete snapshot.
      if(fullCount!==null&&fullCount!==all.length)
        throw new OrderReaderError("clob_orders_total_count_mismatch");
      const matched=all.filter(x=>x.maker_address===account.funderAddress);
      return {
        complete:true,asOf:nowSec,accountFunder:account.funderAddress,
        signerAddress:account.signerAddress,pages:pageCount+1,
        rawOrderCount:all.length,foreignMakerOrderCount:all.length-matched.length,
        matchingMakerObserved:matched.length>0,
        orders:matched
      };
    }
    if(seenCursors.has(page.cursor))throw new OrderReaderError("repeated_order_cursor");
    seenCursors.add(page.cursor);
    cursor=page.cursor;
  }
  throw new OrderReaderError("open_orders_page_limit_reached");
}
