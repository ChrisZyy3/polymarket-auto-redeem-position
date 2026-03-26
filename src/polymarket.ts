import axios from "axios";
import { config } from "./config.js";
import type { Position } from "./types.js";

const client = axios.create({
  baseURL: config.polymarketDataApiBaseUrl,
  timeout: 15_000,
});

/**
 * 校验是否为合法的 EVM 地址
 * @param address 地址
 * @returns 是否合法
 */
function isValidEvmAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * 获取用户当前所有持仓
 * @param userAddress 用户地址
 * @returns 持仓列表
 */
export async function fetchCurrentPositions(userAddress: string): Promise<Position[]> {
  if (!isValidEvmAddress(userAddress)) {
    throw new Error(`Invalid EVM address: ${userAddress}`);
  }
  const response = await client.get<Position[]>("/positions", {
    params: {
      user: userAddress,
      sizeThreshold: 0,
      limit: 500,
      offset: 0,
    },
  });
  // 前置过滤：只保留 size >= 阈值的持仓
  return response.data.filter((p) => p.size >= config.minPositionSize);
}

/**
 * 获取用户可赎回的持仓
 * @param userAddress 用户地址
 * @returns 可赎回持仓列表
 */
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
  // 前置过滤：只保留 redeemable 为 true 且 size >= 阈值的持仓
  return response.data.filter(
    (position) => position.redeemable && position.size >= config.minPositionSize
  );
}
