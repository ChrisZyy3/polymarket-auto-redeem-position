"use client";

import { useState } from "react";
import { Wallet2, Copy, Check, ShieldCheck } from "lucide-react";
import { useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { polygon } from "wagmi/chains";

export function WalletConnectPanel({ language }: { language: "zh" | "en" }) {
  const en = language === "en";
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { address, chainId, isConnected, connector } = useConnection();
  const connectors = useConnectors();
  const { connect, isPending, error, reset } = useConnect();
  const { disconnect } = useDisconnect();
  const { mutate: switchChain, isPending: switching, error: switchError } = useSwitchChain();
  const wcEnabled = Boolean(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim());
  return <section className="ui-surface mt-4 p-4 sm:p-5" aria-label={en ? "Web3 wallet connection" : "Web3 钱包连接"}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="flex items-center gap-2 text-sm font-semibold text-slate-100"><Wallet2 className="h-4 w-4 text-cyan-300" aria-hidden="true"/>{en ? "Web3 wallet" : "Web3 钱包"}</h2><p className="mt-1 text-xs text-slate-400">{en ? "Connect to inspect signer and network" : "连接后查看签名地址与网络"}</p></div>
      {isConnected ? <button type="button" onClick={() => { disconnect(); setOpen(false); }} className="ui-button-quiet px-4 py-2 text-sm">{en ? "Disconnect" : "断开连接"}</button> : <button type="button" onClick={() => { reset(); setOpen(v => !v); }} aria-expanded={open} aria-controls="wallet-options" className="ui-button-secondary px-4 py-2 text-sm">{open ? (en ? "Close" : "收起") : (en ? "Connect wallet" : "连接钱包")}</button>}
    </div>
    {isConnected && address ? <div className="ui-inset mt-4 space-y-3 px-4 py-3 text-sm text-slate-300" role="status">
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="ui-pill ui-pill-success"><span className="ui-live-dot" aria-hidden="true"/>{en ? "Connected" : "钱包已连接"}</span><span className="text-xs text-slate-400">{connector?.name}</span></div>
      <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-slate-400">{en ? "Signer" : "签名地址"}</span><code title={address} className="max-w-full break-all rounded-md bg-slate-950/65 px-2 py-1 font-mono text-xs text-cyan-200">{address}</code><button type="button" className="ui-button-quiet h-8 w-8" aria-label={en?"Copy address":"复制地址"} onClick={async()=>{try{await navigator.clipboard.writeText(address);setCopied(true);}catch{setCopied(false);}}}>{copied?<Check className="h-3.5 w-3.5"/>:<Copy className="h-3.5 w-3.5"/>}</button></div>
      <p className="flex flex-wrap items-center gap-2 text-xs"><ShieldCheck className="h-4 w-4 text-slate-400" aria-hidden="true"/>{en ? "Network" : "网络"}: <span className={chainId===polygon.id?"ui-pill ui-pill-success":"ui-pill ui-pill-warn"}>{chainId === polygon.id ? "Polygon" : `${en ? "Unsupported network" : "非 Polygon 网络"} (${chainId ?? "—"})`}</span></p>
      {chainId !== polygon.id && <button type="button" disabled={switching} onClick={() => switchChain({ chainId: polygon.id })} className="ui-button-secondary px-3 py-2 text-xs disabled:opacity-50">{en ? "Switch to Polygon" : "切换至 Polygon"}</button>}
      {switchError && <p className="text-xs text-amber-300">{en ? "Network switch failed or was rejected." : "网络切换失败或已取消，请在钱包中检查。"}</p>}
    </div> : open ? <div id="wallet-options" className="mt-4 space-y-3">
      <p className="text-xs text-slate-400">{en ? "Choose an installed browser wallet or WalletConnect if configured." : "选择已安装的浏览器钱包；配置后也可使用 WalletConnect。"}</p>
      <div className="flex flex-wrap gap-2">{connectors.map(c => <button type="button" key={c.uid} disabled={isPending} onClick={() => connect({ connector: c })} className="ui-button-secondary px-4 py-2 text-sm disabled:opacity-50">{c.name === "Injected" ? (en ? "Browser wallet" : "浏览器钱包") : c.name}</button>)}</div>
      {error && <p role="alert" className="text-xs text-amber-300">{en ? "Connection failed or was rejected. Check your wallet and try again." : "连接失败或已取消，请检查钱包后重试。"}</p>}
      {!wcEnabled && <p className="text-xs text-slate-500">{en ? "WalletConnect mobile QR is not configured." : "WalletConnect 手机扫码暂未配置。"}</p>}
    </div> : null}
    <p className="mt-3 text-xs leading-5 text-slate-400">{en ? "The signer may differ from your Polymarket profile / funding address. Connecting does not query orders, sign messages, or place orders." : "签名地址可能不同于 Polymarket 持仓／资金地址。连接不会读取挂单、签署消息或下单。"}</p>
  </section>;
}
