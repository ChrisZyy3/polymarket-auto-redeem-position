import { NextRequest, NextResponse } from "next/server";

import { readPortfolioHistory } from "@/lib/portfolio-history-file";
import { readPortfolioHistoryFromRawUrl } from "@/lib/github-history-store";
import {
  calculateHistoryMetrics,
  snapshotsForAddress,
  type PortfolioHistory,
} from "@/lib/portfolio-history";
import { isValidEvmAddress } from "@/lib/polymarket";

export const dynamic = "force-dynamic";

async function readLatestHistory(): Promise<PortfolioHistory> {
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  if (repository) {
    return readPortfolioHistoryFromRawUrl({
      repository,
      branch: process.env.GITHUB_HISTORY_BRANCH?.trim() || "main",
    });
  }

  return readPortfolioHistory();
}

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address")?.trim();
  if (!address || !isValidEvmAddress(address)) {
    return NextResponse.json({ error: "Invalid or missing address" }, { status: 400 });
  }

  const history = await readLatestHistory();
  const snapshots = snapshotsForAddress(history, address);
  return NextResponse.json({
    snapshots,
    metrics: calculateHistoryMetrics(snapshots),
  }, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
