import { NextRequest, NextResponse } from "next/server";

import historyJson from "@/data/portfolio-history.json";
import {
  calculateHistoryMetrics,
  snapshotsForAddress,
  type PortfolioHistory,
} from "@/lib/portfolio-history";
import { isValidEvmAddress } from "@/lib/polymarket";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address")?.trim();
  if (!address || !isValidEvmAddress(address)) {
    return NextResponse.json({ error: "Invalid or missing address" }, { status: 400 });
  }

  const snapshots = snapshotsForAddress(historyJson as PortfolioHistory, address);
  return NextResponse.json({
    snapshots,
    metrics: calculateHistoryMetrics(snapshots),
  });
}
