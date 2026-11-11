// Polymarket Data API v2 client. Retry within a bounded request budget;
// otherwise honor Retry-After by deferring the next Durable Object poll.
// Never retry ServerChan/notification posts.
const RETRYABLE = new Set([429, 502, 503, 504]);
const delayDefault = ms => new Promise(resolve => setTimeout(resolve, ms));
const bounded = (v,lo,hi) => Math.max(lo,Math.min(hi,v));

export function retryAfterMs(headers, now = Date.now()) {
  const h = headers?.get?.("retry-after");
  if (h === null || h === undefined || !String(h).trim()) return null;
  const raw = String(h).trim();
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Math.max(0, Number(raw) * 1000);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function safeRay(headers) {
  const value = String(headers?.get?.("cf-ray") || headers?.get?.("x-request-id") || "");
  return /^[a-zA-Z0-9-]{5,80}$/.test(value) ? value : null;
}

export class DataApiRequestError extends Error {
  constructor({status=null,host="data-api.polymarket.com",endpoint=null,
    retryAfterMs=null,traceId=null,kind="http"}) {
    super(status === null ? "Network/timeout error from " + host :
      "HTTP " + status + " from " + host);
    this.name = "DataApiRequestError";
    this.status = status;
    this.endpoint = endpoint;
    this.retryAfterMs = retryAfterMs;
    this.traceId = traceId;
    this.kind = status === 429 ? "rate_limit" :
      status !== null && status >= 500 ? "upstream" : kind;
  }
}

export async function dataApiJson(fetcher, url, {
  retries = 2, sleep = delayDefault, random = Math.random,
  timeoutMs = 15000, maxWaitMs = 4000
} = {}) {
  const parsed = new URL(url);
  const host = parsed.hostname;
  const endpoint = parsed.pathname; // No query parameters or wallet addresses.
  for (let attempt = 0; attempt <= retries; attempt++) {
    let response;
    try {
      response = await fetcher(url, {signal:AbortSignal.timeout(timeoutMs)});
    } catch {
      if (attempt >= retries) {
        throw new DataApiRequestError({host,endpoint,kind:"network"});
      }
      const wait = bounded(500 * (2 ** attempt) + Math.floor(random()*500),500,maxWaitMs);
      await sleep(wait);
      continue;
    }
    if (response.ok) return response.json();

    const status = response.status;
    const traceId = safeRay(response.headers);
    const requested = retryAfterMs(response.headers);
    const error = new DataApiRequestError({
      host,endpoint,status,retryAfterMs:requested,traceId
    });
    if (!RETRYABLE.has(status) || attempt >= retries) throw error;

    // Respect the server's Retry-After rather than hammering during overload.
    // Never hold a five-minute Cron invocation for a long Retry-After: the
    // caller will persist a nextAllowedPollAt and the next Cron can defer.
    const jitter = Math.floor(random()*500);
    const normal = 500*(2**attempt)+jitter;
    const wait = requested === null ? normal
      : status === 429 ? Math.max(500,requested+jitter)
      : requested;
    if (wait > maxWaitMs) throw error;
    await sleep(wait);
  }
  throw new Error("Unexpected Polymarket retry state");
}
