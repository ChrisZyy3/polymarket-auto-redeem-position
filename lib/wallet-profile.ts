import { isValidEvmAddress } from "./polymarket";

export type ProfileLookup =
  | { status: "found"; proxyWallet: string; name: string | null }
  | { status: "not_found" | "unavailable" | "invalid_profile"; proxyWallet: null; name: null };

export async function lookupWalletProfile(signer: string, fetcher: typeof fetch = fetch): Promise<ProfileLookup> {
  const fail = (status: "not_found" | "unavailable" | "invalid_profile"): ProfileLookup => ({ status, proxyWallet: null, name: null });
  try {
    const url = new URL("https://gamma-api.polymarket.com/public-profile");
    url.searchParams.set("address", signer);
    const response = await fetcher(url, { cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (response.status === 404) return fail("not_found");
    if (!response.ok) return fail("unavailable");
    const profile: unknown = await response.json();
    if (!profile || typeof profile !== "object") return fail("invalid_profile");
    const record = profile as Record<string, unknown>;
    if (typeof record.proxyWallet !== "string" || !isValidEvmAddress(record.proxyWallet) || /^0x0{40}$/i.test(record.proxyWallet)) return fail("invalid_profile");
    const name = typeof record.name === "string" && record.name.trim() ? record.name.trim().slice(0, 120) : null;
    return { status: "found", proxyWallet: record.proxyWallet, name };
  } catch {
    return fail("unavailable");
  }
}
