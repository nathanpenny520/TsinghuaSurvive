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
| OAuth 中转 Worker | `tsinghua-guide-auth`，自定义域名 `https://auth.nathanpenny.fun`（内容后台的 GitHub 登录用，见第 9 节）。**已部署**（2026-09-30，版本 `e9b944e1`），还差两个 secret（GitHub OAuth App 的 client id/secret） |
| R2 桶（内容后台的图片/视频） | `tsinghua-guide-media`，公开域名 `https://media.nathanpenny.fun`。**已建好并接上域名 + CORS**（2026-09-30，`npm run r2:setup`），还差一个 R2 API 令牌填 `access_key_id` |

Cloudflare 侧有**三个 Worker、三个自定义域名、一个 R2 桶**（内容后台的登录中转与媒体存储），
没有任何 KV / D1 / Durable Object。三者的免费额度都远高于本站量级，不会产生费用。
（前两个 Worker 和「零 R2」是 2026-09-30 之前的状态；那之后加了内容后台。）

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
| 分享卡片图 | `public/og.png`，由 `scripts/generate-og.mjs` 生成 |
| RSS | `src/pages/rss.xml.ts` |
| 时效阈值单一来源 | `content-policy.json` |
| 内容后台（改内容 / 插图 / 嵌视频） | `public/admin/`（Sveltia CMS，纯静态）+ R2 媒体库，见第 9 节 |
| 视频嵌入语法糖 | `src/utils/media-embed.mjs` + `astro.config.mjs` 的 `markdown.processor`，见第 9 节 |

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
src/content/docs/        ★ 所有文章（按板块分目录）
src/data/links.ts        ★ 校内常用链接（改这个文件就更新页面）
src/data/link-status.json  链接实测结果（脚本生成，别手改）
src/data/courses.ts      资料库档案 + 课程索引读取
src/data/course-index.json 课程资料索引（脚本生成，别手改）
src/data/archives.ts     不按课程组织的资源站 + 使用红线
src/data/git.ts          git log 读取（更新日志 / 贡献者用）
src/data/resources.ts    资料下载清单（同上）
src/components/          Footer（站脚免责声明）、LinkGrid、CourseExplorer、ArchiveDirectory、ResourceList
src/pages/courses/       ★ 课程资料索引页（可筛选）
src/pages/changelog.astro、contributors.astro  构建时读 git log 生成
scripts/check-feeds.mjs  sitemap / RSS / robots 校验（构建后）
scripts/measure-perf.mjs 本地性能实测（写进本文档 7.5 节）
src/styles/custom.css    清华紫主题 + 中文排版
astro.config.mjs         侧边栏、SEO、域名、仓库地址
wrangler.jsonc           Workers 部署配置
OUTLINE.md               内容路线图（哪些写了、哪些没写）
REFERENCE-NOTES.md       参考项目借鉴笔记（哪些抄了、哪些没抄、为什么）
reference/               ⚠️ 本地参考资料，不进仓库（见 .gitignore）
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

#### 注意 `.md` 与 `.mdx` 的一个差别（踩过一次）

正文里要写 JS（比如 `courses/materials.mdx` 那样从 `src/data/` 导入数据来渲染）时必须用 `.mdx`，
而且**顶层的声明要写成 `export const`**：

```mdx
export const kindsInUse = ALL_KINDS.filter(...);   // ✅
const kindsInUse = ALL_KINDS.filter(...);          // ❌ 构建失败
```

**实测结论（2026-09-30 亲自验过，不是听说）**：裸 `const` 时
`astro check` 报 **0 errors**，但 `npm run build` 直接失败。也就是说这一类问题
**`npm run check:all` 抓不到，只有真跑一次 build 才会暴露**。报错文案随写法不同：

- `const G = { 往年题: { … } };`（对象字面量）→
  `Could not parse expression with oxc: Expected ',' or ')' but found ':' (mdx-jsx:unexpected-character)`
- `const x = ARR.filter(Boolean);`（出现在 `import` 之后的普通语句）→
  `Unexpected statement in code: only import/exports are supported (mdxjs-rs:oxc)`

两种写法的修法一样：加 `export`。提 PR 前请本地跑一次 `npm run build`，别只跑 `check:all`。

### 提交前的自动检查

```bash
npm run check:all              # 类型检查 + 内容检查
npm run check:content          # 只跑内容检查
npm run check:content:strict   # 连「债务警告」也当错误（发布前用）
```

