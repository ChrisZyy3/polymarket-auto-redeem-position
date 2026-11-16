import { NextRequest, NextResponse } from "next/server";
import { isValidEvmAddress } from "@/lib/polymarket";
import { lookupWalletProfile } from "@/lib/wallet-profile";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address")?.trim() ?? "";
  const headers = { "Cache-Control": "no-store" };
  if (!isValidEvmAddress(address)) return NextResponse.json({ status: "invalid_address" }, { status: 400, headers });
  const result = await lookupWalletProfile(address);
  return NextResponse.json(result, { status: result.status === "unavailable" ? 503 : 200, headers });
}
