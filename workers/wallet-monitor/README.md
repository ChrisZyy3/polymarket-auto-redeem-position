# Polymarket 钱包交易与结算提醒（5分钟聚合监控）

独立的 Cloudflare Worker，不依赖 Dashboard、Vercel 或钱包私钥。

支持每 5 分钟监控多个钱包，每个钱包独立持久化检查点、待发通知和去重状态。
推送按地址显示自定义钱包名称，未匹配时仍显示原钱包地址。升级前单钱包地址对应的 Durable Object 名称不变，历史检查进度继续保留。

默认监控地址（3 个）：
- 0x9f7eb5bc88342f01d18754be0439fad79ec282ce
- 0x24816c037cdc2c9bd979e69d777541cf560a9b79
- 0x052f4191cd324a348835a846d34df5b0061e53fb

在 Cloudflare Production `WALLET_ADDRESSES` 变量中用逗号隔开地址；兼容仅设置 `WALLET_ADDRESS` 的旧部署。

## 通知范围

- BUY/SELL 成交：每条新活动通知，包含方向、单笔份数、成交金额、价格和市场链接；不再展示交易哈希链接。
- 新变为可赎回：区分 WIN（每份回款约 1 pUSD）、PARTIAL（正回款不足 1 pUSD）并提醒手动处理；LOSS（每份回款 0）单独提示。
- 实际 REDEEM：通知实际到账金额；到账金额不等于利润。零回款赎回也会提示。
- 结算归零：仅当 Data API 的 redeemable 为 true 且 curPrice 为 0 时触发；单纯浮亏或低价不触发。
- 仓位提醒默认忽略投入/价值均小于 $5 的仓位；结算归零时保留之前记录的投入，避免零市值被过滤。成交提醒没有 $5 门槛，避免漏掉拆分成交。

首次运行只建立基线，不补发历史成交或已经可赎回/归零的仓位。
上线前已经赎回且消失的仓位不会补报。
若归零后在两次轮询之间已赎回而从持仓消失，会通过 REDEEM 活动提示零回款。

## 部署

需要 Node.js 22+ 和 Cloudflare 账号。SQLite Durable Objects 可用于 Workers Free 计划；
实际额度以账号和平台最新限制为准，不保证长期零成本。

在本目录执行：

~~~bash
node test.mjs
npx wrangler@4 login
npx wrangler@4 secret put PUSH_URL
npx wrangler@4 secret put MONITOR_SECRET
npx wrangler@4 deploy
~~~

PUSH_URL 输入你的完整推送地址：
https://<uid>.push.ft07.com/send/<sendkey>.send

MONITOR_SECRET 自行设为一个随机长字符串，用于保护手动测试/状态查询入口。
不要把 PUSH_URL 或 MONITOR_SECRET 提交到 GitHub。无需把浏览器的 Cookie、Origin、
Referer、User-Agent 等请求头复制过来；推送只需 JSON POST。

wrangler.json 已设置 3 个默认钱包地址、$5 仓位门槛、每 5 分钟 Cron、SQLite Durable Object 绑定和迁移。
部署会自动创建存储，不需要手建 KV。
Cron 配置传播可能需要约 15 分钟。实际提醒延迟还受 Polymarket 索引和推送通道影响，
并不保证交易发生后恰好 60 秒内送达。

## 手动验证

用实际部署地址替换 worker.example.workers.dev。先在终端设置 MONITOR_SECRET，
下面的变量不会写进源代码。

~~~bash
curl -X POST -H "Authorization: Bearer $MONITOR_SECRET" https://worker.example.workers.dev/test
curl -X POST -H "Authorization: Bearer $MONITOR_SECRET" https://worker.example.workers.dev/poll
curl -H "Authorization: Bearer $MONITOR_SECRET" https://worker.example.workers.dev/status
~~~

/test 仅发送测试通知；/poll 执行一轮检查；/status 返回初始化、检查时间和待发送数量。
首次 /poll 返回 initialized:true；之后没有新事件属于正常状态。

