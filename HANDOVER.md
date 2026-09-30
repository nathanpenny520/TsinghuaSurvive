# 交接文档

> 这份文档假设读者**对这个项目一无所知**，目标是让人在 10 分钟内接手全部运维。
> 最后更新：2026-09-30

---

## 1. 一句话现状

一个纯静态的经验分享站，源码在 GitHub，构建产物托管在 Cloudflare Workers，主域名 <https://tsinghua.nathanpenny.fun>。**没有后端、没有数据库、没有用户系统**，所以运维面极小：改 Markdown → 提交 → 部署。

---

## 2. 资源清单

接手时最先需要的就是这串 ID，全部已核对。

| 项目 | 值 |
| --- | --- |
| 主域名 | `https://tsinghua.nathanpenny.fun` |
| Cloudflare 账号 | `Nathanpenny520@gmail.com's Account` |
| Account ID | `aa23021279f1ffd6901d7093879554f3` |
| Zone | `nathanpenny.fun`（status: active） |
| Zone ID | `068decbde572025a27b25b97080e4355` |
| Zone 的 NS | `anton.ns.cloudflare.com`, `mona.ns.cloudflare.com` |
| Worker 名称（正式） | `tsinghua-guide` |
| Custom Domain ID | `4185b3075488e7e75699ac5e82db5500b545e3df` |
| 证书 ID | `21a021b9-dcc7-4d03-98ee-2e46106ccb78` |
| Worker 名称（PR 预览） | `tsinghua-guide-preview` |
| 预览域名 | `https://preview.nathanpenny.fun` |
| GitHub 仓库 | <https://github.com/nathanpenny520/TsinghuaSurvive>（public，main） |
| 本地路径 | `TsinghuaSurvive/Tsinghua-guide/` |

Cloudflare 侧有**两个 Worker、两个自定义域名，没有任何 KV / R2 / D1 / Durable Object**。不需要担心有隐藏资源产生费用。

> 预览 Worker 是给 PR 用的独立环境，不是正式站。**如果确认不再需要预览功能**，
> 可以删掉它：`npx wrangler delete --config wrangler.preview.jsonc`，并删除 `.github/workflows/preview.yml`。

站点功能一览（都是构建期完成的，**没有任何运行时**）：

| 能力 | 实现位置 |
| --- | --- |
| 全文搜索（中文分词） | Starlight 内置 Pagefind |
| 按阶段 / 按标签浏览 | `src/pages/stages/`、`src/pages/tags/`，从 frontmatter 自动聚合 |
| 时效看门狗 | `src/components/Banner.astro`（覆盖 Starlight 组件） |
| 文章元信息（阶段/标签/作者/核对日期） | `src/components/ArticleMeta.astro`，由 Footer 调用 |
| JSON-LD 结构化数据 | `src/components/Head.astro`（覆盖 Starlight 组件） |
| 分享卡片图 | `public/og.png`，由 `scripts/generate-og.py` 生成 |
| RSS | `src/pages/rss.xml.ts` |
| 时效阈值单一来源 | `content-policy.json` |

仓库 Secrets 现状（**两个都已配好，CI 已实测跑通**）：

| Secret | 状态 |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | ✅ 已配置 |
| `CLOUDFLARE_API_TOKEN` | ✅ 已配置（2026-09-30） |

CI 验证记录：`workflow_dispatch` 运行 34s 全绿，Cloudflare 侧生成新版本 `2166042b-d87d-4c0a-9292-b5a95e0602dd`（02:51:52Z），自定义域名绑定未受影响，站点 HTTP 200。

> Token 的权限清单与重建步骤见第 5 节。**如果 token 被吊销或过期**，推送会走凭证守卫分支：只构建不部署，并给出 `::warning::` 注解，不会静默失败。

---

## 3. 架构与决策理由

### 技术栈

