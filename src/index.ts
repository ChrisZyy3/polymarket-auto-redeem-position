import { config } from "./config.js";
import { fetchCurrentPositions, fetchRedeemablePositions } from "./polymarket.js";
import { sendNotification } from "./serverchan.js";
import { loadState, saveState } from "./state.js";
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
    const currentRedeemable = await fetchRedeemablePositions(config.polymarketUserAddress);
    console.log(`Total redeemable positions (filtered): ${currentRedeemable.length}`);

    // 3. 加载历史提醒状态并去重
    const notifiedIds = await loadState();
    const newRedeemable = currentRedeemable.filter(p => !notifiedIds.includes(p.conditionId));
    console.log(`New redeemable positions (not notified): ${newRedeemable.length}\n`);

    if (newRedeemable.length === 0) {
      console.log("No new redeemable positions to notify.");
      return;
    }

    // 4. 打印并归集通知内容
    let notificationContent = "";
    for (const [index, position] of newRedeemable.entries()) {
      const positionHeader = `--- New Redeemable Position #${index + 1} ---`;
      console.log(positionHeader);
      const formatted = formatPosition(position);
      console.log(formatted);
      console.log("");

      notificationContent += `${positionHeader}\n${formatted}\n\n`;
    }

    // 5. 发送汇总通知
    const notificationTitle = `Polymarket 发现新可赎回仓位 (${newRedeemable.length}个)`;
    await sendNotification(notificationTitle, notificationContent.trim());

    // 6. 发送成功后，更新本地状态文件
    // 将现有的已提醒 ID 和本次新发现的 ID 合并（去重）
    const updatedNotifiedIds = Array.from(new Set([...notifiedIds, ...newRedeemable.map(p => p.conditionId)]));
    await saveState(updatedNotifiedIds);
    console.log("State file updated successfully.");
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
