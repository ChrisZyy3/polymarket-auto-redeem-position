import { config } from "./config.js";
import { fetchCurrentPositions } from "./polymarket.js";
import {
  calcApr,
  needsAttention,
  isLosing,
  sortByAprAsc,
  sortByPriceAsc,
  type AprResult,
} from "./apr.js";

const address = process.argv[2];

if (!address) {
  console.error("用法: npx tsx src/check-address.ts <你的Polymarket钱包地址>");
  console.error("示例: npx tsx src/check-address.ts 0xYourAddressHere");
  process.exit(1);
}

async function main() {
  console.log(`\n=== Polymarket 仓位快速验证 ===`);
  console.log(`钱包地址: ${address}`);
  console.log(`APR 阈值: ${config.aprThresholdPercent}% | 即将归零阈值: ${config.losingPriceThreshold}\n`);

  try {
    const allPositions = await fetchCurrentPositions(address);
    const holdingPositions = allPositions.filter((p) => !p.redeemable);
    const redeemablePositions = allPositions.filter((p) => p.redeemable);

    console.log(`总持仓: ${allPositions.length} | 持有中(计算APR): ${holdingPositions.length} | 可赎回: ${redeemablePositions.length}\n`);

    if (holdingPositions.length === 0 && redeemablePositions.length === 0) {
      console.log("没有持仓。");
      return;
    }

    // 计算 APR for holding positions
    const results: AprResult[] = holdingPositions.map((p) => calcApr(p));

    const losing = sortByPriceAsc(results.filter((r) => isLosing(r, config.losingPriceThreshold)));
    const rest = sortByAprAsc(results.filter((r) => !isLosing(r, config.losingPriceThreshold)));

    // 打印持有中仓位表格
    console.log("===== 持有中仓位 (按 APR 升序，需关注优先) ====");
    if (rest.length > 0) {
      const tableData = rest.map((r) => ({
        Title: r.position.title.length > 35 ? r.position.title.slice(0, 32) + "..." : r.position.title,
        Outcome: r.position.outcome,
        Size: r.position.size.toFixed(2),
        CurPrice: r.curPrice.toFixed(3),
        DaysLeft: Number.isNaN(r.daysToSettle) ? "-" : r.daysToSettle.toFixed(1),
        ROI: r.roi ? (r.roi * 100).toFixed(1) + "%" : "-",
        APR: r.apr !== null ? (r.apr * 100).toFixed(1) + "%" : (r.note || "-"),
        Status: needsAttention(r, config.aprThresholdPercent) ? "⚠️ 需关注" : "✅ 达标",
      }));
      console.table(tableData);
    } else {
      console.log("(无)");
    }

    if (losing.length > 0) {
      console.log("\n===== 🔻 即将归零仓位 ====");
      const losingTable = losing.map((r) => ({
        Title: r.position.title.length > 35 ? r.position.title.slice(0, 32) + "..." : r.position.title,
        Outcome: r.position.outcome,
        Size: r.position.size.toFixed(2),
        CurPrice: r.curPrice.toFixed(3),
        DaysLeft: Number.isNaN(r.daysToSettle) ? "-" : r.daysToSettle.toFixed(1),
        Note: r.note || "市价过低，市场认为大概率归零",
      }));
      console.table(losingTable);
    }

    if (redeemablePositions.length > 0) {
      console.log("\n===== ✅ 可赎回仓位 ====");
      const redeemTable = redeemablePositions.map((p) => ({
        Title: p.title.length > 35 ? p.title.slice(0, 32) + "..." : p.title,
        Outcome: p.outcome,
        Size: p.size.toFixed(2),
        Note: "可直接在 Polymarket 网页或后续脚本赎回",
      }));
      console.table(redeemTable);
    }

    // 简单总结
    const attentionCount = rest.filter((r) => needsAttention(r, config.aprThresholdPercent)).length;
    console.log(`\n总结: 需关注/调仓 ${attentionCount} 个 | 即将归零 ${losing.length} 个 | 可赎回 ${redeemablePositions.length} 个`);
    console.log("\n验证完成。逻辑与现有 apr-check 一致，可直接用于前端页面开发。\n");

  } catch (error: unknown) {
    console.error("验证失败:", error);
    if (error instanceof Error) {
      console.error(error.message);
    }
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});