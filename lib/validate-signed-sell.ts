import { parseUnits } from 'viem';
/** Reject SDK rounding or mutation that would change the quantity or lower the reviewed price. */
export function validateSignedSell(order:{side:string;postOnly?:boolean;expiration:number;maker:string;tokenId:string;makerAmount:string;takerAmount:string},expected:{assetId:string;funder:string;price:number;size:number;expiration:number}):boolean {
 try {
  const shares=parseUnits(String(expected.size),6),price=parseUnits(String(expected.price),6);
  return shares>0n && price>0n && order.side==='SELL' && order.postOnly===true && order.expiration===expected.expiration && order.maker.toLowerCase()===expected.funder.toLowerCase() && order.tokenId===expected.assetId && BigInt(order.makerAmount)===shares && BigInt(order.takerAmount)*1000000n>=shares*price;
 } catch {return false;}
}
