#!/usr/bin/env node
/**
 * 生成社交分享卡片图（Open Graph image）：全站一张 + 三个重点板块各一张。
 *
 * 为什么不是「每页动态生成」：
 * 每页动态生成要引入 satori / resvg 这类重量级构建依赖，收益远小于成本。
 * 真正决定转发点击率的是 og:title 和 og:description，那两项已经是每页动态的。
 *
 * 为什么用 sharp 而不是 canvas / Python：
 * sharp 本来就是 Astro 的依赖（图像优化用），也就是说**只要 npm install 就能跑**，
 * 不需要额外装 Python、Pillow 或系统图形库。中文由 SVG 走系统字体渲染。
 *
 * 为什么只给三个板块做专属卡片：
 * 课程资料索引 / 技能入门 / 校内常用链接是站外流量最可能落地的入口，
 * 卡片上直接说清「这一页有什么」比一张全站通用图值。再多做就是一堆没人维护的图。
 *
 * 用法：
 *   npm run og        # 生成全部 4 张
 *
 * 输出：
 *   public/og.png           全站通用
 *   public/og/courses.png   /courses/
 *   public/og/skills.png    /skills/
 *   public/og/links.png     /guides/links/
 *
 * 卡片上的数字从数据文件现读（课程数 ← src/data/course-index.json，
 * 链接数 ← src/data/links.ts），**不在这里写死** —— 手写的数字迟早和页面对不上。
 * 改文案直接改下面的 CARDS，然后重新跑一次。
 *
 * 哪一页用哪张图由 src/components/Head.astro 按路径决定，不在这里管。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── 配色与尺寸（改这里就等于改所有卡片的风格）────────────────────────────
const W = 1200;
const H = 630;

const BG_TOP = '#660874'; // 清华紫
const BG_BOTTOM = '#4a0456';
const ACCENT = '#e8c4f0'; // 浅紫

const FOOTER_URL = 'tsinghua.nathanpenny.fun';

/**
 * 字体回退链：优先系统中文字体。
 * librsvg（sharp 的 SVG 后端）通过 fontconfig 匹配，找不到就退到最后一个通用族。
 */
const CJK = "'Hiragino Sans GB','Heiti SC','PingFang SC','Noto Sans CJK SC','Microsoft YaHei',sans-serif";

const PAD = 88; // 左右安全边距
const MAX_TEXT_W = W - PAD * 2; // 文案可用宽度

/**
 * 估算一段文字占多宽：CJK / 全角算 1em，其余（拉丁字母、数字、空格）算 0.55em。
 * 只是用来防止文案改长之后溢出卡片，不需要和真实metrics一致 —— 所以宁可信其大。
 */
function estimateWidth(text, fontSize) {
  let units = 0;
  for (const ch of text) units += /[\u2E80-\uFFFF]/.test(ch) ? 1 : 0.55;
  return units * fontSize;
}

/** 太宽就缩小字号，直到放得下（最多缩到基准的 60%，再缩就不像标题了） */
function fitFontSize(text, base, maxWidth) {
  let size = base;
  while (size > base * 0.6 && estimateWidth(text, size) > maxWidth) size -= 2;
  return size;
}