内容检查（`scripts/check-content.ts`）会抓这些**构建本身抓不到**的问题：

| 级别 | 检查项 |
| --- | --- |
| **错误**（阻断部署） | 站内链接指向不存在的页面（带文件:行号）、文件名不是 ASCII slug、`reviewedAt` 写在未来、同目录 `sidebar.order` 冲突、`links.ts` 里有重名条目或非法网址、资料填了提取码却没链接、课程索引引用了未定义的资料库或拼不出链接 |
| **警告**（只提示） | 作者还是占位符、`status: draft` 数量、链接没有 `reviewedAt`（人工核对）或超过 12 个月未确认、链接实测结果过期或有链接打不开、文章超过 6 个月未核对 |

CI 里另外跑三项（本地 `npm run verify` 一次跑完）：

| 脚本 | 时机 | 拦什么 |
| --- | --- | --- |
| `courses:check` | 构建前 | 课程索引与 `reference/` 不一致（没有 `reference/` 时自动跳过） |
| `check:jsonld` | 构建后 | JSON-LD 语法/重复 `@type`/面包屑 position/占位署名 —— 这些错了不会报错，只会静默失效 |
| `check:assets` | 构建后 | 分享卡片图尺寸不是 1200×630、文件是空的、页面引用的图在 `dist` 里不存在 |
| `check:feeds` | 构建后 | sitemap 指向不存在的页面（含中文 URL 的百分号编码比对）、RSS 为空或缺字段、robots.txt 把整站 `Disallow` 掉 |

**错误级检测都做过注入测试验证过会真的触发**，不是写了没用。

### 实测链接是否还能打开

```bash
npm run check:links        # 逐个请求校外链接，写 src/data/link-status.json
npm run check:links -- --fail   # 有链接打不开时以非 0 退出
```

站点上每条链接有**两个独立角标**：

| 角标 | 来源 | 含义 |
| --- | --- | --- |
| 实测可访问 / 实测打不开 | `npm run check:links` | 网址活着（HTTP < 400）。**不证明入口还是干那件事** |
| 人工核对 2026-09-30 / 人工核对：待补 | `links.ts` 的 `reviewedAt` | **有人点开确认过入口没写错**，这才是可信度的来源 |

⚠️ 这个脚本**需要联网**，所以没有放进 CI 的必跑步骤（CI 里跑会因为某个学校系统抽风而误报）。
建议每次内容批量更新后手动跑一次并提交 `link-status.json`。

### 验证前端交互（改了 `/courses/` 或链接页之后）

```bash
npm run build
npx astro preview --port 4321 &     # 或者任意静态服务器指向 dist/
npm run check:e2e -- --base http://127.0.0.1:4321
```

它会用无头 Chrome 打开 `/courses/` 与 `/guides/links/`，真的输入搜索词、点筛选按钮，
断言「卡片数会变、清除筛选能还原、无结果时给空状态」。找不到 Chrome 时会跳过而不是报错，
所以它没有进 CI（CI 里装浏览器成本太高），属于本地改动后的自查手段。

### 重新生成课程资料索引

```bash
npm run courses            # 扫描 reference/ 下的公开资料库 → src/data/course-index.json
npm run courses:check      # 校验现有 JSON 与 reference/ 是否一致
```

`reference/` 与 `ssast-readme.github.io/` 是**本地参考资料**（克隆来的第三方资料库，合计十几 GB），
已经写进 `.gitignore`，不要提交。没有它们时脚本会跳过对应资料库并打提示，
`/courses/` 页面用已提交的 `course-index.json` 照常渲染。

### 链接核对：先脚本、后人工

```bash
npm run verify:links              # 抓页面比对标题/关键词 → .review/link-verification.json
npm run verify:links -- --apply   # ok 的条目写回 reviewedAt + verifiedBy: 'auto'
```

- 脚本判断依据有三类：标题命中期望词、正文命中、落到同机构认证端点/机构自有域名。
  关键词表写在 `scripts/verify-links.ts` 的 `EXPECT_BY_HOST`（**要维护**：新增链接时补一行）。
- 老系统是 GBK 编码、登录页没有标题，这两类**不是故障**，脚本已处理。
- `verifiedBy: 'auto'` 与 `'human'` 在页面上分别显示「脚本核对」「人工核对」，
  **不要**把脚本结论当成人工核对 —— 登录后的功能只有人能确认。

