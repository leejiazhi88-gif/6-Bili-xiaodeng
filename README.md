# 成长指数研究仪表盘

这个工程模仿 `Bili Atotal / BigA-total` 的结构与视觉风格，但总览指数改为：

- 创业板指：`399006.SZ`
- 科创综指：`000680.SH`

GitHub 仓库：https://github.com/leejiazhi88-gif/6-Bili-xiaodeng

线上页面：https://leejiazhi88-gif.github.io/6-Bili-xiaodeng/

目前包含：

- 总览：创业板指、科创综指的价格走势
- 创业板估值：PE(TTM)、真实利润、PB 历史分位
- 估值事件 List：按年份和季度切换查看典型估值事件
- 情绪-散户模块：两市成交额、换手率、融资余额、融资余额/流通市值、涨停数量
- 情绪-大资金模块：大宗交易、机构席位大宗净买入、产业资本增减持、北向资金历史口径
- 情绪-官方模块：IPO融资额、产业资本净减持额、印花税率、LPR、社融增量、M2增速，以及官方政策事件 List

## 运行

刷新数据并生成页面（使用本机已配置的 Tushare 凭据）：

```bash
python3 ./work/fetch_market_overview_data.py
python3 ./work/fetch_valuation_data.py
python3 ./work/fetch_retail_sentiment_data.py
python3 ./work/fetch_large_money_sentiment_data.py
python3 ./work/fetch_official_sentiment_data.py
python3 ./work/fetch_index_profit_data.py
node ./work/build_market_dashboard.js --cached
```

各脚本自动使用运行当天作为查询截止日；实际数据日期以接口最新披露为准。财报缓存跨日运行时重新获取，避免漏掉新披露财报。手工事件库不随数据接口自动更新。

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
- `work/fetch_index_profit_data.py`：指数成分股归母净利润 TTM 汇总脚本
- `work/index_profit_data.json`：真实利润数据缓存
- `work/market_overview_data.json`：总览数据缓存
- `work/add_valuation_module.js`：估值模块注入脚本
- `work/fetch_valuation_data.py`：PB、股债收益差数据更新脚本
- `work/valuation_data.json`：估值扩展数据缓存
- `work/fetch_official_sentiment_data.py`：官方情绪连续数据更新脚本
- `work/official_sentiment_data.json`：官方情绪连续数据缓存
- `work/official_sentiment_events.json`：官方政策事件库
- `work/add_official_sentiment_module.js`：官方情绪模块注入脚本

## 数据口径

- 创业板指价格与 PE(TTM)：来自 Tushare `index_daily` / `index_dailybasic`
- 科创综指价格：来自 Tushare `index_daily`
- 真实利润：指数成分股归母净利润 TTM 汇总，单位亿元
- PB：来自 Tushare 指数每日指标
- 股债收益差：`100 / PE(TTM) - 10年期国债收益率`
- IPO融资额：来自 Tushare `new_share` 新股上市募集资金，月度汇总
- 产业资本净减持额：来自 Tushare `stk_holdertrade` 重要股东增减持公告，按成交均价估算，正值为净减持
- 政策利率：来自 Tushare `shibor_lpr`，页面默认展示 1年期 LPR
- 社融 / M2：来自 Tushare `sf_month` / `cn_m`
- 印花税率：手工维护的政策表，当前覆盖 2008 年下调、2008 年单边征收、2023 年减半征收等关键节点

注意：截至当前接口返回，Tushare 暂未提供 `000680.SH` 科创综指的 `index_dailybasic` PE/PB 序列，所以页面中科创综指 PE/PB 显示为暂无数据；真实利润使用成分股利润表汇总，仍可展示。

再融资额与国家队持仓规模暂未接入连续走势图：前者缺少当前工程可稳定自动更新的全市场再融资金额接口，后者没有统一官方连续披露口径。页面保留指标入口，并通过官方事件库记录 IPO 节奏、减持监管、印花税调整、汇金增持、窗口指导等政策窗口。
