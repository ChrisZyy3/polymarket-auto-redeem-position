import assert from "node:assert/strict";
import test from "node:test";
import { lookupWalletProfile } from "../lib/wallet-profile";
import { GET } from "../app/api/wallet-profile/route";
import { NextRequest } from "next/server";

const signer = "0x1111111111111111111111111111111111111111";
const proxy = "0x2222222222222222222222222222222222222222";
const fetchResponse = (status: number, data: unknown) => (async (url: string | URL | Request) => {
  assert.equal(new URL(String(url)).searchParams.get("address"), signer);
  return new Response(JSON.stringify(data), { status });
}) as typeof fetch;

test("resolves only a valid proxy from a successful public profile", async () => {
  assert.deepEqual(await lookupWalletProfile(signer, fetchResponse(200, { proxyWallet: proxy, name: "Chris" })), { status: "found", proxyWallet: proxy, name: "Chris" });
  for (const value of [null, {}, { proxyWallet: signer.slice(1) }, { proxyWallet: "0x" + "0".repeat(40) }]) {
    assert.equal((await lookupWalletProfile(signer, fetchResponse(200, value))).status, "invalid_profile");
  }
});

test("not found, rate limits and failures never fall back to signer", async () => {
  assert.deepEqual(await lookupWalletProfile(signer, fetchResponse(404, {})), { status: "not_found", proxyWallet: null, name: null });
  assert.equal((await lookupWalletProfile(signer, fetchResponse(429, {}))).status, "unavailable");
  assert.equal((await lookupWalletProfile(signer, (async () => { throw new Error("network"); }) as typeof fetch)).status, "unavailable");
});

test("profile route rejects invalid address without contacting upstream", async () => {
  const result = await GET(new NextRequest("https://example.org/api/wallet-profile?address=bad"));
  assert.equal(result.status, 400);
  assert.equal((await result.json()).status, "invalid_address");
  assert.equal(result.headers.get("cache-control"), "no-store");
});