部署后查看 Workers Logs 确认没有持续错误。Data API 查询失败会保留原检查点并记录错误，后续 Cron 重试；
推送失败则保留 Outbox，不阻塞正常轮询，由 Durable Object Alarm 独立退避重试。监控自身停机不能依靠同一个推送服务保证通知，必要时另配外部可用性监控。

## 去重与重试

每个钱包使用一个 Durable Object，合并同一实例内重叠的检查请求。
活动按交易哈希、类型、结果 token、方向、时间、金额、价格等字段去重；
一笔链上交易中的不同结果不会只因哈希相同而被丢弃。

活动从上次检查点向前重查 60 分钟，处理常见索引延迟；超过该窗口才被索引的记录可能漏报。
API 断线期间检查点不前进，恢复后从上次检查点补查；分页超限会明确失败，
不会默默截断数据。长时间离线且活动量极大时需要拆分时间窗口恢复。

检测结果与待发送内容先一起写入持久存储，推送成功后才移出待发送列表。
数据 API 失败不会推进检查点。手机推送服务没有幂等键，因此若推送已被服务接收，
但响应丢失或在确认落盘前进程中断，重试仍可能造成重复，不能保证 exactly-once。

API 某些字段完全相同且无独立日志序号的重复成交可能无法彼此区分。
仓位列表使用偏移分页，在翻页期间快速变动时可能短暂重复或遗漏，下一轮再次检查。
本工具基于公开 Data API，提醒不等于链上最终审计结果。

## 文件

- worker.mjs：Cron、受保护的测试/查询接口、Durable Object。
- monitor.mjs：分页、基线、事件识别、持久 outbox、推送。
- test.mjs：模拟数据与推送的行为检查。
- wrangler.json：Cloudflare 部署配置。

没有真实交易、撤单或赎回权限；仅查询和通知。

## 官方参考

- https://docs.polymarket.com/api-reference/core/get-user-activity
- https://docs.polymarket.com/api-reference/core/get-current-positions-for-a-user
- https://developers.cloudflare.com/workers/configuration/cron-triggers/
- https://developers.cloudflare.com/durable-objects/
- https://doc.sc3.ft07.com/en/serverchan3/server/api


## Message delivery audit

The worker stores per-wallet counters in each existing Durable Object (no reset):
- `auditSince`: epoch seconds when this version first initialized audit (not historical data).
- `alertsDetectedCount`, `lastAlertAt`, `lastAlertType`: alerts that met trigger conditions.
- `pushCount`, `lastPushAt`, `lastPushType`: notifications accepted by the ServerChan API.
- `pushFailureCount`, `lastPushErrorAt`, `lastPushError`: delivery attempts that failed.
- `lastPushAttemptAt`, `lastPollAt`, `lastPollAlerts`, `lastPollAccepted`, `pending`:
  inspection and queue status (lastPollAt is the latest successful data-fetch checkpoint).

The protected `GET /status` returns these fields separately for each wallet. Worker Logs emit
`wallet_poll_success`, `wallet_alert_detected`, `push_attempted`,
`push_accepted`, and `push_failed`. These events include wallet, type, count
and time, but never PUSH_URL, MONITOR_SECRET, notification body, or market details.
A `push_accepted` means ServerChan acknowledged the API request, **not** that
the phone displayed the message. A protected `POST /test` verifies the channel,
and does not change a wallet's push counters.

Existing checkpoint/outbox state is preserved. Historic notifications before
auditSince cannot be reconstructed, so pushCount and alertsDetectedCount start at
zero when audit is first initialized. TRADE/REDEEM still have no USD minimum;
only redeemable/lost position transitions use MIN_POSITION_USD.

## 推送的钱包名称和当前持仓摘要

