import type { Position } from "./types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SETTLEMENT_TIME_ZONE = "America/New_York";

// Polymarket 的 endDate 是不带时间的日期（如 "2026-06-17”），实际结算发生在
// 美东时间当天结束（23:59:59.999 ET），这里换算成对应的 UTC 时间点用于计算剩余天数。
function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.filter(({ type }) => type !== "literal").map(({ type, value }) => [type, value]),
  );
  const asUtcMs = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  if (!Number.isFinite(asUtcMs)) return 0;
  return Math.round((asUtcMs - date.getTime()) / (60 * 1000));
}

function endOfDaySettlementUtcMs(dateStr: string): number | null {
  const startOfDayUtcMs = new Date(`${dateStr}T00:00:00.000Z`).getTime();
  if (Number.isNaN(startOfDayUtcMs)) return null;

  // Resolve the offset at the settlement instant itself. The offset at UTC
  // midnight can differ on DST transition dates.
  const endOfDayUtcMs = startOfDayUtcMs + MS_PER_DAY - 1;
  let settlementUtcMs = endOfDayUtcMs;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const offsetMinutes = getTimeZoneOffsetMinutes(new Date(settlementUtcMs), SETTLEMENT_TIME_ZONE);
    settlementUtcMs = endOfDayUtcMs - offsetMinutes * 60 * 1000;
  }
  return settlementUtcMs;
}

export interface AprResult {
  position: Position;
  curPrice: number;
  avgPrice: number;
  holdRoi: number;
  costRoi: number;
  daysToSettle: number;
  holdApr: number | null;
  costApr: number | null;
  note?: string;
}

export function calcApr(position: Position, now: Date = new Date()): AprResult {
  const curPrice = position.curPrice;
  const avgPrice = position.avgPrice;

  const holdRoi = curPrice > 0 ? (1 - curPrice) / curPrice : 0;
  const costRoi = avgPrice > 0 ? (1 - avgPrice) / avgPrice : 0;

  let daysToSettle = Number.NaN;
  let holdApr: number | null = null;
  let costApr: number | null = null;
  let note: string | undefined;

  if (!position.endDate) {
    note = "缺少结算日期";
  } else {
    const endMs = endOfDaySettlementUtcMs(position.endDate);
    if (endMs === null) {
      note = "结算日期无法解析";
    } else {
      daysToSettle = (endMs - now.getTime()) / MS_PER_DAY;
      if (daysToSettle <= 0) {
        note = "已过结算日";
      } else {
        holdApr = curPrice > 0 && curPrice < 1 ? (holdRoi * 365) / daysToSettle : 0;
        costApr = avgPrice > 0 && avgPrice < 1 ? (costRoi * 365) / daysToSettle : 0;
        if (curPrice <= 0 || curPrice >= 1) {
          note = "市价无套利空间";
        }
      }
    }
  }

  return { position, curPrice, avgPrice, holdRoi, costRoi, daysToSettle, holdApr, costApr, note };
}

export function needsAttention(result: AprResult, thresholdPercent: number): boolean {
  if (result.holdApr === null) return true;
  return result.holdApr * 100 < thresholdPercent;
}

export function isLosing(result: AprResult, priceThreshold: number): boolean {
  return result.curPrice < priceThreshold;
}
