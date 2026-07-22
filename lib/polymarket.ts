import axios from "axios";
import { config } from "./config";

import type { Position } from "./types";

const client = axios.create({
  baseURL: config.polymarketDataApiBaseUrl,
  timeout: 15000,
});

export function isValidEvmAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

export interface JsonRpcBalanceResponse {
  result?: string;
  error?: { code: number; message: string };
}

export function parseCashBalanceResponse(response: JsonRpcBalanceResponse): number {
  if (response.error) {
    throw new Error(`Polygon RPC error ${response.error.code}: ${response.error.message}`);
  }
  if (!response.result || !/^0x[0-9a-f]+$/i.test(response.result)) {
    throw new Error("Polygon RPC returned no valid cash balance");
  }
  return Number(BigInt(response.result)) / 1e6;
}

export async function fetchCurrentPositions(
  userAddress: string,
  minPositionSize = config.minPositionSize,
): Promise<Position[]> {
  if (!isValidEvmAddress(userAddress)) {
    throw new Error(`Invalid EVM address: ${userAddress}`);
  }

  const pageSize = 500;
  const positions: Position[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const response = await client.get<Position[]>("/positions", {
      params: { user: userAddress, sizeThreshold: 0, limit: pageSize, offset },
    });
    positions.push(...response.data);
    if (response.data.length < pageSize) break;
  }

  return positions.filter((position) => position.size >= minPositionSize);
}

export async function fetchCashBalance(userAddress: string): Promise<number> {
  if (!isValidEvmAddress(userAddress)) {
    throw new Error(`Invalid EVM address: ${userAddress}`);
  }
  const data = `0x70a08231000000000000000000000000${userAddress.slice(2).toLowerCase()}`;
  const response = await axios.post<JsonRpcBalanceResponse>(
    config.polygonRpcUrl,
    { jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: config.pusdAddress, data }, "latest"] },
    { timeout: 15000 }
  );
  return parseCashBalanceResponse(response.data);
}

export async function fetchRedeemablePositions(userAddress: string): Promise<Position[]> {
  if (!isValidEvmAddress(userAddress)) {
    throw new Error(`Invalid EVM address: ${userAddress}`);
  }
  const response = await client.get<Position[]>("/positions", {
    params: {
      user: userAddress,
      redeemable: true,
      sizeThreshold: 0,
      limit: 500,
      offset: 0,
    },
  });
  return response.data.filter((p) => p.redeemable && p.size >= (config.minPositionSize || 0.1));
}
