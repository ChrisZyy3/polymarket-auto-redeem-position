# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Polymarket position monitoring tool with two parts living in the same repo:

1. **`src/`** — original Node.js CLI scripts (run with `tsx`), the working/shipped tool.
2. **`app/` + `lib/`** — an in-progress Next.js dashboard (branch `feat/dashboard-mvp`, see [README-dashboard.md](README-dashboard.md)) that reuses the same APR/position logic via a `/api/positions` route. **Next.js itself has not been scaffolded yet** — `package.json` has no `next`/`react` dependencies, so `app/` and `lib/` currently won't build/run until `npx create-next-app@latest .` (and `npx shadcn@latest init`) is run as described in README-dashboard.md.

## Commands

```bash
npm install        # install deps
npm run dev         # run src/index.ts — checks for newly redeemable positions, sends notification
npm run apr         # run src/apr-check.ts — APR/rebalance report + alert notification
npm run check       # tsc --noEmit (type-check src/ only, per tsconfig.json "include")
```

There is no test suite or linter configured.

### Environment

Copy `.env.example` to `.env`. Required/used variables:
- `POLYMARKET_USER_ADDRESS` — wallet address to query (must be a valid `0x` + 40 hex chars address; validated in `polymarket.ts`)
- `SERVERCHAN_SEND_KEY` / `FTQQ_PUSH_KEY` — notification channel (FTQQ takes priority if both set; empty = console-only)
- `APR_THRESHOLD` — APR % below which a position is flagged for rebalancing (default `8`)
- `LOSING_PRICE_THRESHOLD` — market price (0–1) below which a held position is considered "about to go to zero" (default `0.5`)

State is persisted to `state.json` (gitignored) to dedupe notifications across runs.

## Architecture (src/ — the CLI tool)

Pipeline: `config.ts` → `polymarket.ts` (fetch) → `apr.ts` (compute) → `serverchan.ts` (notify) → `state.ts` (dedupe persistence).

- **`config.ts`**: loads `.env` via dotenv, validates required vars, parses numeric thresholds with fallback defaults (`APR_THRESHOLD` → 8, `LOSING_PRICE_THRESHOLD` → 0.5). `minPositionSize` (0.1) filters dust positions.
- **`polymarket.ts`**: talks to `https://data-api.polymarket.com`. `fetchCurrentPositions` returns all positions ≥ `minPositionSize`; `fetchRedeemablePositions` additionally filters `redeemable === true`. Both validate the EVM address first.
- **`apr.ts`**: `calcApr(position, now?)` computes, for a held position, the forward annualized return from holding to settlement:
  - `roi = (1 - curPrice) / curPrice`
  - `apr = roi * 365 / daysToSettle`
  - Returns `note` (and `apr: null`) for edge cases: missing/unparseable `endDate`, already past `endDate` but not yet redeemable, or `curPrice` at 0/1 (no arbitrage left).
  - `needsAttention(result, thresholdPercent)`: true if `apr === null` or `apr*100 < threshold`.
  - `isLosing(result, priceThreshold)`: true if `curPrice < priceThreshold` — these are reported separately since their APR is meaningless.
  - `sortByAprAsc` / `sortByPriceAsc`: ordering helpers for reports (worst-first).
- **`serverchan.ts`**: `sendNotification(title, content)` posts Markdown to ServerChan/FTQQ Push. Throws on failure (callers must treat send failure as a hard error — do **not** swallow it, per the "success-only state update" rule: `state.json` is only updated after a notification send succeeds).
- **`state.ts`**: reads/writes `state.json` `{ notifiedKeys: string[] }`. Keys are `${conditionId}_${outcome}`.
- **`index.ts`** (`npm run dev`): finds newly-redeemable positions not yet in `state.json`, sends one combined notification, then updates `state.json` — only on success.
- **`apr-check.ts`** (`npm run apr`): for all non-redeemable held positions, computes APR for each, splits into "about to lose" (price < `LOSING_PRICE_THRESHOLD`, sorted by price asc) vs the rest (sorted by APR asc), prints both reports to console, and sends a combined notification if anything needs attention.

## Architecture (app/ + lib/ — dashboard MVP, WIP)

- **`lib/polymarket.ts`** and **`lib/apr.ts`** are near-duplicates of the `src/` versions, adapted for the dashboard (`lib/types.ts` adds `EnrichedPosition` with a `status: 'good' | 'attention' | 'losing' | 'redeemable'` field).
- **Known discrepancy**: `lib/polymarket.ts` points at `https://gamma-api.polymarket.com` (marked `TODO` in the source) whereas `src/polymarket.ts` (the proven-working version) uses `https://data-api.polymarket.com`. If working on the dashboard's data fetching, check whether this still needs fixing.
- **`app/api/positions/route.ts`**: `GET /api/positions?address=...&aprThreshold=8&minSize=0.1` — fetches positions for `address`, enriches each with APR/ROI/status via `lib/apr.ts`, and returns `{ summary, positions }`. Uses the `@/lib/...` path alias, which requires the Next.js scaffold's `tsconfig.json` paths config to exist.

## Project Status

See [PROJECT_PLAN.md](PROJECT_PLAN.md) for phase tracking. Phases 1–2 (fetch/filter redeemable positions, notification pipeline with dedup) are done. Phases 3–6 (manual redeem, automated batch redeem, polling daemon, production deployment) are not yet implemented — `src/` currently only *reports* on positions, it does not execute on-chain redeem transactions.