| 部分 | 选型 | 为什么不是别的 |
| --- | --- | --- |
| 框架 | Astro 7，`output: 'static'` | 默认零 JS，手机打开快；VitePress 加自定义排版要写 Vue，Docusaurus/Next.js 对这个体量是纯负担 |
| 主题 | Starlight | 侧边导航、目录、深色模式、搜索、i18n 全部内置，省掉文档站最费事的部分 |
| 搜索 | Pagefind（Starlight 内置） | 构建时生成静态索引，不需要任何服务端 |
| 托管 | Cloudflare Workers **静态资源** | `wrangler.jsonc` 里**没有 `main` 入口**——这个 Worker 不执行任何代码，只发文件。所以不产生请求计费、无冷启动、几乎没有攻击面 |
| 内容 | Markdown / MDX + zod 强校验 | frontmatter 写错**构建直接失败并指出文件**，不会静默生成坏页面 |

### 两个关键决策

**决策一：必须用自定义域名，不能用 `*.workers.dev`。**
实测 `tsinghua-guide.nathanpenny520.workers.dev` 在清华校园网被 DNS 污染，解析到美国 IP `208.101.21.43` 后连接超时。绑定自定义域名后实测 **HTTP 200、TLS 0.17s、整页 0.5–0.9s**。所以 `wrangler.jsonc` 里有：

```jsonc
"routes": [{ "pattern": "tsinghua.nathanpenny.fun", "custom_domain": true }]
```

副作用：声明 `routes` 后 Wrangler **默认关闭 workers.dev 入口和 Preview URL**。这是有意的，避免同一个站点有两个域名。海外调试需要时临时加 `"workers_dev": true`。

**决策二：仓库根 = 站点根。**
仓库根直接放 Astro 工程，别人 `git clone` 后 `npm install && npm run dev` 就能跑。
**没有**把 `TsinghuaSurvive/` 父目录作为仓库根——那样会把 `Tsinghua-agent/`（内含 `.env`、爬虫逻辑，且有自己的远程 `TsinghuaMCP.git`）一起暴露到公开仓库。

### 目录职责

```
src/content.config.ts    ★ 内容模型（frontmatter 字段定义）
src/content/docs/        ★ 所有文章
src/data/links.ts        ★ 校内常用链接（改这个文件就更新页面）
src/data/resources.ts    ★ 资料下载清单（同上）
src/components/          Footer（站脚免责声明）、LinkGrid、ResourceList
src/styles/custom.css    清华紫主题 + 中文排版
astro.config.mjs         侧边栏、SEO、域名、仓库地址
wrangler.jsonc           Workers 部署配置
OUTLINE.md               内容路线图（哪些写了、哪些没写）
```

日常写作只需要碰 `src/content/docs/`。

---

## 4. 日常操作

### 改一篇文章

```bash
cd TsinghuaSurvive/Tsinghua-guide
npm run dev            # http://localhost:4321，改 Markdown 自动热更新
npm run check:all      # 提 PR 前跑一遍（类型检查 + 内容检查）
git add -A && git commit -m "docs: 更新选课时间线" && git push
```

推送到 `main` 会自动部署。

### 提交前的自动检查

```bash
npm run check:all              # 类型检查 + 内容检查
npm run check:content          # 只跑内容检查
npm run check:content:strict   # 连「债务警告」也当错误（发布前用）
```

内容检查（`scripts/check-content.ts`）会抓这些**构建本身抓不到**的问题：

| 级别 | 检查项 |
| --- | --- |
| **错误**（阻断部署） | 站内链接指向不存在的页面（带文件:行号）、文件名不是 ASCII slug、`reviewedAt` 写在未来、同目录 `sidebar.order` 冲突、`links.ts` 里有重名条目或非法网址、资料填了提取码却没链接 |
| **警告**（只提示） | 作者还是占位符、`status: draft` 数量、链接没有 `verified` 或超过 12 个月未确认、资料还是 `TODO`、文章超过 6 个月未核对 |

**这四项错误检测都做过注入测试验证过会真的触发**，不是写了没用。

### 加一个校内链接

编辑 `src/data/links.ts`，加一条记录。**填了 `verified: '2026-09-30'` 才会消掉页面上的「待核对」角标**——这是本站最重要的机制，别跳过。

### 加一份资料

编辑 `src/data/resources.ts`，`url` 填网盘链接。留空或写 `'TODO'` 时页面显示「待补充」，不会渲染死链。**文件本体不要进仓库。**

### 重新生成分享卡片图

