import { poll, push } from "./monitor.mjs";

export class WalletMonitor {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.running = null;
  }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/status") {
      const s = await this.ctx.storage.get("monitor");
      return Response.json({ initialized: !!s, checkpoint: s?.checkpoint,
        lastSuccessAt: s?.lastSuccessAt, pending: s?.pending?.length ?? 0 });
    }
    if (path !== "/poll") return new Response("Not found", { status: 404 });
    // Coalesce overlapping cron/manual requests in this object.
    if (!this.running) {
      this.running = poll(this.ctx.storage, this.env).finally(() => { this.running = null; });
    }
    try { return Response.json({ ok: true, ...await this.running }); }
    catch (error) {
      // Do not log request URLs: PUSH_URL contains the send key.
      console.error("Wallet poll failed", error?.message || "Unknown error");
      return Response.json({ ok: false, error: "Poll failed; check Worker logs" }, { status: 502 });
    }
  }
}

function instance(env) {
  return env.MONITOR.get(env.MONITOR.idFromName(env.WALLET_ADDRESS.toLowerCase()));
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil((async () => {
      const r = await instance(env).fetch("https://internal/poll", { method: "POST" });
      if (!r.ok) throw new Error("Wallet monitor poll failed");
    })());
  },
  async fetch(request, env) {
    if (!env.MONITOR_SECRET ||
        request.headers.get("authorization") !== "Bearer " + env.MONITOR_SECRET) {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    const path = new URL(request.url).pathname;
    if (path === "/status" && request.method === "GET") {
      return instance(env).fetch("https://internal/status");
    }
    if (request.method !== "POST") return new Response("Use POST", { status: 405 });
    if (path === "/poll") return instance(env).fetch("https://internal/poll", { method: "POST" });
    if (path === "/test") {
      try {
        await push(env, fetch, "Polymarket · 推送测试", "地址监控通知通道测试成功。");
        return Response.json({ ok: true });
      } catch {
        return Response.json({ ok: false, error: "Push failed" }, { status: 502 });
      }
    }
    return new Response("Not found", { status: 404 });
  }
};
