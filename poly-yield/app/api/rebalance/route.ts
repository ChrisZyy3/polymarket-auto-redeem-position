import { NextResponse } from "next/server";
import { getOrderBook } from "../../../lib/polymarket";
import { decideOrder } from "../../../lib/strategy";
import type { Strategy } from "../../../lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function loadStrategies(): Strategy[] {
  const raw = process.env.STRATEGIES_JSON;
  if (!raw) throw new Error("STRATEGIES_JSON is missing");
  const parsed = JSON.parse(raw) as Strategy[];
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("STRATEGIES_JSON must be a non-empty array");
  return parsed;
}

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && request.headers.get("authorization") === `Bearer ${secret}`;
}

async function handle(request: Request) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const now = new Date();
  const strategies = loadStrategies();
  const results = [];
  for (const strategy of strategies) {
    try {
      const book = await getOrderBook(strategy.tokenId);
      results.push({ strategy: strategy.name, ...decideOrder(strategy, book, now) });
    } catch (error) {
      results.push({ strategy: strategy.name, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return NextResponse.json({ ok: true, mode: "dry-run", at: now.toISOString(), results });
}

export const GET = handle;
export const POST = handle;