通知中的钱包展示名称（不区分大小写）：
- 0x9f7eb5bc88342f01d18754be0439fad79ec282ce → PigsWallet
- 0x052f4191cd324a348835a846d34df5b0061e53fb → ChrisZyy
- 0x24816c037cdc2c9bd979e69d777541cf560a9b79 → RealChris
- 其他钱包地址 → 原样显示地址。

成交、实际赎回、结算/可赎回通知均附加：预计结束、当前该选项总持仓（份）、
当前持仓市值（USDC）和买入均价（USDC/份）。信息来自同一轮
Data API /positions 的 size、currentValue、avgPrice、endDate。
这里的「总持仓」指本钱包在该市场 outcome/选项上的剩余份额，而不是单笔成交量；
不同市场选项不会被错误合并。预计结束日期属于市场元数据，不保证结算时间。
endDate 只有日期时注明「仅提供日期」；缺失或占位符标注「暂无数据」。
卖出全部持仓或持仓接口还没索引到时，数量、市值与均价会标注暂无数据，绝不拿单笔成交量代替。

不再展示 Polygonscan 交易哈希链接；保留 Polymarket 事件市场链接。
旧的持久化待发送消息也会移除交易哈希链接，但不能为历史消息反向补齐缺失的持仓快照。
钱包的 Durable Object ID、检查点、推送审计、Cron 和密钥均不变。

## 新版 Server酱通知格式

- 锁屏标题 title：🟢 BUY / 🟠 SELL / 🏆 WIN / 🔴 LOSS / 🟣 PARTIAL / 💰 REDEEM + 钱包名称 + 主要金额。
- 通知摘要 short：市场名称、YES/NO、成交份数和单价或预计盈亏。
- 正文 desp：支持 Markdown 的市场、成交/结算信息、持仓摘要、预计结束时间与市场链接；不包含交易哈希链接。
- 若 redeemable=true 且 curPrice=1，则 WIN；curPrice=0 为 LOSS；0<curPrice<1 为 PARTIAL，需以最终规则为准。
- 结算盈亏仅在 Data API 的 grossInitialValue 或 initialValue 提供可用的剩余仓位成本时计算，属于估算，非历史全部净盈利。
- 每条推送尾部增加 **💳 钱包余额（链上 pUSD）**：通过 Polygon RPC 的 ERC-20 balanceOf 读取 Polymarket V2 的 pUSD（6 位小数），最多尝试两个 RPC 节点，查询失败只显示暂时无法获取，不阻止成交通知。
- 该余额不等于真正 Available balance：挂单占用可能使可下单金额更低；准确的 CLOB 可用余额需额外授权认证，本工具不收集任何钱包签名/密钥。
- 仅在有待推送消息时查询 pUSD，不增加每分钟空闲 Cron 的链上请求；同一轮推送共享余额结果。
- 修改不触碰 Durable Object 命名、存储结构、Cron、既有消息队列和计数。旧待发通知发送时也附加余额，但不会虚构历史成交数据。

## V2 可靠性升级（2026-10-23）

- **每 5 分钟 Cron**：`*/5 * * * *`。同钱包、同 outcome token、同 BUY/SELL 方向、同五分钟 UTC bucket 内的拆单合并成一条通知；成交金额/份数求和，成交价格按金额加权。REDEEM 与结算事件始终独立提醒。
- **可靠 Outbox**：先将检测到的事件、checkpoint 与待发消息存储到原 Durable Object，再尝试 Server酱。推送失败不会阻断新数据检测，原消息持久留队，由 DO Alarm 进行退避重试。
- **60 分钟活动回查窗口**：针对索引延迟保留 60 分钟重叠，结合逐 fill 的 activityKey 去重；极端超过窗口的索引延迟仍需更深的定期回查。
- **429/503 恢复**：对 Data API 429/502/503/504 进行最多两次短退避重试，支持 Retry-After，超过短等待预算则交给下一轮 Cron 补查；三个钱包请求错峰 800ms。
- **健康指标**：同钱包连续 3 轮失败发送一次故障告警，恢复后发一条恢复通知；不等于 Worker 全局停机监测，后者需要独立健康检查服务。
- **Data API v2 Shadow**：每个钱包每六小时对 `/v2/positions` 进行一次只读游标分页查询，与当前 v1 仓位做 token 集合和 share 数量对照。仅记录数量与差异，不修改结算判断、PnL、Outbox 或检查点。`V2_SHADOW_ENABLED=true` 开启，设置为 false 关闭。v2 故障不会影响 v1 通知。
- **状态兼容**：本升级继续沿用全部钱包独立的 DO ID、pending、seen、checkpoint、audit，密钥和历史账本不需要迁移/重置。
- **状态接口**：原 `/status` 返回推送审计、数据连续失败次数、健康告警状态和最近一次 v2 shadow 对比报告。


