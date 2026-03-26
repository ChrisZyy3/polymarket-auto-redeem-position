import { config } from "./config.js";
import { fetchCurrentPositions, fetchRedeemablePositions } from "./polymarket.js";
import { sendNotification } from "./notification.js";
import type { Position } from "./types.js";

/**
 * 格式化持仓信息用于打印
 * @param position 持仓对象
 * @returns 格式化后的字符串
 */
function formatPosition(position: Position): string {
  return [
    `title: ${position.title}`,
    `outcome: ${position.outcome}`,
    `size: ${position.size}`,
    `endDate: ${position.endDate ?? "-"}`,
  ].join("\n");
}

async function main(): Promise<void> {
  console.log(`Checking positions for: ${config.polymarketUserAddress}\n`);

  try {
    // 1. 获取持仓（polymarket.ts 已内部过滤 size < 0.1）
    const allPositions = await fetchCurrentPositions(config.polymarketUserAddress);
    console.log(`Total current positions (filtered): ${allPositions.length}`);

    // 2. 获取可赎回持仓（polymarket.ts 已内部过滤 size < 0.1）
    const redeemablePositions = await fetchRedeemablePositions(config.polymarketUserAddress);
    console.log(`Redeemable positions (filtered): ${redeemablePositions.length}\n`);

    if (redeemablePositions.length === 0) {
      console.log("No redeemable positions found.");
      return;
    }

    // 3. 打印并归集通知内容
    let notificationContent = "";
    for (const [index, position] of redeemablePositions.entries()) {
      const positionHeader = `--- Redeemable Position #${index + 1} ---`;
      console.log(positionHeader);
      const formatted = formatPosition(position);
      console.log(formatted);
      console.log("");

      notificationContent += `${positionHeader}\n${formatted}\n\n`;
    }

    // 4. 发送汇总通知
    const notificationTitle = `Polymarket 发现可赎回仓位 (${redeemablePositions.length}个)`;
    await sendNotification(notificationTitle, notificationContent.trim());
  } catch (error: unknown) {
    console.error("Script failed.");
    if (error instanceof Error) {
      console.error(error.message);
      // 如果是 axios 错误，打印更多细节
      if ((error as any).response) {
        console.error("API Response Error:", (error as any).response.data);
      }
    } else {
      console.error(error);
    }
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error("Unhandled error in main:", error);
  process.exit(1);
});
