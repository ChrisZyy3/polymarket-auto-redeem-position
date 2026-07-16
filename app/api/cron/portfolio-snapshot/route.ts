import { NextRequest, NextResponse } from "next/server";

import { appendSnapshotOnGitHub } from "@/lib/github-history-store";
import { capturePortfolioSnapshot } from "@/lib/portfolio-snapshot";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const address = process.env.POLYMARKET_USER_ADDRESS?.trim();
  const token = process.env.GITHUB_HISTORY_TOKEN?.trim();
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  const branch = process.env.GITHUB_HISTORY_BRANCH?.trim() || "main";
  if (!address || !token || !repository) {
    return NextResponse.json(
      { error: "Missing POLYMARKET_USER_ADDRESS, GITHUB_HISTORY_TOKEN, or GITHUB_REPOSITORY" },
      { status: 503 },
    );
  }

  try {
    const snapshot = await capturePortfolioSnapshot(address);
    await appendSnapshotOnGitHub(snapshot, { token, repository, branch });
    return NextResponse.json({ ok: true, snapshot });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Snapshot failed" },
      { status: 500 },
    );
  }
}
