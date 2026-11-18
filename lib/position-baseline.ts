import {
  previousShanghaiCalendarDay,
  shanghaiCalendarDay,
  type DailyPositionHistory,
  type DailyPositionPoint,
} from "./position-change";

/** Seven complete Beijing calendar days, starting with yesterday. Never use today's price as a baseline. */
export const POSITION_BASELINE_LOOKBACK_DAYS = 7;
export type PositionReferenceKind = "yesterday" | "recent";

export interface PositionBaselineResult {
  status: "ok" | "missing";
  expectedDate: string;
  baselineDate: string;
  referenceKind: PositionReferenceKind | null;
  recordedAt: string | null;
  positions: DailyPositionPoint[];
}

export function positionBaselineDates(at: Date, lookbackDays = POSITION_BASELINE_LOOKBACK_DAYS): string[] {
  if (!Number.isInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > POSITION_BASELINE_LOOKBACK_DAYS) {
    throw new Error("Invalid position baseline lookback");
  }
  const yesterday = previousShanghaiCalendarDay(at);
  const start = Date.parse(yesterday + "T00:00:00.000Z");
  return Array.from({ length: lookbackDays }, (_, index) =>
    new Date(start - index * 86400000).toISOString().slice(0, 10),
  );
}

export async function selectPositionBaseline(
  address: string,
  at: Date,
  read: (date: string) => Promise<DailyPositionHistory | null>,
  lookbackDays = POSITION_BASELINE_LOOKBACK_DAYS,
): Promise<PositionBaselineResult> {
  const dates = positionBaselineDates(at, lookbackDays);
  const expectedDate = dates[0];
  for (const date of dates) {
    const history = await read(date);
    if (!history) continue;
    if (history.version !== 1 || history.date !== date || !Array.isArray(history.wallets)) {
      throw new Error("Invalid position snapshot for " + date);
    }
    const wallet = history.wallets.find(item => item.address.toLowerCase() === address.toLowerCase());
    if (!wallet) continue;
    const recorded = new Date(wallet.recordedAt);
    if (!Number.isFinite(recorded.getTime()) || shanghaiCalendarDay(recorded) !== date) {
      // An incorrectly dated snapshot is not a valid historical reference.
      continue;
    }
    return {
      status: "ok",
      expectedDate,
      baselineDate: date,
      referenceKind: date === expectedDate ? "yesterday" : "recent",
      recordedAt: wallet.recordedAt,
      positions: wallet.positions,
    };
  }
  return {
    status: "missing",
    expectedDate,
    baselineDate: expectedDate,
    referenceKind: null,
    recordedAt: null,
    positions: [],
  };
}

