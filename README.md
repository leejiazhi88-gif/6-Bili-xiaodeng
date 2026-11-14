# 成长指数研究仪表盘

这个工程模仿 `Bili Atotal / BigA-total` 的结构与视觉风格，但总览指数改为：

- 创业板指：`399006.SZ`
- 科创50：`000688.SH`
- 科创综指：`000680.SH`

GitHub 仓库：https://github.com/leejiazhi88-gif/6-Bili-xiaodeng

线上页面：https://leejiazhi88-gif.github.io/6-Bili-xiaodeng/

长期维护以本 GitHub 仓库为准，不依赖固定本地目录。换电脑后从仓库获取项目，完成更新后将同一提交同步到 `main` 和 `gh-pages`；后者用于 GitHub Pages 发布。在线 URL 固定如上，页面本身不是可直接编辑的源码。数据刷新需要另行配置 Tushare 凭据，不要将凭据提交到仓库。详见 `HANDOFF.md`。

目前包含：

- 总览：价格图可通过曲线图例选择展示三个指数，PE 合图对比；创业板指与科创综指的真实利润合图；交易规模按三个指数分别呈现
- 单图叠加创业板指、科创50、科创综指的估值曲线：PE(TTM)、PE历史分位等；PE曲线仍按7天显示代表点，历史分位则以所选时段内全部有效交易日PE计算；缺失的连续PB不补造
- 情绪-散户模块：图外统一选择沪深两市与三个指数曲线，选择在全部指标页签间生效；成交额与成交量同轴对比，两市成交量采用上证综指与深证综指成交量之和作为宽基代理。换手率使用周频原值，创业板指和科创50取 Tushare 指数每日换手率，科创综指按当期成分股流通市值加权；指数融资余额汇总当期成分股融资余额，融资占比用融资余额除以成分股流通市值。所有可选指标均按每周最后一个交易日取点；时间轴从 2005 年开始，缺失历史不补造
- 情绪-大资金模块：图外统一选择全市场与三个指数曲线，选择在全部指标页签间生效。前三个页签按当期指数成分股归集大宗交易额、机构大宗净买入额、产业资本净增减持金额，四条线同为亿元；北向资金净流入页签已移除。北向持仓分布另按季度展示三个指数成分股的北向持仓市值，或切换为占各指数成分股总市值的比例。主动基金仓位与持仓集中度来自半年报/年报完整持仓样本，ETF份额为跟踪三个指数的ETF周度存量。缺失历史不补造
- 情绪-官方模块：仅保留IPO融资额、再融资额、重要股东净减持额三个页签，均以亿元展示。外层开关跨页签保留选择，黄色曲线按实际范围和指标命名；IPO和再融资按发行时上市板块分为全市场、创业板、科创板，三个页签共用外层范围选择；重要股东净减持额按整个上市板块汇总同批公告金额，含非指数成分股；官方不显示科创50。不绘制指数价格对照。

成交额、成交量、换手率，以及大宗交易额、机构大宗净买入、产业资本净增减持六个页签支持“原数据 / 7点均线 / 30点均线”。默认显示原数据；各曲线按当前采样点及此前6个或29个采样点求算术平均，不按自然日、不使用未来点。未满窗口或窗口内有缺失值时留空，真实零值和负值正常计入；先计算完整历史再裁剪显示范围。计算口径放在各页签图表下方的默认折叠说明内。

## 运行

刷新数据并生成页面（使用本机已配置的 Tushare 凭据）：

首次运行先安装依赖：`python -m pip install -r requirements.txt`。Windows PowerShell 中按本机 Python 安装情况使用 `python` 或 `python3`；当前电脑由 Codex 自带 Python 环境运行。

```bash
node work/build_market_dashboard.js
```

这是**日常更新入口**：按依赖最多两个抓取任务并行，更新行情、估值、利润、散户、大资金、ETF和官方数据后生成页面。基金半年报/年报沿用已有已核实报告，启动时输出真实报告期、待核验期，不改写基金核验时间。

基金完整持仓核验单独执行；有新报告或需要复核历史时使用：

```bash
node work/build_market_dashboard.js --reports
```

