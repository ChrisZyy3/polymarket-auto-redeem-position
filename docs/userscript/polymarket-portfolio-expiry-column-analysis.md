# Polymarket 页面插件方案评估

## 归档来源

- 历史 v0.4.6/v0.6.2 脚本文件已删除，本文件保留其分析记录。
- 当前推荐脚本：`userscripts/polymarket-portfolio-apr-overlay-v0.10.0.user.js`。

## 结论

这份 v0.6.2 可以作为 Tampermonkey 原型的基础，但不能直接满足“在 Polymarket dashboard 每个仓位显示继续持有 APR 和初始建仓 APR”的需求。

它当前完成的是：

1. 在 `polymarket.com` 页面拦截部分 `fetch` 响应，尝试发现 `proxyWallet`；
2. 通过 `data-api.polymarket.com/positions` 拉取当前仓位；
3. 用 slug、标题文本和页面中 `Sell` 按钮的顺序定位页面行；
4. 在行尾注入一个到期日文本。

它没有完成的是：

- 没有计算 APR 或 APY；
- 没有使用 `avgPrice` 计算建仓口径；
- 没有使用 `curPrice` 计算继续持有口径；
- 没有显示列标题、风险状态、异常原因或刷新时间；
- 没有记录真实的建仓时间，因此不能仅凭当前持仓接口还原“从实际建仓时刻开始”的历史 APR。

## 与当前项目算法的对应关系

当前项目中真正同时计算两种指标的是 `lib/apr.ts`，而不是只计算持有 APR 的旧版 `src/apr.ts`。

对于一个仍在持有的、会在结算时获胜并兑付 1 美元的 outcome，项目算法是：

```text
继续持有 ROI = (1 - curPrice) / curPrice
建仓口径 ROI = (1 - avgPrice) / avgPrice
APR = ROI × 365 / 剩余结算天数
```

项目还把日期解释为美东时间当天结束，并处理了夏令时。对应字段为：

| 页面显示 | 数据字段 | 项目字段 | 含义 |
|---|---|---|---|
| 继续持有 APR | `curPrice`、`endDate` | `holdApr` | 现在以当前市价买入并持有到结算的简单年化收益率 |
| 初始建仓 APR | `avgPrice`、`endDate` | `costApr` | 以当前持仓的加权平均成本计算的同一结算期限年化收益率 |
| 继续持有 ROI | `curPrice` | `holdRoi` | 当前买入价格到结算兑付 1 美元的收益率 |
| 建仓口径 ROI | `avgPrice` | `costRoi` | 加权平均建仓成本到结算兑付 1 美元的收益率 |

这里的“初始建仓 APR”需要特别命名清楚：`costApr` 是“按历史平均买入价、以现在剩余期限重新年化”的比较指标，不是真正的历史 realized APR。若要计算真实建仓 APR，还需要每笔 BUY/SELL 的时间、价格、数量以及部分卖出和手续费等历史数据。

## 现有脚本的可复用部分

- `@match https://polymarket.com/*` 适合做页面注入。
- `GM_xmlhttpRequest` 加 `@connect data-api.polymarket.com` 适合从 userscript 读取跨域公开数据。
- `normalizePosition` 的兼容字段思路可保留，但正式版本应优先依赖官方响应字段。
- `data-api.polymarket.com/positions?user=...` 是正确的数据方向，官方接口返回 `proxyWallet`、`asset`、`conditionId`、`size`、`avgPrice`、`curPrice`、`endDate` 等字段。
- MutationObserver 可以继续用于处理 Polymarket 的动态渲染，但不应把页面行顺序当作数据主键。

官方资料：

