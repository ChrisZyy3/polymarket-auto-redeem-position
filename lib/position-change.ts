// A daily fixed-time reference, NOT a rolling 24-hour return.
// Records use the same Polymarket current_price field as the live Dashboard.
export interface DailyPositionPoint {
  tokenId: string;
  price: number | null;
  size: number;
  value: number | null;
}

export interface DailyWalletPositionSnapshot {
  address: string;
  recordedAt: string;
  positions: DailyPositionPoint[];
}

export interface DailyPositionHistory {
  version: 1;
  date: string; // Asia/Shanghai calendar day
  wallets: DailyWalletPositionSnapshot[];
}

export interface DailyPriceChange {
  kind: "ok" | "new" | "missing" | "zero-reference";
  rate: number | null; // e.g. 0.0147 = +1.47%
  cents: number | null; // e.g. 1.4 = +1.4 cents
  previousPrice: number | null;
}

const SHANGHAI_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function shanghaiCalendarDay(at: Date): string {
  if (!Number.isFinite(at.getTime())) throw new Error("Invalid snapshot time");
  const parts = SHANGHAI_DATE.formatToParts(at);
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function previousShanghaiCalendarDay(at: Date): string {
  const date = shanghaiCalendarDay(at);
  const ms = Date.parse(date + "T00:00:00.000Z");
  return new Date(ms - 86400000).toISOString().slice(0, 10);
}

export function mergeDailyPositionHistory(
  previous: DailyPositionHistory | null,
  date: string,
  wallets: DailyWalletPositionSnapshot[],
): DailyPositionHistory {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid position history date");
  if (previous && (previous.version !== 1 || previous.date !== date)) {
    throw new Error("Position history file has a mismatched date/version");
  }
  const merged = new Map<string, DailyWalletPositionSnapshot>();
  for (const entry of previous?.wallets ?? []) {
    merged.set(entry.address.toLowerCase(), entry);
  }
  for (const entry of wallets) {
    const address = entry.address.toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(address)) throw new Error("Invalid snapshot wallet");
    const tokens = new Set<string>();
    for (const point of entry.positions) {
      if (!point.tokenId || tokens.has(point.tokenId)) throw new Error("Duplicate/missing token ID in position snapshot");
      tokens.add(point.tokenId);
      if (!Number.isFinite(point.size) || point.size <= 0 ||
          (point.price !== null && (!Number.isFinite(point.price) || point.price < 0 || point.price > 1)) ||
          (point.value !== null && !Number.isFinite(point.value))) {
        throw new Error("Invalid position price/size/value in daily snapshot");
      }
    }
    merged.set(address, {
      ...entry,
      address,
      positions: [...entry.positions].sort((a, b) => a.tokenId.localeCompare(b.tokenId)),
    });
  }
  return { version: 1, date, wallets: [...merged.values()].sort((a, b) => a.address.localeCompare(b.address)) };
}

export function calculateDailyPriceChange(
  currentPrice: number | null | undefined,
  previous: DailyPositionPoint | undefined,
  hasPreviousWalletSnapshot: boolean,
): DailyPriceChange {
  if (!hasPreviousWalletSnapshot) return { kind: "missing", rate: null, cents: null, previousPrice: null };
  if (!previous) return { kind: "new", rate: null, cents: null, previousPrice: null };
  const reference = previous.price;
  if (typeof currentPrice !== "number" || !Number.isFinite(currentPrice) ||
      currentPrice < 0 || currentPrice > 1 ||
      reference === null || !Number.isFinite(reference) || reference < 0 || reference > 1) {
    return { kind: "missing", rate: null, cents: null, previousPrice: reference };
  }
  const cents = (currentPrice - reference) * 100;
  if (reference === 0) {
    return { kind: "zero-reference", rate: null, cents, previousPrice: reference };
  }
  return { kind: "ok", rate: (currentPrice - reference) / reference, cents, previousPrice: reference };
}
