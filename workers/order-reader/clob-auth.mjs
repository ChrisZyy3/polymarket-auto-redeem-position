// Polymarket L2 read-only HMAC implementation (official CLOB API wire format).
// Only GET paths are allowed. Never expose signing credentials to callers.
export const CLOB_ORIGIN = "https://clob.polymarket.com";
const ALLOWED_READ_PATH = /^\/data\/(?:orders|trades|order\/0x[a-fA-F0-9]{64})$/;
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
export const isAddress = x => typeof x === "string" && ADDRESS.test(x);
export const isReadPath = path => typeof path === "string" && ALLOWED_READ_PATH.test(path);
const textEncoder = new TextEncoder();

export function parseAccountSecret(secretValue) {
  if(typeof secretValue!=="string"||secretValue.length>4096)throw new Error("account_secret_missing");
  let data;
  try{data=JSON.parse(secretValue);}catch{throw new Error("account_secret_invalid_json");}
  if(!data||typeof data!=="object"||!isAddress(data.signerAddress)||
     !isAddress(data.funderAddress)||
     typeof data.apiKey!=="string"||data.apiKey.length<8||
     typeof data.secret!=="string"||data.secret.length<12||
     typeof data.passphrase!=="string"||data.passphrase.length<1)
    throw new Error("account_secret_invalid_fields");
  return Object.freeze({
    signerAddress:data.signerAddress.toLowerCase(),
    funderAddress:data.funderAddress.toLowerCase(),
    apiKey:data.apiKey,secret:data.secret,passphrase:data.passphrase
  });
}

function base64ToBytes(str) {
  if(typeof str!=="string"||!/^[A-Za-z0-9+/]+={0,2}$/.test(str)||str.length%4===1)
    throw new Error("invalid_clob_api_secret");
  let bytes;
  try{bytes=atob(str);}catch{throw new Error("invalid_clob_api_secret");}
  return Uint8Array.from(bytes,x=>x.charCodeAt(0));
}
function bytesToBase64UrlPadded(bytes){
  let binary="";
  for(const b of new Uint8Array(bytes))binary+=String.fromCharCode(b);
  return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_");
}
export async function signL2Request({secret,method="GET",path,timestamp},subtle=crypto.subtle) {
  if(method!=="GET"||!isReadPath(path)||!Number.isInteger(timestamp)||timestamp<=0)
    throw new Error("clob_read_only_policy");
  const key=await subtle.importKey("raw",base64ToBytes(secret),
    {name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const payload=textEncoder.encode(String(timestamp)+method+path);
  return bytesToBase64UrlPadded(await subtle.sign("HMAC",key,payload));
}
export async function l2Headers(account,path,nowSeconds=Math.floor(Date.now()/1000)){
  if(!isAddress(account.signerAddress)||!isReadPath(path))
    throw new Error("clob_read_only_policy");
  return {
    "POLY_ADDRESS":account.signerAddress,
    "POLY_API_KEY":account.apiKey,
    "POLY_PASSPHRASE":account.passphrase,
    "POLY_TIMESTAMP":String(nowSeconds),
    "POLY_SIGNATURE":await signL2Request({
      secret:account.secret,path,timestamp:nowSeconds
    })
  };
}