```bash
npm run og             # 需要 python3 + Pillow
```

图片内容在 `scripts/generate-og.py` 顶部改。**中文标题改动后一定要重新生成**，否则分享出去的卡片还是旧标题。

### 部署

```bash
npm run deploy         # = npm run build && wrangler deploy
npm run deploy:dry     # 只验证，不上传
```

### 回滚

```bash
npx wrangler versions list          # 找到要回的版本 ID
npx wrangler rollback <VERSION_ID>
```

### 紧急下线整个站点

```bash
npx wrangler delete                 # 删除 Worker（自定义域名的 DNS 记录会一起清理）
```

---

## 5. CI 的 API Token（已配置；换 token 时看这里）

**状态：已配好并实测通过。** 本节留给「token 过期 / 被吊销 / 要换账号」时使用。

创建 token 这一步必须人工做——wrangler 的 OAuth 凭证没有「管理 API Token」的权限（调用返回 `9109 Unauthorized`），所以无法脚本化。

1. 打开 <https://dash.cloudflare.com/profile/api-tokens> → **Create Token** → **Custom token**
2. 按下表配置权限（这是能跑通部署的**最小集合**）：

   | 范围 | 权限 | 为什么需要 |
   | --- | --- | --- |
   | Account | **Workers Scripts** · Edit | 上传脚本与静态资源 |
   | Account | **Account Settings** · Read | wrangler 解析账号 |
   | Zone · `nathanpenny.fun` | **Workers Routes** · Edit | 部署时核对自定义域名绑定 |
   | Zone · `nathanpenny.fun` | **Zone** · Read | 同上，需要先列出已有域名 |

3. Account Resources 选你的账号；Zone Resources 只选 `nathanpenny.fun`（**不要**给 All zones）
4. 创建后立刻复制 token，写入仓库 Secret，二选一：

   ```bash
   # 方式一：命令行（推荐，不会留在网页历史里）
   gh secret set CLOUDFLARE_API_TOKEN --repo nathanpenny520/TsinghuaSurvive

   # 方式二：网页
   # 仓库 → Settings → Secrets and variables → Actions → New repository secret
   ```

5. 验证：`gh workflow run deploy.yml --repo nathanpenny520/TsinghuaSurvive`，然后 `gh run watch`

如果 token 有问题，工作流**不会红叉**——凭证守卫步骤会给出 `::warning::` 提示并只构建不部署。看到这条注解就说明 token 需要重建。

> **更省事的替代方案**：用 Cloudflare 自带的 **Workers Builds**（Dashboard → Workers → `tsinghua-guide` → Settings → Builds → 连接 GitHub 仓库，构建命令 `npm run build`）。这样根本不需要 token，但需要在网页上授权 GitHub。如果哪天受够了 token 轮换，可以删掉 `.github/workflows/deploy.yml` 换这条路。

---

## 6. 故障排查

