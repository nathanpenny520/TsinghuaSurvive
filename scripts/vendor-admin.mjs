#!/usr/bin/env node
/**
 * 把内容后台的编辑器脚本放到仓库里（可选操作）。
 *
 * 背景：后台页面（public/admin/index.html）默认从 unpkg 加载 Sveltia CMS。
 * unpkg 是国外 CDN，在校园网里不一定稳。跑一次这个脚本，就会把**锁定版本**的那份
 * 放到 public/admin/vendor/sveltia-cms.js；后台页面是「本地优先、CDN 兜底」，
 * 之后即使 CDN 拿不到，编辑器也能从自己的域名加载。
 *
 * 来源优先级：
 *   1. `node_modules/@sveltia/cms`（package.json 里的 devDependency，版本必须与 index.html 的 VERSION 一致）
 *   2. 上面的包不在时才去 unpkg 下载
 *
 * 代价：这个文件约 2MB（gzip 后约 650KB），会进 Git 仓库。仓库本来不到 1MB，
 * 所以默认不带它 —— 只有确认校园网里 unpkg 不通时再跑。
 *
 * 用法：
 *   npm run admin:vendor            放置本地副本（版本号从 public/admin/index.html 里读）
 *   npm run admin:vendor -- --check 只检查本地副本是否存在、版本是否对得上
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ADMIN_HTML = join(ROOT, 'public/admin/index.html');
const VENDOR_DIR = join(ROOT, 'public/admin/vendor');
const VENDOR_FILE = join(VENDOR_DIR, 'sveltia-cms.js');
const checkOnly = process.argv.includes('--check');

const html = readFileSync(ADMIN_HTML, 'utf8');
const versionMatch = html.match(/VERSION\s*=\s*'(\d+\.\d+\.\d+)'/) || html.match(/sveltia-cms@(\d+\.\d+\.\d+)/);
if (!versionMatch) {
  console.error('✖ 从 public/admin/index.html 里读不到锁定的版本号，先确认那个文件没被改坏。');
  process.exit(1);
}
const version = versionMatch[1];
const url = `https://unpkg.com/@sveltia/cms@${version}/dist/sveltia-cms.js`;

/** 在 node_modules 里找 @sveltia/cms，并核对版本 */
function localBundle() {
  try {
    const require = createRequire(import.meta.url);
    let dir = dirname(require.resolve('@sveltia/cms'));
    for (let i = 0; i < 6; i += 1) {
      const pkgPath = join(dir, 'package.json');
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        if (pkg.name === '@sveltia/cms') {
          const bundle = join(dir, 'dist/sveltia-cms.js');
          return { version: pkg.version, bundle: existsSync(bundle) ? bundle : null };
        }
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    /* 没装就退回网络下载 */
  }
  return null;
}

if (checkOnly) {
  if (!existsSync(VENDOR_FILE)) {
    console.log(`本地没有副本（正常，默认就是走 CDN）：${url}`);
    process.exit(0);
  }
  const size = statSync(VENDOR_FILE).size;
  console.log(`本地副本存在：public/admin/vendor/sveltia-cms.js（${(size / 1024 / 1024).toFixed(1)} MB，目标版本 v${version}）`);
  console.log('⚠️ 它是复制来的快照，升级版本后要重新跑一次 npm run admin:vendor。');
  process.exit(0);
}

const local = localBundle();
if (local && local.version !== version) {
  console.error(
    `✖ 版本对不上：index.html 锁的是 v${version}，但 node_modules 里装的是 v${local.version}。\n` +
      '  先让两者一致（npm run check:admin 也会报这个），再生成本地副本。',
  );
  process.exit(1);
}

mkdirSync(VENDOR_DIR, { recursive: true });

if (local?.bundle) {
  copyFileSync(local.bundle, VENDOR_FILE);
  const size = statSync(VENDOR_FILE).size;
  console.log(
    `✔ 已从 node_modules 复制：public/admin/vendor/sveltia-cms.js（v${version}，${(size / 1024 / 1024).toFixed(1)} MB）\n` +
      '  下一步：提交这个文件。之后后台会优先加载它，CDN 只作为兜底。',
  );
  process.exit(0);
}

console.log(`node_modules 里没有可用的 @sveltia/cms，改为下载：\n  ${url}`);
const response = await fetch(url);
if (!response.ok) {
  console.error(`✖ 下载失败：HTTP ${response.status}。换成有外网的网络再试。`);
  process.exit(1);
}
const body = Buffer.from(await response.arrayBuffer());
if (body.length < 100_000) {
  console.error(`✖ 下载到的内容只有 ${body.length} 字节，不像是完整的编辑器脚本，已放弃。`);
  process.exit(1);
}
writeFileSync(VENDOR_FILE, body);
console.log(
  `\n✔ 已写入 public/admin/vendor/sveltia-cms.js（${(body.length / 1024 / 1024).toFixed(1)} MB）\n` +
    '  下一步：提交这个文件。之后后台会优先加载它，CDN 只作为兜底。',
);

