import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";

// Local-only L1 bootstrap: signing happens in MetaMask/Rabby via EIP-1193.
// Does NOT request, export, persist, print, or transmit any wallet private key.
const HOST="127.0.0.1";
const CLOB="https://clob.polymarket.com";
const FUNDER_WALLETS=Object.freeze([
  "0x9f7eb5bc88342f01d18754be0439fad79ec282ce",
  "0x24816c037cdc2c9bd979e69d777541cf560a9b79",
  "0x052f4191cd324a348835a846d34df5b0061e53fb"
]);
const token=randomBytes(32).toString("hex");
const cookieValue=randomBytes(32).toString("hex");
const csrf=randomBytes(32).toString("hex");
const address=v=>typeof v==="string"&&/^0x[0-9a-fA-F]{40}$/.test(v);
const sig=v=>typeof v==="string"&&/^0x[0-9a-fA-F]{130}$/.test(v);
const json=(res,status,payload)=>{res.writeHead(status,{
  "content-type":"application/json; charset=utf-8",
  "cache-control":"no-store","x-content-type-options":"nosniff",
  "referrer-policy":"no-referrer"
});res.end(JSON.stringify(payload));};
const constantEqual=(a,b)=>{
  const left=Buffer.from(String(a??"")),right=Buffer.from(String(b??""));
  return left.length===right.length&&timingSafeEqual(left,right);
};
async function parseBody(req) {
  let input="",bytes=0;
  for await(const chunk of req){
    bytes+=chunk.length;
    if(bytes>4096)throw new Error("invalid_request_size");
    input+=chunk.toString("utf8");
  }
  try{return JSON.parse(input);}catch{throw new Error("invalid_request_body");}
}
let expectedOrigin="";
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url||"/",expectedOrigin);
  const cookies=(req.headers.cookie??"").split(";").map(s=>s.trim());
  const authenticated=cookies.includes("clob_local="+cookieValue);
  if(req.headers.host!==new URL(expectedOrigin).host){
    return json(res,403,{error:"invalid_host"});
  }
  if(req.method==="GET"&&url.pathname==="/"&&
      constantEqual(url.searchParams.get("access"),token)){
    res.writeHead(303,{
      "location":"/",
      "set-cookie":"clob_local="+cookieValue+"; HttpOnly; SameSite=Strict; Path=/",
      "cache-control":"no-store","referrer-policy":"no-referrer"
    });return res.end();
  }
  if(!authenticated)return json(res,403,{error:"local_session_required"});
  if(req.method==="GET"&&url.pathname==="/"){
    const html=await readFile(new URL("./index.html",import.meta.url));
    res.writeHead(200,{
      "content-type":"text/html; charset=utf-8","cache-control":"no-store",
      "content-security-policy":"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      "x-content-type-options":"nosniff","referrer-policy":"no-referrer"
    });return res.end(html);
  }
  if(req.method==="GET"&&["/client.js","/styles.css"].includes(url.pathname)){
    const type=url.pathname.endsWith(".css")?"text/css":"text/javascript";
    const file=await readFile(new URL("."+url.pathname,import.meta.url));
    res.writeHead(200,{"content-type":type,"cache-control":"no-store",
      "x-content-type-options":"nosniff"});return res.end(file);
  }
  if(req.method==="GET"&&url.pathname==="/context"){
    return json(res,200,{
      timestamp:Math.floor(Date.now()/1000),nonce:0,
      funders:FUNDER_WALLETS,csrf
    });
  }
  if(req.method!=="POST"||!["/derive","/create"].includes(url.pathname))
    return json(res,404,{error:"not_found"});
  if(req.headers.origin!==expectedOrigin||req.headers["x-local-csrf"]!==csrf||
     req.headers["content-type"]!=="application/json")
    return json(res,403,{error:"invalid_local_request"});
  let body;
  try{body=await parseBody(req);}catch{return json(res,400,{error:"invalid_request"});}
  if(!address(body.address)||!sig(body.signature)||body.nonce!==0||
     !Number.isInteger(body.timestamp)||
     Math.abs(Math.floor(Date.now()/1000)-body.timestamp)>120||
     !address(body.funderAddress)||
     !FUNDER_WALLETS.includes(body.funderAddress.toLowerCase()))
    return json(res,400,{error:"invalid_l1_signature_request"});
  // Only the two documented L1 credential endpoints; absolutely no order
  // placement/cancel endpoints. Signatures are not stored or logged.
  const create=url.pathname==="/create";
  if(create&&body.confirmCreate!==true)
    return json(res,400,{error:"explicit_create_confirmation_required"});
  let response;
  try{
    response=await fetch(CLOB+(create?"/auth/api-key":"/auth/derive-api-key"),{
      method:create?"POST":"GET",
      headers:{
        "POLY_ADDRESS":body.address,
        "POLY_SIGNATURE":body.signature,
        "POLY_TIMESTAMP":String(body.timestamp),
        "POLY_NONCE":"0"
      },
      redirect:"error",signal:AbortSignal.timeout(15000)
    });
  }catch{return json(res,503,{error:"clob_unreachable"});}
  if(!response.ok){
    const code=response.status===429?"rate_limited":
      [401,403].includes(response.status)?"signature_rejected":
      !create&&[400,404].includes(response.status)?"credentials_not_derived":
      "clob_api_key_request_failed";
    return json(res,response.status===429?503:400,{error:code,status:response.status});
  }
  let creds;
  try{creds=await response.json();}catch{
    return json(res,502,{error:"credentials_invalid_response"});
  }
  if(typeof creds?.apiKey!=="string"||typeof creds?.secret!=="string"||
     typeof creds?.passphrase!=="string"||!creds.apiKey||!creds.secret||!creds.passphrase)
    return json(res,502,{error:"credentials_incomplete"});
  // Browser holds this response in memory only. No local files or logs.
  return json(res,200,{
    signerAddress:body.address.toLowerCase(),
    funderAddress:body.funderAddress.toLowerCase(),
    apiKey:creds.apiKey,secret:creds.secret,passphrase:creds.passphrase
  });
});
server.listen(0,HOST,()=>{
  const addr=server.address();
  expectedOrigin="http://"+HOST+":"+addr.port;
  process.stdout.write(
    "\nLocal Polymarket CLOB credential setup (MetaMask / Rabby)\n"+
    "Open only on this machine:\n"+expectedOrigin+"/?access="+token+"\n"+
    "Signature stays in your wallet; credentials stay in this localhost session.\n"+
    "Stop with Ctrl+C after you securely paste each secret into Cloudflare.\n\n"
  );
});
