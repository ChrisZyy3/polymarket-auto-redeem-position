import { fetchCashBalance, fetchCurrentPositions } from "./polymarket";
import type { PortfolioSnapshot } from "./portfolio-history";

function roundAmount(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export async function capturePortfolioSnapshot(
  address: string,
  recordedAt = new Date(),
): Promise<PortfolioSnapshot> {
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

  return {
    recordedAt: recordedAt.toISOString(),
    address: address.toLowerCase(),
    totalBalance: roundAmount(positionsValue + availableBalance),
    positionsValue: roundAmount(positionsValue),
    availableBalance: roundAmount(availableBalance),
    positionCount: positions.length,
  };
}
