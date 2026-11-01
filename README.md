# 成长指数研究仪表盘

这个工程模仿 `Bili Atotal / BigA-total` 的结构与视觉风格，但总览指数改为：

- 创业板指：`399006.SZ`
- 科创50：`000688.SH`
- 科创综指：`000680.SH`

GitHub 仓库：https://github.com/leejiazhi88-gif/6-Bili-xiaodeng

线上页面：https://leejiazhi88-gif.github.io/6-Bili-xiaodeng/

长期维护以本 GitHub 仓库为准，不依赖固定本地目录。换电脑后从仓库获取项目，完成更新后将同一提交同步到 `main` 和 `gh-pages`；后者用于 GitHub Pages 发布。在线 URL 固定如上，页面本身不是可直接编辑的源码。数据刷新需要另行配置 Tushare 凭据，不要将凭据提交到仓库。详见 `HANDOFF.md`。

目前包含：

- 总览：创业板指、科创50、科创综指的价格和估值走势
- 创业板与科创板分开展示的估值图：PE(TTM)、历史分位等
- 情绪-散户模块：创业板指、科创50、科创综指各自的成交额与成交量；另列全市场成交额、换手率、融资余额、融资余额/流通市值、涨停数量
- 情绪-大资金模块：三个指数分别与全市场大宗交易、机构席位大宗净买入、产业资本增减持及北向资金历史口径对照；另保留完整市场历史
- 情绪-官方模块：三个指数分别与共同政策环境（IPO融资额、产业资本净减持额、印花税率、LPR、社融增量、M2增速）对照；另保留完整市场历史

## 运行

刷新数据并生成页面（使用本机已配置的 Tushare 凭据）：

首次运行先安装依赖：`python -m pip install -r requirements.txt`。Windows PowerShell 中按本机 Python 安装情况使用 `python` 或 `python3`；当前电脑由 Codex 自带 Python 环境运行。

```bash
python3 ./work/fetch_market_overview_data.py
python3 ./work/fetch_star_official_valuation.py
python3 ./work/fetch_star_official_history.py
python3 ./work/fetch_valuation_data.py
python3 ./work/fetch_retail_sentiment_data.py
python3 ./work/fetch_large_money_sentiment_data.py
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
- 指数交易热度：来自各指数自身的 Tushare `index_daily` 成交额与成交量，不代表散户独占交易；全市场背景来自 `daily_info`，2008 年起沪市 A 股与深市市场口径、2019 年起沪深市场口径。
- 大资金与官方的三指数对照图使用同一条全市场或共同政策指标，分别叠加各指数自身点位；不代表已经按指数成分股归集。全市场大资金和社融/M2历史从 2002 年开始；IPO及印花税率从已核对的 2008 年口径开始，缺失区间不填零。北向资金旧口径只保留至 2024-08-16。
- 大资金大宗交易仅统计 A 股股票代码，排除债券等非股票记录；股东增减持仅统计有成交均价的股票记录，排除无价格的股权划转。需要从原始接口完整重建历史时可运行 `python work/fetch_large_money_sentiment_data.py --full`。
- 股债收益差：`100 / PE(TTM) - 10年期国债收益率`
- IPO融资额：来自 Tushare `new_share` 新股上市募集资金，月度汇总
- 产业资本净减持额：来自 Tushare `stk_holdertrade` 重要股东增减持公告，按成交均价估算，正值为净减持
- 政策利率：来自 Tushare `shibor_lpr`，页面默认展示 1年期 LPR
- 社融 / M2：来自 Tushare `sf_month` / `cn_m`
- 印花税率：手工维护的政策表，当前覆盖 2008 年下调、2008 年单边征收、2023 年减半征收等关键节点

注意：截至当前接口返回，Tushare 暂未提供 `000680.SH` 科创综指的 `index_dailybasic` PE/PB 序列。科创综指官方历史 PE 只从接口实际可得的日期开始；PB 单张比交易日数据更新慢，页面需按披露日期识别时效。真实利润仍使用成分股利润表汇总。

再融资额与国家队持仓规模暂未接入连续走势图：前者缺少当前工程可稳定自动更新的全市场再融资金额接口，后者没有统一官方连续披露口径。页面仅保留禁用的指标入口。