## V2 position lifecycle + winning ROI/APR + settlement net (2026-10-23)

1. Snapshot all nonzero /positions share sizes per token after each successful polling round. Classify a grouped BUY or SELL only if previous/current snapshots match the new fill quantity within tolerance; if API indexing is late, a transfer overlaps, or the wallet lacks a prior snapshot, keep generic BUY/SELL. Never infer EXIT from an absent row alone.
2. One same-token direction group across the entire polling round may become OPEN, ADD, TRIM or EXIT. Mixed sides or multiple 5-minute buckets remain BUY/SELL to avoid attribution errors. Confirmed EXIT displays 0 remaining shares.
3. Every BUY, including OPEN/ADD, displays conditional full-win GROSS ROI = (1 / current_avg_price - 1) x 100%, and SIMPLE annual APR = gross ROI x 365 / estimated remaining days. This assumes that specific outcome wins and each share redeems for $1; it is NOT probability-weighted expected return or guaranteed yield. Buy fees, gas and slippage are excluded. If Gamma only reports YYYY-MM-DD, APR uses end of that UTC date as a rough placeholder, not a settlement promise. Invalid/expired/<1 day windows suppress APR.
4. For new WIN/LOSS/PARTIAL transitions only, query Data API v2 /v2/positions with status=REDEEMABLE to obtain total_cost_usdc, an inclusive remaining-entry basis. Estimated net profit on still-held shares = shares x resolved payout price - total_cost_usdc. Display entry_fees_usdc for disclosure only (already included in basis; do NOT subtract twice). Any realized_pnl is separate historical realized PnL. Net excludes wallet gas and other off-platform expenses, and not earlier realized trading PnL.
5. If v2 is unavailable, cost missing or share amounts disagree with the v1 indexer, do not display a fabricated net figure. Optional gross-only estimate is clearly identified, without preventing the settlement notification.
6. Persist precise resolutionKind alongside legacy status to detect PARTIAL -> WIN changes. Existing redeemable/lost records migrate without duplicate historical settlement alerts. Wallet identity, current Durable Object checkpoint/outbox, 5-minute Cron, ServerChan and pUSD footer remain unchanged.


## 独立可用性检查（外部 watchdog）

- Worker 公开但只读的 `GET /health` **无需 MONITOR_SECRET**，只返回 `{"ok":true|false,"checked":3}`，不会暴露钱包地址、持仓、检查点、余额、PUSH_URL、异常细节或其它私密数据。
- 健康标准：三个钱包 Durable Object 均已初始化，且 `lastSuccessAt` 距离现在不超过 20 分钟；所有钱包正常才返回 HTTP 200，否则返回 HTTP 503（`Cache-Control: no-store`）。此接口**不执行交易查询**，不影响 Cron、现有审计和 Outbox。
- 独立的 GitHub Actions `wallet-monitor-health.yml` 工作流在仓库默认 `main` 分支每十分钟探测该接口；若无法访问、超时、或返回非 200，自动新建/复用一个故障 Issue，恢复后留言并关闭。同一故障不反复创建 Issue。
- 监控站点：`https://polymarket-wallet-monitor.chriszyy3.workers.dev/health`。
- GitHub Actions 故障 Issue 通知由用户 GitHub 通知设置决定，**并不等于 Server酱消息或独立推送服务 SLA**；GitHub 定时工作流有延迟或无法触发的可能，需在高可靠要求下接入其他第三方 uptime 平台。
- 默认保持 `/status`、`/poll`、`/test` 的鉴权不变。不新增任何 API 密钥和钱包签名权限。


