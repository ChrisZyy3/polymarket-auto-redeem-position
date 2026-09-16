const DEFAULT_PRICE_DECIMALS = 3;

function decimalPlaces(value: number): number {
  const normalized = value.toString().toLowerCase();
  const [coefficient, exponentText] = normalized.split("e");
  const coefficientDecimals = coefficient.split(".")[1]?.length ?? 0;

  if (!exponentText) return coefficientDecimals;

  const exponent = Number(exponentText);
  return Number.isFinite(exponent) ? Math.max(0, coefficientDecimals - exponent) : coefficientDecimals;
}

export function priceDecimalsForTick(tickSize: number | null | undefined): number {
  if (!Number.isFinite(tickSize) || !tickSize || tickSize <= 0) return DEFAULT_PRICE_DECIMALS;
  return Math.min(20, decimalPlaces(tickSize));
}

export function formatPriceForTick(value: number | null | undefined, tickSize: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `$${value.toFixed(priceDecimalsForTick(tickSize))}`;
}
