"use strict";

const $ = id => document.getElementById(id);
const connected=$("connected"),status=$("status"),providerSelect=$("provider");
const funderSelect=$("funder"),copyButton=$("copy"),deriveButton=$("derive");
const createButton=$("create");
const discovered=[],known=new Set();
let signer=null,selectedProvider=null,csrf=null,credentials=null;

function report(message,kind="info"){
  status.textContent=message;
  status.dataset.kind=kind;
}
function registerProvider(provider,name){
  if(!provider||typeof provider.request!=="function"||known.has(provider))return;
  known.add(provider);discovered.push({provider,name});
  const option=document.createElement("option");
  option.value=String(discovered.length-1);option.textContent=name;
  providerSelect.appendChild(option);
  if(discovered.length===1)providerSelect.value="0";
}
window.addEventListener("eip6963:announceProvider",event=>{
  const detail=event.detail;
  if(detail?.provider)registerProvider(detail.provider,detail.info?.name||"EIP-6963 Wallet");
});
window.dispatchEvent(new Event("eip6963:requestProvider"));
setTimeout(()=>{
  const injected=window.ethereum;
  if(Array.isArray(injected?.providers)){
    for(const p of injected.providers){
      registerProvider(p,p.isRabby?"Rabby":p.isMetaMask?"MetaMask":"Browser Wallet");
    }
  }else if(injected)registerProvider(injected,injected.isRabby?"Rabby":"Browser Wallet");
  if(!discovered.length)report("No injected wallet detected. Open this localhost page in desktop Chrome with MetaMask or Rabby enabled.","error");
},350);

async function connect(){
  const selection=discovered[Number(providerSelect.value)];
  if(!selection)throw new Error("Select a wallet provider first.");
  const provider=selection.provider;
  const addresses=await provider.request({method:"eth_requestAccounts"});
  if(!Array.isArray(addresses)||!/^0x[a-fA-F0-9]{40}$/.test(addresses[0]??""))
    throw new Error("Wallet did not return a valid signer address.");
  const chain=await provider.request({method:"eth_chainId"});
  if(Number.parseInt(chain,16)!==137){
    await provider.request({method:"wallet_switchEthereumChain",params:[{chainId:"0x89"}]});
    const after=await provider.request({method:"eth_chainId"});
    if(Number.parseInt(after,16)!==137)throw new Error("Please switch the wallet to Polygon.");
  }
  selectedProvider=provider;
  signer=addresses[0];
  credentials=null;copyButton.disabled=true;createButton.disabled=true;
  connected.textContent="Signer: "+signer;
  deriveButton.disabled=false;
  report("Wallet connected. Verify the matching Polymarket funding/Safe address before deriving credentials.","ok");
}

async function signAndRequest(create=false){
  if(!selectedProvider||!signer)throw new Error("Connect your wallet first.");
  const current=await selectedProvider.request({method:"eth_accounts"});
  if(!Array.isArray(current)||current[0]?.toLowerCase()!==signer.toLowerCase())
    throw new Error("Wallet account changed. Connect the intended signer again.");
  const chain=await selectedProvider.request({method:"eth_chainId"});
  if(Number.parseInt(chain,16)!==137)throw new Error("Wallet is not on Polygon.");
  const funderAddress=funderSelect.value;
  if(!/^0x[a-fA-F0-9]{40}$/.test(funderAddress))throw new Error("Choose a funder wallet.");
  const context=await fetch("/context",{cache:"no-store"}).then(r=>r.json());
  if(!context?.csrf||!Number.isInteger(context.timestamp))throw new Error("Local session expired.");
  csrf=context.csrf;
  const typed={
    domain:{name:"ClobAuthDomain",version:"1",chainId:137},
    types:{
      EIP712Domain:[
        {name:"name",type:"string"},{name:"version",type:"string"},{name:"chainId",type:"uint256"}
      ],
      ClobAuth:[
        {name:"address",type:"address"},{name:"timestamp",type:"string"},
        {name:"nonce",type:"uint256"},{name:"message",type:"string"}
      ]
    },
    primaryType:"ClobAuth",
    message:{
      address:signer,timestamp:String(context.timestamp),nonce:"0",
      message:"This message attests that I control the given wallet"
    }
  };
  if(create&&!window.confirm(
    "Creating new CLOB API credentials may invalidate credentials used by existing bots. Only continue if you understand this risk. Continue?"
  ))return;
  report("Approve the official ClobAuth typed-data signature in your wallet (not an on-chain transaction).");
  const signature=await selectedProvider.request({
    method:"eth_signTypedData_v4",params:[signer,JSON.stringify(typed)]
  });
  const res=await fetch(create?"/create":"/derive",{
    method:"POST",
    headers:{"content-type":"application/json","x-local-csrf":csrf},
    body:JSON.stringify({address:signer,signature,nonce:0,
      timestamp:context.timestamp,funderAddress,confirmCreate:create}),
    cache:"no-store"
  });
  const result=await res.json();
  if(!res.ok){
    if(result.error==="credentials_not_derived"&&!create){
      createButton.disabled=false;
      report("No credentials derived for nonce 0. You may explicitly create new credentials, but check for other trading integrations first.","warning");
      return;
    }
    throw new Error("CLOB credential request failed: "+String(result.error??"unknown"));
  }
  credentials=result;
  copyButton.disabled=false;
  createButton.disabled=true;
  report("CLOB credentials received locally. Copy the bundle directly into the matching Cloudflare Secret. Nothing was saved to disk.","ok");
}

$("connect").addEventListener("click",()=>connect().catch(e=>report(e.message,"error")));
deriveButton.addEventListener("click",()=>signAndRequest(false).catch(e=>report(e.message,"error")));
createButton.addEventListener("click",()=>signAndRequest(true).catch(e=>report(e.message,"error")));
copyButton.addEventListener("click",async()=>{
  if(!credentials)return;
  try{
    await navigator.clipboard.writeText(JSON.stringify(credentials));
    report("Copied. Paste into Cloudflare Secret CLOB_ACCOUNT_1 / _2 / _3, then clear your clipboard and close this local page.","ok");
  }catch{report("Clipboard permission denied. Use desktop Chrome on localhost and grant copy permission.","error");}
});
$("clear").addEventListener("click",async()=>{
  credentials=null;copyButton.disabled=true;createButton.disabled=true;
  try{await navigator.clipboard.writeText("");}catch{}
  report("Cleared in-memory credentials and attempted to clear clipboard. Close the browser tab after setup.","ok");
});
(async()=>{
  try{
    const res=await fetch("/context",{cache:"no-store"});
    if(!res.ok)throw new Error("Local session expired");
    const c=await res.json();csrf=c.csrf;
    for(const addr of c.funders){
      const option=document.createElement("option");
      option.value=addr;option.textContent=addr;funderSelect.appendChild(option);
    }
    report("Select MetaMask / Rabby, connect, and choose the Polymarket account funding address.");
  }catch(e){report(e.message,"error");}
})();
