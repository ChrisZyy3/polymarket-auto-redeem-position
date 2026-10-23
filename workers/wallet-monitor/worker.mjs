import { poll, push } from "./monitor.mjs";

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

  async fetch(request) {
    const url = new URL(request.url);
    const wallet = url.searchParams.get("wallet");
    if (!wallet || !/^0x[a-f0-9]{40}$/.test(wallet)) {
      return Response.json({ ok: false, error: "Invalid wallet" }, { status: 400 });
    }
    if (url.pathname === "/status") {
      const s = await this.ctx.storage.get("monitor");
      return Response.json({
        initialized: !!s,
        checkpoint: s?.checkpoint,
        lastSuccessAt: s?.lastSuccessAt,
        pending: s?.pending?.length ?? 0
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
  const results = await Promise.all(wallets.map(async wallet => {
    try {
      const response = await instance(env, wallet).fetch(
        "https://internal/" + route + "?wallet=" + wallet,
        { method: route === "status" ? "GET" : "POST" }
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
    if (!env.MONITOR_SECRET ||
        request.headers.get("authorization") !== "Bearer " + env.MONITOR_SECRET) {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    const path = new URL(request.url).pathname;
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
        return Response.json({ ok: true });
      } catch {
        return Response.json({ ok: false, error: "Push failed" }, { status: 502 });
      }
    }
    return new Response("Not found", { status: 404 });
  }
};
