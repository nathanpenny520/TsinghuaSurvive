# 清华生存指南

面向清华在校学生的经验分享站。不是官方材料，是一群学长学姐把踩过的坑、绕过的路写下来。

**线上地址**：<https://tsinghua-guide.nathanpenny520.workers.dev>

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
npm run build      # 构建到 dist/
npm run preview    # 预览构建产物
npm run check      # 类型与内容校验（提 PR 前跑一下）
npm run deploy     # 构建并部署到 Cloudflare Workers
```

> **提示**：如果 `wrangler` 报 `EPERM ... .wrangler/logs`，说明它没权限写用户目录。设置
> `export WRANGLER_LOG_PATH="$PWD/.wrangler-logs"` 即可把日志重定向到项目内。

---

## 目录结构

```
Tsinghua-guide/
├─ astro.config.mjs          站点配置：标题、侧边栏、社交链接、SEO
├─ wrangler.jsonc            Cloudflare Workers 静态资源部署配置
├─ src/
│  ├─ content.config.ts      ★ 内容模型（frontmatter 校验规则）
│  ├─ content/
│  │  ├─ docs/               ★ 所有文章，一个文件一页
│  │  │  ├─ index.mdx           首页
│  │  │  ├─ 404.md              自定义 404
│  │  │  ├─ start/              本站说明
│  │  │  ├─ freshman/           新生入学
│  │  │  ├─ academics/          学业（选课、绩点……）
│  │  │  ├─ research/           科研与深造
│  │  │  ├─ campus/             校园生活
│  │  │  ├─ mindset/            心态与避坑
│  │  │  └─ guides/             实用工具（链接、资料）
│  │  └─ i18n/zh-CN.json     界面文案覆盖
│  ├─ components/            自定义组件
│  │  ├─ Footer.astro           站脚（免责声明 + 纠错入口）
│  │  ├─ LinkGrid.astro         常用链接卡片墙
│  │  └─ ResourceList.astro     资料下载列表
│  ├─ data/
│  │  ├─ links.ts            ★ 校内常用链接（改这里就更新页面）
│  │  └─ resources.ts        ★ 资料下载清单（改这里就更新页面）
│  └─ styles/custom.css      主题色（清华紫）与中文排版
└─ public/                   favicon、robots.txt
```

**两个 `★` 之外的规则**：日常写作只需要碰 `src/content/docs/`，加链接只碰 `src/data/`。

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
summary: 卡片上显示的一句话
banner:                           # 可选：页面顶部横幅
  content: 本文规则尚未核对，请以官方通知为准。
sidebar:
  order: 10                       # 目录排序，小的在前
---

正文……
```

字段写错会在 `npm run build` 时**报错并指出是哪个文件**，不会生成坏页面。

正文里可以用的排版语法：

- 提示块：`:::tip`、`:::note`、`:::caution`、`:::danger`，带标题写成 `:::tip[标题]`
- 需要 JSX 组件（`<Steps>`、`<Aside>`、`<LinkCard>`）时，把文件后缀改成 `.mdx` 并在 frontmatter 下方 `import`

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

### ⚠️ 已知问题：workers.dev 域名在境内访问不稳定

实测：从清华校园网访问 `tsinghua-guide.nathanpenny520.workers.dev` 时，**DNS 被解析到美国 IP（208.101.21.43）后连接超时**——`*.workers.dev` 在国内属于常被污染的域名。

站点本身部署是正常的（Cloudflare 侧显示版本已 100% 生效），问题只出在域名解析这一层。

**解决办法：绑定自定义域名。** 在 Cloudflare 控制台给这个 Worker 加一个 Custom Domain（域名需托管在 Cloudflare），解析会走 Cloudflare 边缘节点，通常可正常访问。

```bash
# 也可以在 wrangler.jsonc 里声明，部署时自动绑定
# "routes": [{ "pattern": "thu.example.com", "custom_domain": true }]
```

如果你希望国内访问更快、更稳，那需要**域名完成 ICP 备案**并使用 Cloudflare 中国网络（企业版），或者换用境内云厂商的静态托管。这是一个产品决策，不是技术限制。

### 自动部署（可选）

`.github/workflows/deploy.yml` 已配好：推送到 `main` 时自动构建并部署。需要在 GitHub 仓库里设置两个 Secrets：

| Secret | 说明 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | 在 Cloudflare 控制台创建，权限需要 `Workers Scripts: Edit` |
| `CLOUDFLARE_ACCOUNT_ID` | 见 `npx wrangler whoami` 输出 |

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
