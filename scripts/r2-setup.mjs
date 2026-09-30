#!/usr/bin/env node
/**
 * R2 媒体库开通脚本 —— 把「建桶 / 接公开域名 / 配 CORS」三步一次做完，且可重复执行。
 *
 * 为什么写成脚本而不是让人照着文档点：
 *   1. 这三步的每一步都有个容易踩空的细节（CORS 必须用 R2 API 的形状、自定义域名要 zone id、
 *      r2.dev 只适合开发），写成脚本就不用每次重新推。
 *   2. 桶要是哪天被删了、或者有人 fork 了这个项目，一条命令就能复原。
 *
 * ⚠️ 它做不了的那一步：**创建 R2 API 令牌（Access Key ID / Secret Access Key）**。
 *    官方文档只提供控制台路径（Sveltia 需要的 S3 凭据不在这个脚本的能力范围内），
 *    所以脚本最后会把那一步的命令和链接打出来。
 *
 * 用法：
 *   npm run r2:setup              建桶 + 接域名 + 配 CORS（已存在的部分会跳过）
 *   npm run r2:setup -- --check   只报告当前状态，不改任何东西
 *
 * 需要：已登录的 wrangler（`npx wrangler login`），以及 Cloudflare 账号里能管理该 zone 的权限。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const BUCKET = 'tsinghua-guide-media';
const DOMAIN = 'media.nathanpenny.fun';
// zone id 也从 HANDOVER.md 的资源清单里来（不是秘密，是公开的标识）
const ZONE_ID = process.env.R2_ZONE_ID ?? '068decbde572025a27b25b97080e4355';
const CORS_FILE = join(ROOT, 'r2/cors.json');
const CONFIG = join(ROOT, 'public/admin/config.yml');
const checkOnly = process.argv.includes('--check');

const run = (args, { allowFailure = false } = {}) => {
  const command = `npx wrangler ${args.join(' ')}`;
  try {
    return { ok: true, output: execFileSync('npx', ['wrangler', ...args], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    if (allowFailure) return { ok: false, output };
    console.error(`✖ 命令失败：${command}\n${output}`);
    process.exit(1);
  }
};

const line = (() => {
  // 让输出好读一点，同时不引入依赖
  const pad = (label) => `${label.padEnd(14)}`;
  return { pad };
})();

console.log('R2 媒体库状态检查\n');

// ── 1. 桶 ──────────────────────────────────────────────────────────────
const list = run(['r2', 'bucket', 'list']).output;
const bucketExists = list.includes(BUCKET);
console.log(`${line.pad('桶')}${bucketExists ? '✔ 已存在' : '✖ 不存在'}：${BUCKET}`);

if (!checkOnly && !bucketExists) {
  console.log('  → 创建中…');
  run(['r2', 'bucket', 'create', BUCKET]);
  console.log('  ✔ 已创建');
}

// ── 2. 公开域名 ────────────────────────────────────────────────────────
let domainState = run(['r2', 'bucket', 'domain', 'list', BUCKET], { allowFailure: true }).output;
const domainConnected = domainState.includes(DOMAIN);
console.log(`${line.pad('公开域名')}${domainConnected ? '✔ 已连接' : '✖ 未连接'}：${DOMAIN}`);

if (!checkOnly && !domainConnected) {
  const zoneId = ZONE_ID || '<zone-id>';
  console.log('  → 连接中…');
  run(['r2', 'bucket', 'domain', 'add', BUCKET, '--domain', DOMAIN, '--zone-id', zoneId, '--min-tls', '1.2', '-y']);
  console.log('  ✔ 已连接（证书签发要几分钟，状态会从 pending 变 active）');
}

// ── 3. CORS ────────────────────────────────────────────────────────────
if (!existsSync(CORS_FILE)) {
  console.error(`\n✖ 找不到 ${join('r2', 'cors.json')}：CORS 策略文件丢了，先把它找回来。`);
  process.exit(1);
}
const cors = JSON.parse(readFileSync(CORS_FILE, 'utf8'));
if (!Array.isArray(cors.rules)) {
  console.error('\n✖ r2/cors.json 里没有 rules 数组。R2 用的是 rules[].allowed.* 的形状，不是 AWS 那种顶层 AllowedOrigins。');
  process.exit(1);
}

const corsState = run(['r2', 'bucket', 'cors', 'list', BUCKET], { allowFailure: true }).output;
const corsApplied = corsState.includes('allowed_origins') &&
  cors.rules[0].allowed.origins.every((origin) => corsState.includes(origin));
console.log(`${line.pad('CORS')}${corsApplied ? '✔ 已生效' : '✖ 未配置或与 r2/cors.json 不一致'}`);

if (!checkOnly && !corsApplied) {
  console.log('  → 应用 r2/cors.json…');
  run(['r2', 'bucket', 'cors', 'set', BUCKET, '--file', 'r2/cors.json', '-y']);
  console.log('  ✔ 已应用');
}

// ── 4. 与后台配置对得上吗 ──────────────────────────────────────────────
const configText = readFileSync(CONFIG, 'utf8');
const publicUrl = configText.match(/public_url:\s*(\S+)/)?.[1] ?? '';
console.log(`${line.pad('后台 public_url')}${publicUrl === `https://${DOMAIN}` ? '✔ 一致' : `✖ 不一致：${publicUrl || '(空)'}`}：${publicUrl || '(空)'}`);
if (publicUrl !== `https://${DOMAIN}`) {
  console.log(`  → 把 public/admin/config.yml 的 public_url 改成 https://${DOMAIN}`);
}

// ── 5. 剩下那一步（脚本做不了）─────────────────────────────────────────
const accessKeyPlaceholder = /access_key_id:\s*REPLACE_/.test(configText);
console.log(`${line.pad('R2 API 令牌')}${accessKeyPlaceholder ? '✖ 还没配（access_key_id 仍是占位符）' : '✔ 已填入 access_key_id'}`);
if (accessKeyPlaceholder) {
  console.log(`
  还需要你在控制台点一次（官方只提供控制台路径）：
    1. 打开 https://dash.cloudflare.com/?to=/:account/r2/api-tokens
    2. Create API token → 权限选 **Object Read & Write** → 桶只勾 ${BUCKET}
    3. 把 **Access Key ID** 填进 public/admin/config.yml 的 access_key_id（它不是密钥，可以公开）
    4. **Secret Access Key 不要写进任何文件**：每个编辑者第一次打开后台媒体库时在界面上输入一次，
       存在自己浏览器里（Sveltia 的设计如此）。`);
}

console.log(
  checkOnly
    ? '\n（--check 模式：只报告，没有改动任何东西）'
    : '\n完成。可以跑 `npm run check:admin` 看后台配置还缺什么。',
);
