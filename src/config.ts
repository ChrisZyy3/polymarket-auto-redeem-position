import dotenv from "dotenv";
dotenv.config();

/**
 * 确保环境变量存在且不为空
 * @param name 环境变量名称
 * @returns 环境变量值
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

export const config = {
  polymarketUserAddress: requireEnv("POLYMARKET_USER_ADDRESS"),
  serverChanSendKey: process.env.SERVERCHAN_SEND_KEY || "",
  ftqqPushKey: process.env.FTQQ_PUSH_KEY || "",
  polymarketDataApiBaseUrl: "https://data-api.polymarket.com",
  minPositionSize: 0.1, // 最小持仓过滤阈值
};
