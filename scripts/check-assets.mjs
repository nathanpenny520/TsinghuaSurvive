#!/usr/bin/env node
/**
 * 静态资源校验 —— 防止「图没提交」这类事故。
 *
 * 背景：分享卡片图（public/og*.png）是**构建产物**但必须提交进仓库，
 * 忘了提交时本地一切正常、线上分享卡片变成 404，而构建不会有任何警告。
 * favicon 和 robots.txt 同理。
 *
 * 用法：
 *   npm run check:assets            # 校验仓库里的资源文件
 *   npm run check:assets -- --dist  # 额外校验 dist 里被引用的图确实存在
 *
 * 检查项：
 *   1. 必备文件存在且非空；
 *   2. PNG 能被解析、尺寸符合预期（分享卡片必须是 1200×630，否则微信会裁切）；
 *   3. 构建产物里引用的同站 /og/ 图片，在 dist 里真的存在。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

const ROOT = resolve(import.meta.dirname, '..');
const PUBLIC = join(ROOT, 'public');
const checkDist = process.argv.includes('--dist');
const DIST = join(ROOT, 'dist');

const problems = [];

/** 必备资源：路径 + 期望宽度/高度（PNG 才有）+ 说明 */
const REQUIRED = [
  { path: 'og.png', width: 1200, height: 630, why: '全站分享卡片图（微信/Twitter 抓的就是它）' },
  { path: 'og/courses.png', width: 1200, height: 630, why: '/courses/ 的分享卡片' },
  { path: 'og/skills.png', width: 1200, height: 630, why: '/skills/ 的分享卡片' },
  { path: 'og/links.png', width: 1200, height: 630, why: '/guides/links/ 的分享卡片' },
  { path: 'favicon.svg', why: '站点图标' },
  { path: 'robots.txt', why: '爬虫规则（缺了会被默认放开抓取）' },
];

for (const item of REQUIRED) {
  const full = join(PUBLIC, item.path);
  if (!existsSync(full)) {
    problems.push(`缺少 public/${item.path}（${item.why}）—— 跑 npm run og 或补上文件`);
    continue;
  }
  const size = statSync(full).size;
  if (size < 32) {
    problems.push(`public/${item.path} 只有 ${size} 字节，基本是坏文件`);
    continue;
  }
  if (item.width) {
    try {
      const meta = await sharp(full).metadata();
      if (meta.width !== item.width || meta.height !== item.height) {
        problems.push(
          `public/${item.path} 尺寸是 ${meta.width}×${meta.height}，应为 ${item.width}×${item.height}（${item.why}）`,
        );
      }
    } catch (error) {
      problems.push(`public/${item.path} 不是合法图片：${error.message}`);
    }
  }
}

// 构建产物里引用的同站图片必须存在
if (checkDist && existsSync(DIST)) {
  const htmlFiles = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.html')) htmlFiles.push(full);
    }
  };
  walk(DIST);

  const referenced = new Set();
  for (const file of htmlFiles) {
    const html = readFileSync(file, 'utf8');
    for (const match of html.matchAll(/content="https:\/\/[^"]*?(\/(?:og|og\/)[^"]*?\.(?:png|jpg|svg))"/g)) {
      referenced.add(match[1]);
    }
  }

  for (const url of referenced) {
    if (url.includes('placeholder')) continue;
    const full = join(DIST, url.replace(/^\//, ''));
    if (!existsSync(full)) {
      problems.push(`页面引用了 ${url}，但 dist 里没有这个文件`);
    }
  }
  console.log(`扫描了 ${htmlFiles.length} 个页面，其中引用的站内分享卡片：${[...referenced].join('、') || '（无）'}`);
}

if (problems.length) {
  console.error(`\n✖ 资源检查未通过（${problems.length} 条）：`);
  for (const line of problems) console.error(`  · ${line}`);
  process.exit(1);
}

const checked = REQUIRED.map((item) => item.path).join('、');
console.log(`✔ 资源检查通过：${checked}`);
