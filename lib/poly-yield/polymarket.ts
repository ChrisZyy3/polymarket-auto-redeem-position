import type { OrderBook } from "./types";

const HOST = "https://clob.polymarket.com";
const PATH = "/book";
export const ORDER_BOOK_TIMEOUT_MS = 10_000;

export type OrderBookErrorKind = "timeout" | "network" | "http" | "invalid-response";

export interface GetOrderBookOptions {
  timeoutMs?: number;
}

export class OrderBookRequestError extends Error {
  readonly endpoint = `${HOST}${PATH}`;
  readonly status?: number;
  readonly causeMessage?: string;

  constructor(
    readonly kind: OrderBookErrorKind,
    message: string,
    options: { status?: number; causeMessage?: string } = {},
  ) {
    super(message);
    this.name = "OrderBookRequestError";
    this.status = options.status;
    this.causeMessage = options.causeMessage;
  }
}

function formatError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = "cause" in error ? error.cause : undefined;
  const causeText = cause === undefined ? "" : `; cause=${formatError(cause)}`;
  return `${error.name}: ${error.message}${causeText}`;
}

export async function getOrderBook(tokenId: string, options: GetOrderBookOptions = {}): Promise<OrderBook> {
  const url = new URL(PATH, HOST);
  url.searchParams.set("token_id", tokenId);
  const timeoutMs = options.timeoutMs ?? ORDER_BOOK_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!response.ok) {
      throw new OrderBookRequestError("http", `book request failed with HTTP ${response.status}`, {
        status: response.status,
      });
    }

    try {
      return await response.json();
    } catch (error) {
      throw new OrderBookRequestError("invalid-response", "book response was not valid JSON", {
        causeMessage: formatError(error),
      });
    }
  } catch (error) {
    if (error instanceof OrderBookRequestError) throw error;

    if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw new OrderBookRequestError("timeout", `book request timed out after ${timeoutMs}ms`, {
        causeMessage: formatError(error),
      });
    }

    throw new OrderBookRequestError("network", "book request failed before receiving a response", {
      causeMessage: formatError(error),
    });
  } finally {
    clearTimeout(timeout);
  }
}
