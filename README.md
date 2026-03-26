# Polymarket Auto-Redeem Position Checker

一个基于 Node.js + TypeScript 的 Polymarket 持仓监控工具，能够自动过滤可赎回仓位并发送通知。

## 功能特性

- 🛡️ **持仓过滤**：自动识别可赎回（Redeemable）仓位。
- 📊 **大小阈值**：支持通过 `size` 过滤小额仓位（默认 0.1），减少垃圾信息。
- 🔔 **通知整合**：支持 ServerChan (Server酱) 和 FTQQ Push 渠道，自动将多个仓位汇总为单条消息发送。
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

### 3. 运行
```bash
# 开发环境运行
npm run dev

# 类型检查
npm run check
```

## 技术栈

- **Runtime**: Node.js (ES Modules)
- **Language**: TypeScript
- **HTTP Client**: Axios
- **Tooling**: tsx, dotenv

## 许可

[MIT](LICENSE)
