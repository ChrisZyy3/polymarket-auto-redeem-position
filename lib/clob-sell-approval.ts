/**
 * Polymarket legacy CTF SELL approvals.
 * Addresses verified against @polymarket/client production environment and its
 * resolveOrderExchangeAddress implementation (2026-11-17).
 *
 * For SELL, the Safe must approve the correct Exchange as ERC-1155 operator
 * on the CTF contract (not an ERC-20 allowance on the owner's EOA).
 * Fail closed on v2 assets until CONDITIONAL_V2 balance handling is supported.
 */
export const CTF_ERC1155 = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045' as const;
export const CTF_STANDARD_EXCHANGE = '0xE111180000d2663C0091e4f400237545B87B996B' as const;
export const CTF_NEG_RISK_EXCHANGE = '0xe2222d279d744050d28e00520010520000310F59' as const;
type RecordLike = Record<string,unknown>;
const V2_MASK=((1n<<64n)-1n)<<40n;
const validAddress=(s:unknown):s is string=>typeof s==='string'&&/^0x[0-9a-f]{40}$/i.test(s);

export type SellApprovalTarget={operator:string;tokenContract:typeof CTF_ERC1155;marketType:'standard'|'negRisk'};
export function getV1SellApprovalTarget(assetId:string,conditionId:string,market:unknown):SellApprovalTarget|null{
 if(!/^\d{1,100}$/.test(assetId)||!/^0x[0-9a-f]{64}$/i.test(conditionId))return null;
 try{if((BigInt(assetId)&V2_MASK)===0n)return null;}catch{return null;}
 if(!market||typeof market!=='object'||Array.isArray(market))return null;
 const m=market as RecordLike;
 if(typeof m.condition_id!=='string'||m.condition_id.toLowerCase()!==conditionId.toLowerCase())return null;
 const assets=Array.isArray(m.tokens)?m.tokens:Array.isArray(m.t)?m.t:null;
 if(!assets||!assets.some(o=>o&&typeof o==='object'&&(o as RecordLike).token_id===assetId||(o&&typeof o==='object'&&(o as RecordLike).t===assetId)))return null;
 const negRisk=m.neg_risk??m.nr;
 if(typeof negRisk!=='boolean')return null;
 return {operator:negRisk?CTF_NEG_RISK_EXCHANGE:CTF_STANDARD_EXCHANGE,tokenContract:CTF_ERC1155,marketType:negRisk?'negRisk':'standard'};
}
export type SellApprovalCheck='approved'|'missing'|'unknown';
/** CLOB account allowance is a *cross-check*; onchain isApprovedForAll is authoritative. */
export function classifySellApproval(input:{operator:string|undefined;allowances:Record<string,string>;requestedShares:number;onchain:boolean|null}):SellApprovalCheck{
 if(!validAddress(input.operator)||input.onchain===null)return 'unknown';
 if(input.onchain===false)return 'missing';
 if(!Number.isFinite(input.requestedShares)||input.requestedShares<=0)return 'unknown';
 const record=Object.entries(input.allowances).find(([k])=>k.toLowerCase()===input.operator!.toLowerCase());
 if(!record||!/^\d+$/.test(record[1]))return 'unknown';
 const whole=String(input.requestedShares);
 if(!/^\d+(?:\.\d{1,6})?$/.test(whole))return 'unknown';
 const [integer,fraction='']=whole.split('.');
 const required=BigInt(integer)*1000000n+BigInt(fraction.padEnd(6,'0'));
 return BigInt(record[1])>=required?'approved':'unknown'; // discrepancy may be stale CLOB indexing
}

/** EIP-712 verifyingContract must exactly match the checked operator. */
export function isExpectedExchangeDomain(actual:unknown,expected:string):boolean{
 return validAddress(actual)&&validAddress(expected)&&actual.toLowerCase()===expected.toLowerCase();
}
