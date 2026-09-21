# Polymarket Portfolio and Yield Management

This context covers monitoring a Polymarket wallet and planning outcome-specific positions that target a minimum annualized return.

## Language

**Position**:
Shares of one Outcome currently held by the configured wallet.
_Avoid_: Holding order, market position

**Market**:
A binary Polymarket question that contains complementary Outcomes such as Yes and No.
_Avoid_: Event, Outcome

**Event**:
A Polymarket grouping that may contain one or more Markets.
_Avoid_: Market

**Outcome**:
One tradable side of a Market, identified by its own token.
_Avoid_: Market, Event

**Managed Outcome**:
An Outcome with an explicit Target Principal and yield policy. Both Outcomes of the same Market may be managed independently.
_Avoid_: Managed Market, Strategy

**Target Principal**:
The desired amount of capital allocated to a Managed Outcome at its planned buy price. It is a sizing target, not a portfolio-wide risk limit.
_Avoid_: Position limit, payout value, historical cost

**Hold APR**:
The simple annualized return implied by an Outcome's current price, assuming it pays $1 at settlement.
_Avoid_: APY, guaranteed yield

**Alert APR**:
A display threshold used by the portfolio dashboard to flag positions for attention. It is independent from Target APR and does not control yield-management plans.
_Avoid_: Target APR

**Target APR**:
The minimum Hold APR accepted by a Managed Outcome's yield policy. It is independent from Alert APR.
_Avoid_: Alert APR, APY

**Maker Order**:
A limit order intended to remain on the order book rather than execute immediately. It must not cross the best opposing price.
_Avoid_: Market order, Taker order

**Rebalance Plan**:
A read-only description of desired order changes for Managed Outcomes. It is not proof that any order has been submitted or filled.
_Avoid_: Rebalance execution, trade confirmation

**Managed Order**:
An order created and recorded by PolyYield, making it eligible for future automated replacement or cancellation.
_Avoid_: External Order

**External Order**:
An order created outside PolyYield. It affects exposure and capital calculations but is never modified automatically.
_Avoid_: Managed Order

**Projected Proceeds**:
Capital expected from a planned sale that has not filled yet. It may fund a dependent plan but is not Available Cash.
_Avoid_: Available Cash, settled balance

**Contingent Buy**:
A planned buy whose funding depends on Projected Proceeds from one or more planned sales.
_Avoid_: Funded buy, available order
