import { NextRequest, NextResponse } from 'next/server';
import { parseOrderMarketMetadata } from '@/lib/order-market';
export async function GET(request:NextRequest){
 const tokenId=request.nextUrl.searchParams.get('tokenId')??'';
 if(!/^\d{1,100}$/.test(tokenId))return NextResponse.json({error:'invalid_asset'},{status:400});
 try{
  const url=new URL('https://gamma-api.polymarket.com/markets');
  url.searchParams.set('clob_token_ids',tokenId);url.searchParams.set('limit','5');
  const r=await fetch(url,{next:{revalidate:300},signal:AbortSignal.timeout(12000)});
  if(!r.ok)return NextResponse.json({market:null,reason:'gamma_unavailable'},{status:502});
  const market=parseOrderMarketMetadata(tokenId,await r.json());
  return NextResponse.json({market},{headers:{'Cache-Control':'public, max-age=60'}});
 }catch{return NextResponse.json({market:null,reason:'market_lookup_failed'},{status:502});}
}