### 人工核对链接（把「核对：待补」清掉）

```bash
npm run review:links -- --open      # 生成 .review/link-review.html 并打开
#   在页面里逐条：打开（o）→ 看完 → ✓ 没问题（y）或 ✗ 有问题（n，填新地址/备注）
#   进度存在浏览器 localStorage，关掉不丢；核对完点「导出 link-review.json」
npm run review:links:apply -- ~/Downloads/link-review.json          # 看 diff
npm run review:links:apply -- ~/Downloads/link-review.json --write  # 写回 links.ts
npm run check:content && npm run build
```

- ✓ 的条目会被写上 `reviewedAt: '<导出日期>'`；
- ✗ 但填了新地址的，会替换 `url` 并同样记上 `reviewedAt`；
- ✗ 只写了备注的，写进 `.review/link-issues.md`，**不会自动改**，需要你决定怎么处理。
- `.review/` 已经在 `.gitignore` 里：那是工作目录，不进仓库。

### 加一个校内链接

编辑 `src/data/links.ts`，加一条记录（含 `reach` 可达性与 `origin` 来源）。
**只有填了 `reviewedAt: '2026-09-30'` 才会消掉页面上的「人工核对：待补」**——
网址活着是机器能测的，入口有没有写错只有人能判断，这是本站最重要的机制，别跳过。

### 加一份资料

编辑 `src/data/resources.ts`，`url` 填网盘链接。留空或写 `'TODO'` 时页面显示「待补充」，不会渲染死链。**文件本体不要进仓库。**

### 站内互动工具（没有后端）

三个纯前端工具，数据只存在读者自己的浏览器里（localStorage），**不采集、不上传**：

| 工具 | 文件 | 存什么 |
| --- | --- | --- |
| 报到清单（可勾选） | `src/components/Checklist.astro`，用在 `/freshman/arrival-checklist/` | 勾选状态，键名 `tsinghua-guide-checklist:<id>` |
| 学分缺口拆解表 | `src/components/CreditPlanner.astro`，用在 `/academics/credit-planner/` | 类别/学分/课程表，键名 `tsinghua-guide-credit-planner-v1` |
| 选课决策工作台 | `src/components/SelectionWorkbench.astro`，用在 `/academics/course-decision/` | 候选课与承受基线，键名 `tsinghua-guide-selection-workbench-v1` |

改动它们之后，务必跑一次交互冒烟测试（`npm run check:e2e`）——这几个组件的关键路径是「点一下会不会真算」。

#### 写这类组件必须用 `is:global` 样式（踩过一次）

`CreditPlanner` 和 `SelectionWorkbench` 这两个工具的形态都是「模板渲染一遍 + JS 用 innerHTML 再渲染一遍」。
（`Checklist` 不是：它整块 DOM 都由模板渲染，`grep innerHTML src/components/Checklist.astro` 是 0，所以没有这个隐患。）
Astro 的 `<style>` **默认是作用域样式**，
选择器会编译成 `.foo:where(.astro-xxxx) input:where(.astro-xxxx)`；而 `astro-xxxx` 只在构建时加到**模板元素**上，
**JS 插入的元素没有这个类**，于是那部分样式整片失效——输入框退回浏览器默认的白底黑字、行分隔线消失，
**而且没有任何报错或构建警告**。

所以新组件的 `<style>` 一律写成 `<style is:global>`，靠类名前缀（`.planner` / `.wb-` / `.cg-`）做命名空间。
`CreditPlanner` 原来就是踩了这个坑（2026-09-30 修掉），`CourseExplorer` / `SelectionWorkbench` 一开始就写对了。

`scripts/e2e-smoke.mjs` 里为此加了断言：点「加一行」之后量新插入输入框的 `computedStyle`，边框不是 `solid` 就判失败。
**再写新的互动组件时，照着加一条同样的断言。**

### 重新生成分享卡片图

```bash
npm run og             # 只要 npm install 过就能跑（用 sharp 渲染，无额外依赖）
```

图片内容在 `scripts/generate-og.mjs` 顶部改。**中文标题改动后一定要重新生成**，否则分享出去的卡片还是旧标题。

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
| **github.com 网页端打不开** | 清华校园网实测（2026-09-30）：`github.com` 与 `raw.githubusercontent.com` **超时**，但 **SSH 通道通**（22 与 `ssh.github.com:443` 都测过）、`api.github.com` 通（1.2s）。所以 **`git push` / `git clone` / `gh` CLI 全部正常，只有网页端不行**。结论：在校园网内走「本地改 + `git push`」，不要指望点网页上的「编辑此页」——**那些链接本身没写错，是网络问题**。`gh` CLI 走 API，所以 `gh pr`、`gh run`、`gh secret` 在校园网里都能用 |
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

