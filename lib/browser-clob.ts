/** Browser-session-only CLOB reader. It never creates credentials or trades. */
export type ClobCredentials = { apiKey:string; secret:string; passphrase:string };
export type ClobOrder = { id:string; asset_id:string; maker_address:string; side:"BUY"|"SELL"; status:string; price:string; original_size:string; size_matched:string };
const CLOB="https://clob.polymarket.com";
export class ClobReadError extends Error {}
export async function deriveClobCredentials(signer:string, signature:string, timestamp:number, fetcher:typeof fetch=fetch):Promise<ClobCredentials> {
  let response:Response;
  try { response=await fetcher(`${CLOB}/auth/derive-api-key`,{method:"GET",headers:{POLY_ADDRESS:signer,POLY_SIGNATURE:signature,POLY_TIMESTAMP:String(timestamp),POLY_NONCE:"0"},cache:"no-store",credentials:"omit",redirect:"error",signal:AbortSignal.timeout(15000)}); }
  catch { throw new ClobReadError("connection_or_cors"); }
  if(response.status===404) throw new ClobReadError("credentials_not_found");
  if(!response.ok) throw new ClobReadError(response.status===429?"rate_limited":"derive_failed");
  let value:unknown;try{value=await response.json();}catch{throw new ClobReadError("invalid_credentials");}
  if(!value || typeof value!=="object")throw new ClobReadError("invalid_credentials");
  const c=value as Record<string,unknown>;
  if(typeof c.apiKey!=="string"||c.apiKey.length<8||typeof c.secret!=="string"||c.secret.length<12||typeof c.passphrase!=="string"||!c.passphrase)throw new ClobReadError("invalid_credentials");
  return {apiKey:c.apiKey,secret:c.secret,passphrase:c.passphrase};
}
async function signatureFor(secret:string,timestamp:number) {
  try {
    let base64=secret.replace(/-/g,"+").replace(/_/g,"/");base64+="=".repeat((4-base64.length%4)%4);
    const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
    const key=await crypto.subtle.importKey("raw",bytes,{name:"HMAC",hash:"SHA-256"},false,["sign"]);
    const signature=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(`${timestamp}GET/data/orders`));
    return btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g,"-").replace(/\//g,"_");
  }catch{throw new ClobReadError("invalid_credentials");}
}
export async function fetchBrowserOpenOrders(credentials:ClobCredentials,signer:string,funder:string,fetcher:typeof fetch=fetch):Promise<ClobOrder[]> {
  const all:ClobOrder[]=[],ids=new Set<string>(),cursors=new Set<string>();let cursor:string|null=null, totalCount:number|null=null;
  for(let page=0;page<30;page++) {
    const timestamp=Math.floor(Date.now()/1000);const signed=await signatureFor(credentials.secret,timestamp);
    const url=new URL(`${CLOB}/data/orders`);if(cursor!==null)url.searchParams.set("next_cursor",cursor);
    let response:Response;try{response=await fetcher(url,{method:"GET",headers:{POLY_ADDRESS:signer,POLY_API_KEY:credentials.apiKey,POLY_PASSPHRASE:credentials.passphrase,POLY_TIMESTAMP:String(timestamp),POLY_SIGNATURE:signed},credentials:"omit",cache:"no-store",redirect:"error",signal:AbortSignal.timeout(15000)});}catch{throw new ClobReadError("connection_or_cors");}
    if(!response.ok)throw new ClobReadError(response.status===429?"rate_limited":"orders_failed");
    let body:unknown;try{body=await response.json();}catch{throw new ClobReadError("invalid_page");}
    if(!body||typeof body!=="object"||Array.isArray(body))throw new ClobReadError("incomplete_pagination");
    const p=body as Record<string,unknown>;
    if(!Array.isArray(p.data)||(!Object.hasOwn(p,"next_cursor")&&!Object.hasOwn(p,"has_more")))throw new ClobReadError("incomplete_pagination");
    if(p.total_count!==undefined){
      if(!Number.isSafeInteger(p.total_count)||Number(p.total_count)<0 || (totalCount!==null&&totalCount!==p.total_count))throw new ClobReadError("incomplete_pagination");
      totalCount=p.total_count as number;
    }
    const next=p.next_cursor,more=p.has_more;
    if(more!==undefined&&typeof more!=="boolean")throw new ClobReadError("incomplete_pagination");
    const terminal=next==="LTE="||((next===null||next===undefined||next==="")&&more===false);
    if((!terminal&&(typeof next!=="string"||!next||next.length>512))||(terminal&&more===true))throw new ClobReadError("incomplete_pagination");
    for(const raw of p.data){
      const o=raw as Record<string,unknown>;const num=(x:unknown)=>x!==null&&x!==undefined&&x!==""&&Number.isFinite(Number(x))&&Number(x)>=0;
      if(!o||typeof o.id!=="string"||!o.id||typeof o.asset_id!=="string"||!o.asset_id||typeof o.maker_address!=="string"||!/^0x[a-fA-F0-9]{40}$/.test(o.maker_address)||!["BUY","SELL"].includes(String(o.side).toUpperCase())||String(o.status).toUpperCase()!=="LIVE"||!num(o.price)||Number(o.price)<=0||Number(o.price)>=1||!num(o.original_size)||!num(o.size_matched)||Number(o.size_matched)>Number(o.original_size)||ids.has(o.id))throw new ClobReadError("invalid_order");
      ids.add(o.id);
      if(o.maker_address.toLowerCase()!==funder.toLowerCase())throw new ClobReadError("maker_mismatch");
      all.push({id:o.id,asset_id:o.asset_id,maker_address:o.maker_address,side:String(o.side).toUpperCase() as "BUY"|"SELL",status:"LIVE",price:String(o.price),original_size:String(o.original_size),size_matched:String(o.size_matched)});
      if(all.length>6000)throw new ClobReadError("too_many_orders");
    }
    if(terminal){if(totalCount!==null && totalCount!==all.length)throw new ClobReadError("incomplete_pagination");return all;}
    if(typeof next!=="string"||cursors.has(next))throw new ClobReadError("incomplete_pagination");cursors.add(next);cursor=next;
  }
  throw new ClobReadError("incomplete_pagination");
}
