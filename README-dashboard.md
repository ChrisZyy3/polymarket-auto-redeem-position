# Polymarket Dashboard

Next.js 看板会展示钱包当前持仓、可用余额、持仓 APR，以及由每日快照累积出的总资产曲线和历史年化指标。

## 本地运行

需要 Node.js 20.9 或更高版本。

```bash
npm ci
cp .env.example .env
npm run dev
```

打开 `http://localhost:3000`，输入钱包地址即可查询。也可以在 URL 中预置：

```text
http://localhost:3000/?address=0x...
```

## 资产历史

历史数据保存在 `data/portfolio-history.json`。每条快照包含：

- 全部 Polymarket 持仓的当前市值；
- 钱包中的可用 pUSD 余额；
- 两者相加的总资产；
- 记录时间和持仓数量。

本地手动记录：

```bash
npm run snapshot
```

同一钱包在同一 UTC 日期重复执行时会覆盖当天旧值，不会重复追加。

## 定时方式

项目同时提供 GitHub Actions 和 Vercel Cron 两种实现，生产环境选择一种即可。

### GitHub Actions

`.github/workflows/portfolio-history.yml` 每天北京时间 09:10 执行，采集成功后自动提交 `data/portfolio-history.json`。

仓库需要配置：

1. Actions secret：`POLYMARKET_USER_ADDRESS`。
2. `Settings > Actions > General > Workflow permissions` 允许 Read and write permissions。
3. 将功能分支合并到默认分支。定时 workflow 只会从默认分支运行。

### Vercel Cron

Vercel 的本地文件系统不适合持久化，因此 Cron 路由会通过 GitHub Contents API 更新同一个 JSON 文件。配置 `vercel.json` 后，在 Vercel 添加：

```text
POLYMARKET_USER_ADDRESS=0x...
CRON_SECRET=随机长字符串
GITHUB_HISTORY_TOKEN=具有目标仓库 Contents: Read and write 权限的 fine-grained token
GITHUB_REPOSITORY=owner/repository
GITHUB_HISTORY_BRANCH=main
```

路由为 `GET /api/cron/portfolio-snapshot`。Vercel 会把 `CRON_SECRET` 作为 Bearer token 发送，未授权请求返回 401。

## 指标口径

- 记录以来变化：最新总资产相对首条快照的变化率。
- 7 日 / 30 日年化：使用目标日期当日或之前最近一条快照，按复合增长率折算成年化。
- 记录以来年化：首条和最新快照覆盖至少两个不同时间点后显示。

余额曲线无法区分投资收益和充值、提现。发生外部资金流时，这些指标表示账户资金规模变化，不是严格的时间加权投资收益率。

## API

- `GET /api/positions?address=...`：当前持仓与余额。
- `GET /api/portfolio-history?address=...`：历史快照与年化指标。
- `GET /api/cron/portfolio-snapshot`：Vercel Cron 采集入口。
