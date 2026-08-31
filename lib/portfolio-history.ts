export interface PortfolioSnapshot {
  recordedAt: string;
  address: string;
  totalBalance: number;
  positionsValue: number;
  availableBalance: number;
  positionCount: number;
}

export interface PortfolioHistory {
  version: 1;
  snapshots: PortfolioSnapshot[];
}

export interface PortfolioHistoryMetrics {
  changeSinceStart: number | null;
  balanceChangeSinceStart: number | null;
  annualizedSinceStart: number | null;
  annualized7d: number | null;
  balanceChange7d: number | null;
  annualized30d: number | null;
  balanceChange30d: number | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function snapshotDay(snapshot: PortfolioSnapshot): string {
  return snapshot.recordedAt.slice(0, 10);
}

function annualizedChange(start: PortfolioSnapshot, end: PortfolioSnapshot): number | null {
  const startMs = Date.parse(start.recordedAt);
  const endMs = Date.parse(end.recordedAt);
  const elapsedDays = (endMs - startMs) / MS_PER_DAY;

  if (elapsedDays <= 0 || start.totalBalance <= 0 || end.totalBalance < 0) return null;
  return Math.pow(end.totalBalance / start.totalBalance, 365 / elapsedDays) - 1;
}

function lookbackSnapshot(
  snapshots: PortfolioSnapshot[],
  latest: PortfolioSnapshot,
  lookbackDays: number,
): PortfolioSnapshot | undefined {
  const targetMs = Date.parse(latest.recordedAt) - lookbackDays * MS_PER_DAY;
  for (let index = snapshots.length - 1; index >= 0; index -= 1) {
    if (Date.parse(snapshots[index].recordedAt) <= targetMs) {
      return snapshots[index];
    }
  }
  return undefined;
}

export function appendSnapshot(
  history: PortfolioHistory,
  nextSnapshot: PortfolioSnapshot,
): PortfolioHistory {
  const address = nextSnapshot.address.toLowerCase();
  const day = snapshotDay(nextSnapshot);
  const snapshots = history.snapshots.filter(
    (snapshot) =>
      snapshot.address.toLowerCase() !== address || snapshotDay(snapshot) !== day,
  );

  snapshots.push(nextSnapshot);
  snapshots.sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
  return { version: 1, snapshots };
}

export function calculateHistoryMetrics(
  input: PortfolioSnapshot[],
): PortfolioHistoryMetrics {
  const snapshots = [...input].sort((left, right) =>
    left.recordedAt.localeCompare(right.recordedAt),
  );
  const first = snapshots[0];
  const latest = snapshots.at(-1);

  if (!first || !latest || first.totalBalance <= 0) {
    return {
      changeSinceStart: null,
      balanceChangeSinceStart: null,
      annualizedSinceStart: null,
      annualized7d: null,
      balanceChange7d: null,
      annualized30d: null,
      balanceChange30d: null,
    };
  }

  const baseline7d = lookbackSnapshot(snapshots, latest, 7);
  const baseline30d = lookbackSnapshot(snapshots, latest, 30);

  return {
    changeSinceStart: latest.totalBalance / first.totalBalance - 1,
    balanceChangeSinceStart: latest.totalBalance - first.totalBalance,
    annualizedSinceStart: annualizedChange(first, latest),
    annualized7d: baseline7d ? annualizedChange(baseline7d, latest) : null,
    balanceChange7d: baseline7d ? latest.totalBalance - baseline7d.totalBalance : null,
    annualized30d: baseline30d ? annualizedChange(baseline30d, latest) : null,
    balanceChange30d: baseline30d ? latest.totalBalance - baseline30d.totalBalance : null,
  };
}

export function snapshotsForAddress(
  history: PortfolioHistory,
  address: string,
): PortfolioSnapshot[] {
  const normalizedAddress = address.toLowerCase();
  return history.snapshots.filter(
    (snapshot) => snapshot.address.toLowerCase() === normalizedAddress,
  );
}
