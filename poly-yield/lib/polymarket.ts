import type { OrderBook } from "./types";

const HOST = "https://clob.polymarket.com";

export async function getOrderBook(tokenId: string): Promise<OrderBook> {
  const url = new URL("/book", HOST);
  url.searchParams.set("token_id", tokenId);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`book request failed: ${response.status}`);
  return response.json();
}
