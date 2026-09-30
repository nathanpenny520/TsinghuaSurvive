# 清华生存指南

面向清华在校学生的经验分享站。不是官方材料，是一群学长学姐把踩过的坑、绕过的路写下来。

**线上地址**：<https://tsinghua.nathanpenny.fun>

---

## 我想做 X，该改哪里？

日常 90% 的操作都在下面这张表里。**改完提交推送，CI 会自动构建部署，不需要手动做任何部署动作。**

| 我想…… | 改哪里 | 怎么做 |
| --- | --- | --- |
| **写一篇新经验帖** | `src/content/docs/<分类>/` 新建 `.md` | 复制 [`src/content/docs/_template.md`](./src/content/docs/_template.md) 当模板。**文件名用英文小写加连字符**，中文标题写在 `title` 里 |
| **改一篇已有文章** | 对应 `.md` 文件 | 本地改后 push；或用网页端点「编辑此页 / 纠错」（需代理，见下） |
| **加一个校内网址** | `src/data/links.ts` | 加一条记录。**亲自点开确认后填 `verified: '2026-09-30'`**，页面上的「待核对」角标才会消失 |
| **加一份可下载资料** | `src/data/resources.ts` | `url` 填网盘链接，`code` 填提取码。**文件本体不要进仓库**，只放外链 |
| **加一个新分类** | `astro.config.mjs` 的 `sidebar` | 在 `src/content/docs/` 下建目录，然后往 `sidebar` 数组里加一项 `{ autogenerate: { directory: '目录名' } }` |
| **调侧边栏顺序** | 文章的 `sidebar.order` | 数字小的在前。**同目录内不要重复**，否则内容检查会报错 |
| **改站点标题 / 描述 / 联系方式** | `astro.config.mjs` | 顶部有 `SITE`、`REPO` 等常量 |
| **改分享卡片图** | `scripts/generate-og.mjs` 顶部文案 | 改完跑 `npm run og`，**记得提交 `public/og.png`** |
| **标一篇内容过期了** | 文章 frontmatter | `status: outdated`（红色警告）或更新 `reviewedAt`（橙色自动提醒） |
| **改「多久算过期」** | `content-policy.json` | 改 `staleAfterMonths`。**站点看门狗和 CI 检查同时生效** |
| **看哪些内容还欠着** | 跑 `npm run check:content` | 会输出「债务总账」：待补作者 / 待核对页面 / 待核对链接 / 待补充资料 |
| **回滚一次线上发布** | 本地跑 wrangler | `npx wrangler versions list` 找到版本 ID，再 `npx wrangler rollback <ID>` |

**没有本地环境也能干活**（但要注意下面那条网络限制）：有了 GitHub 账号就能在网页上点「编辑此页」改内容，提交后会自动生成 PR，机器人会把预览链接评论到 PR 上，你确认没问题再合并。

> ### ⚠️ 校园网里 GitHub 网页端打不开
> 实测（2026-09-30，清华校园网）：
>
> | 通道 | 结果 |
> | --- | --- |
> | `git push` / `git clone`（SSH，22 或 443 端口） | ✅ 通 |
> | `api.github.com` | ✅ 通（1.2s） |
> | **`github.com` 网页端** | ❌ **超时** |
> | `raw.githubusercontent.com` | ❌ 超时 |
>
> 所以**在校园网内，网页端那条路走不通，会卡在打开网页这一步**。可靠的做法是：
> - **本地改 + `git push`**（本仓库的全部提交都是这么推上去的）
> - 或者开代理后再用网页端
> - 站点上的「编辑此页 / 纠错」链接指向 `github.com`，**在校园网内点开也会超时**，不是链接写错了

### 三种不同的改动方式，按你的习惯选

| 方式 | 适合 | 代价 |
| --- | --- | --- |
| **本地 `npm run dev` + `git push`** | 写长文、调排版、批量改链接 | **校园网里唯一稳定可用的方式**；要装 Node 和依赖（一次性） |
| **GitHub 网页直接改** | 改错别字、更新链接 | 需要代理；校内直连打不开 github.com |
| **只提 Issue** | 不会 Git、只想提供素材 | 同样需要能打开 github.com（或让有代理的人代提） |

