# 内容编辑方案：不改代码也能改内容，并且能插图 / 嵌视频

> 状态：**已按 A 方案落地 Phase 1**（见下面的「实施记录」；§5 里关于媒体库的那几节已被 R2 方案取代）。
> 本文保留提案时的完整论证与代价分析，方便以后回看「为什么这么选」。

---

## 实施记录（2026-09-30）

拍板结果：**A 方案（Sveltia CMS + `/admin/`）+ 图片视频存 Cloudflare R2 + GitHub OAuth 登录**。已落地的改动：

| 改动 | 文件 | 说明 |
| --- | --- | --- |
| 后台页面 | `public/admin/index.html` | 锁定 Sveltia `0.225.0`；本地 vendor 优先、unpkg 兜底；noindex |
| 后台配置 | `public/admin/config.yml` | 12 个目录集合 + 1 个单文件集合，覆盖全部 44 个内容文件；中文字段与提示；编辑工作流；OAuth 登录；R2 媒体库（浏览器端 WebP/2048/EXIF 剥离/30MB 上限） |
| OAuth 中转 | `auth-worker/`（`src/index.js` + `wrangler.jsonc` + `LICENSE.txt` + `README.md`） | 内联上游 `sveltia/sveltia-cms-auth`（MIT，单个 13KB Worker），部署到 `auth.nathanpenny.fun`；只做「授权码 → 访问令牌」的交换 |
| 视频语法糖 | `src/utils/media-embed.mjs` + `astro.config.mjs` | `::bilibili[BV号]` / `::video[https://…]`，输出 16:9 响应式容器 |
| 样式 | `src/styles/custom.css` | `.media-embed` 系列（16:9，不溢出手机） |
| 后台配置守卫 | `scripts/check-admin.mjs` | **用官方 JSON Schema 校验整份配置**（schema 来自 `node_modules/@sveltia/cms`，版本必须与后台页面锁定的版本一致）、字段覆盖率（漏字段=错误）、OAuth 三处地址防漂移、R2 占位符（提醒）、关键开关、44 个文件是否都被后台覆盖 |
| 依赖 | `package.json` | 新增 devDependencies：`@sveltia/cms`（提供官方 schema + `admin:vendor` 的本地副本来源）、`ajv`（JSON Schema 校验）、`@astrojs/markdown-satteri`（astro.config 里显式用的处理器） |
| 媒体守卫 | `scripts/check-media.mjs` | 语法糖写法、外链图床、`http://`、空 alt、产物与源码的容器数比对 |
| 可选兜底 | `scripts/vendor-admin.mjs` | `npm run admin:vendor` 把编辑器脚本放进仓库（校园网 CDN 不通时用） |
| 云端资源开通 | `scripts/r2-setup.mjs` + `r2/cors.json` | `npm run r2:setup`（可重复执行）：建桶 `tsinghua-guide-media`、接公开域名 `media.nathanpenny.fun`、应用 CORS。**2026-09-30 已执行并实测通过**（curl 取对象 200 + 正确的 CORS 头） |
| 收敛收录 | `public/robots.txt`、`public/_headers`、页面 meta | 三处一起挡 `/admin/` |
| CI | `.github/workflows/deploy.yml`、`preview.yml`、`package.json` | 新增 `check:admin`、`check:media`（构建前）与 `check:media:dist`（构建后），并入 `verify` |
| 文档 | `README.md`、`HANDOVER.md` 第 9 节、`auth-worker/README.md`、`contribute.mdx` | 后台流程、OAuth 与 R2 开通步骤、踩坑记录 |

### 与原提案的四处偏差（都是实施中实测后改的）

1. **视频语法糖改用 Sätteri 插件，不是 remark 插件。**
   Astro 7 的默认 Markdown 处理器是 Sätteri，`markdown.remarkPlugins` 需要额外装 `@astrojs/markdown-remark`
   并把全站管线换回 unified。为一个语法糖换掉整个渲染器不划算，所以改用 Sätteri 自带的
   `mdastPlugins`（Starlight 的 `:::tip` 也是这么接的），并显式写 `satteri({ mdastPlugins: [...] })`
   —— 参数与 Astro 默认值完全一致，渲染行为不变。
2. **媒体库直接上 R2（拍板结论），没有先用 `public/uploads`。**
   好处是仓库永远不因图片变重；代价见 §5.2 的取舍说明与 `HANDOVER.md` 第 9 节的开通清单。
3. **`.mdx` 单独成集合。** 官方明确「一个集合只列出一种扩展名的文件」，而站上 10 个 `.mdx` 里有 JSX 组件，
   所以按目录拆成「文章（.md）」与「含组件页面（.mdx）」两组，后者在后台里单独写清风险提示。
4. **新增了一条提案里没预料到的守卫。** 实测发现：**Astro 的内容加载器出错时 `npm run build` 仍然返回 0，
   而且那一页正文会整个变空**。也就是「构建成功」完全不等于「内容都在」。
   于是有了 `check:media:dist`：数产物里的视频容器数量与源码里的语法糖是否一致。
