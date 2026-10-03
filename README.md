# 清华生存指南

面向清华在校学生的经验分享站。不是官方材料，是一群学长学姐把踩过的坑、绕过的路写下来。

**线上地址**：<https://tsinghua.nathanpenny.fun>

---

## 我想做 X，该改哪里？

日常 90% 的操作都在下面这张表里。**改完提交推送，CI 会自动构建部署，不需要手动做任何部署动作。**

| 我想…… | 改哪里 | 怎么做 |
| --- | --- | --- |
| **改内容（推荐给不会 Git 的人）** | <https://tsinghua.nathanpenny.fun/admin/> | 站内后台：浏览器里改文字、拖图、嵌视频，保存后自动开 PR 并给预览链接。登录用 GitHub 令牌，配置见 [HANDOVER.md 第 9 节](./HANDOVER.md) |
| **给文章插图 / 嵌视频** | 同上（后台媒体库） | 图片拖进去就会自动压成 WebP 并传到 R2（**不进 Git 仓库**）；视频写 `::bilibili[BV号]` 或 `::video[地址]` 各占一行 |
| **写一篇新经验帖** | `src/content/docs/<分类>/` 新建 `.md` | 复制 [`src/content/docs/_template.md`](./src/content/docs/_template.md) 当模板。**文件名用英文小写加连字符**，中文标题写在 `title` 里 |
| **改一篇已有文章** | 对应 `.md` 文件 | 后台改（推荐）；或本地改后 push；或网页端点「编辑此页 / 纠错」（需代理，见下） |
| **加一个校内网址** | `src/data/links.ts` | 加一条记录。**亲自点开确认后填 `reviewedAt: '2026-10-03'` + `verifiedBy: 'human'`**，页面上的「待核对」角标才会消失（跑 `npm run verify:links` 能自动核对的那一类，写 `verifiedBy: 'auto'`） |
| **加一份可下载资料** | `src/data/resources.ts` | `url` 填网盘链接，`code` 填提取码。**文件本体不要进仓库**，只放外链 |
| **加一个第三方工具** | `src/data/tools.ts` | 加一条记录：`status`（活跃/不活跃/已停止/**未核实**）与 `access`（公网/校园网/需代理/未实测）。**状态栏抄上游项目页写的**，不要凭印象填「活跃」—— 那一个字会被当成"可以放心用" |
| **加一门课 / 一个资料库** | `scripts/build-course-index.mjs` | 资料库目录变了就重新生成：`npm run courses`（详见下面「课程资料索引」一节） |
| **加一个技能页** | `src/content/docs/skills/` 新建 `.md` | 结构和语气照抄同目录其他文章；侧边栏是 `autogenerate`，不用改配置 |
| **检查网址还活着吗** | 跑 `npm run check:links` | 实测所有校内链接，结果写进 `src/data/link-status.json`，页面上会显示「实测可访问 / 打不开」 |
| **人工核对链接入口** | 跑 `npm run review:links` | 生成一份本地核对清单（浏览器里逐条点「没问题 / 有问题」），导出后 `review:links:apply` 自动把日期写回 `links.ts` |
| **课程书目 / 课程↔技能** | 自动派生 | `/courses/books/` 与技能页的映射表都从 `course-index.json` 读，不用手工维护 |
| **改站内互动工具** | `src/components/Checklist.astro`、`CreditPlanner.astro` | 报到清单（可勾选）与学分缺口表（自动算）。数据只存浏览器 localStorage，**没有后端、不上传** |
| **加一篇经验帖/骨架** | `src/content/docs/<分类>/` | 骨架页写 `status: draft` + `banner` 说明"未核实"，**不要填 reviewedAt** |
| **加一个新分类** | `astro.config.mjs` 的 `sidebar` | 在 `src/content/docs/` 下建目录，然后往 `sidebar` 数组里加一项 `{ autogenerate: { directory: '目录名' } }` |
| **调侧边栏顺序** | 文章的 `sidebar.order` | 数字小的在前。**同目录内不要重复**，否则内容检查会报错 |
| **改站点标题 / 描述 / 联系方式** | `astro.config.mjs` | 顶部有 `SITE`、`REPO` 等常量 |
| **改分享卡片图** | `scripts/generate-og.mjs` 顶部文案 | 改完跑 `npm run og`，会生成 4 张（全站 + 课程/技能/链接），**记得一起提交** |
| **标一篇内容过期了** | 文章 frontmatter | `status: outdated`（红色警告）或更新 `reviewedAt`（橙色自动提醒） |
| **改「多久算过期」** | `content-policy.json` | 改 `staleAfterMonths`。**站点看门狗和 CI 检查同时生效** |
| **看哪些内容还欠着** | 跑 `npm run check:content` | 会输出「债务总账」：待补作者 / 待核对页面 / 待核对链接 / 待补充资料 |
| **回滚一次线上发布** | 本地跑 wrangler | `npx wrangler versions list` 找到版本 ID，再 `npx wrangler rollback <ID>` |

**没有本地环境也能干活**（但要注意下面那条网络限制）：有了 GitHub 账号就能在网页上点「编辑此页」改内容，提交后会自动生成 PR，机器人会把预览链接评论到 PR 上，你确认没问题再合并。

> ### ✅ 校园网内改内容：用站内后台（2026-09-30 起）
> <https://tsinghua.nathanpenny.fun/admin/> —— 自域名，校园网可达，**不需要 Git、不需要装 Node**。
> 登录是 **GitHub 一键授权**（自建的中转在 `auth-worker/`）：只有点登录那一下需要能打开 github.com（开代理或手机流量），
> 授权后拿到长效令牌，**之后改内容、传图、提交全部在校园网内完成**（走 `api.github.com`，实测通）。
> 部署中转、R2 媒体库的开通步骤见 [HANDOVER.md 第 9 节](./HANDOVER.md)。

> ### ⚠️ 校园网里 GitHub 网页端打不开
> 实测（2026-09-30，清华校园网）：
>
> | 通道 | 结果 |
> | --- | --- |
> | `git push` / `git clone`（SSH，22 或 443 端口） | ✅ 通 |
> | `api.github.com` | ✅ 通（1.2s） |
> | 站内后台读写内容（走 `api.github.com`） | ✅ 通 |
> | `auth.nathanpenny.fun`（自建 OAuth 中转） | ✅ 通 |
> | `github.com/login/oauth/authorize`（登录时要跳一次） | ❌ 需代理 |
> | **`github.com` 网页端** | ❌ **超时** |
> | `raw.githubusercontent.com` | ❌ 超时 |
>
> 所以**在校园网内，网页端那条路走不通，会卡在打开网页这一步**。可靠的做法是：
> - **用站内后台改内容**（普通人推荐，浏览器即可；登录那一下开代理）
> - **本地改 + `git push`**（要批量改、改代码时用）
> - 或者开代理后再用网页端
> - 站点上的「编辑此页 / 纠错」链接指向 `github.com`，**在校园网内点开也会超时**，不是链接写错了

### 四种不同的改动方式，按你的习惯选

| 方式 | 适合 | 代价 |
| --- | --- | --- |
| **站内后台 `/admin/`** | 改正文、插图、嵌视频（不会 Git 也完全没问题） | 登录那一步要能打开 github.com（开一次代理）；改含 JSX 组件的 `.mdx` 页面要小心（后台里已单独标注） |
| **本地 `npm run dev` + `git push`** | 写长文、调排版、批量改链接、改代码 | 要装 Node 和依赖（一次性） |
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
| 内容后台 | **Sveltia CMS**（纯前端单页应用，静态托管在同一个 Worker 上） | 不用 Git 也能改内容、插图、嵌视频；提交仍然走 GitHub PR，原有校验一条不放松。配置用官方 JSON Schema 校验（`npm run check:admin`） |
| 后台登录 | **GitHub OAuth**，中转是 `auth-worker/`（内联上游 `sveltia/sveltia-cms-auth`，13KB Worker，MIT） | 一键授权、不用管令牌。client secret 只存在 Worker 的加密环境变量里（前端应用不能放 secret，GitHub 的纯前端 PKCE 流程目前不可用） |
| 图片 / 视频存储 | **Cloudflare R2**（`tsinghua-guide-media` 桶，公开域名访问） | 媒体不进 Git 仓库，clone 不会越来越慢；10GB 免费额度、出网免费。视频优先用 B 站嵌入，站上只放 iframe |
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
npm run check:content      # 内容检查：死链、中文文件名、占位符、过期核对日期、数据文件一致性
npm run check:admin        # 后台配置检查：字段覆盖率（漏字段会让后台保存时丢数据）、R2 占位符
npm run check:media        # 媒体检查：视频语法糖写法、外链图片是否用了会失效的图床
npm run check:all          # 上面几个一起跑 ← 提 PR 前跑这个
npm run check:content:strict  # 连「债务警告」也当错误（发布前用）
npm run verify             # 一键跑完：类型 + 内容 + 后台 + 媒体 + 构建 + 结构化数据 + 资源 + 订阅 + 产物比对 ← 提 PR 前跑这个
npm run check:links        # 实测所有校外链接是否可访问（需要联网，写 link-status.json）
npm run verify:links       # 语义核对：抓页面比对标题/关键词，判断「地址还指向那个服务吗」
npm run verify:links -- --apply   # 把结论 ok 的条目写回 links.ts（reviewedAt + verifiedBy: 'auto'）
npm run check:e2e          # 用无头 Chrome 点一遍筛选/搜索 + Pagefind 中文检索（先 build + 起本地静态服务）
npm run review:links       # 生成链接人工核对清单（.review/link-review.html，加 --open 直接打开）
npm run review:links:apply -- <导出文件>          # 预览要写回的 reviewedAt（加 --write 才真的改）
npm run courses            # 从 reference/ 重新生成课程资料索引（course-index.json）
npm run courses:check      # 校验 course-index.json 与 reference/ 是否一致（CI 用）
npm run check:feeds        # 校验 sitemap / RSS / robots（构建后跑）
npm run check:jsonld       # 校验每页 JSON-LD（构建后跑）
npm run check:assets       # 校验分享卡片尺寸与是否漏提交
npm run check:media:dist   # 数产物里的视频容器和源码里的语法糖是否一致（构建后跑；Astro 出错时构建仍返回 0）
npm run admin:vendor       # 可选：把后台编辑器脚本放进 public/admin/vendor/（校园网里 unpkg 不通时用）
npm run auth:dry           # 看 OAuth 中转 Worker 的打包结果，不部署
npm run auth:deploy        # 部署 OAuth 中转（内容后台的 GitHub 登录用；需要 Cloudflare 凭据）
npm run r2:setup -- --check  # 看 R2 桶 / 公开域名 / CORS / 后台 public_url 是否都对得上（只读）
npm run r2:setup           # 建桶 + 接公开域名 + 应用 r2/cors.json（可重复执行）
npm run measure:perf       # 本地实测页面字节数与请求数（无头 Chrome，无新依赖）
npm run og                 # 重新生成社交分享卡片图：共 4 张（全站 public/og.png + 课程 public/og/courses.png、技能 public/og/skills.png、链接 public/og/links.png）
npm run deploy             # 构建并部署到 Cloudflare Workers
```

> **提示**：如果 `wrangler` 报 `EPERM ... .wrangler/logs`，说明它没权限写用户目录。设置
> `export WRANGLER_LOG_PATH="$PWD/.wrangler-logs"` 即可把日志重定向到项目内。
> 同理 `npm` 报 `EPERM ... ~/.npm` 时，设置 `export npm_config_cache="$PWD/.npm-cache"`。
> `wrangler login` 也会往用户目录写登录令牌（`~/Library/Preferences/.wrangler`），受限环境里把它一起重定向：
> ```bash
> export XDG_CONFIG_HOME="$PWD/.wrangler-config" XDG_CACHE_HOME="$PWD/.wrangler-cache"
> npx wrangler login     # 令牌落在 .wrangler-config/ 里，已被 .gitignore 忽略
> ```
> 登录用的是账号级 OAuth（不是细粒度 API 令牌）。不用了可以 `npx wrangler logout` 或直接删掉该目录。

### 站点的几个自动化机制

| 机制 | 位置 | 作用 |
| --- | --- | --- |
| **时效看门狗** | `src/components/Banner.astro` | `reviewedAt` 超过 6 个月没重新核对 → 页面顶部自动出现过期提醒；`status: outdated` → 红色警告 |
| **按阶段 / 按标签浏览** | `src/pages/stages/`、`src/pages/tags/` | 从 frontmatter 的 `stage` / `tags` **自动聚合**，不需要手工维护分类 |
| **内容检查** | `scripts/check-content.ts` | 抓构建抓不到的问题：站内死链、中文文件名、未来日期、order 冲突、占位符 |
| **结构化数据** | `src/components/Head.astro` | 每页注入 JSON-LD `Article`。署名是占位符时署成「本站」这个组织，**不编造人名** |
| **分享卡片图** | `scripts/generate-og.mjs` | 生成 1200×630 的 `public/og.png`，脚本可复现 |
| **统一阈值** | `content-policy.json` | 看门狗和内容检查脚本读同一份配置，避免两边阈值漂移 |
| **链接实测** | `scripts/check-links.ts` | 逐个请求所有校外链接，结果写进 `src/data/link-status.json`；页面上分成「实测可访问」（机器测的）和「人工核对」（人测的）两个角标 |
| **课程资料索引** | `scripts/build-course-index.mjs` | 扫描 `reference/` 下几个公开资料库的目录结构，生成 `src/data/course-index.json`（142 门课 / 185 条资料），`/courses/` 页面的筛选数据全来自它 |
| **更新日志与贡献者** | `src/pages/changelog.astro`、`src/pages/contributors.astro` | 构建时读 `git log` 生成，不需要手工维护名单；拿不到历史时页面自动降级 |
| **交互冒烟测试** | `scripts/e2e-smoke.mjs` | 用无头 Chrome 真的点一遍课程筛选与链接搜索 —— 静态检查看不见「点了没反应」 |
| **结构化数据校验** | `scripts/check-jsonld.mjs` | 构建后扫描每页 JSON-LD：必须是合法 JSON、同一页不能有两个抢同一 `@type` 的实体、面包屑 position 要连续、署名不能是占位符 |
| **静态资源校验** | `scripts/check-assets.mjs` | 分享卡片图尺寸必须是 1200×630、文件不能是空的、页面引用的图必须真的存在 —— 防「图忘了提交，线上分享卡片 404」 |
| **订阅与收录守卫** | `scripts/check-feeds.mjs` | sitemap 是否指向真实页面（含中文百分号编码的正确比对）、RSS 是否 0 条或缺字段、robots.txt 有没有 `Disallow: /` 把整站屏蔽 |
| **性能基线** | `scripts/measure-perf.mjs` | 无头 Chrome 实测每页请求数、HTML gzip/原始字节、JS/CSS 体积与 DCL；数据记在 HANDOVER 的「性能基线」一节 |
| **链接人工核对** | `scripts/review-links.ts` | 生成离线核对清单（localStorage 存进度），导出后自动把 `reviewedAt` 写回 `links.ts`；标记「有问题」的条目写进 `.review/link-issues.md` 等你处理 |

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
│  │  │  ├─ courses/            课程资料：每种资料怎么用（`materials.mdx`）
│  │  │  ├─ research/           科研与深造
│  │  │  ├─ campus/             校园生活
│  │  │  ├─ mindset/            心态与避坑
│  │  │  └─ guides/             实用工具（链接、第三方工具、资料、模板）
│  │  └─ i18n/zh-CN.json     界面文案覆盖
│  ├─ pages/                 自定义路由（不走 Starlight 的文档路由）
│  │  ├─ stages/             按阶段浏览（自动聚合）
│  │  ├─ tags/               按标签浏览（自动聚合）
│  │  ├─ courses/            ★ 课程资料索引（可搜索、可筛选）+ 课程参考书目
│  │  ├─ changelog.astro     更新日志（构建时读 git log）
│  │  ├─ contributors.astro  贡献者（构建时读 git log）
│  │  └─ rss.xml.ts          RSS feed
│  ├─ components/
│  │  ├─ Banner.astro           ★ 时效看门狗（覆盖 Starlight）
│  │  ├─ Head.astro             ★ JSON-LD 结构化数据（覆盖 Starlight）
│  │  ├─ Footer.astro           文章元信息 + 免责声明（覆盖 Starlight）
│  │  ├─ ArticleMeta.astro      阶段/标签/作者/核对日期
│  │  ├─ ArticleGrid.astro      文章卡片网格
│  │  ├─ LinkGrid.astro         ★ 常用链接卡片墙（搜索 + 可达性角标）
│  │  ├─ ToolDirectory.astro    ★ 第三方工具清单（维护状态 + 校内可达性）
│  │  ├─ CourseExplorer.astro   ★ 课程索引的筛选界面（无 JS 也能读）
│  │  ├─ CourseSkillMap.astro   ★ 课程 ↔ 技能映射表（数据来自课程索引）
│  │  ├─ Checklist.astro        ★ 可勾选、会记住进度的清单（localStorage）
│  │  ├─ CreditPlanner.astro    ★ 学分缺口拆解表（纯前端计算 + 导出 JSON）
│  │  ├─ SelectionWorkbench.astro ★ 选课决策工作台（先修缺口 / 期末撞车 / 投入超载）
│  │  ├─ ArchiveDirectory.astro ★ 外部资料库地图
│  │  └─ ResourceList.astro     资料下载列表
│  ├─ data/
│  │  ├─ links.ts            ★ 校内常用链接（改这里就更新页面）
│  │  ├─ link-status.json    链接实测结果（`npm run check:links` 生成，别手改）
│  │  ├─ courses.ts          ★ 资料库档案 + 课程索引的读取与链接组装
│  │  ├─ course-index.json   课程资料索引（`npm run courses` 生成，别手改）
│  │  ├─ archives.ts         不按课程组织的资源站 + 使用红线
│  │  ├─ git.ts              git log 读取（更新日志 / 贡献者用）
│  │  ├─ resources.ts        ★ 资料下载清单（改这里就更新页面）
│  │  ├─ tools.ts            ★ 学生自建工具清单（改这里就更新页面）
│  │  ├─ browse.ts           浏览页的 collection 查询（过滤规则只有一份）
│  │  └─ policy.ts           时效策略（读 content-policy.json）
│  ├─ utils/
│  │  ├─ media-embed.mjs     视频语法糖（`::bilibili` / `::video`）
│  │  └─ card-text.ts        卡片文案转义（`**加粗**` → `<strong>`，两个卡片组件共用）
│  └─ styles/custom.css      主题色（清华紫）与中文排版
├─ scripts/
│  ├─ check-content.ts       内容检查（CI 里跑，会阻断部署）
│  ├─ check-links.ts         校外链接实测（写 link-status.json）
│  ├─ review-links.ts        人工核对清单生成 + 结果写回 links.ts
│  ├─ e2e-smoke.mjs          交互冒烟测试（无头 Chrome）
│  ├─ check-jsonld.mjs       结构化数据校验（构建后扫描 dist）
│  ├─ check-assets.mjs       静态资源校验（分享卡片尺寸 / 是否漏提交）
│  ├─ check-feeds.mjs        sitemap / RSS / robots 校验
│  ├─ measure-perf.mjs       本地性能实测（无头 Chrome）
│  ├─ build-course-index.mjs 课程资料索引生成（扫描 reference/）
│  └─ generate-og.mjs        生成分享卡片图
├─ reference/                ⚠️ 本地参考资料：克隆来的公开资料库（体积可达 10 GB，已在 .gitignore 里）
├─ public/og.png             全站分享卡片图
├─ public/og/                板块级分享卡片图（courses / skills / links）
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

## 课程资料索引是怎么来的

`/courses/` 那一页的 142 门课、185 条资料**不是人肉抄的**，而是扫描出来的：

```
reference/REKCARC-TSC-UHT/         计算机系课程攻略（按学期分的课程目录）
reference/WeiYangXueXi.github.io/  未央书院学习资料共享计划（mkdocs nav）
reference/sast-skill-docs/         计算机系学生科协技能引导文档（课程↔技能映射）
ssast-readme.github.io/            软件学院 ReadMe 互助文档（mkdocs nav）
        │
        │  npm run courses
        ▼
src/data/course-index.json         课程名 / 类别 / 学期 / 参考书目 / 资料库路径+类型
        │
        │  构建时读取（src/data/courses.ts 负责把路径拼成链接）
        ▼
/courses/                          可搜索、可按类别/类型/资料库筛选
```

几个刻意的设计：

- **`reference/` 不进仓库。** 那几个资料库加起来十几 GB（大量 PDF），只在本地扫描用；
  扫描结果 `course-index.json` 才提交，所以 CI 和别人的机器上都不需要它们。
- **本站不镜像任何文件**，索引里存的是「资料库 + 库内路径」，链接指向原库。
- **课程名会归一化**：上游目录里带老师姓名/昵称的（`面向对象程序设计基础-刘知远老师`）会被合并成课程名，
  本站不出现对具体老师的指向。归一化规则写在 `scripts/build-course-index.mjs` 的 `NAME_OVERRIDES`。
- **可达性优先**：校内 GitLab 镜像排在 GitHub 前面，因为校园网里 `github.com` 网页端打不开（实测结论见站点上的链接页）。

资料库换了目录结构，跑一次 `npm run courses` 重新生成，然后提交 `src/data/course-index.json` 即可。

## 链接为什么会自己变「打不开」

`src/data/links.ts` 里的每条链接有两个独立的状态：

链接的可信度分三层，页面上分三个角标显示，**别混成一个「可信 / 不可信」**：

| 字段 / 产物 | 谁产生 | 能证明什么 |
| --- | --- | --- |
| `link-status.json` | `npm run check:links` | 网址能打开（HTTP < 400）。**只证明域名活着** |
| `reviewedAt` + `verifiedBy: 'auto'` | `npm run verify:links` | 抓页面比对标题与关键词，确认**地址还指向那个服务**（看不到登录后的内容） |
| `reviewedAt` + `verifiedBy: 'human'` | 人 | 有人真的点开用过。**只有这一层能确认入口没写错、功能还在** |

页面上因此有三个角标，缺哪个就标哪个。`npm run check:content` 会提醒你：实测结果超过 12 个月没更新、
某条链接实测失败、或者还有多少条没人人工核对过（进「债务总账」）。

### 先跑脚本核对（能省掉大部分人工）

```bash
npm run verify:links              # 只核对：抓 39 个页面，比对标题与期望关键词，输出 ok / suspect / fail
npm run verify:links -- --apply   # 把 ok 的写回 links.ts（reviewedAt + verifiedBy: 'auto'）
```

它会处理校园系统那些「看起来像坏了」的正常情况：GBK 老页面按声明编码解码、
登录页没有 `<title>`、跳转到 `/users/sign_in` 之类的认证端点。证据留在
`.review/link-verification.json`（状态码、最终地址、标题、命中与未命中的关键词），
`suspect` / `fail` 的条目**不会**被写回，留给人看。

:::caution[脚本核对 ≠ 人工核对]
脚本能确认「这个地址打开的是清华的网络学堂」，但**看不到登录后的内容**，
也发现不了「页面里功能挪了位置」。所以写回时标的是 `verifiedBy: 'auto'`，
页面上显示「脚本核对」，与人工点开确认的「人工核对」区分开。
:::

### 人工核对链接（`npm run review:links`）

「这个入口现在还是干这件事吗」只有人能判断。为此准备了一个**本地离线核对清单**：
不用手改文件，也不用一条条复制网址。

```bash
npm run review:links -- --open        # 生成 .review/link-review.html 并自动打开
```

打开的页面里每条链接是一张卡片，显示名称、说明、网址、可达性、**脚本实测状态**和来源：

| 操作 | 快捷键 | 说明 |
| --- | --- | --- |
| 打开链接 | <kbd>o</kbd> | 在新标签页打开，自己看内容对不对 |
| 记「没问题」 | <kbd>y</kbd> | 这条就算人工核对过了 |
| 记「有问题」 | <kbd>n</kbd> | 展开输入框：填**新地址**（搬走了）或**备注**（说清哪里不对） |
| 上下移动 | <kbd>j</kbd> / <kbd>k</kbd> | |

- 进度存在浏览器 **localStorage**，关掉页面不会丢；
- 标记过的卡片**留在原位变暗**，不会因为消失而顶位、让你连着标错下一条；
- 核对完点「导出 link-review.json」，然后：

```bash
npm run review:links:apply -- ~/Downloads/link-review.json          # 只看 diff，不改文件
npm run review:links:apply -- ~/Downloads/link-review.json --write  # 写回 links.ts
npm run check:content && npm run build
```

写回的规则：

| 你的标记 | 结果 |
| --- | --- |
| ✓ 没问题 | 条目上写入 `reviewedAt: '<导出日期>'`，页面上的「人工核对：待补」消失 |
| ✗ 有问题 + 填了新地址 | 替换 `url`，并同样记上 `reviewedAt`（你已经确认过新地址） |
| ✗ 有问题 + 只写备注 | **不自动改**，写进 `.review/link-issues.md`，需要你自己决定怎么处理 |

`review:links` 生成的东西都在 `.review/`（已在 `.gitignore` 里），不进仓库。
判断标准只有一条：**点开后，这个入口还是不是干说明里的那件事**。

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
