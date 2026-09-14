import { NextResponse } from "next/server";
import { getOrderBook, OrderBookRequestError } from "@/lib/poly-yield/polymarket";
import { decideOrder } from "@/lib/poly-yield/strategy";
import type { Strategy } from "@/lib/poly-yield/types";

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

function describeError(error: unknown) {
  if (error instanceof OrderBookRequestError) {
    return {
      kind: error.kind,
      message: error.message,
      endpoint: error.endpoint,
      ...(error.status === undefined ? {} : { status: error.status }),
      ...(error.causeMessage ? { cause: error.causeMessage } : {}),
    };
  }

  if (error instanceof Error) {
    const cause = "cause" in error ? error.cause : undefined;
    return {
      kind: "unknown",
      name: error.name,
      message: error.message,
      ...(cause === undefined
        ? {}
        : { cause: cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause) }),
    };
  }

  return { kind: "unknown", message: String(error) };
}

async function handle(request: Request) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (process.env.DRY_RUN === "false") {
    return NextResponse.json(
      { ok: false, error: "live order execution is not implemented yet" },
      { status: 501 },
    );
  }
  const now = new Date();
  const strategies = loadStrategies();
  const results = [];
  for (const strategy of strategies) {
    try {
      const book = await getOrderBook(strategy.tokenId);
      results.push({ strategy: strategy.name, ...decideOrder(strategy, book, now) });
    } catch (error) {
      const errorDetails = describeError(error);
      console.error("[poly-yield] strategy failed", { strategy: strategy.name, ...errorDetails });
      results.push({ strategy: strategy.name, error: errorDetails.message, errorDetails });
    }
  }
  return NextResponse.json({ ok: true, mode: "dry-run", at: now.toISOString(), results });
}

export const GET = handle;
export const POST = handle;
