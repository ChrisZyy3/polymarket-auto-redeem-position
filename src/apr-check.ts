import { config } from "./config.js";
import { fetchCurrentPositions } from "./polymarket.js";
import { sendNotification } from "./serverchan.js";
import {
  calcApr,
  needsAttention,
  isLosing,
  sortByAprAsc,
  sortByPriceAsc,
  type AprResult,
} from "./apr.js";

/** 把 APR（小数）格式化为百分比字符串，null 显示为 "—"。 */
function formatApr(apr: number | null): string {
  if (apr === null) return "—";
  return `${(apr * 100).toFixed(1)}%`;
}

/** 把距结算天数格式化，NaN 显示为 "—"。 */
function formatDays(days: number): string {
  return Number.isNaN(days) ? "—" : days.toFixed(1);
}

/** 截断过长标题。 */
function shortTitle(title: string): string {
  return title.length > 40 ? `${title.slice(0, 40)}…` : title;
}

/** 控制台单行摘要（APR 报告用）。 */
function formatAprLine(r: AprResult, threshold: number): string {
  const flag = needsAttention(r, threshold) ? "⚠️ " : "   ";
  const noteSuffix = r.note ? ` (${r.note})` : "";
  return `${flag}APR ${formatApr(r.apr).padStart(7)} | 市价 ${r.curPrice.toFixed(3)} | 剩 ${formatDays(r.daysToSettle).padStart(6)}天 | ${r.position.outcome.padEnd(4)} | ${shortTitle(r.position.title)}${noteSuffix}`;
}

/** 控制台单行摘要（即将归零列表用，突出市价）。 */
function formatLosingLine(r: AprResult): string {
  return `🔻 市价 ${r.curPrice.toFixed(3)} | 剩 ${formatDays(r.daysToSettle).padStart(6)}天 | ${r.position.outcome.padEnd(4)} | ${shortTitle(r.position.title)}`;
}

/** 通知用：低 APR / 异常仓位的 Markdown 块。 */
function formatAttentionBlock(r: AprResult, index: number): string {
  return [
    `### ⚠️ 需调仓 #${index + 1}`,
    `* **Title**: ${r.position.title}`,
    `* **Outcome**: ${r.position.outcome}`,
    `* **当前 APR**: ${formatApr(r.apr)}`,
    `* **当前市价**: ${r.curPrice.toFixed(3)}`,
    `* **距结算**: ${formatDays(r.daysToSettle)} 天`,
    `* **Size**: ${r.position.size}`,
    `* **End Date**: ${r.position.endDate ?? "-"}`,
    ...(r.note ? [`* **说明**: ${r.note}`] : []),
  ].join("\n\n");
}

/** 通知用：即将归零仓位的 Markdown 块。 */
function formatLosingBlock(r: AprResult, index: number): string {
  return [
    `### 🔻 即将归零 #${index + 1}`,
    `* **Title**: ${r.position.title}`,
    `* **Outcome**: ${r.position.outcome}`,
    `* **当前市价**: ${r.curPrice.toFixed(3)}（市场认为你这边大概率会输）`,
    `* **距结算**: ${formatDays(r.daysToSettle)} 天`,
    `* **Size**: ${r.position.size}`,
    `* **End Date**: ${r.position.endDate ?? "-"}`,
  ].join("\n\n");
}

async function main(): Promise<void> {
  const threshold = config.aprThresholdPercent;
  const losingPrice = config.losingPriceThreshold;
  console.log(`Checking position APR for: ${config.polymarketUserAddress}`);
  console.log(`APR 调仓阈值: ${threshold}% | 即将归零市价阈值: ${losingPrice}\n`);

  try {
    // 1. 获取当前持仓（已内部过滤 size < minPositionSize）
    const allPositions = await fetchCurrentPositions(config.polymarketUserAddress);

    // 2. 排除已可赎回的仓位（那是 redeem 流程要处理的，不参与 APR 计算）
    const holdingPositions = allPositions.filter((p) => !p.redeemable);
    console.log(`持仓总数: ${allPositions.length}，参与计算（未可赎回）: ${holdingPositions.length}\n`);

    if (holdingPositions.length === 0) {
      console.log("没有可计算的持仓。");
      return;
    }

    const results = holdingPositions.map((p) => calcApr(p));

    // 3. 拆成两组：即将归零（市价 < 阈值）单独一组，其余进入正常 APR 报告
    const losing = sortByPriceAsc(results.filter((r) => isLosing(r, losingPrice)));
    const rest = sortByAprAsc(results.filter((r) => !isLosing(r, losingPrice)));

    // 4. 控制台：正常 APR 报告
    console.log(`===== 持仓 APR 报告 (市价 ≥ ${losingPrice}，按 APR 升序) =====`);
    if (rest.length === 0) {
      console.log("（无）");
    } else {
      for (const r of rest) {
        console.log(formatAprLine(r, threshold));
      }
    }
    console.log("");

    // 5. 控制台：即将归零列表
    console.log(`===== 🔻 即将归零列表 (市价 < ${losingPrice}) =====`);
    if (losing.length === 0) {
      console.log("（无）");
    } else {
      for (const r of losing) {
        console.log(formatLosingLine(r));
      }
    }
    console.log("");

    // 6. 找出需关注的仓位（低 APR 或异常）；即将归零的仓位不参与 APR 判断（其 APR 无意义）
    const attention = rest.filter((r) => needsAttention(r, threshold));
    console.log(`需调仓 (APR < ${threshold}% 或异常): ${attention.length} | 即将归零: ${losing.length}\n`);

    if (attention.length === 0 && losing.length === 0) {
      console.log("所有仓位均达标，无需调仓，不发送通知。");
      return;
    }

    // 7. 有任一情况就推送通知
    const sections: string[] = [];

    if (attention.length > 0) {
      let block = `## ⚠️ APR 低于阈值 (${threshold}%) / 需关注：${attention.length} 个\n\n`;
      attention.forEach((r, index) => {
        block += `${formatAttentionBlock(r, index)}\n\n---\n\n`;
      });
      sections.push(block.trim());
    }

    if (losing.length > 0) {
      let block = `## 🔻 即将归零 (市价 < ${losingPrice})：${losing.length} 个\n\n`;
      losing.forEach((r, index) => {
        block += `${formatLosingBlock(r, index)}\n\n---\n\n`;
      });
      sections.push(block.trim());
    }

    const content = sections.join("\n\n");
    const title = `Polymarket 调仓提醒 (需调仓 ${attention.length} / 即将归零 ${losing.length})`;
    await sendNotification(title, content);

    const hasChannel = Boolean(config.ftqqPushKey || config.serverChanSendKey);
    console.log(
      hasChannel
        ? "调仓提醒通知已发送。"
        : "未配置推送渠道（FTQQ_PUSH_KEY / SERVERCHAN_SEND_KEY），仅控制台输出。"
    );
  } catch (error: unknown) {
    console.error("APR check failed.");
    if (error instanceof Error) {
      console.error(error.message);
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
  console.error("Unhandled error in apr-check:", error);
  process.exit(1);
});
