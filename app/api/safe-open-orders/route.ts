import { NextRequest, NextResponse } from "next/server";
import { verifyOrderAccess, type AccessRequest } from "@/lib/safe-order-access";

export const dynamic = "force-dynamic";
const headers={"Cache-Control":"no-store", "X-Content-Type-Options":"nosniff"};
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers});
export async function GET() {
  return json({configured: Boolean(process.env.ORDER_READER_URL && (process.env.ORDER_READER_TOKEN?.length ?? 0)>=32)});
}
export async function POST(request:NextRequest) {
  // Only same-origin browser requests. Never turn this into a general proxy.
  if (request.headers.get("origin") !== request.nextUrl.origin) return json({error:"invalid_origin"},403);
  const length=Number(request.headers.get("content-length") ?? "0");
  if (length>4096) return json({error:"request_too_large"},413);
  let body:AccessRequest;
  try { const raw=await request.text(); if(raw.length>4096) return json({error:"request_too_large"},413); body=JSON.parse(raw); } catch { return json({error:"invalid_request"},400); }
  if (body?.origin !== request.nextUrl.origin || !(await verifyOrderAccess(body))) return json({error:"invalid_wallet_proof"},401);
  const token=process.env.ORDER_READER_TOKEN, base=process.env.ORDER_READER_URL;
  if (!token || token.length<32 || !base) return json({error:"reader_not_configured"},503);
  let url:URL;
  try { url=new URL(base); if(url.protocol!=="https:" || url.hostname!=="polymarket-order-reader.chriszyy3.workers.dev" || url.pathname!=="/" || url.search || url.hash || url.username || url.password) throw new Error(); }
  catch { return json({error:"reader_invalid_configuration"},503); }
  url.pathname="/orders"; url.searchParams.set("wallet",body.funder);
  let response:Response;
  try { response=await fetch(url,{method:"GET",headers:{Authorization:`Bearer ${token}`},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(15000)}); }
  catch { return json({error:"reader_unavailable"},503); }
  if (!response.ok) {
    let code="reader_unavailable";
    try { const data=await response.json(); if(data?.error==="wallet_not_configured") code="wallet_not_configured"; } catch { /* keep generic */ }
    return json({error:code},503);
  }
  let snapshot;
  try { snapshot=await response.json(); } catch { return json({error:"invalid_snapshot"},502); }
  if (!snapshot || snapshot.complete!==true || snapshot.actionableForTrading!==false || !Array.isArray(snapshot.orders) ||
      typeof snapshot.accountFunder!=="string" || snapshot.accountFunder.toLowerCase()!==body.funder.toLowerCase() ||
      typeof snapshot.signerAddress!=="string" || snapshot.signerAddress.toLowerCase()!==body.signer.toLowerCase() ||
      !Number.isInteger(snapshot.asOf) || snapshot.asOf*1000>Date.now()+30000 || Date.now()-snapshot.asOf*1000>120000) return json({error:"invalid_snapshot"},502);
  return json({complete:true,asOf:snapshot.asOf,mappingStatus:snapshot.mappingStatus,orders:snapshot.orders});
}
