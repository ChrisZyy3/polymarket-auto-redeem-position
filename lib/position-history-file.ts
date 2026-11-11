import fs from "node:fs/promises";
import path from "node:path";

import type { DailyPositionHistory } from "./position-change";

export function positionHistoryPath(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid position history date");
  return path.join(process.cwd(), "data", "position-history", date + ".json");
}

export async function readDailyPositionHistoryLocal(date: string): Promise<DailyPositionHistory | null> {
  try {
    const data = JSON.parse(await fs.readFile(positionHistoryPath(date), "utf8")) as DailyPositionHistory;
    if (data.version !== 1 || data.date !== date || !Array.isArray(data.wallets)) {
      throw new Error("Invalid daily position history format");
    }
    return data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeDailyPositionHistoryLocal(history: DailyPositionHistory): Promise<void> {
  const target = positionHistoryPath(history.date);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify(history, null, 2) + "\n", "utf8");
}
