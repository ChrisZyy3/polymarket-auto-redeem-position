import { NextRequest, NextResponse } from "next/server";
import { daysUntilSettlement } from "@/lib/apr";
import { buildPositionQuote } from "@/lib/position-quote";
import { getOrderBook } from "@/lib/poly-yield/polymarket";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenId = searchParams.get("tokenId")?.trim() ?? "";
  const endDate = searchParams.get("endDate");
  const currentPriceRaw = searchParams.get("currentPrice");
  const thresholdAprRaw = searchParams.get("thresholdApr");
  const currentPrice = currentPriceRaw === null || currentPriceRaw.trim() === "" ? Number.NaN : Number(currentPriceRaw);
  const thresholdAprPercent = thresholdAprRaw === null || thresholdAprRaw.trim() === "" ? Number.NaN : Number(thresholdAprRaw);

  if (!tokenId || tokenId.length > 256) {
    return jsonResponse({ ok: false, error: "A valid tokenId is required" }, 400);
  }
  if (!Number.isFinite(currentPrice) || currentPrice < 0 || currentPrice > 1) {
    return jsonResponse({ ok: false, error: "currentPrice must be a number between 0 and 1" }, 400);
  }
  if (!Number.isFinite(thresholdAprPercent) || thresholdAprPercent < 0) {
    return jsonResponse({ ok: false, error: "thresholdApr must be a non-negative number" }, 400);
  }

  const now = new Date();
  const daysToSettle = daysUntilSettlement(endDate, now);
  let orderBook = null;

  // Do not call the remote order book for positions that cannot produce a quote.
  if (Number.isFinite(daysToSettle) && daysToSettle > 0) {
    try {
      orderBook = await getOrderBook(tokenId);
    } catch {
      // The pure quote still provides the theoretical threshold price without a live book.
      orderBook = null;
    }
  }

  const quote = buildPositionQuote({
    currentPrice,
    endDate,
    thresholdAprPercent,
    orderBook,
    now,
  });

  return jsonResponse({ ok: true, quote });
}
