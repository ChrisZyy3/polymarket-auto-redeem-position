/** Normalize the platform's ISO market end date without converting it across time zones. */
export function normalizeMarketEndDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:$|T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$)/.exec(value.trim());
  if (!match) return null;
  const date = match[1];
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
  return date;
}

/** A settlement estimate is auto-verified only when fresh CLOB market metadata
 * agrees with the date in the fresh position snapshot. This is not a guarantee
 * of the actual resolution/settlement timestamp.
 */
export function verifyMarketSettlementDate(positionEndDate: string | null | undefined, marketEndDateIso: unknown) {
  const positionDate = normalizeMarketEndDate(positionEndDate);
  const marketDate = normalizeMarketEndDate(marketEndDateIso);
  return {
    verified: positionDate !== null && marketDate !== null && positionDate === marketDate,
    positionDate,
    marketDate,
  };
}
