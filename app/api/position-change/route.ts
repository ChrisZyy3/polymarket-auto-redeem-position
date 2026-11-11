import { NextRequest, NextResponse } from "next/server";

import { readDailyPositionHistoryFromRawUrl } from "@/lib/github-history-store";
import { previousShanghaiCalendarDay } from "@/lib/position-change";
import { readDailyPositionHistoryLocal } from "@/lib/position-history-file";
import { isValidEvmAddress } from "@/lib/polymarket";

export const dynamic = "force-dynamic";

// Independent from /api/positions: a missing GitHub snapshot cannot break
// live Polymarket portfolio queries or trigger additional Data API reads.
export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address")?.trim();
  if (!address || !isValidEvmAddress(address)) {
    return NextResponse.json({ error: "Invalid or missing address" }, { status: 400 });
  }

  const date = previousShanghaiCalendarDay(new Date());
  const headers = { "Cache-Control": "no-store, max-age=0" };
  try {
    const repository = process.env.GITHUB_REPOSITORY?.trim();
    const history = repository
      ? await readDailyPositionHistoryFromRawUrl({
          repository,
          branch: process.env.GITHUB_HISTORY_BRANCH?.trim() || "main",
        }, date)
      : await readDailyPositionHistoryLocal(date);
    const wallet = history?.wallets.find(
      item => item.address.toLowerCase() === address.toLowerCase(),
    );
    if (!wallet) {
      return NextResponse.json({
        status: "missing", baselineDate: date, recordedAt: null, positions: [],
      }, { headers });
    }
    return NextResponse.json({
      status: "ok",
      baselineDate: date,
      recordedAt: wallet.recordedAt,
      positions: wallet.positions,
    }, { headers });
  } catch (error) {
    console.warn("Yesterday position history unavailable", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({
      status: "unavailable", baselineDate: date, recordedAt: null, positions: [],
    }, { headers });
  }
}
