import { poll, push, auditSnapshot, deliverPending, recordPollFailure } from "./monitor.mjs";
import { healthSummary, HEALTH_STALE_SECONDS } from "./health.mjs";

// One configured wallet per Durable Object. Preserve the legacy address as a fallback.
export function walletAddresses(env) {
  const raw = String(env.WALLET_ADDRESSES ?? "").trim();
  const values = raw ? (raw.startsWith("[") ? JSON.parse(raw) : raw.split(/[\s,;，、；]+/)) : [env.WALLET_ADDRESS];
  if (!Array.isArray(values) || values.length === 0 || values.length > 20) {
    throw new Error("WALLET_ADDRESSES must contain 1-20 wallet addresses");
  }
  const unique = [];
  const seen = new Set();
  for (const value of values) {
    const address = String(value ?? "").trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(address)) throw new Error("Invalid wallet address in WALLET_ADDRESSES");
    if (!seen.has(address)) {
      seen.add(address);
      unique.push(address);
    }
  }
  return unique;
}

export class WalletMonitor {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.running = null;
  }

  async alarm() {
    // Alarm is a separate delivery channel. Existing pending messages are
    // retried independently of Polymarket Data API availability.
    if (this.running) await this.running;
    if (!this.running) {
      this.running = deliverPending(this.ctx.storage, this.env, fetch, undefined, "alarm")
        .finally(() => { this.running = null; });
    }
    await this.running;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const wallet = url.searchParams.get("wallet");
    if (!wallet || !/^0x[a-f0-9]{40}$/.test(wallet)) {
      return Response.json({ ok: false, error: "Invalid wallet" }, { status: 400 });
    }
    if (url.pathname === "/health") {
      const s = await this.ctx.storage.get("monitor");
      return Response.json({ ok: true, initialized: Boolean(s),
        lastSuccessAt: s?.lastSuccessAt ?? null });
    }
    if (url.pathname === "/status") {
      const s = await this.ctx.storage.get("monitor");
      return Response.json({
        initialized: !!s,
        checkpoint: s?.checkpoint,
        lastSuccessAt: s?.lastSuccessAt,
        pending: s?.pending?.length ?? 0,
        ...auditSnapshot(s)
      });
    }
    if (url.pathname !== "/poll") return new Response("Not found", { status: 404 });
    // Each wallet has its own DO and checkpoint; overlapping invocations coalesce.
    if (!this.running) {
      this.running = poll(this.ctx.storage, this.env, fetch, undefined, wallet)
        .finally(() => { this.running = null; });
    }
    try {
      return Response.json({ ok: true, ...await this.running });
    } catch (error) {
      // Best-effort health tracking must not obscure the original failure.
      try {
        await recordPollFailure(this.ctx.storage, this.env, fetch,
          Math.floor(Date.now() / 1000), error);
      } catch (healthError) {
        console.error("Wallet health bookkeeping failed for " + wallet,
          healthError?.message || "Unknown error");
      }
      // Do not log request URLs: PUSH_URL contains the send key.
      console.error("Wallet poll failed for " + wallet, error?.message || "Unknown error");
      return Response.json({ ok: false, error: "Poll failed; check Worker logs" }, { status: 502 });
    }
  }
}

function instance(env, wallet) {
  // Same ID as the original single-wallet worker: keeps its existing state.
  return env.MONITOR.get(env.MONITOR.idFromName(wallet));
}

async function runAll(env, route) {
  const wallets = walletAddresses(env);
  const results = await Promise.all(wallets.map(async (wallet, index) => {
    // Spread API calls over ~2 seconds to avoid a 3-wallet synchronized burst.
    if (route === "poll" && index > 0) {
      await new Promise(resolve => setTimeout(resolve, index * 800));
    }
    try {
      const response = await instance(env, wallet).fetch(
        "https://internal/" + route + "?wallet=" + wallet,
        { method: route === "status" || route === "health" ? "GET" : "POST" }
      );
      const body = await response.json();
      return { wallet, ...body, ok: response.ok && body.ok !== false };
    } catch (error) {
      console.error("Wallet " + route + " request failed for " + wallet, error?.message || "Unknown error");
      return { wallet, ok: false, error: "Worker request failed" };
    }
  }));
  return { ok: results.every(r => r.ok), wallets: results };
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil((async () => {
      const result = await runAll(env, "poll");
      if (!result.ok) {
        const failed = result.wallets.filter(r => !r.ok).map(r => r.wallet);
        throw new Error("Wallet monitor poll failed for: " + failed.join(", "));
      }
    })());
  },

  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    // Independent external watchdog: intentionally exposes only aggregate
    // health and count. All other routes remain fully authenticated.
    if (request.method === "GET" && path === "/health") {
      try {
        const result = await runAll(env, "health");
        const publicHealth = healthSummary(result.wallets);
        return Response.json(publicHealth, {
          status: publicHealth.ok ? 200 : 503,
          headers: { "cache-control": "no-store" }
        });
      } catch {
        return Response.json({ ok: false, checked: 0 }, {
          status: 503,
          headers: { "cache-control": "no-store" }
        });
      }
    }
    if (!env.MONITOR_SECRET ||
        request.headers.get("authorization") !== "Bearer " + env.MONITOR_SECRET) {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    if (path === "/status" && request.method === "GET") {
      return Response.json(await runAll(env, "status"));
    }
    if (path === "/poll" && request.method === "POST") {
      const result = await runAll(env, "poll");
      return Response.json(result, { status: result.ok ? 200 : 502 });
    }
    if (path === "/test" && request.method === "POST") {
      try {
        await push(env, fetch, "Polymarket · 推送测试", "多钱包地址监控通知通道测试成功。");
        console.info("push_accepted", JSON.stringify({ kind: "test", provider: "serverchan",
          at: Math.floor(Date.now() / 1000) }));
        return Response.json({ ok: true });
      } catch {
        return Response.json({ ok: false, error: "Push failed" }, { status: 502 });
      }
    }
    return new Response("Not found", { status: 404 });
  }
};
