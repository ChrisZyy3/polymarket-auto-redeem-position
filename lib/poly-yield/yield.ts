export function yearsUntil(endTime: string, now = new Date()): number {
  const endMs = new Date(endTime).getTime();
  if (!Number.isFinite(endMs)) throw new Error(`Invalid endTime: ${endTime}`);
  return (endMs - now.getTime()) / (365 * 24 * 60 * 60 * 1000);
}

export function priceForTargetApy(targetApy: number, endTime: string, now = new Date()): number {
  const years = yearsUntil(endTime, now);
  if (years <= 0) throw new Error("market maturity has already passed");
  return Math.pow(1 + targetApy, -years);
}

export function apyForPrice(price: number, endTime: string, now = new Date()): number {
  const years = yearsUntil(endTime, now);
  if (years <= 0) throw new Error("market maturity has already passed");
  return Math.pow(1 / price, 1 / years) - 1;
}

export function floorToTick(value: number, tick: number): number {
  const decimals = Math.max(0, (tick.toString().split(".")[1] ?? "").length);
  return Number((Math.floor((value + 1e-12) / tick) * tick).toFixed(decimals));
}
