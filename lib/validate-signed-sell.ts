import { parseUnits } from 'viem';

type SignedSellFields={
 side:string;postOnly?:boolean;expiration:number;maker:string;signer:string;
 signatureType:number;orderType:string;tokenId:string;makerAmount:string;takerAmount:string
};
type ExpectedSell={assetId:string;funder:string;signer:string;price:number;size:number;expiration:number};

/** Field-only errors. Never include signatures, wallet keys or CLOB credentials. */
export function signedSellMismatchFields(order:SignedSellFields,expected:ExpectedSell):string[]{
 const issues:string[]=[];
 if(order.side!=='SELL')issues.push('side');
 if(order.orderType!=='GTD')issues.push('order_type');
 if(order.postOnly!==true)issues.push('post_only');
 if(order.signatureType!==2)issues.push('signature_type');
 if(order.expiration!==expected.expiration)issues.push('expiration');
 if(typeof order.signer!=='string'||order.signer.toLowerCase()!==expected.signer.toLowerCase())issues.push('signer');
 if(typeof order.maker!=='string'||order.maker.toLowerCase()!==expected.funder.toLowerCase())issues.push('maker');
 if(order.tokenId!==expected.assetId)issues.push('token_id');
 try{
  const shares=parseUnits(String(expected.size),6),price=parseUnits(String(expected.price),6);
  if(shares<=0n||price<=0n)issues.push('invalid_review_amount');
  if(BigInt(order.makerAmount)!==shares)issues.push('share_size');
  if(BigInt(order.takerAmount)*1000000n<shares*price)issues.push('price_below_review');
 }catch{issues.push('invalid_amount_precision');}
 return issues;
}
/** SDK output must match user-reviewed shares, minimum price, GTD and Post-Only. */
export function validateSignedSell(order:SignedSellFields,expected:ExpectedSell):boolean{
 return signedSellMismatchFields(order,expected).length===0;
}