此入口只重核到期的基金报告并重建页面，不重复跑当天行情。基金接口单期可能返回上百万条持仓，仍需数分钟；它不再阻塞日常行情发布。每完成一期即保存，失败重试保留已完成的报告期。持仓分页最多两页并行，按原顺序处理，每10页输出进度。不会跨次保存可移动的 offset 页，以免上游新增记录造成漏页或重复。

只查看基金待核验状态（不使用凭据、不请求网络）：

```bash
python3 work/fetch_large_money_fund_reports.py --status
```

单个抓取脚本仍可独立运行。默认流程不会自动创建后台任务；待核验基金报告需通过上述报告入口完成。

各脚本自动使用运行当天作为查询截止日；实际数据日期以接口最新披露为准。事件库仅保留原始文件，不在页面展示。

### 增量刷新与全量核验

日常使用 `node work/build_market_dashboard.js`，完整基金核验使用 `--reports`。默认策略如下：

| 数据 | 日常刷新策略 |
| --- | --- |
| 三指数行情、PE/PB | 从已保存的最后交易日向前回看90天，按日期合并修订；首次无缓存时拉完整历史 |
| 科创综指官方历史PE | 同样回看90天，合并后保留更早历史，并继续核对官方单张 |
| ETF份额 | 每只基金保留原始日份额；从上次成功查询截止日回看90天，补齐至今天。新基金首次拉历史，仍包含退市基金 |
| 指数利润 | 同日复用；跨日按最近90天公告窗口逐股查询，与旧报告期合并。成功请求立即暂存，失败后同日重试只补缺失股票；参数或日期变化重新查询，全批成功才更新正式缓存 |
| 基金仓位/集中度 | 日常入口复用已核实报告并列出待核验期。单独的 `--reports` 按以下间隔重核：报告期结束后90天内每日，之后最近两期每7天，更早历史每30天；未到期直接跳过 |
| 散户、指数成分及其他按年/月查询的接口 | 最近90天涉及的查询窗口照常更新（按年接口可能回拉整个当年）；更早窗口缓存30天，到期重新核验 |
| 北向持仓 | 日常补缺失季度；使用全量入口重核已有季度 |
| 官方月度指标、再融资、官方单张 | 官方融资和股东公告回查当年、宏观保留完整查询；首次升级补齐历史分项，以后保留历史合并；达到接口行数上限则拆分查询，避免截断 |

原始请求缓存位于 `work/.refresh-cache/`，不包含凭据、不提交Git。换电脑或清空缓存后，首次运行需要建立历史缓存，会比之后慢；已提交的图表历史仍保留。基金核验时间写入结果元数据，只有成功完成该报告期才更新；失败不冒充完成。涉及增量缓存的写入使用临时文件原子替换。

较早历史可能出现超过90天的修订，因此另保留全量核验入口，建议每月或怀疑历史修订时运行：

```bash
node work/build_market_dashboard.js --full
```

也可对单个脚本执行 `python3 work/fetch_large_money_etf_shares.py --full` 等命令。全量入口绕过历史请求缓存，重拉行情、ETF、财报等历史，并重核已有基金和北向报告期。此命令不会自动创建后台定时任务；日常运行中的历史请求缓存会按有效期复核；基金报告通过独立的 `--reports` 入口按上述间隔核验。`--cached` 只重建页面，不请求数据。

回看窗口内新旧同键记录以新值覆盖，旧窗口历史不裁掉；上游报错时终止该刷新步骤，不用零填补失败。所选刷新模式遇到错误会停止生成页面，等待已运行的数据任务退出，不启动剩余任务；不会将失败当成刷新成功。

每次刷新输出各任务耗时，并将模式、完成/失败状态和实际耗时写入 `work/.refresh-cache/last-refresh.json`，用于定位慢接口。任务依赖包括行情→估值、官方单张→官方历史校验、散户→指数指标、大资金→ETF。一个构建进程最多同时执行两个抓取脚本，已有的单脚本线程限制仍保留。刷新锁防止两个入口同时写部署文件。

利润暂存位于 `work/.refresh-cache/income-pending/`，不含凭据、不提交Git；仅同日同股票同查询参数可复用，次日清理旧暂存，`--full` 绕过暂存。基金成功完成的报告及真实核验时间保存在可同步的输出JSON中，换电脑仍能跳过未到期报告。

