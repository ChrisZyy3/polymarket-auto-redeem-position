# Auto Sell V2 — Maker-First Order Reconciliation (Dry Run)

Scope: pure read-only decision model only. No trading keys, credential access, CLOB order creation/cancellation, or production Worker changes.

## Agreed policy

- Mark APR target (12% default) becomes the minimum SELL price; never round down.
- New order would be LIMIT + postOnly=true + GTD; **7 days effective** with expiration = now + 604800 + 60 seconds (Polymarket expires one minute early).
- Start at best ask, but no lower than the APR-based minimum price. No automatic ask undercutting; never become taker or market.
- The five-minute poll does not imply five-minute cancel-and-repost. Preserve compliant Auto Sell orders and their time priority even if the best ask moves.
- Below-floor Auto Sell price: recommend cancellation, then verify cancellation/filled amount and recompute free shares before any replacement.
- GTD within 24 hours of effective expiry: flag for future renewal, not unconditional immediate cancellation.
- Manual SELL orders are read-only. Their unmatched quantity reserves shares and may be flagged if priced below the APR floor, but only a separately authorized Adopt Order feature could let us manage them.
- Failed CLOB lookups, partial pagination, stale book, missing tick or ambiguous order IDs must block fresh orders.
- Maker rebates and liquidity rewards are conditional and not included in the Mark APR floor.

## Contract

Pure function: reconcileAutoSellMaker(input) in order-reconciliation.mjs.

Inputs: wallet, tokenId, nowSec, positionShares, positionAsOf, authOrders, managedOrderIds, confirmedTerminalOrderIds, targetFloorPrice, quote, availableBalanceShares, minOrderShares.

- positionShares is the TOTAL position balance, not an already net spendable balance.
- authOrders = { complete:true, asOf, orders:[...] } is only valid after a fully paginated, properly authenticated CLOB GET /data/orders and wallet-address-scoped reconciliation. A 429/incomplete/unauthenticated request is NOT equivalent to an empty order list.
- Quote requires bestBid, bestAsk, tickSize, tickVerified:true and fresh asOf.
- managedOrderIds must be persisted per wallet+token. Never treat arbitrary manual orders as auto-managed. If an owned ID is missing from open orders, require a separately verified terminal status before assuming reserved shares are free.
- CLOB net available balance may already account for open orders: use it as a safety cap, **do not subtract reservations twice**.
- Snapshot freshness: full position <=10 minutes; CLOB orders and book <=2 minutes. Otherwise blocked.
- Unknown status, negative/malformed matched quantity, duplicate orders, oversubscription, crossed book, price above max tick: blocked.
- Public book depth is not personal FIFO rank, so no exact queue position should be implied.

Possible decision actions: keep_existing; would_create_post_only; would_cancel_then_reconcile; would_renew_gtd; no_available_shares; blocked.

## Next stage

Build a SEPARATE authenticated read-only CLOB adapter with per-wallet L2 credentials in scoped secrets, complete cursor pagination and strict authentication/observability. Prefer isolating it from the original Wallet Monitor because L2 keys may also authorize trading. No real order POST/DELETE until finality, partial-fill, allowance, cancel-race and fail-closed tests have passed and the user explicitly approves a small pilot.

Regression: node workers/wallet-monitor/test-order-reconciliation.mjs.