## Asset digest, redeem and market-risk alerts

**Daily (Beijing ~09:00)**: existing 5-minute Cron triggers a single three-wallet summary during the 09:00 hour. Each wallet stores a fresh compact position snapshot after a successful poll; a separate coordinator Durable Object `_system_daily_digest_v1` accepts at most one report per Beijing calendar day. The message is persisted in the existing Outbox mechanism and retried if ServerChan is unavailable. No additional Cron schedules, database or API keys are needed.

The daily report separates on-chain wallet pUSD (not order-adjusted available balance), live/unresolved market-value estimates and potential unredeemed payouts. Their sums do not double-count redeemable positions. Gross floating PnL is a mark-to-market estimate based on currentValue and initialValue/avgPrice; it is not a fee-inclusive or realized net profit. Missing RPC/valuation data yields `unavailable`, not an invented zero.

**Redeemable cash**: a position must remain redeemable with positive estimated payout for at least 6 hours and be worth at least $5 before a `💰 CLAIM` reminder is emitted for the wallet. The same token can be reminded no more often than every 24 hours. All qualifying tokens in a wallet are grouped into a single alert per poll. Loss outcomes with zero payout are not advertised as reclaimable cash. Existing wallets seed new tracking state on rollout, preventing a wave of historical notices.

**Market price risk**: current, open, non-dust holdings from the Data API are monitored on the existing 5-minute poll. A risk event occurs when the *observed reference price* crosses below 0.90; or falls at least 5% below the wallet's average entry price; or falls by at least $0.05 in one successful polling interval. Multiple reasons per token and multiple tokens per wallet are grouped in one risk message, with a 24-hour per-token cooldown. On upgrade, observed marks silently initialize their baseline. These are price-based triggers, not executable order prices or liquidation advice.

Default Wrangler text vars:

- `DAILY_REPORT_ENABLED=true`
- `REDEEM_REMINDER_ENABLED=true`, `REDEEM_DELAY_HOURS=6`, `REDEEM_COOLDOWN_HOURS=24`, `MIN_REDEEM_USD=5`
- `RISK_ALERT_ENABLED=true`, `PRICE_ALERT_FLOOR=0.90`, `COST_DRAWDOWN_PCT=5`, `RAPID_DROP_POINTS=0.05`, `RISK_COOLDOWN_HOURS=24`

The default public `GET /health` still provides no personal portfolio values. New internal DO-only `/digest-snapshot`, `/digest-state`, `/digest-enqueue` routes are not exposed by the Worker's public HTTP routing. Existing protected `/status`, `/test` and `/poll` are unchanged. New storage fields only extend existing wallet DO state; no wallets, secrets, transaction permissions or checkpoints are reset.

## Tests

```bash
node workers/wallet-monitor/test.mjs
node workers/wallet-monitor/test-digest.mjs
```

## 自动赎回钱包通知策略（2026-10-24）

- 默认 `REDEEM_REMINDER_ENABLED=false`：停用“可赎回超过 6 小时”的 CLAIM 催办，适合已经自动赎回的钱包。该机制仍可按需手动开启。
- 新的 `REDEEM` 活动继续触发通知：当 Data API 返回正数 `usdcSize`，标题展示 `💰 已赎回 · <钱包名称> · $到账金额`，正文继续包含市场、选择、份数、活动报告的赎回到账金额与链上钱包余额。
- 零回款标为“零回款赎回”，没有可核实的金额则标为“赎回记录（到账待核实）”，不会误报已到账正数金额。
- WIN / LOSS / PARTIAL 结算结果仍按原机制单独提醒，不能取代链上实际赎回。日报保留“待赎回金额”作为统计，不再因此触发催办推送。
- 已持久化的交易去重记录和 Outbox 保留；不重置任何钱包状态，不更改 Cron 频率。


