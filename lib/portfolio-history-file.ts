import fs from "node:fs/promises";
import path from "node:path";

import type { PortfolioHistory } from "./portfolio-history";

export const HISTORY_FILE = path.join(
  process.cwd(),
  "data",
  "portfolio-history.json",
);

export async function readPortfolioHistory(): Promise<PortfolioHistory> {
  try {
    const content = await fs.readFile(HISTORY_FILE, "utf8");
    return JSON.parse(content) as PortfolioHistory;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, snapshots: [] };
    }
    throw error;
  }
}

export async function writePortfolioHistory(
  history: PortfolioHistory,
): Promise<void> {
  await fs.mkdir(path.dirname(HISTORY_FILE), { recursive: true });
  await fs.writeFile(HISTORY_FILE, `${JSON.stringify(history, null, 2)}\n`, "utf8");
}
