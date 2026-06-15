import axios from "axios";
import { config } from "./config.js"; // 暂时使用简单配置，后续可改为环境变量

import type { Position } from "./types.js";

const client = axios.create({
  baseURL: "https://gamma-api.polymarket.com", // 根据你原来代码调整为正确的 Polymarket Data API
  timeout: 15000,
});

export function isValidEvmAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

export async function fetchCurrentPositions(userAddress: string): Promise<Position[]> {
  if (!isValidEvmAddress(userAddress)) {
    throw new Error(`Invalid EVM address: ${userAddress}`);
  }
  // TODO: 根据你原来代码调整请求参数和 baseURL
  const response = await client.get<Position[]>("/positions", {
    params: {
      user: userAddress,
      sizeThreshold: 0,
      limit: 500,
      offset: 0,
    },
  });
  return response.data.filter((p) => p.size >= (config.minPositionSize || 0.1));
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