5. **新增了「用无头 Chrome 打开一次后台」的验证手段，并因此修掉三个静默失效的配置错误。**
   把配置丢给真实 CMS 跑一遍才发现：`commit_messages` 写在顶层（应在 `backend` 下）、
   `slug.editable/pattern/hint` 写在顶层（应在集合级）、`automatic_deployments` 已被官方标记过时——
   三者 CMS 都只是打印一句 warning 然后**静默忽略**，配置看起来「没问题」。
   对应措施：`check:admin` 现在用官方 JSON Schema 校验整份配置，并且要求后台页面锁定的版本与
   `package.json` 里依赖的版本一致（schema 与真实运行的 CMS 必须同源）。
   验证方法记在 `HANDOVER.md` 第 9.6 节第 8、10 条。
6. **登录方式从「令牌」改成「GitHub OAuth」**（拍板：可以开代理，令牌太麻烦）。
   做法：把上游 `sveltia/sveltia-cms-auth`（MIT，单个 13KB Worker）内联到 `auth-worker/`，
   部署到 `auth.nathanpenny.fun`，只做「授权码 → 访问令牌」的交换。
   `auth_methods: [oauth, token]`：默认一键登录，令牌只作为中转挂掉时的备用入口（想彻底去掉就改成 `[oauth]`）。
   代价：多一个 Worker（第三个），并且**登录那一步需要代理**（授权页在 github.com）；
   授权后拿到长效令牌，之后读写全部在校园网内完成。
   注意：`auth_scope` 只接受 `repo` / `public_repo`（不能写 scope 列表），已按公开仓库收窄成 `public_repo`。

### 还没做的（只有你能做）

1. **GitHub OAuth App 的两个密钥**：
   - 注册 OAuth App（需要代理）：<https://github.com/settings/applications/new>，
     callback 必须是 `https://auth.nathanpenny.fun/callback`；
   - `cd auth-worker && npx wrangler secret put GITHUB_CLIENT_ID`（粘贴）、`... GITHUB_CLIENT_SECRET`（粘贴）。
   **中转 Worker 本身已经部署好了**（2026-09-30，域名与证书生效，版本 `e9b944e1`），不用再跑 `wrangler deploy`；
   在配好密钥之前，`https://auth.nathanpenny.fun/auth` 会返回 `MISCONFIGURED_CLIENT`（这是预期行为，已验证）。
2. **R2 API 令牌**（`auth_key_id`）：
   - 建桶 / 公开域名 / CORS **已经完成并实测通过**（`npm run r2:setup`，桶 `tsinghua-guide-media`，
     域名 `media.nathanpenny.fun`，curl 取对象 200 且 CORS 头正确）；
   - 还剩控制台里建一个 **Object Read & Write**、只限该桶的 R2 API 令牌，
     把 **Access Key ID** 填进 `public/admin/config.yml`（它不是密钥）；
     **Secret Access Key 不进任何文件**，每个编辑者第一次用媒体库时在浏览器里输入一次。
3. 之后可以在校园网里复测 unpkg 可达性；不通就跑 `npm run admin:vendor` 把编辑器脚本放进仓库。

---

## 0. 结论（TL;DR）

> ⚠️ 以下是**拍板前**写的提案结论（当时推荐令牌登录 + 仓库内媒体库）。
> 最终落地是 **OAuth 登录 + R2 媒体库**，差异与理由见上面的「实施记录」。保留原文是为了留下决策过程。

**推荐 A 方案：给站点加一个站内后台 `/admin/`，用 Sveltia CMS（Git 原生 CMS，零后端、零新资源），
配「浏览器端自动压图 + 仓库内媒体库」解决图片，配「B站嵌入语法糖」解决视频。**

三个关键判断（都经过实测，见 §1、§5、§6）：

| 判断 | 依据 |
| --- | --- |
| 后台必须**放在自己的域名下**，不能依赖 github.com 网页端 | 校园网实测 `github.com` 网页端超时、`api.github.com` 通（README:37-50） |
| 提案时建议 **PAT 登录**；最终改为 **OAuth + 自建中转** | OAuth 授权页在 `github.com`，校园网里点不开；但只要登录那一步能开代理，之后日常编辑都在校园网内完成 |
| 图片走**媒体库 + 浏览器端转 WebP**，视频走 **B站 iframe 嵌入** | 视频文件进 Git 会让仓库爆炸；媒体最终放 R2（拍板结论），仓库永远不因图片变重 |

实施后，一位不会 Git 的学长学姐的完整操作是：

> 打开 `https://tsinghua.nathanpenny.fun/admin/` → 点一次 **Sign in with GitHub**（登录那一下要能开 github.com，
> 之后很久都不用再登）→ 选「学业 / 选课怎么排」→ 改文字 → 拖一张手机照片进编辑器
> （浏览器里就压成 WebP，存到 R2）→ 写一行 `::bilibili[BV号]` 嵌视频 → 点保存 →
> 生成 PR → 机器人把预览链接贴到 PR 上 → 维护者点合并 → 上线。

不再需要：装 Node、装依赖、`git clone`、手写 frontmatter、手写图片相对路径、每次编辑都开代理。

---

## 1. 现状：现在改一次内容要付出什么

### 1.1 四条路，没有一条是「打开网页就能改」

| 方式 | 门槛 | 校园网可用性 |
| --- | --- | --- |
| 本地 `npm run dev` + `git push` | 要装 Node 20+、`npm install`、会 Git | ✅ 唯一稳定 |
| GitHub 网页端「编辑此页」 | 要 GitHub 账号 + 代理 | ❌ `github.com` 网页端超时 |
| 提 Issue 投稿 | 同样要打开 github.com | ❌ 同上 |
| 找人代排 | 依赖人 | 取决于人 |

