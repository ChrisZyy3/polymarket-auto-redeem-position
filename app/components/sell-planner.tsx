"use client";

import { useEffect, useRef, useState } from 'react';
import { makerSellSuggestion } from '@/lib/sell-planner';
import type { PositionQuote } from '@/lib/position-quote';
import type { EnrichedPosition } from '@/lib/types';

type Row = { wallet: string; position: EnrichedPosition; quote: PositionQuote | null; quotedAt: number; positionAt: number; error?: string };
const validAddress = (s: string) => /^0x[0-9a-f]{40}$/i.test(s);
const MAX_AGE = 5 * 60_000;
const fmt = (v: number | null | undefined, n = 2) => v == null || !Number.isFinite(v) ? '—' : v.toFixed(n);

export function SellPlanner({ currentAddress, language }: { currentAddress: string; language: 'zh' | 'en' }) {
  const en = language === 'en';
  const [addresses, setAddresses] = useState('');
  const [target, setTarget] = useState('12');
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<Row[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now());
  const generation = useRef(0);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 15_000); return () => { clearInterval(timer); generation.current++; }; }, []);
  useEffect(() => { if (currentAddress) setAddresses(currentAddress); }, [currentAddress]);
  const key = (r: Row) => `${r.wallet.toLowerCase()}:${r.position.asset}`;
  async function refresh() {
    const wallets = [...new Set(addresses.split(/[\s,，]+/).filter(Boolean).map(a => a.toLowerCase()))];
    if (!wallets.length || wallets.length > 3 || wallets.some(a => !validAddress(a))) {
      setErrors([en ? 'Enter one to three valid wallet addresses.' : '请输入 1 至 3 个有效钱包地址。']); return;
    }
    const run = ++generation.current;
    setLoading(true); setRows([]); setErrors([]); setOverrides({});
    const results = await Promise.all(wallets.map(async wallet => {
      try {
        const res = await fetch(`/api/positions?address=${wallet}&aprThreshold=10&minValue=0`, { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok || !Array.isArray(data.positions)) throw new Error(data.error || `HTTP ${res.status}`);
        return { wallet, positions: (data.positions as EnrichedPosition[]).filter(p => !p.redeemable && p.size > 0), positionAt: Date.parse(data.fetchedAt || ''), error: '' };
      } catch (e) { return { wallet, positions: [] as EnrichedPosition[], positionAt: NaN, error: e instanceof Error ? e.message : 'Request failed' }; }
    }));
    if (run !== generation.current) return;
    setErrors(results.filter(r => r.error).map(r => `${r.wallet}: ${r.error}`));
    const work: Row[] = results.flatMap(r => r.positions.map(position => ({ wallet: r.wallet, position, quote: null, quotedAt: 0, positionAt: r.positionAt })));
    setRows([...work]);
    let next = 0;
    async function worker() {
      while (next < work.length && run === generation.current) {
        const i = next++; const row = work[i];
        try {
          const p = row.position;
          const params = new URLSearchParams({ tokenId: p.asset, currentPrice: String(p.curPrice), thresholdApr: '12' });
          if (p.endDate) params.set('endDate', p.endDate);
          const response = await fetch(`/api/position-quote?${params}`, { cache: 'no-store' });
          const payload = await response.json();
          if (!response.ok || !payload.ok || !payload.quote) throw new Error(payload.error || `HTTP ${response.status}`);
          work[i] = { ...row, quote: payload.quote, quotedAt: Date.now() };
        } catch (e) { work[i] = { ...row, quotedAt: Date.now(), error: e instanceof Error ? e.message : 'Request failed' }; }
        if (run === generation.current) setRows([...work]);
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, work.length) }, () => worker()));
    if (run === generation.current) { setNow(Date.now()); setLoading(false); }
  }
  return <section className="mt-6 rounded-2xl border border-indigo-500/30 bg-slate-900/60 p-4 sm:p-5" aria-label="Sell Planner">
    <h2 className="text-lg font-bold text-slate-100">Sell Planner <span className="text-xs text-indigo-300">· DRY RUN</span></h2>
    <p className="mt-2 text-xs leading-5 text-amber-200">{en ? 'Read-only estimates. Shares are total holdings, not verified available shares; existing orders are unknown. No order or wallet signature is created. Settlement dates are estimates; maker execution is not guaranteed.' : '只读估算，不签名、不下单。数量为总持仓，并非已核实可卖数量；已有卖单占用未知。结算日期仅供估算，Maker 成交不保证。'}</p>
    <div className="mt-3 flex flex-wrap items-end gap-3">
      <label className="min-w-[240px] flex-1 text-xs text-slate-300">{en ? 'Wallets (up to 3, separated by spaces or commas)' : '钱包地址（最多 3 个，空格或逗号分隔）'}<textarea value={addresses} onChange={e=>setAddresses(e.target.value)} rows={2} className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 p-2 font-mono text-xs" /></label>
      <label className="text-xs text-slate-300">{en ? 'Global target APR %' : '全局目标 APR %'}<input type="number" min="0.01" max="10000" step="0.5" value={target} onChange={e=>setTarget(e.target.value)} className="mt-1 block w-28 rounded-lg border border-slate-700 bg-slate-950 p-2" /></label>
      <button type="button" disabled={loading} onClick={()=>void refresh()} className="rounded-lg bg-indigo-400 px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-50">{loading ? (en?'Loading…':'读取中…') : (en?'Refresh plan':'刷新计划')}</button>
    </div>
    {errors.map(e=><p key={e} role="alert" className="mt-2 break-all text-xs text-rose-300">{e}</p>)}
    <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-xs text-slate-300"><thead><tr className="border-b border-slate-700 text-slate-400">{(en?['Wallet / Market','Shares','Mark','Mark APR','Settlement / days','Target APR %','APR price','Best ask','Suggested sell','Status / action']:['钱包 / 市场','总持仓','当前价','Mark APR','预计结算 / 天数','目标 APR %','APR 对应价','卖一','建议卖价','状态 / 操作']).map(x=><th key={x} className="px-2 py-2 font-medium">{x}</th>)}</tr></thead><tbody>
    {rows.map(row=>{
      const p=row.position; const id=key(row); const raw=overrides[id] ?? target; const apr=raw.trim() ? Number(raw) : NaN;
      const result=makerSellSuggestion(row.quote,apr,p.size,p.avgPrice,p.redeemable);
      const stale=!!row.quotedAt && (now-row.quotedAt>MAX_AGE || !Number.isFinite(row.positionAt) || now-row.positionAt>MAX_AGE || row.positionAt>now+60_000);
      const price=stale?null:result.price;
      const slug=p.eventSlug || p.slug;
      const reasons: Record<string, string> = en ? {missing_bid_or_ask:'Bid or ask unavailable', invalid_or_crossed_book:'Invalid or crossed book', orderbook_or_tick_unverified:'Book or tick unavailable', settlement_date_missing_or_passed:'Settlement date missing or passed', target_above_highest_legal_price:'Target exceeds legal tick', invalid_target:'Invalid target APR', not_active_holdings:'Inactive position'} : {missing_bid_or_ask:'买一或卖一缺失', invalid_or_crossed_book:'盘口异常或交叉', orderbook_or_tick_unverified:'盘口或 Tick 不可用', settlement_date_missing_or_passed:'结算日期缺失或已过期', target_above_highest_legal_price:'目标价超过合法范围', invalid_target:'目标 APR 无效', not_active_holdings:'仓位不可用'};
      const status=!row.quotedAt ? (en?'Loading':'读取中') : row.error ? (en?'Quote failed':'报价失败') : stale ? (en?'Quote expired; refresh':'报价过期，请刷新') : price===null ? (reasons[result.reason] || (en?'Unavailable':'暂不可用')) : (en?'Indicative only':'仅供参考');
      return <tr key={id} className="border-b border-slate-800 align-top"><td className="max-w-[280px] px-2 py-3"><span className="font-mono text-slate-500">{row.wallet.slice(0,6)}…{row.wallet.slice(-4)}</span><div className="mt-1 whitespace-normal text-slate-100">{p.title} · {p.outcome}</div></td><td className="px-2 py-3">{fmt(p.size)}</td><td className="px-2 py-3">{fmt(p.curPrice,4)}</td><td className="px-2 py-3">{fmt(result.plan.currentMarkAprPercent)}%</td><td className="px-2 py-3">{p.endDate || '—'}<br/>{fmt(row.quote?.daysToSettle,1)} {en?'days':'天'}<br/><span className="text-slate-500">{en?'API estimate':'持仓 API 日期'}</span></td><td className="px-2 py-3"><input aria-label={`${p.title} target APR`} type="number" min="0.01" max="10000" step="0.5" placeholder={target} value={overrides[id] ?? ''} onChange={e=>setOverrides({...overrides,[id]:e.target.value})} className="w-20 rounded border border-slate-700 bg-slate-950 p-1" /></td><td className="px-2 py-3">{fmt(result.plan.theoreticalTargetPrice,5)}</td><td className="px-2 py-3">{fmt(row.quote?.bestAsk,4)}</td><td className="px-2 py-3 font-bold text-indigo-300">{price === null ? '—' : String(price)}</td><td className="px-2 py-3"><div>{status}</div>{row.quotedAt>0 && <div className="mt-1 text-slate-500">{new Date(row.quotedAt).toLocaleTimeString()} · {en?'positions':'持仓'} {Number.isFinite(row.positionAt) ? new Date(row.positionAt).toLocaleTimeString() : '—'}</div>}<div className="mt-2 flex gap-2">{price!==null && <button type="button" onClick={()=>void navigator.clipboard.writeText(String(price))} className="text-cyan-300 underline">{en?'Copy':'复制'}</button>}{slug && <a href={`https://polymarket.com/event/${encodeURIComponent(slug)}`} target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline">{en?'Open':'打开市场'}</a>}</div></td></tr>;
    })}</tbody></table></div>
  </section>;
}