1. **核对校内常用链接**（`src/data/links.ts`），逐条点开确认后填 `reviewedAt` 日期。
   现在有 38 条，`npm run check:content` 的「债务总账」会告诉你还剩多少条没核对。
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

## 7.5 性能基线（2026-09-30 本地实测）

用 `npm run measure:perf`（无头 Chrome + 浏览器计时 API，无新依赖）量了一次。**读数字前先看局限**：
本机静态服务器不做 gzip（transferSize 偏大），所以额外算了 HTML 的 gzip 大小；单机、单次、无网络延迟模拟，
这是**量级参考**，不是实验室数据。校园网内的真实体验还受出口与国际链路影响，这里测不出来。

```bash
npm run build
npx http-server dist -p 4321 &
npm run measure:perf -- --base http://127.0.0.1:4321
```

| 页面 | 请求数 | HTML(gzip) | HTML(原始) | JS | CSS | 资源合计 | DCL |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 首页 | 6 | 9.4 KB | 32.0 KB | 97.8 KB / 3 个 | 70.9 KB | 169.3 KB | 20 ms |
| 课程资料索引（最重的一页） | 6 | 25.5 KB | 204.4 KB | 97.8 KB / 3 个 | 77.3 KB | 175.1 KB | 47 ms |
| 校内常用链接 | 10 | 18.9 KB | 97.0 KB | 104.0 KB / 7 个 | 89.0 KB | 193.0 KB | 48 ms |
| 技能入门 | 8 | 16.2 KB | 68.5 KB | 101.2 KB / 6 个 | 70.9 KB | 172.1 KB | 32 ms |

**结论与后续可做的事**：

- **读这张表之前先看服务器**：上面的数字是在 `npx http-server dist`（**不做压缩**）下测的，
  所以 JS/CSS/原始 HTML 都偏大。用 `npm run preview`（Astro 自带服务器，会压缩）再测一遍，
  同一页的 `HTML(gzip)` 基本不变，但 JS 从 ~98 KB 掉到 ~29 KB、CSS 从 ~71 KB 掉到 ~14 KB。
  **换服务器测出来的数字不能和这张表直接比**，要更新就整表一起重测。
- **2026-09-30 第二轮**：`校内常用链接` 从 39 条加到 47 条，该页 `HTML(gzip)` 约 +1.8 KB（18.9 → 20.7 KB）。
  其余页面基本没动（新增的 `/academics/course-decision/` 与 `/courses/materials/` 是独立页面，不影响这些页）。
- **HTML 不是瓶颈**。课程索引页虽然原始 204 KB，gzip 后只有 25.5 KB（8 倍压缩，因为卡片结构高度重复）。
  这一页曾经是 269 KB，2026-09-30 做过一次瘦身（去掉 Astro 作用域类 + `data-search` 副本 + 按资料库分组），
  详见第 8 节「已知限制」里那条「不要改回作用域样式」。
- **真正的重量是 Starlight 的 UI bundle（约 98–104 KB 未压缩）与 CSS（71–89 KB）**，
  两者都由框架提供（搜索、主题切换、目录、代码高亮）。gzip 后约 30 KB + 15 KB，可以接受。
  如果哪天要再快一档，方向是**按需加载 Expressive Code**（只有带代码块的页面才需要），而不是继续压 HTML。
- **图片走 R2，不走 Astro 的图片优化管线**：正文里的图片是 R2 的公网 URL，通过后台的媒体库上传（上传前在浏览器里就转成 WebP、长边 2048、剥掉 EXIF）。
  代价是不会生成响应式 srcset / AVIF；收益是作者零心智负担、仓库永远不因为图片变重。
  想改回「图片进仓库 + Astro 优化」的话，得同时改 `public/admin/config.yml` 的媒体库设置和 `scripts/check-media.mjs` 的白名单，别只改一半。
  （Astro 确实会把正文里的**相对路径**图片优化成 WebP，这一点实测过；是 Sveltia 的 `public_folder` 不支持相对路径，所以两者不能同时要。）

---