证据：`README.md:37-50` 的实测表（`github.com` 网页端 ❌ 超时、`raw.githubusercontent.com` ❌ 超时、
`git push/clone` ✅、`api.github.com` ✅ 1.2s）。

### 1.2 图片：全站正文里目前一张都没有

实测统计：

- `src/content/docs/**` 里**没有任何** `![...](...)` 图片（只有 `skills/markdown-and-notes.md:49` 讲语法时提到）。
- **没有** `src/assets/` 目录，**没有** `public/uploads/` 之类的媒体目录；`public/` 下只有 `favicon.svg`、`og.png`、`og/`。
- `HANDOVER.md:429` 自己写着：「**没有做图片优化**：本站几乎没有图片」。
- `check-assets.mjs` 只管分享卡片和 favicon，不管正文图片。

也就是说，想插图现在只有一条路：自己把文件放进 `public/`，自己在 Markdown 里算清相对层级写 `![](../../assets/...)`。
**我实测过这条路的失败模式**：路径层级差一级，构建直接失败：

```
[ImageNotFound] Could not find requested image `../../assets/images/_probe.png`. Does it exist?
```

对非技术作者，这是最容易踩、又最难自己修的一类错误（报错在构建日志里，不在页面上）。

### 1.3 视频：零支持

- 全站没有 `<iframe>` / `<video>` / 任何视频嵌入。
- Markdown 里**可以**写裸 `<iframe>`（我实测产物里原样保留，见 §6），但要手写 HTML 属性、自己保证 16:9 比例、
  自己知道 B站播放器参数。仍然是「会写代码的人才能干」的活。

### 1.4 frontmatter 有 7 类 CI 校验，非技术作者踩中就是部署失败

`scripts/check-content.ts` 的规则（节选）：

| 规则 | 级别 | 位置 |
| --- | --- | --- |
| 文件名必须是 ASCII slug（不能中文） | ❌ error | `check-content.ts:139` |
| `reviewedAt` 不能是未来 / 不能是非法日期 | ❌ error | `check-content.ts:150,153` |
| 站内链接必须指向存在的页面 | ❌ error | `check-content.ts:298` |
| 同目录 `sidebar.order` 不能重复 | ❌ error | `check-content.ts:212` |
| 没填 `authors` / `description` | ⚠️ warn | `check-content.ts:161,177` |
| `sidebar.order` 过大（≥999） | ⚠️ warn | `check-content.ts:183` |
| `reviewedAt` 超过 6 个月未复核 | ⚠️ warn | `check-content.ts:186-196` |

这些校验本身是本站的优点，**必须保留**。方案要做的是「让后台产出的内容天然合规」，
而不是把校验放宽。

### 1.5 还有一类内容也是代码

`src/data/links.ts`（常用链接）、`src/data/resources.ts`（可下载资料）都是 TS 文件，
加一条链接也要改代码。这是「改内容的门槛」的另一半，但**本次方案不碰**（见 §8 不做的事）。

---

## 2. 方案对比

> 顺带说一句：这条路**仓库自己早就记下了** —— `HANDOVER.md:438`：
> 「**没有 CMS**。其他学长学姐投稿要么会 Git，要么把稿子发到 Issues 由人代排。
> 以后要降低门槛可以接 Decap/Sveltia CMS（基于 Git，零后端，与当前架构天然兼容）。」
> 本方案就是把它具体化，并补上它当时没有解决的两件事：**图片**与**视频**。

| 维度 | **A. Sveltia CMS + `/admin/`（推荐）** | B. 自研 `/studio/` 编辑器 | C. 飞书/Notion 当内容源 | D. R2/D1 自建后端 CMS |
| --- | --- | --- | --- | --- |
| 编辑体验 | 表单化 frontmatter + Markdown 编辑器 + 预览 + 媒体库 | 可以为本站 schema 定制，最好用 | 最舒服，手机就能改 | 好 |
| 零后端 | ✅ 纯前端 SPA，提交走 GitHub API | ✅ 同 | ⚠️ 构建时拉第三方 API | ❌ 需要 Worker 运行时 + 鉴权 |
| 校园网可用 | ✅ 自域名 + PAT（api.github.com 通） | ✅ 同 | ✅ 飞书境内快 | ✅ 自域名 |
| 图片 | ✅ 内置媒体库，浏览器端转 WebP、限大小、拖拽上传 | 要自己写（上传、压缩、命名、冲突） | ⚠️ 外链易失效、不能进仓库 | ✅ 对象存储最干净 |
| 视频 | ✅ B站嵌入（与 CMS 无关，见 §6） | 同 | 同 | ✅ 可放长视频 |
| 实施工作量 | 0.5–1 天 | 3–5 天（且要长期维护） | 1–2 天 + 长期脆弱 | 2–4 天 + 长期运维/费用 |
| 与现有 CI 的关系 | ✅ 编辑工作流自动走 PR，现有 preview + 全部 check 全复用 | 需要自己接 | 需要新写同步脚本 | 需要新写 |
| 主要风险 | 第三方 beta 版本变动、CDN 可达性 | 自己写的每一行都是维护成本 | 内容源在别人手里、图片外链失效 | 打破「零后端零隐藏资源」原则 |