仅使用缓存重新生成页面：

```bash
node ./work/build_market_dashboard.js --cached
```

本地预览：

```bash
node ./work/preview_server.js
```

然后打开：

```text
http://127.0.0.1:9876
```

## 主要文件

- `outputs/growth_indices_dashboard.html`：生成后的仪表盘
- `index.html`：和输出页同步的根页面
- `work/build_market_dashboard.js`：总览生成入口
- `work/fetch_market_overview_data.py`：总览价格、PE(TTM)数据更新脚本
- `work/fetch_star_official_valuation.py`：中证指数官方科创综指估值单张抓取脚本
- `work/star_official_valuation.json`：官方估值快照及来源记录
- `work/fetch_star_official_history.py`：中证指数官方科创综指历史 PE 抓取及单张核对
- `work/star_official_history.json`：科创综指官方 PE 日频序列
- `work/fetch_index_profit_data.py`：指数成分股归母净利润 TTM 汇总脚本
- `work/index_profit_data.json`：真实利润数据缓存
- `work/market_overview_data.json`：总览数据缓存
- `work/fetch_retail_index_metrics.py`：按周计算指数换手率、融资余额、融资占比和涨停家数
- `work/retail_index_metrics.json`：上述指数指标缓存
- `work/fetch_large_money_fund_reports.py`：主动基金半年报仓位与前十大持仓集中度
- `work/large_money_fund_reports.json`：基金样本历史数据和覆盖率
- `work/fetch_large_money_etf_shares.py`：三个指数跟踪ETF的周度份额汇总
- `work/large_money_etf_shares.json`：ETF份额历史缓存
- `work/fetch_northbound_index_holdings.py`：季度末北向持仓按三个指数成分归集，并计算持仓市值占指数成分总市值的比例
- `work/northbound_index_holdings.json`：北向指数持仓季度缓存
- `work/add_valuation_module.js`：估值模块注入脚本
- `work/fetch_valuation_data.py`：PB、股债收益差数据更新脚本
- `work/valuation_data.json`：估值扩展数据缓存
- `work/fetch_official_sentiment_data.py`：官方情绪连续数据更新脚本
- `work/official_sentiment_data.json`：官方情绪连续数据缓存
- `work/official_sentiment_events.json`：保留的历史事件原始文件，页面不展示
- `work/add_official_sentiment_module.js`：官方情绪模块注入脚本

## 数据口径

