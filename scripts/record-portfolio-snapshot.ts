import "dotenv/config";

import { appendSnapshot } from "../lib/portfolio-history";
import {
  readPortfolioHistory,
  writePortfolioHistory,
} from "../lib/portfolio-history-file";
import { parsePortfolioAddresses } from "../lib/portfolio-addresses";
import { capturePortfolioSnapshot } from "../lib/portfolio-snapshot";

async function main(): Promise<void> {
  const addresses = parsePortfolioAddresses(
    process.env.POLYMARKET_USER_ADDRESSES || process.env.POLYMARKET_USER_ADDRESS,
  );
  const recordedAt = new Date();

  const [history, results] = await Promise.all([
    readPortfolioHistory(),
    Promise.allSettled(
      addresses.map((address) => capturePortfolioSnapshot(address, recordedAt)),
    ),
  ]);

  const snapshots = results.flatMap((result, index) => {
    if (result.status === "fulfilled") return [result.value];

    console.error(`Failed to record ${addresses[index]}:`, result.reason);
    return [];
  });

  if (snapshots.length === 0) {
    throw new Error("No portfolio snapshots were recorded");
  }

  const updatedHistory = snapshots.reduce(
    (currentHistory, snapshot) => appendSnapshot(currentHistory, snapshot),
    history,
  );
  await writePortfolioHistory(updatedHistory);

  for (const snapshot of snapshots) {
    console.log(
      `Recorded ${snapshot.recordedAt} for ${snapshot.address}: ` +
        `total=$${snapshot.totalBalance.toFixed(2)}, ` +
        `positions=$${snapshot.positionsValue.toFixed(2)}, ` +
        `cash=$${snapshot.availableBalance.toFixed(2)}`,
    );
  }

  const failedCount = results.length - snapshots.length;
  if (failedCount > 0) {
    throw new Error(`${failedCount} portfolio snapshot(s) failed after successful snapshots were saved`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