| 症状 | 原因与处理 |
| --- | --- |
| `EPERM ... /Users/xxx/.npm/_logs` | 沙箱不允许写用户目录。设 `export npm_config_cache="$PWD/.npm-cache"` |
| `EPERM ... .wrangler/logs` | 同上，设 `export WRANGLER_LOG_PATH="$PWD/.wrangler-logs"` |
| 域名解析 NXDOMAIN | **先别急着改配置**。清华校园网会**透明劫持 53 端口的 DNS 查询**——你问 8.8.8.8、223.5.5.5、119.29.29.29 拿到的其实都是校内解析器的答案，所以看起来「所有公共 DNS 都挂了」。判断真伪要看 NXDOMAIN 响应里的 SOA serial 是否落后于当前 zone。**用 DoH（443 端口）绕开劫持验证**：`curl "https://dns.alidns.com/resolve?name=tsinghua.nathanpenny.fun&type=A"`。另一个铁证：`dig +short TXT o-o.myaddr.l.google.com @8.8.8.8` 返回的是什么 IP——返回校内地址就说明被劫持了。真正的原因通常只是校内解析器缓存了建记录之前的否定结果（SOA minimum=1800，约 30 分钟自动过期） |
| 站点打不开但 Cloudflare 显示已部署 | 先分清是 DNS 问题还是部署问题：`curl --resolve tsinghua.nathanpenny.fun:443:172.67.207.247 https://tsinghua.nathanpenny.fun/` 绕过 DNS 直连 |
| 搜索搜不到中文 | Pagefind 支持中文分词但**不做词干化**，所以「选课」和「选课规则」不会互相命中。搜短词（2–3 字），并靠 tags 补足 |
| 构建报 frontmatter 错误 | 这是**设计如此**。按报错指出的文件修正字段，字段定义见 `src/content.config.ts` |
| 部署刚完成时个别页面 404 | **部署传播竞态**，几秒后自行恢复。我实测遇到过一次：`/freshman/dorm-and-network/` 在部署完成后立刻请求返回 404，重试即 200。确认方法：等 10 秒再请求一次，仍 404 才是真问题 |
| 中文标签/阶段页返回 307 | **正常**。Cloudflare 把原始 UTF-8 路径（`/tags/选课/`）307 规范化到百分号编码形式，浏览器自动跟随，最终 200。爬虫和社交平台也能正确跟随 |
| 页面顶部出现橙色的过期提醒 | 这是**看门狗**在工作：`reviewedAt` 超过 `content-policy.json` 里的 `staleAfterMonths`（默认 6 个月）。重新核对内容后更新 `reviewedAt` 即可 |
| 页面顶部出现红色的过期警告 | 作者把 `status` 设成了 `outdated`。内容修好后改成 `stable` |
| 分享出去的卡片图还是旧标题 | `public/og.png` 是**静态文件**，改站点标题后要跑 `npm run og` 重新生成 |
| 想调整「多久算过期」 | 改 `content-policy.json` 的 `staleAfterMonths`，**站点看门狗和 CI 检查脚本同时生效**（这是刻意设计的单一来源） |
| 内容检查报「站内链接指向不存在的页面」 | 改文件名或移动文章后没同步引用。报错里有文件:行号，按行号改。中文标签链接（`/tags/选课/`）和编码形式都已被正确识别，不会误报 |
| 预览链接 404 或 PR 上没有预览评论 | 先看 PR 是不是来自 **fork**（fork PR 拿不到 Secrets，设计如此）。其次确认 `wrangler.preview.jsonc` 里的预览域名是否创建成功 |
| 想删掉预览环境 | `npx wrangler delete --config wrangler.preview.jsonc`，并删除 `.github/workflows/preview.yml` |

---

## 7. 内容缺口与红线

完整路线图见 [OUTLINE.md](./OUTLINE.md)。**发布前必须做的三件事**：

1. **核对 9 条校内常用链接**（`src/data/links.ts`），逐条点开确认后填 `verified` 日期。
2. **填或删 5 条资料条目**（`src/data/resources.ts`）。
3. **替换署名**——所有文章现在作者都是 `待补充`。

**绝对不能写进站点的内容**（详见站内《免责声明与内容边界》）：

- 内部系统的数据、截图、账号，或绕过权限的方法
- 对具体老师的指名评价
- 他人隐私（学号、成绩、联系方式、名单）
- 违反校规的做法
- 付费内容导流

**关于保研 / 出国 / 考研三篇**：`OUTLINE.md` 里明确标注必须由当事人按当年政策写。写错时间线会真耽误别人一年，**不要为了让大纲看起来完整去猜**。本站处理不确定信息的方式是显式标记「待核对」，不是编一个看起来合理的数字。

---

## 8. 已知限制

- **境内访问是「可用」不是「快」**。整页 0.5–0.9s，因为走的是 Cloudflare 海外节点。要更快需要 **ICP 备案 + Cloudflare 中国网络（企业版）**，或换境内云厂商静态托管。这是产品决策，不是技术限制。
- **`workers.dev` 入口已关闭**，不要把它写进任何对外宣传材料。
- **没有评论系统**（按需求刻意不做）。纠错入口是页脚的 GitHub Issues 链接。
- **没有 CMS**。其他学长学姐投稿要么会 Git，要么把稿子发到 Issues 由人代排。以后要降低门槛可以接 Decap/Sveltia CMS（基于 Git，零后端，与当前架构天然兼容）。
- **构建依赖 Node 20+**，CI 用 Node 22。
