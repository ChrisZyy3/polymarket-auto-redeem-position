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

/**
 * 解析 APR 阈值（单位：百分比）。非法或缺省时回退到 8。
 */
function parseAprThreshold(): number {
  const raw = process.env.APR_THRESHOLD;
  if (!raw || raw.trim() === "") {
    return 8;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : 8;
}

/**
 * 解析「即将归零」价格阈值（0~1 之间的市价）。持有方向市价低于此值视为论点破裂、大概率归零。
 * 非法或缺省时回退到 0.5。
 */
function parseLosingPriceThreshold(): number {
  const raw = process.env.LOSING_PRICE_THRESHOLD;
  if (!raw || raw.trim() === "") {
    return 0.5;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 && value < 1 ? value : 0.5;
}

export const config = {
  polymarketUserAddress: requireEnv("POLYMARKET_USER_ADDRESS"),
  serverChanSendKey: process.env.SERVERCHAN_SEND_KEY || "",
  ftqqPushKey: process.env.FTQQ_PUSH_KEY || "",
  polymarketDataApiBaseUrl: "https://data-api.polymarket.com",
  minPositionSize: 0.1, // 最小持仓过滤阈值
  aprThresholdPercent: parseAprThreshold(), // APR 调仓阈值（百分比），低于此值的仓位会被单独提示
  losingPriceThreshold: parseLosingPriceThreshold(), // 「即将归零」市价阈值，持有方向市价低于此值单独列出
};
