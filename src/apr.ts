import type { Position } from "./types.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface AprResult {
  position: Position;
  /** 当前持有方向的市价（0~1），越接近 1 代表市场认为越大概率会赢 */
  curPrice: number;
  /** 持有到结算的收益率：(1 - curPrice) / curPrice */
  roi: number;
  /** 距结算日的天数（可能为小数；已过期则为负） */
  daysToSettle: number;
  /** 年化收益率（小数，例如 0.08 表示 8%）。无法计算时为 null */
  apr: number | null;
  /** apr 为 null 或需要关注时的说明 */
  note?: string;
}

/**
 * 计算单个仓位「从当前市价持有到结算日」的前瞻年化收益率（APR）。
 *
 * 逻辑：结算时获胜方向每股返还 $1，当前每股市价为 curPrice，
 * 因此持有到期的收益率 roi = (1 - curPrice) / curPrice，
 * 再按距结算的天数做简单年化：apr = roi * 365 / daysToSettle。
 *
 * @param position 仓位对象
 * @param now 当前时间（默认 new Date()，便于测试注入）
 */
export function calcApr(position: Position, now: Date = new Date()): AprResult {
  const curPrice = position.curPrice;
  // curPrice 异常（<=0）时 roi 无意义，置 0 避免除零
  const roi = curPrice > 0 ? (1 - curPrice) / curPrice : 0;

  let daysToSettle = Number.NaN;
  let apr: number | null = null;
  let note: string | undefined;

  if (!position.endDate) {
    note = "缺少结算日期，无法计算 APR";
  } else {
    const endMs = new Date(position.endDate).getTime();
    if (Number.isNaN(endMs)) {
      note = "结算日期无法解析，无法计算 APR";
    } else {
      daysToSettle = (endMs - now.getTime()) / MS_PER_DAY;
      if (daysToSettle <= 0) {
        note = "已过结算日但仍未可赎回，需关注";
      } else if (curPrice <= 0 || curPrice >= 1) {
        // 价格已贴到边界，几乎没有套利空间
        apr = 0;
        note = "市价已无套利空间";
      } else {
        apr = (roi * 365) / daysToSettle;
      }
    }
  }

  return { position, curPrice, roi, daysToSettle, apr, note };
}

/**
 * 判断一个仓位是否需要关注（提示调仓）：
 * 1. APR 无法计算（缺日期 / 已过期未赎回等异常）；或
 * 2. APR 低于阈值。
 *
 * @param result calcApr 的结果
 * @param thresholdPercent 阈值（百分比，例如 8 表示 8%）
 */
export function needsAttention(result: AprResult, thresholdPercent: number): boolean {
  if (result.apr === null) {
    return true;
  }
  return result.apr * 100 < thresholdPercent;
}

/**
 * 判断仓位是否「即将归零」：持有方向当前市价低于阈值，
 * 说明市场认为你大概率站错边、到期会归零。此类仓位的 APR 无参考意义，需单独列出。
 *
 * @param result calcApr 的结果
 * @param priceThreshold 市价阈值（0~1，例如 0.5）
 */
export function isLosing(result: AprResult, priceThreshold: number): boolean {
  return result.curPrice < priceThreshold;
}

/**
 * 按当前市价升序排序（最接近归零的排最前）。
 */
export function sortByPriceAsc(results: AprResult[]): AprResult[] {
  return [...results].sort((a, b) => a.curPrice - b.curPrice);
}

/**
 * 按 APR 升序排序（最该调仓的排最前）；无法计算 APR 的异常仓位排在最顶部。
 */
export function sortByAprAsc(results: AprResult[]): AprResult[] {
  return [...results].sort((a, b) => {
    if (a.apr === null && b.apr === null) return 0;
    if (a.apr === null) return -1;
    if (b.apr === null) return 1;
    return a.apr - b.apr;
  });
}
