#!/usr/bin/env node
/**
 * 生成站点统一的社交分享卡片图（Open Graph image）。
 *
 * 为什么是「一张统一图」而不是每页动态生成：
 * 每页动态生成要引入 satori / resvg 这类重量级构建依赖，收益远小于成本。
 * 真正决定转发点击率的是 og:title 和 og:description，那两项已经是每页动态的。
 *
 * 为什么用 sharp 而不是 canvas / Python：
 * sharp 本来就是 Astro 的依赖（图像优化用），也就是说**只要 npm install 就能跑**，
 * 不需要额外装 Python、Pillow 或系统图形库。中文由 SVG 走系统字体渲染。
 *
 * 用法：
 *   npm run og
 *
 * 输出：public/og.png（1200×630，微信/微博/Twitter 的通用尺寸）
 * 改文案直接改下面的常量，然后重新跑一次。
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'og.png');

// ── 文案与配色 ─────────────────────────────────────────────────────────
const W = 1200;
const H = 630;

const BG_TOP = '#660874'; // 清华紫
const BG_BOTTOM = '#4a0456';
const ACCENT = '#e8c4f0'; // 浅紫

const LABEL = 'THU · GUIDE';
const TITLE = '清华生存指南';
const SUBTITLE = '来自学长学姐的经验分享';
const TAGS = '选课 · 绩点 · 科研 · 保研 · 生活';
const FOOTER = 'tsinghua.nathanpenny.fun';

/**
 * 字体回退链：优先系统中文字体。
 * librsvg（sharp 的 SVG 后端）通过 fontconfig 匹配，找不到就退到最后一个通用族。
 */
const CJK = "'Hiragino Sans GB','Heiti SC','PingFang SC','Noto Sans CJK SC','Microsoft YaHei',sans-serif";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${BG_TOP}"/>
      <stop offset="100%" stop-color="${BG_BOTTOM}"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  <!-- 右上角装饰圆，让纯色背景不那么呆板 -->
  <circle cx="${W - 50}" cy="70" r="200" fill="#ffffff" fill-opacity="0.055"/>
  <circle cx="${W - 30}" cy="60" r="115" fill="#ffffff" fill-opacity="0.04"/>

  <text x="88" y="140" font-family="${CJK}" font-size="22" letter-spacing="2" fill="#ffffff" fill-opacity="0.5">${LABEL}</text>

  <text x="88" y="248" font-family="${CJK}" font-size="92" font-weight="700" fill="#ffffff">${TITLE}</text>

  <rect x="88" y="300" width="96" height="6" fill="${ACCENT}"/>

  <text x="88" y="378" font-family="${CJK}" font-size="38" fill="#ffffff" fill-opacity="0.92">${SUBTITLE}</text>
  <text x="88" y="436" font-family="${CJK}" font-size="30" fill="${ACCENT}">${TAGS}</text>

  <text x="88" y="${H - 72}" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="25" fill="#ffffff" fill-opacity="0.55">${FOOTER}</text>
</svg>`;

const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
writeFileSync(OUT, png);

const { width, height } = await sharp(png).metadata();
console.log(`已生成 public/og.png （${width}×${height}, ${(png.length / 1024).toFixed(1)} KB）`);
