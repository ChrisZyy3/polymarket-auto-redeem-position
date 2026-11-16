import { CLOB_ORIGIN, isAddress } from "./clob-auth.mjs";
import { OrderReaderError } from "./clob-orders.mjs";

const MAX_PAGES = 30, MAX_ORDERS = 6000;
const validNumber = x => x !== null && x !== undefined && x !== "" && Number.isFinite(Number(x)) && Number(x) >= 0;

// This endpoint is documented for Deposit Wallets. Its API key is read-only,
// but the returned snapshot is never automatically considered safe to trade.
export function parseReadonlyAccount(raw) {
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error("invalid_readonly_config"); }
  if (!data || data.walletType !== "deposit" || !isAddress(data.signerAddress) || !isAddress(data.funderAddress) ||
      typeof data.readonlyApiKey !== "string" || data.readonlyApiKey.trim().length < 8 || data.readonlyApiKey.length > 512)
    throw new Error("invalid_readonly_config");
  return { walletType:"deposit", signerAddress:data.signerAddress.toLowerCase(), funderAddress:data.funderAddress.toLowerCase(), readonlyApiKey:data.readonlyApiKey };
}

export async function fetchWalletOpenOrders(account, fetcher=fetch, nowSec=Math.floor(Date.now()/1000)) {
  if (account.walletType !== "deposit" || !isAddress(account.signerAddress) || !isAddress(account.funderAddress) || !Number.isInteger(nowSec) || nowSec <= 0) throw new OrderReaderError("invalid_wallet_read_config", 400);
  const seenCursors = new Set(), seenIds = new Set(), orders=[];
  let cursor = "";
  for (let page=1; page<=MAX_PAGES; page++) {
    const url=new URL(CLOB_ORIGIN+"/data/wallet-open-orders");
    if (cursor) url.searchParams.set("cursor",cursor);
    let response;
    try { response=await fetcher(url.toString(), { method:"GET", headers:{ POLY_ADDRESS:account.signerAddress, POLY_READONLY_API_KEY:account.readonlyApiKey }, redirect:"error", signal:AbortSignal.timeout(12000) }); }
    catch { throw new OrderReaderError("wallet_orders_network_failure",503); }
    if (!response.ok) {
      if (response.status===429) throw new OrderReaderError("wallet_orders_rate_limited",503);
      if ([401,403].includes(response.status)) throw new OrderReaderError("wallet_orders_authorization_failed",503);
      throw new OrderReaderError("wallet_orders_upstream_failed",503);
    }
    let payload; try { payload=await response.json(); } catch { throw new OrderReaderError("wallet_orders_invalid_json"); }
    if (!payload || !Array.isArray(payload.data) || typeof payload.next_cursor!=="string" || payload.next_cursor.length>512) throw new OrderReaderError("wallet_orders_invalid_pagination");
    for (const o of payload.data) {
      if (!o || typeof o.id!=="string" || !o.id || typeof o.asset_id!=="string" || !o.asset_id || !isAddress(o.maker_address) ||
          !["BUY","SELL"].includes(String(o.side).toUpperCase()) || String(o.status).toUpperCase()!=="LIVE" ||
          !validNumber(o.original_size) || !validNumber(o.size_matched) || Number(o.size_matched)>Number(o.original_size) ||
          !validNumber(o.price) || Number(o.price)<=0 || Number(o.price)>=1 || typeof o.order_type!=="string" || !validNumber(o.expiration ?? 0))
        throw new OrderReaderError("wallet_orders_invalid_order");
      if (o.maker_address.toLowerCase()!==account.funderAddress.toLowerCase()) throw new OrderReaderError("wallet_orders_maker_mismatch");
      if (seenIds.has(o.id)) throw new OrderReaderError("repeated_open_order_id");
      seenIds.add(o.id);
      orders.push({id:o.id,asset_id:o.asset_id,maker_address:o.maker_address.toLowerCase(),side:o.side.toUpperCase(),status:"LIVE",price:String(o.price),original_size:String(o.original_size),size_matched:String(o.size_matched),order_type:o.order_type.toUpperCase(),expiration:String(o.expiration??0)});
      if (orders.length>MAX_ORDERS) throw new OrderReaderError("too_many_open_orders");
    }
    if (payload.next_cursor === "") return { complete:true, asOf:nowSec, accountFunder:account.funderAddress, signerAddress:account.signerAddress, pages:page, orders, scope:"deposit_wallet", matchingMakerObserved:orders.length>0 };
    if (seenCursors.has(payload.next_cursor)) throw new OrderReaderError("repeated_order_cursor");
    seenCursors.add(payload.next_cursor); cursor=payload.next_cursor;
  }
  throw new OrderReaderError("open_orders_page_limit_reached");
}
