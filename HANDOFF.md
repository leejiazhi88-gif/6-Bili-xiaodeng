# 项目交接与线上维护

唯一长期保存的项目仓库：

https://github.com/leejiazhi88-gif/6-Bili-xiaodeng

固定在线页面：

https://leejiazhi88-gif.github.io/6-Bili-xiaodeng/

GitHub Pages 从 `gh-pages` 分支根目录发布，`main` 保存源码、数据与生成后的 `index.html`。两条分支应指向同一次完成的提交。仓库中的 `README.md` 记录数据来源和运行方式。

以后换电脑时，从上述 GitHub 仓库获取项目即可继续维护；不依赖任何特定电脑上的文件夹。在线页面是发布结果，不能直接作为可编辑的项目源码。数据刷新仍需 Tushare 凭据；凭据只应配置在执行环境或 GitHub Secrets，不能提交到仓库。

每次更新流程：先同步 `main`，修改或刷新数据并生成 `index.html`，核对页面，再提交到 `main` 并同步到 `gh-pages`。最后检查 GitHub Pages 构建状态和公开页面。不要仅修改 `gh-pages` 而丢失 `main` 中的源码。

## 展示约束

用户明确要求：资金指标只展示对应的真实资金数据，不添加指数价格对照，不用价格曲线或其他指标冒充资金数据；无法获得的指数资金拆分应明确说明缺失，不绘制替代曲线。北向资金净流入页签已按用户要求移除；北向持仓分布保留。
