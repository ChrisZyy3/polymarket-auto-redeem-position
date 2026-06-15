import type { Position } from "./types.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface AprResult {
  position: Position;
  curPrice: number;
  roi: number;
  daysToSettle: number;
  apr: number | null;
  note?: string;
}

export function calcApr(position: Position, now: Date = new Date()): AprResult {
  const curPrice = position.curPrice;
  const roi = curPrice > 0 ? (1 - curPrice) / curPrice : 0;

  let daysToSettle = Number.NaN;
  let apr: number | null = null;
  let note: string | undefined;

  if (!position.endDate) {
    note = "缺少结算日期";
  } else {
    const endMs = new Date(position.endDate).getTime();
    if (Number.isNaN(endMs)) {
      note = "结算日期无法解析";
    } else {
      daysToSettle = (endMs - now.getTime()) / MS_PER_DAY;
      if (daysToSettle <= 0) {
        note = "已过结算日";
      } else if (curPrice <= 0 || curPrice >= 1) {
        apr = 0;
        note = "市价无套利空间";
      } else {
        apr = (roi * 365) / daysToSettle;
      }
    }
  }

  return { position, curPrice, roi, daysToSettle, apr, note };
}

export function needsAttention(result: AprResult, thresholdPercent: number): boolean {
  if (result.apr === null) return true;
  return result.apr * 100 < thresholdPercent;
}

export function isLosing(result: AprResult, priceThreshold: number): boolean {
  return result.curPrice < priceThreshold;
}
