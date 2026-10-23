# Polymarket 每分钟地址提醒

独立的 Cloudflare Worker，不依赖 Dashboard、Vercel 或钱包私钥。

支持每分钟监控多个钱包，每个钱包独立持久化检查点、待发通知和去重状态。
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

wrangler.json 已设置 3 个默认钱包地址、$5 仓位门槛、每分钟 Cron、SQLite Durable Object 绑定和迁移。
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

部署后查看 Workers Logs 确认没有持续错误。数据或推送失败会抛出错误并记录日志，
后续 Cron 重试。监控自身停机不能依靠同一个推送服务保证通知，必要时另配外部可用性监控。

## 去重与重试

每个钱包使用一个 Durable Object，合并同一实例内重叠的检查请求。
活动按交易哈希、类型、结果 token、方向、时间、金额、价格等字段去重；
一笔链上交易中的不同结果不会只因哈希相同而被丢弃。

活动从上次检查点向前重查 15 分钟，处理常见索引延迟；超过该窗口才被索引的记录可能漏报。
断线期间检查点不前进，恢复后从上次检查点补查；分页超限会明确失败，
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