## 8. 已知限制

- **境内访问是「可用」不是「快」**。整页 0.5–0.9s，因为走的是 Cloudflare 海外节点。要更快需要 **ICP 备案 + Cloudflare 中国网络（企业版）**，或换境内云厂商静态托管。这是产品决策，不是技术限制。
- **`workers.dev` 入口已关闭**，不要把它写进任何对外宣传材料。
- **没有评论系统**（按需求刻意不做）。纠错入口是页脚的 GitHub Issues 链接。
- **有 CMS 了（2026-09-30 起）**：站内后台 `https://tsinghua.nathanpenny.fun/admin/`，浏览器里就能改内容、拖图、嵌视频，不需要会 Git。它是 Sveltia CMS（纯前端）+ 一个自建的 OAuth 中转 Worker（`auth-worker/`），每次保存自动开 PR 并走预览 + 全套 CI。登录用 GitHub 一键授权（**只有点登录那一下需要代理**，之后全在校园网内完成）。录入流程、OAuth 与 R2 的开通步骤、踩过的坑都在第 9 节。不会 Git 的人仍然可以发 Issue 由人代排。
- **站点上没有任何课程文件**。`/courses/` 只是索引，链接指向第三方资料库；他们的许可、存活、下架都不由本站控制。
- **链接实测依赖联网**，所以 `npm run check:links` 不进 CI 必跑步骤；结果过期时只给警告，不阻断构建。
- **更新日志 / 贡献者页依赖完整 Git 历史**（CI 的 `fetch-depth: 0` 就是为它和 Starlight 的「最后更新」配的）。拿不到历史时这两个页面会降级显示一句说明，不会构建失败。
- **构建依赖 Node 20+**，CI 用 Node 22。
- **课程索引页刻意不用 Astro 的作用域样式**（`<style is:global>` + `cg-` 前缀）。作用域会给 2500 个元素各加一个 `astro-xxxx` 类，实测多出 40 KB；页面体积已从 269 KB 降到 209 KB。**不要"顺手"改回作用域样式**，那会把体积加回去。除了体积，还有一条更硬的理由：凡是**用 JS 二次渲染**的组件，作用域样式会直接失效（见第 4 节「写这类组件必须用 `is:global` 样式」）。
- **JSON-LD 只在 `src/components/Head.astro` 输出**。页面里不要再写一份，否则同页两个 `@type` 会互相打架（`check:jsonld` 会拦住，但别故意踩）。

---

## 9. 站内后台（改内容不用碰代码）

> 2026-09-30 新增。目标是「会用浏览器就能改内容」，同时**不放松**原有的质量门。

### 9.1 它是什么

| 项 | 内容 |
| --- | --- |
| 地址 | <https://tsinghua.nathanpenny.fun/admin/> |
| 实现 | Sveltia CMS —— 纯前端单页应用，静态文件在 `public/admin/`（`index.html` + `config.yml`），随站点一起部署，**没有额外服务器** |
| 配置 | `public/admin/config.yml`（12 个目录集合 + 1 个单文件集合，覆盖全部 44 个内容文件） |
| 登录 | **默认 GitHub 一键登录（OAuth）**，走自建的轻量中转 `auth.nathanpenny.fun`（`auth-worker/`）；令牌登录保留作备用 |
| 数据流 | 浏览器 →（登录时一次 OAuth 跳转）→ 之后所有读写直连 `api.github.com` → 提交到分支 → PR → `preview.nathanpenny.fun` + 全套 CI → 合并到 main → 自动部署 |
| 保存方式 | `publish_mode: editorial_workflow`：**每次保存开一个 PR**，不直推 main |

**为什么需要一个 OAuth 中转**：Sveltia CMS 是纯前端应用，浏览器里不能放 GitHub 的 client secret；
GitHub 的 PKCE 纯前端流程目前还没开放（官方路线图暂停）。所以用一个 13KB 的 Cloudflare Worker
（`auth-worker/`，内联了上游 `sveltia/sveltia-cms-auth`）做「授权码 → 访问令牌」的交换。

**代理只在登录那一步要**：OAuth 授权页在 `github.com`（校园网实测打不开），所以点「Sign in with GitHub」时需要一个能打开
github.com 的网络。授权完成后拿到的是长效令牌（存浏览器 localStorage），**之后改内容、传图、提交都不需要代理**
（全走 `api.github.com`，实测通）。每隔很久（换浏览器/清缓存/令牌失效）才需要再登录一次。