- 创业板指价格与 PE(TTM)：来自 Tushare `index_daily` / `index_dailybasic`
- 科创50价格、PE(TTM)、PB：来自 Tushare `index_daily` / `index_dailybasic`
- 科创综指价格：来自 Tushare `index_daily`
- 科创综指 PE(TTM)：来自[中证指数官方历史行情](https://www.csindex.com.cn/csindex-home/perf/index-perf?indexCode=000680&startDate=20191231&endDate=20261030)中的滚动市盈率字段。当前有效序列始于 2024-10-23；与[中证指数官方单张](https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/indices/detail/files/zh_CN/000680factsheet.pdf)同日数据交叉核对，不填补更早缺失日期。两者均非 Tushare 口径，不能直接比较绝对倍数。
- 科创综指 PB：仍仅来自中证指数官方单张的月末快照；抓取副本保存在 `work/sources/`
- 时间轴默认展示全部可用历史，并标出板块开市日。创业板 2009-10-30 开市，但创业板指以 2010-05-31 为基日；科创板 2019-07-22 开市，但科创50和科创综指均以 2019-12-31 为基日。板块开市和指数起点不是同一天，开市至基日之间不填造指数价格。
- 真实利润：指数成分股归母净利润 TTM 汇总，单位亿元
- PB：来自 Tushare 指数每日指标
- 指数交易热度：来自各指数自身的 Tushare `index_daily` 成交额与成交量，不代表散户独占交易；全市场背景来自 `daily_info`，2005 年起沪市 A 股与深市市场口径、2019 年起沪深市场口径。
- 大资金前三个页签按 Tushare `index_weight` 月度成分股名单归集交易或公告当期的真实金额；创业板指自 2010-07、科创50自 2020-08、科创综指自 2025-02 起有可核对的成分归集。北向净流入历史数据仅保留缓存，页面不展示；官方模块IPO及再融资按上市板块汇总，重要股东净减持也按整个上市板块归集；新增北向持仓分布页签则按季度成分股归集持仓市值，分母为同日成分股总市值，不代表净流入。全市场大资金从 2002 年开始；官方 M2 同比从 1991 年 12 月、社融从 2002 年开始；IPO及印花税率从已核对的 2008 年口径开始。北向资金旧口径只保留至 2024-08-16。
- 大资金大宗交易仅统计 A 股股票代码，排除债券等非股票记录；股东增减持仅统计有成交均价的股票记录，排除无价格的股权划转，金额为变动股数乘披露均价。`work/large_money_index_data.json` 保存三个指数的周度归集值。需要从原始接口完整重建历史时可运行 `python work/fetch_large_money_sentiment_data.py --full`。
- 股债收益差：`100 / PE(TTM) - 10年期国债收益率`；当前 Tushare 凭据没有国债收益率接口权限，故无可靠连续数据，页面入口暂时禁用。
- IPO发行金额：来自 Tushare `new_share` 发行股数×发行价，优先按发行日期所属月份汇总，发行日期缺失时使用上市日期
- 产业资本净减持额：来自 Tushare `stk_holdertrade` 重要股东增减持公告，按成交均价估算，正值为净减持
- 历史政策利率缓存：来自 Tushare `shibor_lpr`；1年期LPR页签已移除
- 历史社融 / M2缓存：来自 Tushare `sf_month` / `cn_m`；两个页签已移除
- 历史印花税率缓存：手工维护的政策表；印花税率页签已移除

注意：截至当前接口返回，Tushare 暂未提供 `000680.SH` 科创综指的 `index_dailybasic` PE/PB 序列。科创综指官方历史 PE 只从接口实际可得的日期开始；PB 单张比交易日数据更新慢，页面需按披露日期识别时效。真实利润仍使用成分股利润表汇总。

再融资额使用东方财富已实施增发、配股逐笔发行金额，全市场和两板块同源归集。历史自2008年起，增发按发行日期、配股按缴款截止日归月，仅已结束月。包含非现金资产认购及换股合并，不等于现金融资或二级市场流出；不含首次发行、可转债。与此前同花顺月表的日期和覆盖口径不同，数值可能变化，不拼接历史。

`work/fetch_refinancing_data.py` 核对源分页总数和发行事件编号，结合Tushare初始上市日期剔除首次发行。发行金额优先采用TOTAL_RAISE_FUNDS（元），缺失时按实际股数×发行价计算。日常增发回看180天，配股全量；`--full`全量重取。`work/refinancing_issuance_records.json`保存逐笔记录、计算来源及剔除事件，`work/refinancing_data.json`保存月度汇总。异常不覆盖已发布缓存；旧同花顺脚本仅保留为`work/legacy_refinancing_ths.py`供历史核对。

北向净流入历史按每日 `north_money` 求周合计（百万元除以100换算亿元），不是每周最后一天值。该历史数据仅保留用于追溯，不在页面提供页签；周六仅是统一周标签。原始日序列保存于 `work/northbound_daily_data.json`。仅修复/刷新此序列可运行 `python3 work/fetch_large_money_sentiment_data.py --north-only`。

官方金额计算在 `work/official_metrics.py`：IPO缺发行股数或发行价的月份留空；重要股东仅计披露均价记录，并保留计价覆盖条数。净减持分项按股票代码所属上市板块汇总，包含非指数成分股，不依赖历史指数名单；科创板设立前留空。三个融资/股东页签均已移除价格基准100和右轴；未结束月的融资/公告额标明截至当日累计。

IPO采用发行总股数×发行价格的发行总额口径（未扣费用，若含老股转让不等于公司净募资），不直接采用部分历史记录中与上市公告书不一致的funds字段。按原始发行记录的股票代码和交易所归属创业板/科创板，不以当前指数成分名单回溯，不因调样或退市删除历史发行。源明细保存在`work/ipo_issuance_records.json`，金额字段核对依据在`work/ipo_listing_overrides.json`；不将科创50重复列为上市板块。