**为什么不是 D**：`HANDOVER.md:34` 的架构承诺是「两个 Worker、两个自定义域名，没有任何 KV / R2 / D1 / Durable Object，
不需要担心有隐藏资源产生费用」。为了几个人的编辑便利引入运行时后端，代价与收益不匹配。
真到了需要长视频/大图库的那天，A 方案有一条平滑的升级路径（Sveltia 支持 Cloudflare R2 作为外置媒体库，见 §5.5）。

**为什么不是 C**：内容源一旦在飞书，页面构建就依赖第三方 API 的可用性和文档结构；
飞书图片是带防盗链/有效期的 CDN 链接，一旦失效，历史文章里的图全变空。搬迁成本还很高。

**为什么不是 B**：自研能把本站的 schema、check 规则、中文文案做得最贴，但它是**要长期维护的第二套软件**。
本站的运维风格（`HANDOVER.md` 记录每一次踩坑）意味着任何自研件都会变成新的历史包袱。
只有在 A 方案在实测中被证伪（例如校园网里 Sveltia 完全跑不起来）时，才回头考虑 B。

---

## 3. 推荐方案：架构与数据流

```
作者（学长学姐，不需要会 Git）
   │  打开 https://tsinghua.nathanpenny.fun/admin/     ← 自域名，境内可达
   ▼
Sveltia CMS（纯前端 SPA，静态托管在这个 Worker 上）
   │  ① 首次：粘贴 fine-grained PAT（存 localStorage）
   │  ② 读/写内容：浏览器直连 api.github.com（校园网实测可达）
   │  ③ 上传图片：浏览器内转 WebP → 作为文件提交进仓库
   ▼
GitHub 仓库（public）── 编辑工作流：每次保存 → 独立分支 + PR
   │
   ├─► PR Preview（.github/workflows/preview.yml）→ preview.nathanpenny.fun + 全套 CI 校验
   │
   └─► 合并到 main → .github/workflows/deploy.yml → 构建 → Cloudflare Worker → 线上
```

**关键点：整条链路里没有任何新增的服务器、数据库或付费资源。** 新增的只有一个静态页面（`public/admin/`）和一份配置。

### 3.1 为什么是 PAT 而不是 OAuth（这是校园网场景的决定性因素）