### 9.2 只做一次（A）：GitHub 登录的 OAuth 中转

> 完整步骤也写在 `auth-worker/README.md`；这里只留运维视角的要点。
>
> **当前状态（2026-09-30）**：Worker 已经部署好了（`npm run auth:deploy`，自定义域名与证书都已生效，
> 版本 `e9b944e1`），所以下面第 2 步的 `wrangler deploy` 不用再跑；**只差第 1 步的 OAuth App 和两个 secret**。
> 在配好之前，`auth.nathanpenny.fun/auth` 会明确返回「OAuth app client ID or secret is not configured」。

1. **注册 GitHub OAuth App**（需要代理）：<https://github.com/settings/applications/new>
   - Homepage URL：`https://tsinghua.nathanpenny.fun/`
   - **Authorization callback URL：`https://auth.nathanpenny.fun/callback`**（必须一字不差）
   - 创建后记下 **Client ID**，再点 **Generate a new client secret** 记下 **Client Secret**
2. **写密钥**（需要你自己的 Cloudflare 凭据；每条命令都会立即部署一个新版本）：
   ```bash
   cd auth-worker
   npx wrangler secret put GITHUB_CLIENT_ID       # 粘贴 Client ID
   npx wrangler secret put GITHUB_CLIENT_SECRET   # 粘贴 Client Secret
   npx wrangler deploy                            # 首次部署才需要；已部署过可跳过
   ```
   想先看打包结果不部署：`npm run auth:dry`。域名和证书是首次部署时自动建的。
3. **确认配置对得上**：`public/admin/config.yml` 里 `backend.base_url` 必须是 `https://auth.nathanpenny.fun`。
   `npm run check:admin` 会比对它与 `auth-worker/wrangler.jsonc` 里的 routes，防止两边漂移。
   Worker 里的 `ALLOWED_DOMAINS`（`wrangler.jsonc` 的 vars）决定**哪些站点可以用这个中转**，
   当前是 `*.nathanpenny.fun,localhost` —— 不要改成 `*`。
4. **验证**：开代理打开 `/admin/` → 点 **Sign in with GitHub** → 授权 → 应该回到后台并看到 9 个分类。

**为什么用 `auth_scope: public_repo`**：本站是公开仓库，`public_repo` 足够读写文章与开 PR，
比默认的 `repo`（含所有私有仓库读写）小得多。它只接受 `repo` 或 `public_repo` 两个值
（写成 `public_repo,user` 会被 schema 直接拒绝 —— 这是实测踩过的坑）。

### 9.3 只做一次（B）：R2 媒体库（图片、视频存这里）

后台的图片/视频**不进 Git 仓库**，存在 R2 桶 `tsinghua-guide-media`，通过公开域名
`https://media.nathanpenny.fun` 访问。

**当前状态（2026-09-30）**：桶、公开域名、CORS **都已经配好并实测通过**
（`curl` 取对象返回 200，且带正确的 `access-control-allow-origin` / `ETag` 头）。
只剩最后一步 —— 建 R2 API 令牌、把 **Access Key ID** 填进 `public/admin/config.yml`。

三步都已经脚本化，可重复执行（桶被删、换账号、别人 fork 都能一键复原）：

```bash
npm run r2:setup -- --check   # 只报告当前状态，不改任何东西
npm run r2:setup              # 建桶 + 接公开域名 + 应用 CORS
```

对应关系：桶名 / 域名 / zone id / CORS 策略分别写在脚本顶部、`auth-worker` 同级的 `r2/cors.json` 里。

**最后一步（脚本做不了，官方只提供控制台路径）**：创建 R2 API 令牌

1. 打开 <https://dash.cloudflare.com/?to=/:account/r2/api-tokens> → **Create API token**
2. Permission 选 **Object Read & Write**，桶**只勾 `tsinghua-guide-media`**
3. 把 **Access Key ID** 填进 `public/admin/config.yml` 的
   `media_libraries.cloudflare_r2.access_key_id`（它不是密钥，官方明确说可以公开放在配置里）
4. **Secret Access Key 不要写进任何文件**：每个编辑者第一次打开后台媒体库时在界面上输入一次，
   存在自己浏览器里。配置文件里根本没有它的位置。

改完 `config.yml` 要提交并部署（后台读的是线上那份配置）。`npm run check:admin` 会告诉你还缺什么。

