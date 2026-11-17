import { createSecureClient, OrderSide } from '@polymarket/client';
import { signerFrom } from '@polymarket/client/viem';
import type { WalletClient } from 'viem';
import { validateSignedSell } from './validate-signed-sell';
import type { ClobCredentials } from './browser-clob';

/** Never create credentials or wallet, send chain transactions, or auto-approve allowances. */
export async function createSafeSellClient(wallet:WalletClient, funder:string, credentials:ClobCredentials) {
 const base=signerFrom(wallet);
 let permitOrderSignature=false, posted=false;
 const signer={...base,signTypedData:async (payload:Parameters<typeof base.signTypedData>[0])=>{if(!permitOrderSignature || payload.primaryType!=='Order')throw Error('unexpected_signature');return base.signTypedData(payload);},signMessage:async()=>{throw Error('unexpected_signature');},sendTransaction:async()=>{throw Error('transactions_disabled');}};
 const restrictedFetch:typeof fetch=async (input,init)=>{
  const request=new Request(input,init), url=new URL(request.url);
  if(request.method!=='GET' && !(request.method==='POST' && url.origin==='https://clob.polymarket.com' && url.pathname==='/order')) throw Error('request_not_allowed');
  if(request.method==='POST'){if(posted)throw Error('duplicate_submission_blocked');posted=true;}
  return fetch(request);
 };
 const client=await createSecureClient({signer,wallet:funder,credentials:{key:credentials.apiKey,secret:credentials.secret,passphrase:credentials.passphrase} as NonNullable<Parameters<typeof createSecureClient>[0]["credentials"]>,fetch:restrictedFetch});
 if(client.account.wallet.toLowerCase()!==funder.toLowerCase() || Number(client.account.walletType)!==2) throw Error('safe_mismatch');
 return {sign:async (assetId:string,price:number,size:number,expiration:number)=>{permitOrderSignature=true;try{const order=await client.createLimitOrder({assetId,side:OrderSide.SELL,price:String(price),size:String(size),postOnly:true,expiration});if(!validateSignedSell(order,{assetId,funder,signer:wallet.account!.address,price,size,expiration}))throw Error("signed_order_differs");return order;}finally{permitOrderSignature=false;}},post:(order:Parameters<typeof client.postOrder>[0])=>client.postOrder(order)};
}
