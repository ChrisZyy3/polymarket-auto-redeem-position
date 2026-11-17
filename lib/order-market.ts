export type OrderMarketMetadata={title:string;outcome:string;conditionId:string;slug:string|null};
function stringArray(value:unknown):string[]|null{
 try{const parsed=typeof value==='string'?JSON.parse(value):value;return Array.isArray(parsed)&&parsed.every(v=>typeof v==='string')?parsed:null;}catch{return null;}
}
/** A Gamma query must be cross-checked against the actual token to prevent wrong titles. */
export function parseOrderMarketMetadata(tokenId:string,value:unknown):OrderMarketMetadata|null{
 if(!/^\d{1,100}$/.test(tokenId)||!Array.isArray(value))return null;
 for(const item of value){
  if(!item||typeof item!=='object')continue;
  const m=item as Record<string,unknown>;
  const assets=stringArray(m.clobTokenIds),outcomes=stringArray(m.outcomes);
  if(!assets||!outcomes||!/^0x[0-9a-f]{64}$/i.test(String(m.conditionId)))continue;
  const index=assets.indexOf(tokenId);
  if(index<0||typeof outcomes[index]!=='string'||typeof m.question!=='string'||!m.question.trim())continue;
  return {title:m.question.trim(),outcome:outcomes[index],conditionId:String(m.conditionId),slug:typeof m.slug==='string'?m.slug:null};
 }
 return null;
}
export function shortenTokenId(tokenId:string):string{
 return tokenId.length>22?tokenId.slice(0,10)+'…'+tokenId.slice(-8):tokenId;
}