- Sveltia 的 GitHub 后端支持两种登录：授权码流程（需要 github.com 的授权页 + 一个 OAuth 中转服务）和
  **访问令牌（"Sign In with Token"）**。后者不需要任何服务端，令牌存在浏览器 localStorage。
  （[Sveltia 官方文档：GitHub Backend → Authentication](https://sveltiacms.app/en/docs/backends/github.md)）
- 授权码流程会跳转到 `github.com/login/oauth/authorize` —— **校园网里打不开**，直接卡死。
- 令牌流程只需要 `api.github.com` —— README 实测 ✅ 通。
- 所需权限（fine-grained token）：`Contents: Read and write`（读写内容和图片）；
  再加 `Pull requests: Read and write` 才能用编辑工作流（每次保存开一个 PR）。
- 一次性成本：生成令牌的那一页在 `github.com` 上，**要在校外/手机流量/代理环境点一次**。
  令牌可以设成 1 年有效期甚至不过期，所以是「一年一次」的事，不是每次编辑都要开代理。
- 可选补充：对「有代理」的贡献者，可以再部署 `sveltia-cms-auth`（一个 Cloudflare Worker，免费）
  提供 OAuth 登录，两种登录方式并存。**Phase 1 不做**，因为 PAT 已经够用。

### 3.2 内容模型映射（这是配置文件的骨架，不是实施细节）

| 站点字段（`src/content.config.ts`） | 后台控件 | 中文标签 | 说明 |
| --- | --- | --- | --- |
| `title` | string | 标题 | 必填 |
| `description` | text | 一句话摘要（搜索引擎/分享卡片） | 必填 |
| `summary` | string | 列表卡片上的一句话 | 可选，缺省回退 description |
| `stage` | select（多选） | 适用阶段 | 枚举锁定：本科新生 / 本科低年级 / 本科高年级 / 研究生 / 全阶段 |
| `tags` | list | 主题标签 | 提示复用已有标签 |
| `authors` | list | 作者署名 | 必填，提示「匿名学长」也是合法值 |
| `status` | select | 内容状态 | draft / stable / outdated，附中文解释 |
| `reviewedAt` | date | 最近一次逐条核对的日期 | **不填 = 未核对**，文案写清楚（本站最重要的字段） |
| `banner.content` | object → text | 页面顶部横幅 | 可选 |
| `sidebar.order` | object → number | 目录排序 | 必填，提示「同目录不要重复」 |
| 正文 | richtext（Markdown） | 正文 | 支持 `:::tip` 等容器、表格、复选框、B站视频 |
| 文件名（entry slug） | **必填的英文/拼音 slug 字段** | 网址文件名 | **不能自动从中文标题生成**：`check-content.ts:139` 要求 ASCII slug，中文标题自动生成的 slug 会被拦下，必须让作者显式填 |

**不做的事**：不改 `astro.config.mjs` 里的 `sidebar`（全站都是 `autogenerate`），
所以新增文章不需要动任何配置，这一点现有架构已经做对了。

### 3.3 安全与边界

| 项 | 做法 |
| --- | --- |
| 后台被发现 | `public/admin/index.html` 加 `<meta name="robots" content="noindex">`；`public/robots.txt` 加 `Disallow: /admin/`；`public/_headers` 给 `/admin/*` 加 `X-Robots-Tag: noindex` |
| 密钥泄漏 | 仓库是 public，但 `config.yml` 里**不含任何密钥**；PAT 只存在每个编辑者自己的浏览器里，不写进仓库 |
| 谁能改 | 只有仓库 collaborator（write 权限）能用自己的 PAT 提交；外人只能看到登录页，拿不到任何写权限 |
| 坏内容直推 main | 开启**编辑工作流**：每次保存 → 独立分支 + PR → 预览域名先看 + 全套 CI 校验 → 维护者合并才上线。**这是「后台也存在审稿」的关键开关** |
| 内容红线 | 保持不变：红线仍写在 `/start/disclaimer/`，由 PR 审阅把关；后台只是把「写」这一步变简单 |
| 双人同时编辑 | Sveltia 内置冲突检测（保存前提示别人改过），并可配合 PR 审阅 |

---

## 4. Phase 1 实施清单（可直接照着做）

| # | 文件 | 动作 | 验收 |
| --- | --- | --- | --- |
| 1 | `public/admin/index.html` | 新建：加载 Sveltia CMS（版本号锁死），`noindex` | 打开 `/admin/` 出现登录页 |
| 2 | `public/admin/config.yml` | 新建：backend=github + repo、媒体库、9 个内容集合（freshman/academics/research/campus/mindset/skills/guides/courses/start）、字段全中文标签 | 每个集合能列出已有文章 |
| 3 | `public/robots.txt` | 加 `Disallow: /admin/` | `curl /robots.txt` 可见 |
| 4 | `public/_headers` | 新建：`/admin/*` → `X-Robots-Tag: noindex` | 线上响应头可见 |
| 5 | `src/utils/remark-bilibili.mjs` | 新建：把 `:::bilibili[BV号]` / B站链接转成响应式 16:9 iframe | `npm run build` 后产物里有正确 iframe |
| 6 | `astro.config.mjs` | 注册上面这个 remark 插件 | 同上 |
| 7 | `scripts/check-media.mjs` | 新建：扫描 `public/uploads/`：单文件 ≤1MB、只允许 webp/jpg/png/svg/mp4、总体积阈值告警、未被引用的图提示；并校验 `dist` 里 `<img src="/uploads/...">` 真的存在 | `npm run check:media` 通过；故意放一张 3MB 图会失败/告警 |
| 8 | `package.json` | 加 `check:media`，并挂进 `verify` 与两个 workflow | CI 里能看到这一步 |
| 9 | `.github/workflows/deploy.yml` / `preview.yml` | 各加一步 `npm run check:media` | PR 上跑得到 |
| 10 | `src/content/docs/contribute.mdx`、`README.md`、`HANDOVER.md` | 更新：「用后台改内容」成为推荐路径；写明 PAT 怎么来、图片怎么插、视频怎么嵌 | 文档自洽 |
| 11 | `src/content/docs/start/how-to-use.md` | 给读者的「怎么用本站」不动；如新增面向贡献者的说明则放 contribute | — |

**Phase 1 验收标准（全部可执行，缺一不可）**

1. `npm run dev` → 打开 `/admin/` → PAT 登录成功 → 能看到 9 个目录集合，以及仓库里现有的 41 篇正文。
2. 改一篇文章的正文并保存 → 生成一个 PR 分支 → PR 上出现 preview 评论链接。
3. 上传一张 **3MB 手机照片** → 仓库里落地的文件 **≤1MB 且是 webp** → 页面显示正常、无横向溢出。
4. 插入一个 B站视频 → 预览页能播放，手机上比例正常（16:9，不溢出）。
5. 用后台新建一篇文章：**故意**填中文 slug → 保存后被拒绝或 CI 报错并给出人话提示；
   填英文 slug → 全套 CI 全绿（`check` / `check:content` / `courses:check` / `build` / `check:jsonld` / `check:assets` / `check:feeds` / `check:media`）。
6. 合并后线上页面正确；`/admin/` 不出现在 sitemap 里，`robots.txt` 已屏蔽。
7. 无令牌访客打开 `/admin/`，只有登录页，任何操作都拿不到写权限。
8. 现有流程不回归：本地 `npm run verify` 全绿；原有文章渲染与之前逐字节一致（除新增文件外 `git diff` 只有预期改动）。

**预估工作量**：配置 + 插件 + 守卫脚本 ≈ **2–4 小时编码 + 1 小时校园网实测**（含边界情况调优）。

---

## 5. 图片方案（重点）

> ⚠️ 本节 5.1 保留了**提案时**的「仓库内媒体库」写法；最终按拍板结果走了 **R2**（见「实施记录」与 §10）。
> 5.2 的取舍分析、5.3 的守卫设计、5.4 的写作约定、5.5 的升级路径都仍然成立。

### 5.1 落地形态

提案时的仓库内媒体库写法（**最终未采用**，实际配置见 `public/admin/config.yml`）：

```yaml
media_folder: /public/uploads     # 文件进仓库，走静态托管，无需任何新资源
public_folder: /uploads           # 正文里的引用形式：![说明](/uploads/xxx.webp)
media_libraries:
  all:
    max_file_size: 1048576        # 1MB 硬上限，超了不让传
    slugify_filename: true        # 中文/空格文件名自动变成 URL 友好形式
    filename_template: '{{year}}{{month}}{{day}}-{{uuid_short}}'  # 手机原名 IMG_1234 不是好名字
    transformations:
      raster_image: { format: webp, quality: 85, width: 2048, height: 2048 }
      svg: { optimize: true }
```

最终采用 R2 后，配置长这样（媒体**不进 Git**，其余优化一模一样）：

```yaml
media_libraries:
  default: false                  # 关掉仓库内媒体库，避免图片被误存进 Git
  cloudflare_r2:
    access_key_id: …              # 不是密钥，可以公开
    bucket: tsinghua-guide-media
    account_id: …
    public_url: https://media.nathanpenny.fun
    prefix: uploads/
  all:
    max_file_size: 31457280       # 30MB：图片会被压成几百 KB，这条是拦「手滑传了个大录屏」
    slugify_filename: true
    filename_template: '{{year}}{{month}}{{day}}-{{uuid_short}}'
    transformations:
      raster_image: { format: webp, quality: 85, width: 2048, height: 2048 }
      svg: { optimize: true }
```

要点（两种存放方式都适用）：

- **压缩发生在浏览器里**（上传前），不是构建时：手机拍的 HEIC/大 JPEG 会被转成 WebP、长边缩到 2048、
  剥掉 EXIF（含定位信息）。落到存储上的就已经是 200KB 级别。
- **体积上限**是关键守卫：走仓库时它是 1MB（防止仓库膨胀），走 R2 时放宽到 30MB（拦手滑传大文件）。
- 编辑器里是「点插入图片 / 拖拽」+ 媒体库选图，作者**永远不用手写路径**——这正是当前最容易出错的地方。

### 5.2 为什么不直接放 `src/assets/`（Astro 图片优化的取舍）

我实测：Starlight 的 Markdown 正文里写**相对路径**图片，Astro 会自动优化成 WebP 并补上
`width/height/loading="lazy"`：

```markdown
![探针图片](../../../assets/images/_probe.png)
```
```html
<img alt="探针图片" loading="lazy" decoding="async" width="1200" height="630" src="/_astro/_probe.BIEK7dTz_ZC5n2q.webp">
```

这是更省流量的做法（可出 AVIF、可出响应式 srcset）。**但 Sveltia 的 `public_folder` 不支持相对路径**
（官方文档明确：不支持绝对 URL，只能用 `/` 开头的站内路径），而 `src/assets` 这类方案恰恰要求正文里写
`../../../assets/...` 的相对路径。两者不兼容。

| 选择 | 优点 | 缺点 |
| --- | --- | --- |
| **MVP：`public/uploads` + 浏览器端 WebP（推荐先做）** | 稳定、零插件、上传即压缩、作者零心智负担 | 没有构建期响应式 srcset / AVIF |
| Phase 2：加一个 remark 插件，把正文里的 `/uploads/x.webp` 在构建时重写成 Astro 优化图 | 拿到 Astro 全部优化能力，作者体验不变 | 多 ~40 行插件 + 需要回归测试；`/uploads` 与重写规则耦合 |

Phase 2 的具体做法（供将来参考）：remark 插件拿到当前文件的路径，把 `![](/uploads/x.webp)`
改写成相对路径（`../../../assets/uploads/x.webp`），交给 Astro 现有的 content-assets 管线自动优化。
**先不做**，因为 Phase 1 的收益（能插图）已经拿到，而插件会引入「路径重写」这一类新的失败模式；
本站的工程风格一直偏保守（宁可少一个功能，也不要多一个会静默失效的机制），等真的有流量压力再上。

### 5.3 与现有检查脚本的关系

- `check-assets.mjs` 目前只校验分享卡片/favicon 和「HTML 里引用的 /og/ 图是否在 dist 里」。
- 新增 `check-media.mjs` 补上：`/uploads/` 下的文件体积/格式、总体积趋势、**被引用但在 dist 里不存在**、
  **存在但全站没人引用**（死图，提示删除）。
- 挂进 `verify` 和两个 workflow，做法与现有 7 个 check 完全一致。

### 5.4 作者侧写作约定（要写进 `contribute.mdx`）

- 截图/照片直接用后台拖进去，**不要**贴微信/聊天软件的临时链接（会失效）。
- 涉及**内部系统、成绩单、教务截图**的一律不许上传（内容红线，`README.md:440-450`）。
  截图前打码；人脸、学号、成绩单不能出现。
- 图片说明（alt）必须写，且要和图有关（SEO + 无障碍）。

### 5.5 升级路径（只在真的需要时启用）

如果某天仓库里 `uploads/` 超过 ~200MB，或要放长视频：把媒体库切到 **Cloudflare R2**
（Sveltia 内置 S3 兼容支持，R2 免费额度 10GB、无出网流量费）。
届时 `public_folder` 变成 R2 的自定义域名，正文引用形式不变，历史文章不需要改。
**现在不做**，因为那会引入本项目目前刻意没有的 Cloudflare 资源。

---

## 6. 视频方案（重点）

### 6.1 首选：B站嵌入

- **境内可访问**（YouTube 在校园网/境内打不开，直接排除）。
- **零带宽成本、零仓库体积**：视频文件在 B站，站点只放一个 iframe。
- 我实测：Markdown 里写裸 `<iframe>` 会被原样保留到产物中：

```markdown
<iframe src="https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&page=1"
        width="100%" height="400" frameborder="0" allowfullscreen></iframe>
```
```html
<iframe src="https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&page=1" width="100%" height="400" frameborder="0" allowfullscreen>
```

问题在于：手写这段 HTML 对非技术作者就是拦路虎，而且 `height="400"` 在手机上会被拉伸变形。
所以加**一行语法糖**（`src/utils/remark-bilibili.mjs`）：

```markdown
:::bilibili[BV1xx411c7mD]
```
→ 输出一个 16:9 自适应、`loading="lazy"`、带说明文字的容器；同时在 `contribute.mdx` 里写明
「把 B站视频链接整条粘进来就行」。

### 6.2 次选：短自托管视频（Phase 2 起再考虑）

适合「无声桌面录屏、10MB 以内」这类（例如演示某个操作步骤）：文件放 `public/uploads/`，
用一个 `<video controls preload="metadata">` 的语法糖/组件。**默认不推荐**，只在确实需要
「不希望出现在 B站」时使用。

⚠️ 注意与 §5.1 的一致性：Phase 1 的 `max_file_size: 1MB` 是**全局**上限（正文里插图走的是媒体库，
吃的是同一份配置），所以 Phase 1 **传不上任何视频**——这是有意的，避免「随手传个 200MB 录屏进仓库」。
要启用本节这条路，必须同时把上限提到 10MB 左右，并给 `check:media` 加单独的 mp4 规则；
这是一次显式决策，不是默认行为。

### 6.3 明确不做

| 做法 | 为什么不做 |
| --- | --- |
| mp4 进 Git（手机直接拍的 100MB+） | 仓库会永久膨胀；Sveltia 的 GitHub 后端**不支持 Git LFS**，无法事后清理 |
| YouTube 嵌入 | 境内打不开，与本站「校园网可用」的底线冲突 |
| Cloudflare Stream | 付费，且当前没有对应资源，收益不匹配（真要放长视频时用 R2 + `<video>`） |

---

## 7. 风险与对策

| 风险 | 概率 | 影响 | 对策 |
| --- | --- | --- | --- |
| `unpkg.com` 在校园网不可达（CMS 是单文件 SPA，默认从 CDN 加载） | 中 | 后台打不开，方案失效 | 本次在开发机上实测 unpkg 可达（2.1MB 下载成功），但**必须在校园网复测**；不通就把 bundle 放进仓库 `public/admin/vendor/`（实测 2.1MB 原始 / 663KB gzip，由 Cloudflare 压缩后传输） |
| Sveltia 仍是 beta，版本变动可能破坏配置 | 中 | 后台某天打不开 | CDN 地址与 npm 依赖都**锁死版本号**；`config.yml` 里有官方 schema，可用 `$schema` 校验；把版本号写进 `HANDOVER.md` |
| Markdown 编辑器重排 `:::tip` 容器或裸 HTML | 中 | 文章排版被改动 | 默认用 Markdown 模式而非富文本模式；`check-content.ts` 已有站内链接/结构校验，再补一条「容器语法未被破坏」的检查 |
| 图片进仓库导致 clone 变慢 | 低（有 1MB 上限） | 仓库膨胀 | `max_file_size` + `check:media` 体积阈值 + R2 升级路径 |
| 作者填中文 slug 导致 CI 报错、以为「后台坏了」 | 高 | 体验受挫 | slug 作为**必填字段**并给出示例；保存时前端就拦截；CI 报错文案保持现有的人话风格 |
| PAT 泄漏（公共电脑） | 低 | 他人可改仓库 | 用 fine-grained token 只授权这一个仓库；文档写明「不要在学校机房电脑上存令牌」，提供登出说明 |
| 内容红线被绕过（后台太方便） | 低 | 合规风险 | 编辑工作流强制走 PR 审阅；红线文案放在集合说明里；媒体库上传前提示不得传内部系统截图 |
| 维护者不熟悉新后台 | 低 | 无人维护 | 在 `HANDOVER.md` 补一节「后台怎么加一个字段/加一个集合」，与现有文档风格一致 |

---

## 8. 本次明确不做的事（避免范围蔓延）

1. **不改 `src/data/links.ts` / `resources.ts` 的编辑方式**（链接和资料仍是代码）。
   如果将来也要「不改代码加链接」，可以再做一个 `data` 集合，让后台写 JSON/YAML 再生成 TS——
   属于独立的一期，不建议和本次混在一起。
2. **不引入 R2 / D1 / KV / OAuth Worker**（保留「零隐藏资源」架构承诺）。
3. **不动 Astro 图片管线**（Phase 2 才考虑 remark 重写插件）。
4. **不改内容校验规则**（`check-content.ts` 一条都不放宽）。
5. **不做「手机 App / 小程序」**：后台是响应式网页，手机浏览器即可改文字，够用。

---

## 9. 分期与工作量

| 期 | 内容 | 预估 | 交付物 |
| --- | --- | --- | --- |
| **Phase 1（建议立刻做）** | `/admin/` 后台 + 媒体库（图片）+ B站语法糖 + 守卫脚本 + 文档更新 | 0.5–1 天 | 会用浏览器就能改内容、能插图、能嵌视频 |
| Phase 2（按需） | remark 图片重写（Astro 优化图）、`<video>` 语法糖、可选 OAuth 登录 | 0.5 天 | 更省流量；有代理的贡献者更顺 |
| Phase 3（触发条件式） | 媒体库切 R2（仓库 >200MB 或要放长视频） | 0.5–1 天 | 仓库保持轻量 |

**触发 Phase 3 的条件写清楚**，避免「以后再说」变成永远不做：
`npm run check:media` 报告 `public/uploads/` 总体积 > 200MB，或出现必须自托管的长视频需求。

---

## 10. 拍板结果（2026-09-30）

1. **是否按 A 方案落地 Phase 1？** → **是，已落地。**
2. **图片存哪？** → **Cloudflare R2**（不是提案里推荐的 `public/uploads`）。
   代价：多了一个 Cloudflare 资源、要一次性配好桶/令牌/域名/CORS；收益：仓库永远不因图片变重，
   以后放短视频也不用改架构。开通步骤见 `HANDOVER.md` 第 9.3 节。
3. **视频怎么放？** → **B 站嵌入为主**（`::bilibili[BV号]`），R2 自托管为辅（`::video[地址]`，适合无声短录屏）。
4. **登录方式？** → **GitHub OAuth**（拍板：可以开代理，不要令牌）。
   额外引入一个自建的 OAuth 中转 Worker（`auth-worker/`，部署在 `auth.nathanpenny.fun`）；
   令牌登录保留为备用入口。**登录那一步需要代理**，之后日常编辑不需要。
   三处地址必须一致（CMS `base_url` / Worker 路由 / GitHub OAuth App 回调），前两处有检查兜底。

---

### 附：本文的技术依据（可复核）

| 结论 | 依据 |
| --- | --- |
| 校园网 `github.com` 网页端不通、`api.github.com` 通 | `README.md:37-50`（2026-09-30 实测记录） |
| 本站是纯静态、无任何 KV/R2/D1 | `wrangler.jsonc`、`HANDOVER.md:34` |
| 仓库自己记录过「以后可以接 Decap/Sveltia CMS」 | `HANDOVER.md:438`（以及 `HANDOVER.md:429`「没有做图片优化」） |
| 推送 main 自动跑全套校验并部署 | `.github/workflows/deploy.yml` |
| PR 有独立预览域名 + 全套校验 | `.github/workflows/preview.yml`（`preview.nathanpenny.fun`） |
| 正文相对路径图片会被 Astro 优化成 WebP 并补 `width/height/lazy` | 本次实测（临时探针文件，已删除；产物为 `/_astro/_probe.*.webp`） |
| 路径层级写错会直接构建失败 | 本次实测（`[ImageNotFound]`） |
| Markdown 裸 `<iframe>` 会原样保留 | 本次实测 |
| Sveltia 支持「Sign In with Token」（PAT），无需 OAuth 服务端 | [Sveltia docs · GitHub Backend](https://sveltiacms.app/en/docs/backends/github.md) |
| Sveltia 媒体库可浏览器端转 WebP、限大小、改文件名 | [Sveltia docs · Media Storage](https://sveltiacms.app/en/docs/media.md)、[Internal Storage](https://sveltiacms.app/en/docs/media/internal.md) |
| Sveltia 支持 Cloudflare R2 作为外置媒体库 | [Sveltia docs · Media Storage（外部存储列表）](https://sveltiacms.app/en/docs/media.md) |
| Sveltia bundle 体积 2.1MB（gzip 663KB） | 本次实测下载 unpkg 产物 |
| 文件名必须是 ASCII slug、`sidebar.order` 不可重复等 7 类校验 | `scripts/check-content.ts:139,150,153,161,177,183,190,212,298` |
| 资源检查现状（只覆盖分享卡片/favicon） | `scripts/check-assets.mjs` |
| Astro 7 默认 Markdown 处理器是 Sätteri；`markdown.remarkPlugins` 需要额外装包并换成 unified | `node_modules/astro/dist/core/config/schemas/base.js:202`（默认就是 `satteri()`）、`node_modules/@astrojs/starlight/dist/integrations/markdown-plugins.js` |
| 一个集合只列出配置里那一种扩展名的文件 | [Sveltia docs · File Formats](https://sveltiacms.app/en/docs/collections/entries/formats.md) |
| R2 媒体库的 Secret Access Key 由编辑者在浏览器里输入、不进配置 | [Sveltia docs · Cloudflare R2](https://sveltiacms.app/en/docs/media/cloudflare-r2.md) |
| **内容加载器出错时构建仍返回 0，且那一页正文变空** | 本次实测（`[starlight-docs-loader] Error rendering …`，`build exit=0`，产物页面缺正文） |
| R2 集成支持浏览器端上传并允许 `output_filename_only` 之类的输出控制 | 同上 |

### 改这个功能之前请先读

- `HANDOVER.md` 第 9 节（站内后台）—— 开通步骤、令牌怎么发、7 条踩坑记录。
- `scripts/check-admin.mjs` 与 `scripts/check-media.mjs` 的文件头注释 —— 它们就是「不许静默失效」的具体化。
- `public/admin/config.yml` 顶部注释 —— 哪些值可以公开、哪些绝不能进仓库。