- [Get current positions for a user](https://docs.polymarket.com/api-reference/core/get-current-positions-for-a-user)
- [Get trades for a user or markets](https://docs.polymarket.com/api-reference/core/get-trades-for-a-user-or-markets)
- [Get user activity](https://docs.polymarket.com/api-reference/core/get-user-activity)

## 不能原样使用的地方

### 1. 核心指标缺失

脚本只把 `endDate` 格式化为文本，没有调用 `calcApr` 或等价逻辑。因此它无法支持用户最关注的两列 APR。

### 2. 通过任意 JSON 响应递归找钱包地址不够可靠

`findProxyWallet` 会在多个 Polymarket JSON 响应中递归寻找第一个看起来像地址的字段。一个页面请求可能包含市场参与者、其他用户或嵌套对象，不能保证第一个地址就是当前用户的 profile/proxy wallet。

更稳妥的顺序应是：

1. 优先从当前页面明确的 profile 地址或页面持仓响应取得地址；
2. 允许用户在插件设置中手动指定地址；
3. 只把通过 EVM 地址校验的地址交给 `/positions`；
4. 不要扫描 LocalStorage 中所有包含 `0x` 的字符串。

### 3. 页面行定位依赖标题和顺序，容易错位

脚本使用 slug、标题前 20 个字符和第 `i` 行兜底。页面排序、筛选、虚拟滚动、重复标题或多个 outcome 都可能导致 APR 被显示到错误的持仓上。

正式版本应优先使用：

- `asset` 或 token id；
- `conditionId + outcomeIndex`；
- 页面链接中的 slug 只作为辅助匹配；
- 永远不要把数组序号作为最终主键。

### 4. 缓存更新条件会保留旧数据

脚本仅在新响应的持仓数量大于等于旧缓存数量时更新。持仓数量减少时，价格和 APR 可能继续显示旧值。APR 插件必须按地址和仓位主键替换整份快照，不能按数组长度判断新旧。

### 5. 没有分页

请求固定 `limit=500`。500 是单次上限；如果地址有更多仓位，应继续使用 `offset` 拉取后续页面。

### 6. 监听和拦截范围过宽

脚本通过 `url.includes(domain)` 判断白名单，严格性不如解析 URL 后比较 `hostname`。此外，重写全局 `fetch` 并克隆所有白名单 JSON 响应会产生额外开销，也会增加与 Polymarket 前端实现变化的耦合。只为计算 APR 时，没有必要拦截页面 fetch；直接定时调用公开 Data API 更简单。

### 7. 改写原生行的 display 可能破坏布局

脚本把部分行强制设置为 `display:flex`，这可能破坏原页面的 grid、table 或响应式布局。更稳妥的展示方式是插入一个带 Shadow DOM 的独立面板，或在确定的单元格内追加受控元素。

## Tampermonkey 还是浏览器扩展

### 建议路线：先 Tampermonkey，后 MV3 扩展

对于当前目标——自己在 Polymarket 页面上验证指标口径和展示效果——优先用 Tampermonkey：

- 安装和迭代最快；
- 可以直接注入现有页面；
- 公开 Data API 读取不需要后端；
- 适合先验证“APR 是否真的有决策价值”。

当需要以下功能时，再升级为 Chrome/Edge Manifest V3 扩展：

- popup/side panel 设置；
- 多钱包和本地配置；
- 稳定的后台轮询和缓存；
- 独立的 Shadow DOM UI；
- 发布给其他用户；
- 与 dashboard、通知和后续交易辅助功能统一。

MV3 版本建议拆成：

```text
content script       读取页面状态、渲染 APR 标签/面板
service worker       定时拉取 API、缓存、消息分发
shared apr core      与当前项目共享 calcApr 纯函数
popup/side panel     阈值、语言、地址、刷新周期设置
storage              保存用户设置，不保存私钥
```

Chrome 扩展需要在 Manifest V3 中声明 content script 的页面匹配和对 Data API 的 host permission；官方文档说明跨域请求需要相应 host permission，`chrome.scripting` 也需要 scripting 权限和页面 host permission。

官方资料：

- [Declare permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)
- [Cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
- [chrome.scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [Manifest V3](https://developer.chrome.com/docs/extensions/mv3/manifest)

## 推荐的第一版功能边界

第一版先做只读监控，不做自动交易和自动签名：

1. 获取当前 profile/proxy wallet；
2. 分页拉取当前仓位；
3. 复用 `lib/apr.ts` 的日期和 APR 逻辑；
4. 每个 outcome 显示 `Hold APR`、`Entry APR`、剩余天数、当前价格、平均成本和状态；
5. APR 低于阈值、当前价格低于风险阈值、已过结算日等情况单独标记；
6. 15–30 秒刷新一次，并显示“数据更新时间”和失败状态；
7. 通过 Shadow DOM 或独立浮层避免污染 Polymarket 原生布局；
8. 用 `asset` 或 `conditionId + outcomeIndex` 做匹配；
9. 把 APR 核心逻辑抽成浏览器可复用 bundle，避免 userscript 和 dashboard 各自维护一份公式。

如果以后加入买入、卖出或赎回，必须让用户的钱包弹窗明确签名；不要在插件中保存私钥，也不要把“低 APR”直接等同于“无风险”。Polymarket 的 outcome 仍然有方向性、结算、流动性、价格冲击和智能合约等风险。

## 最终判断

这份代码的定位是“到期日注入脚本”，不是“Pendle 风格的 Polymarket 收益率插件”。可以复用它的 API 访问和页面注入思路，但应重写：

- 数据获取；
- APR 计算调用；
- 仓位主键匹配；
- UI 注入层；
- 缓存和刷新机制。

当前项目的 dashboard 已经有 `holdApr` 和 `costApr` 的服务端返回与表格展示，所以最快的产品化路径是：先把同一套纯计算逻辑打包进 Tampermonkey userscript，验证页面内 overlay；验证稳定后再迁移为 MV3 扩展。

## 当前 APR 浮层版（v0.10.0）

已维护 `userscripts/polymarket-portfolio-apr-overlay-v0.10.0.user.js`，主要变化：

- 不再依赖递归扫描任意 JSON 响应来猜地址；
- 支持从页面 URL/页面请求自动捕获地址，也支持在浮层手动输入；
- 直接分页读取 `data-api.polymarket.com/positions`；
- 复用当前项目的美东结算日和 `holdApr`/`costApr` 口径；
- 用 Shadow DOM 独立浮层显示仓位，不修改 Polymarket 原生行布局；
- 支持最小仓位、APR 阈值、风险价格阈值和状态筛选；
- 设置会保存在 Tampermonkey storage 中，页面刷新后仍保留。
- 浮层可以收起为单个 `%` 图标，图标和展开后的标题栏都支持拖动，位置会保存。
- 浮层的点击、指针按下/抬起、应用、刷新、收起和拖动都会输出 `[PM APR]` 诊断日志。
- 普通点击不会提前捕获指针，只有移动超过 4px 后才进入拖动，避免图标点击被标题栏拦截。
- 所有数据列表头支持升序、降序和取消排序，排序列显示 `↑/↓`，排序状态会保存。

使用方法：在 Tampermonkey 中新建脚本，把 `userscripts/polymarket-portfolio-apr-overlay-v0.10.0.user.js` 全文复制进去；打开 `/portfolio` 或 `/profile`。若没有自动识别地址，在浮层输入 Profile/Proxy Wallet 地址后点击“应用”。

## v0.10.0 价格路径列

油猴脚本和网页端 dashboard 已将“建仓均价”和“当前价”合并为一个可排序列：

- 展示格式为 `建仓价 → 当前价`，价格值统一乘以 100，例如 `$98 → $99`；
- 油猴脚本点击该列时按当前价排序，继续支持升序、降序和取消排序；
- 网页端使用同一展示格式，并按当前价参与表格排序；
- 油猴脚本会将旧版本保存的 `当前价`/`建仓均价`排序状态迁移到合并列。

网页端在首次点击“查询分析”之前也会保留完整 dashboard 框架：指标卡、历史指标、历史曲线和仓位表格均显示占位状态，表格提示输入钱包地址后再查询；查询中则显示加载状态。

网页端仓位表格还将“持有收益金额”和“持有收益率”合并为一个可排序列，展示为 `+$100 (+0.5%)`；该列按持有收益金额排序。
