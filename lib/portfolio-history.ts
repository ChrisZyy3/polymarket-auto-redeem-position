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
  annualizedSinceStart: number | null;
  annualized7d: number | null;
  annualized30d: number | null;
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

function lookbackRate(
  snapshots: PortfolioSnapshot[],
  latest: PortfolioSnapshot,
  lookbackDays: number,
): number | null {
  const targetMs = Date.parse(latest.recordedAt) - lookbackDays * MS_PER_DAY;
  let baseline: PortfolioSnapshot | undefined;
  for (let index = snapshots.length - 1; index >= 0; index -= 1) {
    if (Date.parse(snapshots[index].recordedAt) <= targetMs) {
      baseline = snapshots[index];
      break;
    }
  }
  return baseline ? annualizedChange(baseline, latest) : null;
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
      annualizedSinceStart: null,
      annualized7d: null,
      annualized30d: null,
    };
  }

  return {
    changeSinceStart: latest.totalBalance / first.totalBalance - 1,
    annualizedSinceStart: annualizedChange(first, latest),
    annualized7d: lookbackRate(snapshots, latest, 7),
    annualized30d: lookbackRate(snapshots, latest, 30),
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
