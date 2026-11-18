import { NextRequest, NextResponse } from "next/server";

import { readDailyPositionHistoryFromRawUrl } from "@/lib/github-history-store";
import { previousShanghaiCalendarDay } from "@/lib/position-change";
import { selectPositionBaseline } from "@/lib/position-baseline";
import { readDailyPositionHistoryLocal } from "@/lib/position-history-file";
import { isValidEvmAddress } from "@/lib/polymarket";

export const dynamic = "force-dynamic";

// Independent from /api/positions. Missing daily files (404/ENOENT) are allowed
// for a bounded seven-day lookback; other read errors fail closed as unavailable.
export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address")?.trim();
  if (!address || !isValidEvmAddress(address)) {
    return NextResponse.json({ error: "Invalid or missing address" }, { status: 400 });
  }

  const now = new Date();
  const expectedDate = previousShanghaiCalendarDay(now);
  const headers = { "Cache-Control": "no-store, max-age=0" };
  try {
    const repository = process.env.GITHUB_REPOSITORY?.trim();
    const read = repository
      ? (date: string) => readDailyPositionHistoryFromRawUrl({
          repository,
          branch: process.env.GITHUB_HISTORY_BRANCH?.trim() || "main",
        }, date)
      : (date: string) => readDailyPositionHistoryLocal(date);
    return NextResponse.json(
      await selectPositionBaseline(address, now, read),
      { headers },
    );
  } catch (error) {
    console.warn("Position history reference unavailable", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({
      status: "unavailable",
      expectedDate,
      baselineDate: expectedDate,
      referenceKind: null,
      recordedAt: null,
      positions: [],
    }, { headers });
  }
}