## 2026-10-24: Data API v2 主接口切换（旧版接口退役）

Polymarket 数据 API v1 官方迁移时间表标注 2026-10-24 退役。此 Worker 现已支持独立 `DATA_API_PRIMARY=v2` 主数据读取，且原 v1 读取逻辑保留为临时回滚选项。

- `DATA_API_PRIMARY=v2`：核心仓位查询走 `/v2/positions`，核心买卖/实际赎回查询走 `/v2/activity`。接口使用标准 `{data,pagination}`、`pagination.next_cursor` 游标分页，禁止旧 `offset`；429/503 重试沿用原 `data-client.mjs`。
- 字段适配：`token_id -> asset`、`current_size -> size`、`avg_price -> avgPrice`、`current_price -> curPrice`、`total_cost_usdc -> grossInitialValue`、`entry_cost_usdc -> initialValue`、`usdc_size -> usdcSize`、`transaction_hash -> transactionHash`，保留费用字段和市场标题、选项信息。
- `current_size` 是剩余份数，`total_size` 是累计买入份数，绝不能混用。缺失的仓位数量、活动身份、或游标异常直接失败，不当作零仓位并推进 checkpoint。
- 新老版本迁移第一轮，对已有 Durable Object 的近 60 分钟已通知事件按交易哈希、资产、方向、成交份数及时间进行兼容去重。旧队列、历史检查点、钱包标签、持仓快照和审计字段均不重置。
- 进入 v2 的第一轮，风险价格监控只更新当前基线，不把新旧来源的参考价格差异误报为风险事件。
- 原 `V2_SHADOW_ENABLED` 只用于 v1 主接口与 v2 并行对照；v2 已为主接口时自动跳过重复影子读取。
- 若需要快速回滚，仅可把 `DATA_API_PRIMARY` 改为 `v1`（前提是旧 API 尚可用）。不建议长期回滚到即将退役的 v1；应优先修复 v2。
- 测试：`node workers/wallet-monitor/test-v2-primary.mjs`，包括多页游标、旧事件桥接去重、真实 BUY/ADD/WIN/REDEEM、无损 checkpoint 以及异常数据失败保护。

## 低 Mark APY / 可考虑卖出提醒

- 默认开启：`LOW_APY_ALERT_ENABLED=true`。
- 触发阈值：`LOW_APY_THRESHOLD_PCT=10`。
- **触发依据改为 Mark / Current APY**：使用 Data API 的 `curPrice` 计算机会成本，`APY = (1 / curPrice)^(365 / remainingYears) - 1`。
- 通知同时展示 **Mark APR（简单年化）**，用于和 Dashboard 现有的持有 APR 口径对照；APR 不参与触发。
- CLOB **Best Bid APY 只用于说明真实退出条件**，不再决定是否发提醒。
- 若 Mark APY 低于阈值，即使 CLOB 暂时不可用，也仍会提醒，并把可执行价标为暂不可用。
- 恢复门槛：`LOW_APY_RECOVER_PCT=12`。触发后只有 Mark APY 恢复到 12% 以上才重新武装。
- 检查频率：`LOW_APY_CHECK_MINUTES=30`；Wallet Monitor 本身仍每 5 分钟轮询。
- 重复提醒冷却：`LOW_APY_COOLDOWN_HOURS=24`。
- 延续 `MIN_POSITION_USD=5` 过滤小仓位。
- 推送包含：钱包、市场/方向、Mark 价、Mark APY、Mark APR、持仓价值、Best Bid、可执行 APY/APR、买一深度、持仓数量、均价和预计结束日期。
- 日期型 `endDate` 按美东当天结束估算，与 Dashboard 的结算日口径保持一致。
- 买一价只代表当前第一档；若买一深度不足，整笔卖出的实际均价可能更低。
