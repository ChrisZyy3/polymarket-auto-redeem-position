# Entry APR implementation handoff

## Objective

Replace the misleading, time-varying `costApr` concept with a true `Entry APR`: the annualized return calculated at each buy fill using that fill's price and the settlement time remaining at that fill, then preserved as a historical entry metric.

The product should eventually show:

- `Market APR`: dynamic, based on current market price and current time remaining.
- `Entry APR`: historical, based on actual fill price and time remaining at the fill.

Until complete trade-history reconstruction exists, Cost/Entry APR must remain hidden from the UI rather than displaying an approximation.

## Repository state

- Repository: `C:\Users\41289\Desktop\projects\polymarket-auto-redeem-position`
- Branch: `feat/poly-yield-cron-v1`
- Latest commit: `3376d52 feat: refine position table layout`
- Repository guidance: `AGENTS.md`
- Existing domain/context artifact: `CONTEXT.md` is untracked; inspect it before deciding whether it should be used or committed.
- Current working tree has uncommitted changes in:
  - `app/page.tsx`
  - `lib/price-format.ts`
  - `tests/price-format.test.ts`
  - untracked `CONTEXT.md`
- Do not overwrite or discard these changes. Inspect `git diff` before editing. The user explicitly interrupted an earlier request to commit/push; this handoff request does not authorize commit/push.

Relevant existing commits instead of duplicating their implementation details:

- `e512426 feat: add per-outcome target APR guidance`
- `18b53e2 feat: refine portfolio position metrics`
- `3376d52 feat: refine position table layout`

## Confirmed product semantics

Current `costApr` in `lib/apr.ts` is not Entry APR. It combines fixed `avgPrice` with the current remaining settlement days, so it rises mechanically as expiry approaches. That metric should not be presented as historical entry yield.

For each BUY fill:

```text
entryRoi = (1 - fillPrice) / fillPrice
daysAtEntry = (settlementTime - fillTimestamp) / 1 day
fillEntryApr = entryRoi * 365 / daysAtEntry
```

For a position with multiple BUY fills, use cost-weighted moving average Entry APR:

```text
positionEntryApr = sum(remainingFillCost * fillEntryApr)
                 / sum(remainingFillCost)
```

Recommended inventory behavior for this analytics product:

- BUY: increase size/cost and recalculate the cost-weighted Entry APR.
- Partial SELL: reduce remaining size and remaining cost proportionally; keep Entry APR unchanged.
- Full SELL: reset size, cost, and Entry APR.
- Re-buy after full exit: begin a new Entry APR history.
- YES and NO are separate because they have different `token_id` values.

This is an analytics convention, not tax-lot accounting. If FIFO is later required, record that as an explicit product decision before changing the model.

## Historical data source

Use Polymarket Data API v2 trades:

```text
GET https://data-api.polymarket.com/v2/trades?user=<wallet>&start=1
```

Follow `pagination.next_cursor` until it is null. The API supplies fields including `timestamp`, `price`, `size`, `side`, `token_id`, `condition_id`, and `transaction_hash`. `start=1` requests full available history. Re-send identical filters on every cursor page.

Official reference: https://data-api.polymarket.com/v2/docs

Do not fetch only the latest N rows. An old Market A entry can be pushed far back by unrelated trades in Markets B/C/D. Full pagination plus grouping by `token_id` is required.

## Persistence design

Use server-side Postgres. Recommended current Vercel option: Neon Postgres through Vercel Marketplace.

References:

- https://vercel.com/docs/postgres
- https://vercel.com/marketplace/neon/neon

Do not use browser `localStorage`, repository JSON, or the Vercel function filesystem for this ledger.

### `trade_events`

Persist raw source events so derived state can be rebuilt and audited.

Suggested fields:

```text
trade_key primary key
wallet_address
token_id
condition_id
side
size
price
traded_at
transaction_hash
raw_data jsonb
created_at
```

If the source has no stable unique trade id, derive `trade_key` from stable source fields such as wallet, transaction hash, token, side, price, size, and timestamp. Insert idempotently with `ON CONFLICT DO NOTHING`.

### `token_entry_state`

Persist the current derived state used by the dashboard.

```text
wallet_address
token_id
condition_id
outcome
remaining_size
remaining_cost_usdc
weighted_entry_apr
first_entry_at
last_entry_at
last_trade_at
is_reconciled
updated_at
primary key (wallet_address, token_id)
```

### `wallet_sync_state`

Persist resumable synchronization progress.

```text
wallet_address primary key
sync_status
next_cursor
last_trade_timestamp
full_sync_completed_at
last_error
updated_at
```

## Synchronization flow

1. Initial sync fetches full trade history in cursor pages.
2. Write each page of raw trades and its new cursor atomically.
3. If a run stops, resume from the saved cursor.
4. Process trades chronologically and upsert `token_entry_state`.
5. Mark full sync complete only after every page is ingested and derived state is rebuilt.
6. Subsequent daily runs fetch only newer activity, with a small timestamp overlap and idempotent insertion.
7. Trades in unrelated markets do not alter a token's state.

Vercel Hobby currently allows a daily Cron and functions configurable up to 60 seconds. Chunk initial history synchronization across runs so a highly active wallet does not exceed that limit.

## Reconciliation and correctness boundary

Before exposing Entry APR for a token, compare reconstructed state with the live position:

```text
reconstructed remaining size ~= position.size
reconstructed average cost  ~= position.avgPrice
```

Only return Entry APR when reconciliation passes within explicit tolerances. Otherwise return an unavailable/incomplete state; never silently fall back to the current `costApr` approximation.

Known cases requiring explicit handling or an unavailable result:

- split/merge activity
- token transfers between wallets
- redemption/resolution events
- missing or truncated history
- duplicate or ambiguous fills
- settlement timestamp unavailable at the historical fill

## Suggested implementation sequence

1. Preserve current UI behavior: Market APR only; Entry APR hidden.
2. Introduce pure domain types and a pure chronological ledger reducer.
3. Add tests first for single buy, multiple buys, partial sell, full exit, re-entry, YES/NO separation, duplicate ingestion, and reconciliation failure.
4. Add Postgres schema/migrations and repository functions.
5. Add paginated full-sync and resumable cursor handling.
6. Add incremental daily synchronization.
7. Join reconciled Entry APR into `/api/positions` as a nullable field with explicit status/reason.
8. Re-enable UI as `Market APR / Entry APR` only when the backend data is trustworthy.

Required validation commands are documented in `AGENTS.md`; currently use:

```text
npm run check
npm test
npm run build
```

## Suggested skills

- `domain-modeling`: formalize Entry APR terminology and invariants; update `CONTEXT.md` or an ADR if appropriate.
- `codebase-design`: design the ledger reducer and persistence seam as deep modules.
- `tdd`: implement trade reconstruction and reconciliation test-first.
- `vercel-react-best-practices`: use when reconnecting Entry APR to the Next.js API/UI.
- `ui-ux-pro-max`: use when reintroducing the Market APR / Entry APR presentation.
- `diagnosing-bugs`: use if reconstructed size/cost diverges from live Polymarket positions.

