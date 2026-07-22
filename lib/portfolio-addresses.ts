const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

export function parsePortfolioAddresses(raw: string | undefined): string[] {
  const addresses = (raw ?? "")
    .split(/[\r\n,]+/)
    .map((address) => address.trim())
    .filter(Boolean)
    .map((address) => address.toLowerCase());

  const uniqueAddresses = [...new Set(addresses)];
  const invalidAddress = uniqueAddresses.find((address) => !EVM_ADDRESS_PATTERN.test(address));
  if (invalidAddress) {
    throw new Error(`Invalid EVM address: ${invalidAddress}`);
  }
  if (uniqueAddresses.length === 0) {
    throw new Error(
      "POLYMARKET_USER_ADDRESSES or POLYMARKET_USER_ADDRESS is required",
    );
  }

  return uniqueAddresses;
}
