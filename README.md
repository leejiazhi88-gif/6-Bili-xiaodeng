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
- 单图叠加创业板指、科创50、科创综指的估值曲线：PE(TTM)、PE历史分位等；缺失的连续PB不补造
- 情绪-散户模块：图外统一选择沪深两市与三个指数曲线，选择在全部指标页签间生效；成交额与成交量同轴对比，两市成交量采用上证综指与深证综指成交量之和作为宽基代理。换手率使用周频原值，创业板指和科创50取 Tushare 指数每日换手率，科创综指按当期成分股流通市值加权；指数融资余额汇总当期成分股融资余额，融资占比用融资余额除以成分股流通市值。所有可选指标均按每周最后一个交易日取点；时间轴从 2005 年开始，缺失历史不补造
- 情绪-大资金模块：图外统一选择全市场与三个指数曲线，选择在全部指标页签间生效。前三个页签按当期指数成分股归集大宗交易额、机构大宗净买入额、产业资本净增减持金额，四条线同为亿元；北向净流入历史页签以全市场净流入对照指数价格。北向持仓分布另按季度展示三个指数成分股的北向持仓市值，或切换为占各指数成分股总市值的比例。主动基金仓位与持仓集中度来自半年报/年报完整持仓样本，ETF份额为跟踪三个指数的ETF周度存量。缺失历史不补造
- 情绪-官方模块：一张图中只绘一条所选共同政策指标（IPO融资额、产业资本净减持额、印花税率、LPR、社融增量或M2增速），并叠加三个指数的相对走势；左轴为政策原值，右轴以 2020-01-07 为 100

## 运行

刷新数据并生成页面（使用本机已配置的 Tushare 凭据）：

首次运行先安装依赖：`python -m pip install -r requirements.txt`。Windows PowerShell 中按本机 Python 安装情况使用 `python` 或 `python3`；当前电脑由 Codex 自带 Python 环境运行。

```bash
python3 ./work/fetch_market_overview_data.py
python3 ./work/fetch_star_official_valuation.py
python3 ./work/fetch_star_official_history.py
python3 ./work/fetch_valuation_data.py
python3 ./work/fetch_retail_sentiment_data.py
python3 ./work/fetch_retail_index_metrics.py
python3 ./work/fetch_large_money_sentiment_data.py
python3 ./work/fetch_northbound_index_holdings.py
python3 ./work/fetch_large_money_fund_reports.py
python3 ./work/fetch_large_money_etf_shares.py
python3 ./work/fetch_official_sentiment_data.py
python3 ./work/fetch_index_profit_data.py
node ./work/build_market_dashboard.js --cached
```

各脚本自动使用运行当天作为查询截止日；实际数据日期以接口最新披露为准。财报缓存跨日运行时重新获取，避免漏掉新披露财报。事件库仅保留原始文件，不在页面展示。

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
- 大资金前三个页签按 Tushare `index_weight` 月度成分股名单归集交易或公告当期的真实金额；创业板指自 2010-07、科创50自 2020-08、科创综指自 2025-02 起有可核对的成分归集。北向净流入历史页签与官方模块的三指数线仍为价格走势；新增北向持仓分布页签则按季度成分股归集持仓市值，分母为同日成分股总市值，不代表净流入。全市场大资金从 2002 年开始；官方 M2 同比从 1991 年 12 月、社融从 2002 年开始；IPO及印花税率从已核对的 2008 年口径开始。北向资金旧口径只保留至 2024-08-16。
- 大资金大宗交易仅统计 A 股股票代码，排除债券等非股票记录；股东增减持仅统计有成交均价的股票记录，排除无价格的股权划转，金额为变动股数乘披露均价。`work/large_money_index_data.json` 保存三个指数的周度归集值。需要从原始接口完整重建历史时可运行 `python work/fetch_large_money_sentiment_data.py --full`。
- 股债收益差：`100 / PE(TTM) - 10年期国债收益率`；当前 Tushare 凭据没有国债收益率接口权限，故无可靠连续数据，页面入口暂时禁用。
- IPO融资额：来自 Tushare `new_share` 新股上市募集资金，月度汇总
- 产业资本净减持额：来自 Tushare `stk_holdertrade` 重要股东增减持公告，按成交均价估算，正值为净减持
- 政策利率：来自 Tushare `shibor_lpr`，页面默认展示 1年期 LPR
- 社融 / M2：来自 Tushare `sf_month` / `cn_m`
- 印花税率：手工维护的政策表，当前覆盖 2008 年下调、2008 年单边征收、2023 年减半征收等关键节点

注意：截至当前接口返回，Tushare 暂未提供 `000680.SH` 科创综指的 `index_dailybasic` PE/PB 序列。科创综指官方历史 PE 只从接口实际可得的日期开始；PB 单张比交易日数据更新慢，页面需按披露日期识别时效。真实利润仍使用成分股利润表汇总。

再融资额与国家队持仓规模暂未接入连续走势图：前者缺少当前工程可稳定自动更新的全市场再融资金额接口，后者没有统一官方连续披露口径。页面仅保留禁用的指标入口。
