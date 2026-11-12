# Polymarket Order Reader — MetaMask / Rabby setup

**Status:** Account-authenticated, read-only Open Orders adapter. No trading or cancellation methods are present. Account secrets must be installed locally by the wallet owner before the reader can query CLOB.

## Security boundaries

- The previous wallet-monitor remains independent; no changes to its scheduled poll, alert thresholds, Durable Objects, or existing secrets.
- The new `polymarket-order-reader` Worker exposes public `GET /health` (static information only), and token-protected `GET /status` and `GET /orders?wallet=...`. There are **no POST, PUT, DELETE or trading routes**. The Worker itself sends **only GET** requests to `https://clob.polymarket.com/data/orders`.
- CLOB L2 `apiKey`, `secret`, `passphrase` are powerful authentication credentials, *not inherently read-only*. Treat them as sensitive trading credentials even though this Worker only uses GET. Never put them in a browser-facing Dashboard, GitHub, a chat message, or a plaintext Wrangler `vars` field.
- The local bootstrap never requests a private key or mnemonic, never records credentials on disk, never sends them to a third party, and never sends transactions. It runs only on `127.0.0.1` with a random local access link, HttpOnly session cookie and CSRF protection. The only external requests go to the two documented Polymarket CLOB L1 credential endpoints.
- CLOB L2 reads are signed with `timestamp + GET + /data/orders`, excluding query parameters, using base64-decoded API secret and URL-safe base64 HMAC-SHA256 with padding. Account snapshots require complete pagination. A 401/429, unexpected unpaginated response, repeated cursor or malformed order is **not** an empty order list.
- User's Polymarket **funder/Safe/portfolio address** may differ from MetaMask/Rabby **signer EOA**. Do not choose a funder arbitrarily. Confirm which one belongs to the currently connected signer in Polymarket profile. Orders are filtered by the exact `maker_address` (funder); snapshot reports other-maker rows and whether a matching maker was observed.
- This service has no cron yet: first establish and verify one account with explicit authenticated reads, then integrate into the approved five-minute reconciliation schedule. Do not add a five-minute polling loop that silently treats absent credentials as zero open orders.

## Step 1 — Local wallet signature (desktop)

Use your personal computer with MetaMask or Rabby installed, and Node.js 22+.

From this repository root:

```bash
node tools/clob-credentials-local/server.mjs
```

Open the **127.0.0.1 link printed by your own terminal**, in the browser with your wallet extension. Choose MetaMask or Rabby, connect the signer wallet, switch to Polygon (chain 137), and **double-check the intended Polymarket funder address** from the dropdown.

Click **derive existing credentials** first. Your extension will request a signature of `ClobAuthDomain` / `ClobAuth` typed data: this is a *message signature*, not a blockchain transaction. Verify the domain and signer address in the wallet popup.

If derive fails with *no existing credentials*, the **explicit create** button becomes available. Creating credentials may invalidate an existing CLOB API key for the same signer/nonce; inspect running integrations before consenting. Creation is never automatic.

After success, use the **Copy Secret JSON** button. The bundle includes `signerAddress`, `funderAddress`, `apiKey`, `secret`, `passphrase`; it is **in memory only**. Copy/paste directly into Cloudflare Secret. Clear the clipboard and close the local page when done. Avoid clipboard sync or history plugins when handling secrets.

For the other accounts, connect the correct signer and repeat. The selector includes the three funded wallet addresses already used by this project's monitor. An address present in the list is not proof that the selected signer controls it.

## Step 2 — Deploy the independent Cloudflare Worker

The repository already uses Wrangler. After authenticating to Cloudflare with your account in your own terminal:

```bash
npx wrangler@4 deploy --config workers/order-reader/wrangler.json
```

In Cloudflare dashboard: **Workers & Pages → polymarket-order-reader → Settings → Variables and Secrets**. Add these as **encrypted Secret** type (not plaintext Variable):

| Secret | Value |
| --- | --- |
| `ORDER_READER_TOKEN` | A separate, randomly generated bearer token, at least 32 characters |
| `CLOB_ACCOUNT_1` | Secret JSON copied from the first chosen wallet |
| `CLOB_ACCOUNT_2` | Secret JSON for another wallet |
| `CLOB_ACCOUNT_3` | Secret JSON for the third wallet |

Create the bearer token locally using `openssl rand -hex 32`, or another cryptographically secure secret generator. **Do not share it in chat or commit it.**

One-account validation is recommended: set only `CLOB_ACCOUNT_1` initially, compare its maker address and active orders with the Polymarket user interface, and only then configure the other two.

You can also use `npx wrangler@4 secret put CLOB_ACCOUNT_1 --config workers/order-reader/wrangler.json` interactively, pasting the JSON when prompted. Be aware that Wrangler secret updates can immediately deploy a new Worker version. Do not pass the secret value as a command-line argument.

## Step 3 — Verify read-only live orders

From your own terminal, with the deployed Worker URL and protected bearer token set *locally*, query:

```bash
curl --fail-with-body --no-progress-meter \
  -H "Authorization: Bearer $ORDER_READER_TOKEN" \
  "https://YOUR-ORDER-READER.workers.dev/status"

curl --fail-with-body --no-progress-meter \
  -H "Authorization: Bearer $ORDER_READER_TOKEN" \
  "https://YOUR-ORDER-READER.workers.dev/orders?wallet=0x052f4191cd324a348835a846d34df5b0061e53fb"
```

Do not paste the token, unredacted order response or credential JSON in chat. Report the **HTTP status, sanitized error code, total count and whether maker mapping was observed** instead.

Successful response includes `complete:true`, `asOf`, `orders[]`, `accountFunder`, `matchingMakerObserved`, `foreignMakerOrderCount` and `actionableForTrading:false`. For a wallet with zero active SELLs, `matchingMakerObserved:false` is expected and **does not prove the wallet mapping**. Verify signer→funder linkage before using that zero as spendable shares.

If the CLOB returns an array without pagination metadata, the adapter deliberately returns `unpaginated_orders_response_unverified` rather than pretending the full orderbook has been verified. That wire shape should be assessed using actual account responses before enabling automation.

## Step 4 — Link to maker reconciliation (next change)

The pure engine is already in `workers/wallet-monitor/order-reconciliation.mjs` (PR #42). It accepts an L2 order snapshot of the form `{complete:true,asOf,orders}` in the expected raw CLOB field names. Only after complete/matching account verification can it calculate unmatched SELL shares, reserved shares, and decisions such as `keep_existing`, `would_create_post_only`, or `would_cancel_then_reconcile`.

That next integration must be private server-to-server; do **not** expose the protected order endpoint through an unauthenticated public Dashboard API. The actual seven-day GTD / Post-Only order executor remains disabled until you approve a small real-money pilot and cancellation/partial-fill/finality tests have passed.

## Regression checks

```bash
node --check tools/clob-credentials-local/server.mjs
node --check tools/clob-credentials-local/client.js
node --test workers/order-reader/test-order-reader.mjs
```

Relevant official docs:
- https://docs.polymarket.com/getting-started/api#authentication
- https://docs.polymarket.com/trading/manage-orders
- https://developers.cloudflare.com/workers/configuration/secrets/