**两个实施时踩到的坑**（都在上面脚本/文件里注释了）：

- **CORS 的 JSON 形状是 R2 那套**：`{ "rules": [ { "allowed": { "origins": [...] } } ] }`，
  不是 AWS S3 那种顶层 `AllowedOrigins`。写成 S3 形状 `wrangler` 会直接拒绝（`r2/cors.json` 里已按 R2 形状写好，
  用 `npm run r2:setup` 应用，不要手动粘控制台那份 S3 例子）。
- **`wrangler r2 object put/get` 默认操作本地模拟存储**：不加 `--remote` 时对象只写进 `.wrangler/state/`，
  桶里其实是空的（表现是桶信息里 `object_count: 0`、公开域名取不到对象）。做真实上传/校验时记得加 `--remote`。

### 9.4 日常维护后台

| 我想…… | 怎么做 |
| --- | --- |
| 加一个字段 | 先在 `src/content.config.ts` 加 schema，再在 `public/admin/config.yml` 的字段表里加，然后 `npm run check:admin` |
| 加一个集合（新目录） | 在 `astro.config.mjs` 的 sidebar 加一项（autogenerate），在 `config.yml` 加集合，`npm run check:admin` 会检查有没有文件漏在后台外面 |
| 加一篇文章能在后台创建 | 集合默认 `create: true`，不用改配置 |
| 改后台的字段说明 / 提示 | 直接改 `config.yml` 里的 `hint`、`description`（支持简单 Markdown） |
| 升级 Sveltia CMS | **两处一起改**：`public/admin/index.html` 的 `VERSION` 与 `package.json` 的 `@sveltia/cms`（必须锁同一个固定版本）。依赖的那个版本提供官方 schema，`npm run check:admin` 拿它校验配置；两者不一致会被检查报错。改完 `npm install && npm run check:admin`，再打开后台点一遍确认字段没变 |
| 校园网里 unpkg 不通、后台打不开 | `npm run admin:vendor`：把该版本的编辑器脚本放进 `public/admin/vendor/`（2.1MB / gzip 650KB，优先从 `node_modules` 复制，装不到才下载）并提交。后台页面「本地优先、CDN 兜底」，不用改代码 |
| 改 OAuth 中转的域名 | 三处一起改：`auth-worker/wrangler.jsonc` 的 routes、GitHub OAuth App 的 callback URL、`config.yml` 的 `backend.base_url`。`check:admin` 能查到前两处不一致，GitHub 那边只能人工确认 |
| 换 OAuth App / 密钥泄漏 | GitHub 上重新生成 client secret → `cd auth-worker && npx wrangler secret put GITHUB_CLIENT_SECRET`。旧的 secret 立即作废，不影响已登录的人（他们手里是访问令牌） |
| 给新贡献者开权限 | GitHub 仓库 → Settings → Collaborators 加 Write 权限，然后把后台地址发给 TA，让他点 **Sign in with GitHub**（**不需要**再教怎么建令牌） |
| 关掉整个后台 | 删除 `public/admin/`，把 `astro.config.mjs` 的 `markdown.processor` 换回默认（去掉 mediaEmbedPlugin），并 `npx wrangler delete --config auth-worker/wrangler.jsonc` |

### 9.5 备用登录：访问令牌（一般用不到）

`config.yml` 里保留 `token` 只是为了**中转 Worker 挂掉时不至于谁都进不来后台**；日常请用 GitHub 登录。
真要用令牌时（例如临时没有代理）：

1. 登录 GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate new token
2. Repository access：**Only select repositories** → 只勾 `nathanpenny520/TsinghuaSurvive`
3. Permissions（Repository permissions）：
   - **Contents: Read and write**（读写文章和图片）
   - **Pull requests: Read and write**（编辑工作流要开 PR；少了这个权限，保存会卡在「开不了 PR」）
4. 到期时间按需要选（最长 1 年）
5. 回到 <https://tsinghua.nathanpenny.fun/admin/> → **Sign In Using Access Token** → 粘贴令牌

⚠️ 令牌等于账号的写权限：不要写进文件、不要发群里、不要在机房公共电脑上保存。

想彻底去掉这个备用入口：把 `config.yml` 的 `auth_methods` 改成 `[oauth]`（`check:admin` 允许两种写法）。

### 9.6 踩过的坑（改动前先读）