/** 一张卡片的 SVG。所有卡片共用同一套版式，只有文案和缩号不同。 */
function renderCard({ label, title, subtitle, tags, footer }) {
  const titleSize = fitFontSize(title, 92, MAX_TEXT_W);
  const subtitleSize = fitFontSize(subtitle, 38, MAX_TEXT_W);
  const tagsSize = fitFontSize(tags, 30, MAX_TEXT_W);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
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

  <text x="${PAD}" y="140" font-family="${CJK}" font-size="22" letter-spacing="2" fill="#ffffff" fill-opacity="0.5">${label}</text>

  <text x="${PAD}" y="248" font-family="${CJK}" font-size="${titleSize}" font-weight="700" fill="#ffffff">${title}</text>

  <rect x="${PAD}" y="300" width="96" height="6" fill="${ACCENT}"/>

  <text x="${PAD}" y="378" font-family="${CJK}" font-size="${subtitleSize}" fill="#ffffff" fill-opacity="0.92">${subtitle}</text>
  <text x="${PAD}" y="436" font-family="${CJK}" font-size="${tagsSize}" fill="${ACCENT}">${tags}</text>

  <text x="${PAD}" y="${H - 72}" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="25" fill="#ffffff" fill-opacity="0.55">${footer}</text>
</svg>`;
}

/**
 * 读数据文件里的数字。
 * - 课程数：course-index.json 是 scripts/build-course-index.mjs 的产物，直接读 JSON。
 * - 链接数：links.ts 是唯一事实来源，用 tsx 直接 import（所以本脚本由 `npm run og` 用 tsx 跑），
 *   正则抠数字那种做法看起来省事，但实际上是把「数据」又抄了一遍。
 */
async function readCounts() {
  const courseIndex = JSON.parse(readFileSync(join(ROOT, 'src/data/course-index.json'), 'utf8'));

  let campusLinks;
  try {
    ({ campusLinks } = await import('../src/data/links.ts'));
  } catch (error) {
    console.error(
      '[og] 读不到 src/data/links.ts。这个脚本要用 tsx 才能 import .ts 数据文件，请用 `npm run og` 运行。'
    );
    throw error;
  }

  return { courses: courseIndex.courses.length, links: campusLinks.length };
}

const { courses: courseCount, links: linkCount } = await readCounts();

/** 四张卡片：第一张是全站通用，其余三张按路径被 Head.astro 引到对应板块。 */
const CARDS = [
  {
    out: 'public/og.png',
    label: 'THU · GUIDE',
    title: '清华生存指南',
    subtitle: '来自学长学姐的经验分享',
    tags: '选课 · 绩点 · 科研 · 保研 · 生活',
    footer: FOOTER_URL,
  },
  {
    out: 'public/og/courses.png',
    label: 'THU · GUIDE / 课程与资料',
    title: '课程资料索引',
    subtitle: `${courseCount} 门课在哪个资料库有材料`,
    tags: '往年题 / 笔记 / 课件 · 标注可达性 · 不镜像文件',
    footer: `${FOOTER_URL}/courses/`,
  },
  {
    out: 'public/og/skills.png',
    label: 'THU · GUIDE / 技能入门',
    title: '技能入门',
    subtitle: 'Git / LaTeX / 命令行，最短上手路径',
    tags: '版本管理 · 排版 · 终端 · 文献 · 数据画图',
    footer: `${FOOTER_URL}/skills/`,
  },
  {
    out: 'public/og/links.png',
    label: 'THU · GUIDE / 实用工具',
    title: '校内常用链接',
    subtitle: '带可达性与核对状态的入口清单',
    tags: `${linkCount} 个入口 · 校园网 / 公网 / 未实测 · 人工核对日期`,
    footer: `${FOOTER_URL}/guides/links/`,
  },
];

const written = [];

for (const card of CARDS) {
  const out = join(ROOT, card.out);
  const svg = renderCard(card);
  const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();

  const { width, height } = await sharp(png).metadata();
  if (width !== W || height !== H) {
    throw new Error(`${card.out} 尺寸是 ${width}×${height}，应该是 ${W}×${H}`);
  }

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, png);
  written.push({ file: card.out, width, height, bytes: png.length });
}

console.log('\n已生成社交分享卡片图（1200×630）：');
for (const { file, width, height, bytes } of written) {
  console.log(`  ${file.padEnd(26)} ${width}×${height}  ${(bytes / 1024).toFixed(1)} KB`);
}
console.log(`\n共 ${written.length} 张。板块卡片由 src/components/Head.astro 按路径引用。`);
console.log(`数字来源：课程 ${relative(ROOT, join(ROOT, 'src/data/course-index.json'))}（${courseCount} 门）、` +
  `链接 src/data/links.ts（${linkCount} 条）。`);
