import "dotenv/config";

import { appendSnapshot } from "../lib/portfolio-history";
import {
  readPortfolioHistory,
  writePortfolioHistory,
} from "../lib/portfolio-history-file";
import { capturePortfolioSnapshot } from "../lib/portfolio-snapshot";

async function main(): Promise<void> {
  const address = process.env.POLYMARKET_USER_ADDRESS?.trim();
  if (!address) {
    throw new Error("POLYMARKET_USER_ADDRESS is required");
  }

  const [history, snapshot] = await Promise.all([
    readPortfolioHistory(),
    capturePortfolioSnapshot(address),
  ]);
  await writePortfolioHistory(appendSnapshot(history, snapshot));

  console.log(
    `Recorded ${snapshot.recordedAt}: total=$${snapshot.totalBalance.toFixed(2)}, ` +
      `positions=$${snapshot.positionsValue.toFixed(2)}, cash=$${snapshot.availableBalance.toFixed(2)}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