详细写作规范见站点上的[怎么贡献一篇经验帖](https://tsinghua.nathanpenny.fun/contribute/)，运维细节见 [HANDOVER.md](./HANDOVER.md)，内容路线图见 [OUTLINE.md](./OUTLINE.md)。

---

## 技术栈

刻意选了最省心的组合：**没有后端、没有数据库、没有用户系统**。

| 部分 | 选型 | 为什么 |
| --- | --- | --- |
| 站点框架 | **Astro 7**（纯静态 `output: 'static'`） | 默认零 JS，手机打开快；内容用 Markdown 写 |
| 文档主题 | **Starlight** | 自带侧边导航、目录、深色模式、搜索、i18n |
| 全文搜索 | **Pagefind**（Starlight 内置） | 构建时生成静态索引，不需要任何服务；中文分词已启用 |
| 内容格式 | Markdown / MDX + 强类型 frontmatter | 写错字段构建直接失败，不会静默生成坏页面 |
| 托管 | **Cloudflare Workers 静态资源** | 构建产物直接当静态资源上传，无运行时费用、无冷启动 |

### 为什么是「Workers 静态资源」而不是别的

这个站没有任何服务端逻辑，所以 `dist/` 就是全部。`wrangler.jsonc` 里只声明了 `assets.directory`，**没有 `main` 入口**——也就是说这个 Worker 不执行任何代码，只负责把文件发出去。

带来的好处：不产生 Worker 请求计费、不会被冷启动影响、也几乎没有可被攻击的面。

---

## 本地开发

需要 Node.js 20 以上。

```bash
npm install
npm run dev        # http://localhost:4321
```

其他命令：

```bash
npm run build              # 构建到 dist/
npm run preview            # 预览构建产物
npm run check              # 类型检查（astro check）
npm run check:content      # 内容检查：死链、中文文件名、占位符、过期核对日期
npm run check:all          # 上面两个一起跑 ← 提 PR 前跑这个
npm run check:content:strict  # 连「债务警告」也当错误（发布前用）
npm run og                 # 重新生成社交分享卡片图（public/og.png）
npm run deploy             # 构建并部署到 Cloudflare Workers
```

> **提示**：如果 `wrangler` 报 `EPERM ... .wrangler/logs`，说明它没权限写用户目录。设置
> `export WRANGLER_LOG_PATH="$PWD/.wrangler-logs"` 即可把日志重定向到项目内。
> 同理 `npm` 报 `EPERM ... ~/.npm` 时，设置 `export npm_config_cache="$PWD/.npm-cache"`。

### 站点的几个自动化机制

| 机制 | 位置 | 作用 |
| --- | --- | --- |
| **时效看门狗** | `src/components/Banner.astro` | `reviewedAt` 超过 6 个月没重新核对 → 页面顶部自动出现过期提醒；`status: outdated` → 红色警告 |
| **按阶段 / 按标签浏览** | `src/pages/stages/`、`src/pages/tags/` | 从 frontmatter 的 `stage` / `tags` **自动聚合**，不需要手工维护分类 |
| **内容检查** | `scripts/check-content.ts` | 抓构建抓不到的问题：站内死链、中文文件名、未来日期、order 冲突、占位符 |
| **结构化数据** | `src/components/Head.astro` | 每页注入 JSON-LD `Article`。署名是占位符时署成「本站」这个组织，**不编造人名** |
| **分享卡片图** | `scripts/generate-og.mjs` | 生成 1200×630 的 `public/og.png`，脚本可复现 |
| **统一阈值** | `content-policy.json` | 看门狗和内容检查脚本读同一份配置，避免两边阈值漂移 |

---

## 目录结构

> 📘 接手运维请先看 **[HANDOVER.md](./HANDOVER.md)**（资源 ID、部署、故障排查都在里面）；内容路线图见 **[OUTLINE.md](./OUTLINE.md)**。

```
Tsinghua-guide/
├─ astro.config.mjs          站点配置：标题、侧边栏、社交链接、SEO
├─ wrangler.jsonc            Cloudflare Workers 静态资源部署配置
├─ HANDOVER.md               运维交接文档
├─ OUTLINE.md                内容大纲与待办
├─ src/
│  ├─ content.config.ts      ★ 内容模型（frontmatter 校验规则）
│  ├─ content/
│  │  ├─ docs/               ★ 所有文章，一个文件一页
│  │  │  ├─ index.mdx           首页
│  │  │  ├─ 404.md              自定义 404
│  │  │  ├─ start/              本站说明
│  │  │  ├─ freshman/           新生入学
│  │  │  ├─ academics/          学业（选课、绩点、考试……）
│  │  │  ├─ research/           科研与深造
│  │  │  ├─ campus/             校园生活
│  │  │  ├─ mindset/            心态与避坑
│  │  │  └─ guides/             实用工具（链接、资料）
│  │  └─ i18n/zh-CN.json     界面文案覆盖
│  ├─ pages/                 自定义路由（不走 Starlight 的文档路由）
│  │  ├─ stages/             按阶段浏览（自动聚合）
│  │  ├─ tags/               按标签浏览（自动聚合）
│  │  └─ rss.xml.ts          RSS feed
│  ├─ components/
│  │  ├─ Banner.astro           ★ 时效看门狗（覆盖 Starlight）
│  │  ├─ Head.astro             ★ JSON-LD 结构化数据（覆盖 Starlight）
│  │  ├─ Footer.astro           文章元信息 + 免责声明（覆盖 Starlight）
│  │  ├─ ArticleMeta.astro      阶段/标签/作者/核对日期
│  │  ├─ ArticleGrid.astro      文章卡片网格
│  │  ├─ LinkGrid.astro         常用链接卡片墙
│  │  └─ ResourceList.astro     资料下载列表
│  ├─ data/
│  │  ├─ links.ts            ★ 校内常用链接（改这里就更新页面）
│  │  ├─ resources.ts        ★ 资料下载清单（改这里就更新页面）
│  │  ├─ browse.ts           浏览页的 collection 查询（过滤规则只有一份）
│  │  └─ policy.ts           时效策略（读 content-policy.json）
│  └─ styles/custom.css      主题色（清华紫）与中文排版
├─ scripts/
│  ├─ check-content.ts       内容检查（CI 里跑，会阻断部署）
│  └─ generate-og.mjs        生成分享卡片图
├─ content-policy.json       ★ 时效阈值（看门狗与检查脚本共用）
├─ wrangler.jsonc            正式站配置
└─ wrangler.preview.jsonc    PR 预览站配置
```

**带 `★` 之外的规则**：日常写作只需要碰 `src/content/docs/`，加链接只碰 `src/data/`。

---

## 写一篇文章

在对应目录下新建 `.md` 文件，**文件名用英文小写加连字符**（文件名会变成网址，中文网址在微信里转发会变成一长串 `%E5%AD%A6...`），标题写中文：

```yaml
---
title: 选课怎么排才不踩坑          # 必填
description: 一句话摘要，会出现在搜索结果和分享卡片里
stage: ['本科低年级']              # 本科新生/本科低年级/本科高年级/研究生/全阶段
tags: ['选课', '培养方案']
authors: ['你的昵称（xx 院系 xx 级）']
status: stable                    # draft / stable / outdated
reviewedAt: 2026-09-30            # 你亲自逐条核对过文中事实的日期 ← 决定看门狗
summary: 卡片上显示的一句话
banner:                           # 可选：页面顶部横幅（手动说明）
  content: 本文规则尚未核对，请以官方通知为准。
sidebar:
  order: 10                       # 目录排序，小的在前
---

正文……
```

字段写错会在 `npm run build` 时**报错并指出是哪个文件**，不会生成坏页面。

**`reviewedAt` 是最需要认真对待的一个字段**：填了表示你逐条核实过文中事实，超过 6 个月没重新核对，页面顶部会自动出现橙色「可能已过期」提醒。**制度性内容没查证过就不要填**，并把 `status` 设成 `draft`。三个字段的分工：

| 字段 | 效果 |
| --- | --- |
| `status: draft` | 卡片上显示「待核对」标签 |
| `status: outdated` | 页面顶部红色过期警告 |
| `reviewedAt` | 超过阈值 → 顶部橙色自动提醒；不填 → 页脚显示「尚未标注」 |

正文里可以用的排版语法：

- 提示块：`:::tip`、`:::note`、`:::caution`、`:::danger`，带标题写成 `:::tip[标题]`
- 需要 JSX 组件（`<Steps>`、`<Aside>`、`<LinkCard>`）时，把文件后缀改成 `.mdx` 并在 frontmatter 下方 `import`
- **站内链接写相对站点的绝对路径**（如 `/academics/gpa/`），`npm run check:content` 会验证它是否存在

---

## 加一个链接或一份资料

- **常用链接**：编辑 `src/data/links.ts`，加一条记录。填了 `verified: '2026-09-30'` 就不再显示「待核对」角标。
- **资料下载**：编辑 `src/data/resources.ts`。`url` 留空或写 `'TODO'` 时页面显示「待补充」，不会渲染死链。

**文件本体不要放进仓库**，只放第三方网盘外链。

---

## 部署

```bash
npm run deploy
```

第一次部署前需要登录 Cloudflare（`npx wrangler login`），或者设置 `CLOUDFLARE_API_TOKEN`。

### 域名：为什么必须用自定义域名，不能用 workers.dev

实测结论（2026-09-30，清华校园网）：

| 域名 | 结果 |
| --- | --- |
| `tsinghua-guide.nathanpenny520.workers.dev` | ❌ DNS 被解析到美国 IP `208.101.21.43`，连接超时 —— `*.workers.dev` 属于境内常被污染的域名 |
| `tsinghua.nathanpenny.fun` | ✅ HTTP 200，TLS 握手 0.17s，整页 0.5–0.9s |

所以正式入口是 **<https://tsinghua.nathanpenny.fun>**，它通过 `wrangler.jsonc` 的 `routes` 以 Custom Domain 方式绑定：

```jsonc
"routes": [{ "pattern": "tsinghua.nathanpenny.fun", "custom_domain": true }]
```

`npm run deploy` 时 Wrangler 会自动创建 DNS 记录并签发证书，不需要手动去控制台点。

> **注意：`workers.dev` 入口已被关闭。**
> 一旦声明了 `routes` 而没写 `workers_dev`，Wrangler 会**默认关闭 workers.dev 入口**（同时关闭 Preview URL）。这是好事——避免同一个站点有两个域名、一份被污染的域名继续对外服务。如果哪天需要在海外调试，显式加 `"workers_dev": true` 再部署。

> **刚绑定时校园网可能还打不开。**
> 校内的 DNS 解析器（`166.111.8.28`）会缓存 NXDOMAIN，新域名可能要等负缓存过期（通常 30 分钟内）才生效。权威 NS 查询是正常的：
>
> ```bash
> nslookup tsinghua.nathanpenny.fun anton.ns.cloudflare.com
> # → 104.21.61.85 / 172.67.207.247，Cloudflare 任意播地址
> ```

如果想要境内访问再快一档（更低的延迟、更稳的链路），需要**域名完成 ICP 备案**并使用 Cloudflare 中国网络（企业版），或者换境内云厂商的静态托管。这是产品决策，不是技术限制——当前 0.5–0.9s 的整页耗时对学生浏览已经够用。

### 自动部署

**已配好并实测通过**：推送到 `main` 会自动构建并部署，不需要手动跑任何命令。流程是「安装依赖 → `astro check` → `check:content` → `build` → `wrangler deploy`」。

| Secret | 状态 |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | ✅ 已配置 |
| `CLOUDFLARE_API_TOKEN` | ✅ 已配置（权限最小集合见 [HANDOVER.md](./HANDOVER.md) 第 5 节） |

token 失效时工作流会给出一条 `::warning::` 注解并只构建不部署，不会静默失败。

### PR 预览

提 PR 后机器人会评论一个预览链接：**<https://preview.nathanpenny.fun>**（独立的预览 Worker，由 `wrangler.preview.jsonc` 配置）。

- 每次推送更新同一个预览，评论也会更新而不是刷屏。
- **来自 fork 的 PR 没有预览** —— 这是有意的安全取舍：给 fork PR 开凭证等于把 Cloudflare 账号交给陌生代码。工作流用的是 `pull_request` 而不是 `pull_request_target`。
- 预览地址是公开的，**不要在里面放未脱敏的内容**。

要跳过 CI 手动发布，本地跑 `npm run deploy` 即可。

---

## 内容红线

投稿和审稿都必须遵守，详见站点上的《免责声明与内容边界》：

- ❌ 内部系统的数据、截图、账号，或绕过权限的方法
- ❌ 对具体老师的指名评价
- ❌ 他人隐私（学号、成绩、联系方式、名单）
- ❌ 违反校规的做法
- ❌ 付费内容导流

---

## 许可

内容采用 **CC BY-NC-SA 4.0**。学校官方文件版权归学校所有，本站只做链接引用。
