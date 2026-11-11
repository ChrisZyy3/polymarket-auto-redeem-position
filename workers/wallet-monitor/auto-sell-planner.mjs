// Read-only Auto Sell planner. Reuses the five-minute wallet-monitor poll's
// existing position snapshot and Mark APR date basis. NEVER signs or sends
// orders; orderbook tick size and active orders must be verified before V2.
import { remainingYears, simpleApr } from "./low-apy.mjs";

export const AUTO_SELL_PLANNER_BASIS = "mark-apr-dry-run-v1";
export const DEFAULT_AUTO_SELL_TARGET_APR_PCT = 12;
const validNumber = value => value !== undefined && value !== null &&
  value !== "" && Number.isFinite(Number(value));
const positive = value => validNumber(value) && Number(value) > 0;
const rounded = value => Number(Number(value).toFixed(8));

function exposureUsd(position) {
  const current=positive(position.currentValue)?Number(position.currentValue):0;
  const initial=positive(position.initialValue)?Number(position.initialValue):0;
  const shares=positive(position.size)&&positive(position.avgPrice)
    ? Number(position.size)*Number(position.avgPrice):0;
  return Math.max(current,initial,shares);
}

export function theoreticalSellPrice(targetAprPct, endDate, nowSec) {
  if(!Number.isFinite(Number(targetAprPct)) || Number(targetAprPct)<=0)return null;
  const years=remainingYears(endDate,nowSec);
  if(years===null || !Number.isFinite(years) || years<=0)return null;
  const denominator=1+(Number(targetAprPct)/100)*years;
  const price=1/denominator;
  return Number.isFinite(price)&&price>0&&price<1 ? price:null;
}

export function buildAutoSellDryRun(positions,previous,nowSec,options={}) {
  if(!Number.isFinite(nowSec)||nowSec<=0)throw new Error("Invalid planner time");
  const enabled=options.enabled===true;
  const targetAprPct=Number(options.targetAprPct??DEFAULT_AUTO_SELL_TARGET_APR_PCT);
  const minUsd=Number(options.minUsd??5);
  if(!Number.isFinite(targetAprPct)||targetAprPct<=0||targetAprPct>10000 ||
      !Number.isFinite(minUsd)||minUsd<0)throw new Error("Invalid auto-sell config");
  const previousItems=previous?.basis===AUTO_SELL_PLANNER_BASIS ? previous.plans||{}:{};
  if(!enabled){
    return {basis:AUTO_SELL_PLANNER_BASIS,mode:"off",checkedAt:nowSec,
      targetAprPct,plans:{},summary:{eligible:0,needsQuote:0,reprice:0}};
  }
  const plans={};
  let eligible=0, needsQuote=0, reprice=0;
  for(const p of Array.isArray(positions)?positions:[]){
    if(!p||p.asset==null||p.redeemable===true||!positive(p.size))continue;
    if(exposureUsd(p)<minUsd)continue;
    const asset=String(p.asset);
    // A token is identified within its own wallet's Durable Object.
    if(!asset || Object.prototype.hasOwnProperty.call(plans,asset))continue;
    const markPrice=validNumber(p.curPrice)?Number(p.curPrice):null;
    const years=remainingYears(p.endDate,nowSec);
    const markApr=markPrice!==null?simpleApr(markPrice,p.endDate,nowSec):null;
    const targetPrice=theoreticalSellPrice(targetAprPct,p.endDate,nowSec);
    const size=Number(p.size);
    const previousPlan=previousItems[asset];
    const status=targetPrice===null?"unknown_settlement":
      markApr===null||markPrice<=0||markPrice>1?"invalid_mark_price":
      "theoretical_only";
    // Only mark an indicative action; the Worker intentionally does not
    // know tick size, outstanding orders, wallet allowance or live CLOB bids.
    const delta=previousPlan && typeof previousPlan.theoreticalPrice==="number" && targetPrice!==null
      ? targetPrice-previousPlan.theoreticalPrice:null;
    const indicativeAction=status!=="theoretical_only"?"needs_review":
      !previousPlan||previousPlan.status!=="theoretical_only"?"would_create":
      delta!==null && Math.abs(delta)>=0.0001?"would_reprice":"unchanged";
    if(status==="theoretical_only")eligible++;
    if(indicativeAction==="would_reprice")reprice++;
    if(targetPrice!==null)needsQuote++;
    plans[asset]={
      tokenId:asset,
      title:String(p.title||p.conditionId||"Unknown market").slice(0,240),
      outcome:String(p.outcome||"").slice(0,60),
      endDate:p.endDate||null,
      quantity:size,
      markPrice,
      markAprPct:markApr===null?null:rounded(markApr*100),
      targetAprPct,
      theoreticalPrice:targetPrice===null?null:rounded(targetPrice),
      status,indicativeAction,
      // Never give a false executable SELL price with an assumed tick size.
      proposedLimitPrice:null,
      tickVerified:false,
      orderBookChecked:false,
      checkedAt:nowSec
    };
  }
  return {basis:AUTO_SELL_PLANNER_BASIS,mode:"dry-run",checkedAt:nowSec,
    targetAprPct,plans,summary:{eligible,needsQuote,reprice}};
}