1. **Astro 的内容加载器出错时，`npm run build` 仍然返回 0，而且那一页正文会整个变空**（实测，2026-09-30）。
   所以「构建成功」不代表内容都在。`npm run check:media:dist` 就是为这件事存在的：它会数产物里的视频容器
   与源码里的语法糖是否对得上。**任何「markdown 改了但页面少一块」都先用它定位。**
2. **`:::` 容器写法的视频指令没闭合，会把后面整篇正文吞掉**。语法糖推荐两个冒号的写法 `::bilibili[BV号]`。
   `check:media` 会拦住没闭合的写法。
3. **一个集合只能对应一种扩展名**（官方文档明确）。所以 `.mdx`（含 JSX 组件的页面）单独成集合，
   并在 `description` 里写明「不要删 import 那几行」。编辑器默认打开「原文模式」，`:::` 提示块与组件都不会被改写。
4. **Sveltia 保存时只写回配置里声明过的字段**，漏声明一个字段，作者保存一次就把它丢了。
   `npm run check:admin` 做的是「源码里出现过的 frontmatter 字段是否都被声明」的覆盖率检查 —— 加字段时别绕过它。
5. **后台不写 `slug` 字段**：文件名（网址）由作者在保存时手填，规则是小写英文/数字/连字符。
   这是被 `check-content.ts` 的 ASCII slug 规则逼出来的 —— 中文标题自动生成的 slug 会被 CI 拦下。
6. **Media 域名白名单在两处**：`public/admin/config.yml` 的 `public_url`（上传用）和
   `scripts/check-media.mjs` 的 `allowedHosts`（校验用）。换域名时两处都要改。
7. **后台是公开地址**，但里面没有任何密钥：仓库是 public，`config.yml` 里的 `access_key_id`/`bucket`/`account_id`
   官方明确说可以公开；真正的写权限在 GitHub（没有令牌只能看到登录页）。
   收录层面用三处一起挡：`public/robots.txt` 的 `Disallow: /admin/`、`public/_headers` 的 `X-Robots-Tag`、
   页面里的 `<meta name="robots" content="noindex">`。
8. **选项写在错误的层级 → CMS 静默忽略**（2026-09-30 实测，改完配置一定要在浏览器里打开一次后台看控制台）：
   - `commit_messages` 属于 `backend`，写在顶层无效；
   - `slug` 有**两套不同选项**：顶层只认编码/大小写这类，`editable`/`pattern`/`hint` 必须写在**每个集合**里；
   - `automatic_deployments` 已被官方标记为过时（改用 `skip_ci`），我们就没写它。
   这类问题现在由 `npm run check:admin` 用**官方 JSON Schema**（来自 `node_modules/@sveltia/cms`）在校验阶段挡掉。
9. **`.mdx` 里不能写 `<https://…>` 这种自动链接**：MDX 会把它当 JSX 解析，构建直接失败
   （报 `Unexpected character after <`）。`.mdx` 里请写 `[文字](https://…)`；`.md` 里两种都行。
10. **改完内容看一眼浏览器控制台**：`check:admin` 覆盖的是 schema 与字段，但 CMS 的运行时警告
    （比如某个选项被弃用）只有真打开后台才会打印。花 10 秒点一次，比事后排查省事。
11. **OAuth 相关的三处地址必须一致**，否则表现是「点了登录、也授权了，但回到后台仍是未登录」：
    `config.yml` 的 `backend.base_url`、`auth-worker/wrangler.jsonc` 的 routes、
    GitHub OAuth App 的 callback URL。前两处 `check:admin` 会比对；第三处只能人工确认。
12. **`auth_scope` 只接受 `repo` / `public_repo` 两个值**。写成 `public_repo,user` 这种 scope 列表会被
    schema 直接拒绝（实测踩过：官方 schema 的 enum 就只有这两个）。
13. **`auth-worker` 是第三个 Worker**，它不随主站 CI 部署（改动很少，手动 `npm run auth:deploy`）。
    改它之前先 `npm run auth:dry` 看打包结果；`ALLOWED_DOMAINS` 不要写成 `*`，那是防滥用白名单。
14. **内联的上游代码要保留来源注释与 LICENSE**：`auth-worker/src/index.js` 来自 MIT 许可的
    `sveltia/sveltia-cms-auth`，文件头记录了 commit 与 sha256，升级方式写在 `auth-worker/README.md`。
    `check:admin` 会检查这些注释和 LICENSE 还在不在。
