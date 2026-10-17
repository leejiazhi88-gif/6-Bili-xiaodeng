# BigA-growth 本地说明

这个工程是按 `Bili Atotal / BigA-total` 模仿出的成长指数版，当前目标指数为：

- 创业板指：`399006.SZ`
- 科创综指：`000680.SH`

GitHub 仓库：

```text
https://github.com/leejiazhi88-gif/Bili-xiaodeng
```

线上页面：

```text
https://leejiazhi88-gif.github.io/Bili-xiaodeng/
```

## 本机路径

```text
/Users/fuguiplus/Documents/Codex/2026-07-02/bi/work/BigA-growth
```

主要页面文件：

```text
index.html
outputs/growth_indices_dashboard.html
```

## 本地运行

生成页面：

```bash
node ./work/build_market_dashboard.js
```

本地预览：

```bash
node ./work/preview_server.js
```

然后打开：

```text
http://127.0.0.1:9876
```

## 数据限制

Tushare 当前可以返回：

- 创业板指 `399006.SZ`：价格、PE(TTM)、PB
- 科创综指 `000680.SH`：价格

Tushare 当前没有返回科创综指 `index_dailybasic` 的 PE/PB 序列，所以科创综指的 PE、PB、股债收益差在页面内显示为暂无数据。真实利润使用 `index_weight` 成分股与 `income` 归母净利润 TTM 汇总，可以正常展示。

新增的 `情绪-官方` 模块包含：

- IPO融资额：Tushare `new_share` 月度汇总
- 产业资本净减持额：Tushare `stk_holdertrade` 重要股东增减持公告估算，正值为净减持
- 印花税率：手工政策表
- 政策利率：Tushare `shibor_lpr`，当前展示 1年期 LPR
- 社融增量 / M2增速：Tushare `sf_month` / `cn_m`
- 官方情绪事件 List：维护在 `work/official_sentiment_events.json`

再融资额与国家队持仓规模当前只保留指标入口：再融资额暂缺稳定可自动更新的全市场金额接口，国家队持仓规模没有统一官方连续披露口径。

相关文件：

```text
work/fetch_official_sentiment_data.py
work/official_sentiment_data.json
work/official_sentiment_events.json
work/add_official_sentiment_module.js
```

## 同步与部署

每次修改后：

```bash
git pull --rebase
node ./work/build_market_dashboard.js
git add .
git commit -m "描述这次修改"
git push origin main
git push origin main:gh-pages
```

GitHub Pages 使用 `gh-pages` 分支根目录发布；`main` 保存源码与数据，两条分支都要同步。Pages/CDN 可能有几分钟缓存。
