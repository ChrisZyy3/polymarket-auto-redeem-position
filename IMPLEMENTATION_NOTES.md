# 资金历史功能交接留言

日期：2026-07-16

## 已完成

- 增加总资产每日快照，金额由“全部持仓当前市值 + 链上可用余额”组成。
- 持仓 API 改成分页拉取，避免超过 500 条时漏算；历史采集不应用 0.1 的尘埃过滤。
- 历史数据保存在 `data/portfolio-history.json`，同一钱包同一 UTC 日重复采集会覆盖旧值。
- Dashboard 增加记录以来变化、记录以来年化、7 日年化、30 日年化和 30/90/全部资产曲线。
- 增加 GitHub Actions 每日采集并自动 commit/push。
- 增加 Vercel Cron 入口；由于 Vercel 文件系统不持久，它通过 GitHub Contents API 更新历史 JSON。
- 增加单元测试、类型检查和生产构建验证。

## 首条记录

2026-07-16 采集成功：

- 总资产：`$369,540.52`
- 持仓市值：`$369,402.03`
- 可用余额：`$138.48`

市场价格实时变化，所以 Dashboard 当前查询金额与当天快照有小幅差异是正常现象。

## 回家后需要做的配置

推荐先用 GitHub Actions，配置最少：

1. 把当前功能分支合并到默认分支。GitHub 定时任务只从默认分支运行。
2. 在 GitHub 仓库 `Settings > Secrets and variables > Actions` 增加 secret：`POLYMARKET_USER_ADDRESS`。
3. 在 `Settings > Actions > General > Workflow permissions` 选择 `Read and write permissions`。
4. 在 Actions 页面手动运行一次 `Record Portfolio History`，确认产生一条 `data: record daily portfolio snapshot` 提交。

Vercel Cron 是备选方案，所需环境变量和 token 权限见 `README-dashboard.md`。不要同时长期启用两种定时方式；虽然当天数据会覆盖而不是重复，但没有必要发起两次更新。

## 重要口径

7 日和 30 日年化是总余额变化的复合年化。它无法识别充值和提现，所以发生外部资金流时，不应把它当作严格的投资收益率。后续若需要真实业绩归因，应额外记录 cash flow，再计算时间加权收益率或资金加权收益率。

## 隐私提醒

历史 JSON 会跟随 Git 提交，包含钱包地址和每日余额。如果仓库是公开的，这些数据也会公开。当前实现按需求把本地数据推入仓库；若不希望公开，应把仓库设为 private，或后续改为数据库并对 API 加认证。

## 验证结果

- `npm test`：7 个测试通过。
- `npm run check`：通过。
- `npm run build`：Next.js 生产构建通过。
- 浏览器：桌面与 390px 移动端检查通过，移动端无横向滚动，曲线范围切换正常，控制台无错误。
