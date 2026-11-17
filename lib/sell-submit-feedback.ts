/** Exact stages of a single reviewed CLOB SELL. Signing alone never proves order placement. */
export type SellSubmitStage='precheck'|'wallet'|'postcheck'|'posting'|'readback';
export type SellSubmitReceipt={
 asset:string;title:string;orderId:string;price:number;quantity:number;at:number;
 outcome:'live'|'needs_reconciliation';
};
const stages:Record<SellSubmitStage,{step:number;zh:string;en:string;hintZh:string;hintEn:string}>={
 precheck:{step:1,zh:'重新核对实时盘口、余额与已有挂单',en:'Checking live book, balances and orders',hintZh:'未开始钱包签名',hintEn:'Wallet signing has not started'},
 wallet:{step:2,zh:'等待钱包确认 EIP-712 签名',en:'Awaiting EIP-712 wallet signature',hintZh:'请查看 Rabby / MetaMask；签名不代表订单已经提交',hintEn:'Confirm in Rabby / MetaMask; signing is not submission'},
 postcheck:{step:3,zh:'签名后重新核验交易条件',en:'Rechecking conditions after signature',hintZh:'若价格、份额或授权变化，将停止提交',hintEn:'Submission stops if price, shares or approval changed'},
 posting:{step:4,zh:'正在提交 SELL 到 Polymarket CLOB',en:'Submitting SELL to Polymarket CLOB',hintZh:'请勿重复点击或刷新；等待订单结果',hintEn:'Do not retry or refresh while awaiting result'},
 readback:{step:5,zh:'等待订单 ID 精确回读确认',en:'Verifying exact order ID in CLOB',hintZh:'只有找到一致的 LIVE 挂单才标记成功',hintEn:'Only a matching LIVE order will be marked confirmed'}
};
export function sellSubmitProgress(stage:SellSubmitStage,language:'zh'|'en'){
 const v=stages[stage];return {step:v.step,total:5,title:language==='zh'?v.zh:v.en,hint:language==='zh'?v.hintZh:v.hintEn};
}
/** React preflight effect may run only for an existing review, never after its
 * completion cleared the review and refreshed the remaining share balance. */
export function shouldAutoRecheckSell(i:{
 active:boolean;hasReview:boolean;busy:boolean;locked:boolean;ordersReady:boolean;
 pending:boolean;uncertain:boolean;configChanged:boolean
}):boolean{
 return i.active&&i.hasReview&&!i.busy&&!i.locked&&i.ordersReady&&!i.pending&&!i.uncertain&&i.configChanged;
}
export function sellBlockReasonText(reason:string,language:'zh'|'en'):string{
 if(reason==='invalid_quantity')return language==='zh'
  ?'拟卖份额无效、低于市场最小下单量，或不足 0.01 份；如刚完成挂单，请先在订单中心确认已有 SELL，勿重复下单'
  :'Invalid shares, below market minimum, or less than 0.01 share; if just submitted, verify existing SELL before retry';
 return reason;
}
