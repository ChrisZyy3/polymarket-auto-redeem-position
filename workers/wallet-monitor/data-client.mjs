// Polymarket Data API retry client. Never retry notification posts.
// Honors short Retry-After delays; long delays are left for the next Cron run.
const RETRYABLE = new Set([429, 502, 503, 504]);
const delayDefault = ms => new Promise(resolve => setTimeout(resolve, ms));
export function retryAfterMs(headers, now = Date.now()) {
  const h = headers?.get?.("retry-after");
  if (h === null || h === undefined || !String(h).trim()) return null;
  const raw = String(h).trim();
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Math.max(0, Number(raw) * 1000);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}
export async function dataApiJson(fetcher, url, { retries = 2, sleep = delayDefault,
  random = Math.random, timeoutMs = 15000 } = {}) {
  const host = new URL(url).hostname;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let response;
    try {
      response = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      if (attempt >= retries) throw new Error("Network/timeout error from " + host);
      await sleep(Math.min(3000, 400 * 2 ** attempt + Math.floor(random() * 250)));
      continue;
    }
    if (response.ok) return response.json();
    const status = response.status;
    if (!RETRYABLE.has(status) || attempt >= retries)
      throw new Error("HTTP " + status + " from " + host);
    const backoff = Math.min(3000, 400 * 2 ** attempt + Math.floor(random() * 250));
    const requested = retryAfterMs(response.headers);
    const wait = requested == null ? backoff : requested;
    // Don't block the five-minute polling tick for a long server overload.
    if (wait > 4000) throw new Error("HTTP " + status + " from " + host);
    await sleep(wait);
  }
  throw new Error("Unexpected retry state from " + host);
}
