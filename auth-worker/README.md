# OAuth 中转（内容后台的 GitHub 登录）

这个目录里是**内联的上游代码**，负责内容后台的 GitHub 登录（OAuth 授权码流程）。

```
auth-worker/
├── src/index.js      ← 上游 sveltia/sveltia-cms-auth 的代码（MIT，只加了文件头的来源注释）
├── LICENSE.txt       ← 上游的 MIT 许可（必须随代码一起保留）
└── wrangler.jsonc    ← 我们的部署配置：Worker 名称、自定义域名、ALLOWED_DOMAINS
```

## 它解决什么问题

Sveltia CMS 是纯前端应用，浏览器里不能放 GitHub 的 client secret；
而 GitHub 的 PKCE 纯前端流程目前还没开放（官方路线图已暂停）。
所以登录时的「授权码 → 访问令牌」交换必须有个服务端来做 —— 就是这个 13KB 的 Worker。

流程：

```
后台（tsinghua.nathanpenny.fun/admin/）
   │ ① 打开弹窗 → auth.nathanpenny.fun/auth
   ▼
中转 Worker ──② 302──▶ github.com/login/oauth/authorize   ← 这一步需要代理（境内打不开）
   │ ③ 用户在 GitHub 点授权 → 回调 auth.nathanpenny.fun/callback
   │ ④ Worker 用 client_secret 换 access_token（secret 只在 Worker 里，不进浏览器）
   ▼
后台拿到令牌（存浏览器 localStorage）→ 之后所有读写直接走 api.github.com（校园网实测可达）
```

**所以只有第 ② 步需要代理，而且每个编辑者只需登录一次。**

## 一次性部署（需要你自己的 Cloudflare 与 GitHub 账号）

### 1. 注册 GitHub OAuth App

到 <https://github.com/settings/applications/new>（**需要代理**）填：

| 字段 | 值 |
| --- | --- |
| Application name | `清华生存指南内容后台`（随便写） |
| Homepage URL | `https://tsinghua.nathanpenny.fun/` |
| Authorization callback URL | `https://auth.nathanpenny.fun/callback` ← **必须是这个** |

创建后点 **Generate a new client secret**，记下 **Client ID** 与 **Client Secret**。

### 2. 部署 Worker 并写入密钥

```bash
cd auth-worker
npx wrangler secret put GITHUB_CLIENT_ID       # 粘贴 Client ID
npx wrangler secret put GITHUB_CLIENT_SECRET   # 粘贴 Client Secret
npx wrangler deploy
```

`wrangler deploy` 会自动创建 `auth.nathanpenny.fun` 的 DNS 记录与证书（配置在 `wrangler.jsonc` 里）。

### 3. 确认后台配置对得上

`public/admin/config.yml` 里应当有：

```yaml
backend:
  name: github
  repo: nathanpenny520/TsinghuaSurvive
  branch: main
  base_url: https://auth.nathanpenny.fun     # 必须与 wrangler.jsonc 的 routes 一致
  auth_methods: [oauth, token]
  auth_scope: public_repo,user
```

`npm run check:admin` 会校验 `base_url` 与 `wrangler.jsonc` 的路由是否一致（防止两边漂移）。

### 4. 验证

用**代理**打开 <https://tsinghua.nathanpenny.fun/admin/> → 点 **Sign in with GitHub** →
授权 → 应该回到后台并显示 9 个分类。之后关掉代理，读写依然正常（走 `api.github.com`）。

## 安全说明

- `GITHUB_CLIENT_SECRET` 只存在于 Cloudflare 的加密环境变量里，**不进 Git、不进浏览器**。
- `ALLOWED_DOMAINS`（在 `wrangler.jsonc` 的 `vars` 里）是白名单：只有从这些域名打开的页面才能拿到令牌。
  这就是为什么它写的是 `*.nathanpenny.fun,localhost` 而不是 `*`。
- OAuth App 的授权范围通过 `auth_scope: public_repo,user` 收窄到「公开仓库 + 用户资料」，
  比默认的 `repo`（含所有私有仓库读写）小得多 —— 本站是公开仓库，够用。
- Worker 只做两件事：302 到 GitHub、用授权码换令牌。不认识的路由返回 404，没有别的入口。

## 升级上游代码

```bash
# 1. 看上游有没有更新（需要网络）
curl -s https://api.github.com/repos/sveltia/sveltia-cms-auth/commits/main | head -20

# 2. 拿到新的 src/index.js 后，重新加文件头注释并替换，然后更新本文件与 index.js 头部的 sha256
shasum -a 256 <(tail -n +12 src/index.js)   # 去掉我们加的文件头部分再算，方便与上游对比
```

当前内联的版本：

- 上游：<https://github.com/sveltia/sveltia-cms-auth>
- commit：`4fd08b5d4e009a85fa473fd523824ca9dfee9533`（2026-09-21）
- 上游 `src/index.js` 的 sha256：`a2858897152ffda6652e060f12f4976183879ae8baec6d00e60957f2ea802985`
- 我们的改动：仅文件头 17 行来源注释，其余逐字未改
- 许可：MIT（Copyright (c) 2026 Kohei Yoshino），见 `LICENSE.txt`
