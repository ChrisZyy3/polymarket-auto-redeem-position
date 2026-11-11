import "dotenv/config";

import { appendSnapshot } from "../lib/portfolio-history";
import { readPortfolioHistory, writePortfolioHistory } from "../lib/portfolio-history-file";
import { parsePortfolioAddresses } from "../lib/portfolio-addresses";
import { capturePortfolioSnapshotWithPositions } from "../lib/portfolio-snapshot";
import { mergeDailyPositionHistory, shanghaiCalendarDay } from "../lib/position-change";
import {
  readDailyPositionHistoryLocal,
  writeDailyPositionHistoryLocal,
} from "../lib/position-history-file";

async function main(): Promise<void> {
  const addresses = parsePortfolioAddresses(
    process.env.POLYMARKET_USER_ADDRESSES || process.env.POLYMARKET_USER_ADDRESS,
  );
  const recordedAt = new Date();
  const shanghaiDay = shanghaiCalendarDay(recordedAt);

  // Reuse the exact same positions fetch for total value and every token price.
  const [history, yesterdayOrTodayFile, results] = await Promise.all([
    readPortfolioHistory(),
    readDailyPositionHistoryLocal(shanghaiDay),
    Promise.allSettled(
      addresses.map(address => capturePortfolioSnapshotWithPositions(address, recordedAt)),
    ),
  ]);
  const captured = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
  if (captured.length === 0) throw new Error("No portfolio snapshots were recorded");

  const updatedHistory = captured.reduce(
    (current, item) => appendSnapshot(current, item.portfolio),
    history,
  );
  const updatedPositions = mergeDailyPositionHistory(
    yesterdayOrTodayFile,
    shanghaiDay,
    captured.map(item => item.walletPositions),
  );

  // Commit both files together in a single GitHub Actions commit.
  await writePortfolioHistory(updatedHistory);
  await writeDailyPositionHistoryLocal(updatedPositions);

  for (const entry of captured) {
    const snapshot = entry.portfolio;
    console.log(
      `Recorded ${snapshot.recordedAt} for ${snapshot.address}: ` +
        `total=$${snapshot.totalBalance.toFixed(2)}, ` +
        `positions=${snapshot.positionCount}, priceRecords=${entry.walletPositions.positions.length}`,
    );
  }
  const failures = results.flatMap((result, index) =>
    result.status === "rejected" ? [addresses[index]] : [],
  );
  if (failures.length > 0) {
    for (const address of failures) console.error(`Snapshot failed for wallet ${address}`);
    // The workflow commits successful wallet files even if this step fails,
    // but stays red so incomplete daily coverage cannot go unnoticed.
    throw new Error(`${failures.length} wallet snapshot(s) failed; other wallets were saved`);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
