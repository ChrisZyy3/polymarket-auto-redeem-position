export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      fetch(env.REBALANCE_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
      }).then(async (response) => {
        if (!response.ok) throw new Error(`rebalance failed: ${response.status} ${await response.text()}`);
      }),
    );
  },
};
