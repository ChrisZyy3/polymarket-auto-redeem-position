import { fetchCashBalance, fetchCurrentPositions } from "./polymarket";
import type { PortfolioSnapshot } from "./portfolio-history";
import type { DailyPositionPoint, DailyWalletPositionSnapshot } from "./position-change";

function roundAmount(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export interface PortfolioCapture {
  portfolio: PortfolioSnapshot;
  walletPositions: DailyWalletPositionSnapshot;
}

// One positions API read powers both portfolio totals and per-token price
// history. A missing price stays null; it is never turned into a zero price.
export async function capturePortfolioSnapshotWithPositions(
  address: string,
  recordedAt = new Date(),
): Promise<PortfolioCapture> {
  const [positions, availableBalance] = await Promise.all([
    fetchCurrentPositions(address, 0),
    fetchCashBalance(address),
  ]);
  const positionsValue = positions.reduce(
    (total, position) => total + position.currentValue,
    0,
  );
  if (!Number.isFinite(positionsValue) || !Number.isFinite(availableBalance)) {
    throw new Error("Polymarket returned a non-finite portfolio balance");
  }
  const normalizedAddress = address.toLowerCase();
  const pricePoints: DailyPositionPoint[] = positions
    .filter(position => Number.isFinite(position.size) && position.size > 0)
    .map(position => ({
      tokenId: position.asset,
      price: Number.isFinite(position.curPrice) && position.curPrice >= 0 && position.curPrice <= 1
        ? roundAmount(position.curPrice)
        : null,
      size: position.size,
      value: Number.isFinite(position.currentValue) ? roundAmount(position.currentValue) : null,
    }));
  return {
    portfolio: {
      recordedAt: recordedAt.toISOString(),
      address: normalizedAddress,
      totalBalance: roundAmount(positionsValue + availableBalance),
      positionsValue: roundAmount(positionsValue),
      availableBalance: roundAmount(availableBalance),
      positionCount: positions.length,
    },
    walletPositions: {
      recordedAt: recordedAt.toISOString(),
      address: normalizedAddress,
      positions: pricePoints,
    },
  };
}

// Keep the previous API available for the authenticated Vercel Cron route.
export async function capturePortfolioSnapshot(
  address: string,
  recordedAt = new Date(),
): Promise<PortfolioSnapshot> {
  return (await capturePortfolioSnapshotWithPositions(address, recordedAt)).portfolio;
}
