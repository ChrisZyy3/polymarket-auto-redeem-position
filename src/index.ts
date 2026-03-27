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
    `* **Title**: ${position.title}`,
    `* **Outcome**: ${position.outcome}`,
    `* **Size**: ${position.size}`,
    `* **End Date**: ${position.endDate ?? "-"}`,
  ].join("\n\n"); // 使用双换行确保在所有 Markdown 渲染器中都能正确换行
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

    // 3. 加载历史提醒状态并去重 (使用 conditionId + outcome 作为唯一标识)
    const notifiedKeys = await loadState();
    const newRedeemable = currentRedeemable.filter(p => {
      const key = `${p.conditionId}_${p.outcome}`;
      return !notifiedKeys.includes(key);
    });
    console.log(`New redeemable positions (not notified): ${newRedeemable.length}\n`);

    if (newRedeemable.length === 0) {
      console.log("No new redeemable positions to notify.");
      return;
    }

    // 4. 打印并归集通知内容
    let notificationContent = "";
    for (const [index, position] of newRedeemable.entries()) {
      const positionHeader = `### 🔔 New Redeemable Position #${index + 1}`;
      console.log(`--- New Redeemable Position #${index + 1} ---`);
      
      const formatted = formatPosition(position);
      // 控制台打印时稍微简化一下，避免过长
      console.log(formatPosition(position).replace(/\n\n/g, "\n"));
      console.log("");

      notificationContent += `${positionHeader}\n\n${formatted}\n\n---\n\n`;
    }

    // 5. 发送汇总通知
    const notificationTitle = `Polymarket 发现新可赎回仓位 (${newRedeemable.length}个)`;
    await sendNotification(notificationTitle, notificationContent.trim());

    // 6. 发送成功后，更新本地状态文件
    // 将现有的已提醒 Key 和本次新发现的 Key 合并（去重）
    const newKeys = newRedeemable.map(p => `${p.conditionId}_${p.outcome}`);
    const updatedNotifiedKeys = Array.from(new Set([...notifiedKeys, ...newKeys]));
    await saveState(updatedNotifiedKeys);
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
