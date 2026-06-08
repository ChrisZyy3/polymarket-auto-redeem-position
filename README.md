# Polymarket Auto-Redeem Position Checker

一个基于 Node.js + TypeScript 的 Polymarket 持仓监控工具，能够自动过滤可赎回仓位并发送通知。

## 功能特性

- 🛡️ **持仓过滤**：自动识别可赎回（Redeemable）仓位。
- 📊 **大小阈值**：支持通过 `size` 过滤小额仓位（默认 0.1），减少垃圾信息。
- 🔔 **通知整合**：支持 ServerChan (Server酱) 和 FTQQ Push 渠道，自动将多个仓位汇总为单条消息发送。
- 📈 **APR 监控**：计算每个持仓「持有到结算日」的前瞻年化收益率，低于阈值时提示调仓。
- ⚡ **轻量高效**：使用 `tsx` 直接运行 TypeScript 源码，无需复杂的编译流程。

## 快速开始

### 1. 安装依赖
```bash
npm install
```

### 2. 配置环境变量
复制 `.env.example` 为 `.env` 并填写相关参数：
- `POLYMARKET_USER_ADDRESS`: 您的钱包地址。
- `FTQQ_PUSH_URL`: [Server酱/Push](https://s.ftqq.com/) 的推送 URL。
- `APR_THRESHOLD`: APR 调仓阈值（单位百分比，缺省 `8`）。低于此值的仓位会被单独提示。

### 3. 运行
```bash
# 可赎回仓位检查（redeem 通知）
npm run dev

# APR 监控（计算各仓位年化收益率，低于阈值时提示调仓）
npm run apr

# 类型检查
npm run check
```

## APR 监控说明

`npm run apr` 会拉取当前持仓（排除已可赎回的），计算每个仓位「从当前市价持有到结算日」的前瞻年化收益率：

```
ROI = (1 - curPrice) / curPrice        # 例：市价 0.99 → 1.01%
APR = ROI × 365 / 距结算天数            # 简单年化
```

- **基准价**：使用当前市价 `curPrice`，反映当前锁定资金的真实年化（买入成本视为沉没成本）。
- **完整报告**：控制台始终打印全部持仓的 APR，按升序排列（最该调仓的在最前）。
- **两类预警**，存在任一即推送一条汇总通知：
  - ⚠️ **需调仓**：`APR < 阈值`，或异常（缺结算日期 / 已过期未赎回 / 市价已无套利空间）。
  - 🔻 **即将归零**：持有方向市价低于 `LOSING_PRICE_THRESHOLD`（缺省 0.5），说明安全论点破裂、大概率归零。此类仓位 APR 无参考意义，单独列出、不参与 APR 排序。

### 每日定时任务（Windows 任务计划程序）

```powershell
schtasks /Create /TN "Polymarket-APR" ^
  /TR "cmd /c cd /d C:\path\to\project && npm run apr >> apr.log 2>&1" ^
  /SC DAILY /ST 09:00
```

## 技术栈

- **Runtime**: Node.js (ES Modules)
- **Language**: TypeScript
- **HTTP Client**: Axios
- **Tooling**: tsx, dotenv

## 许可

[MIT](LICENSE)
