# PolyYield V1

A small Next.js service that converts a target APY into a maximum Polymarket bid price and can keep a maker BUY order near the effective best external bid.

## Safety first

The default is `DRY_RUN=true`. In dry-run mode it fetches the live CLOB order book and returns a decision, but it does not authenticate, cancel, or place orders.

## Strategy logic

For maturity `T` years and target APY `y`:

```text
maxPrice = (1 + y)^(-T)
```

Then the bot:

1. Fetches the token order book.
2. Ignores bid levels whose estimated external notional is below `minExternalLevelUsd`.
3. Chooses `min(maxPrice, effectiveBestBid + oneTick)`.
4. Caps the bid below the best ask to avoid intentionally crossing.
5. Keeps an existing order if it is already at the desired price.
6. Applies a cooldown before cancel/reprice.
7. In live mode, cancels the old BUY order(s) for the token and posts a new GTC BUY.

When live, the bot subtracts your own open-order size from aggregate book levels before applying the external-depth filter. This is an estimate because public aggregated book levels do not expose maker identities.

## Run locally

```bash
cp .env.example .env.local
npm install
npm run dev
```

Test the endpoint:

```bash
curl -X POST http://localhost:3000/api/rebalance \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

## Deploy to Vercel

Push the project to GitHub and import it into Vercel. Add every variable from `.env.example` under Project Settings -> Environment Variables.

Do **not** prefix secrets with `NEXT_PUBLIC_`.

## Cloudflare Cron pattern

Use a Cloudflare Worker Cron Trigger to POST to:

```text
https://YOUR_PROJECT.vercel.app/api/rebalance
```

with:

```text
Authorization: Bearer YOUR_CRON_SECRET
```

A 2-5 minute cadence is a reasonable starting point for a slow-moving yield strategy.

## Going live

Only after validating dry-run logs:

```text
DRY_RUN=false
```

Use a small dedicated trading wallet first. Polymarket CLOB V2 uses pUSD and the current SDK package is `@polymarket/clob-client-v2`.

## Important assumptions

- `endTime` is your expected economic maturity, not necessarily the exact time funds become redeemable after resolution.
- APY is conditional on the chosen outcome resolving to $1.
- `amountUsd` is used to calculate order shares as `amountUsd / desiredPrice`; partial fills can change your remaining intended exposure, so position-aware sizing is the next feature to add.
