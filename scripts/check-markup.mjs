#!/usr/bin/env node
/**
 * 渲染产物检查 —— 抓「加粗没生效、`**` 被原样印在页面上」这类缺陷。
 *
 * 背景：站上有三种地方写 `**加粗**`，但只有一种会真的变粗：
 *
 *   1. 正文（Markdown）—— 变粗，但**有前提**：CommonMark 要求开标记是 left-flanking、
 *      闭标记是 right-flanking。`**` 紧贴全角标点时会不成立，例如
 *      `在**「图库」**窗口` —— 开标记后面是「（标点）而前面是汉字，判定失败，
 *      `**` 就原样输出。正确写法是 `在「**图库**」窗口`。
 *   2. frontmatter 里的 `banner.content` —— 走 set:html，**只认 HTML 不认 Markdown**，
 *      要加粗得写 `<strong>`；`title` / `description` / `summary` 则是纯文本，只能不加粗。
 *   3. `src/data/*.ts` 的 `desc` / `note` —— 卡片文案，必须经 `src/utils/card-text.ts`
 *      的 `descHtml()` 渲染；有组件忘了调它，星号就会原样显示（资料下载页出过）。
 *
 * 三种的共同点是：**构建一律成功、页面也能打开，只是文字上多了几个星号**，
 * 靠人眼复核很难全扫一遍。所以在构建之后数一遍产物里的可见文本。
 *
 * 用法：
 *   npm run check:markup            # 检查 dist（需要先 build）
 *   npm run check:markup -- --list  # 只列问题，不返回失败码
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const listOnly = process.argv.includes('--list');

if (!existsSync(DIST)) {
  console.error('✖ 找不到 dist/：先跑 npm run build');
  process.exit(1);
}

function walk(dir, filter) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, filter));
    else if (filter(full)) out.push(full);
  }
  return out;
}

/**
 * 只保留「用户能看到的文本」：
 * 去掉 script/style/svg/textarea 整块，再去掉 pre/code 里的内容
 * （`**加粗**` 这种语法示例是用反引号写的，属于代码，不算缺陷），
 * 最后剥掉所有标签与其属性（属性里可能有 `**`，那不是页面文字）。
 */
function visibleText(html) {
  return html
    .replace(/<(script|style|svg|textarea)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(pre|code)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

const files = walk(DIST, (p) => p.endsWith('.html'));
const problems = [];

for (const file of files) {
  const text = visibleText(readFileSync(file, 'utf8'));
  if (!text.includes('**')) continue;
  for (const m of text.matchAll(/.{0,35}\*\*.{0,35}/g)) {
    problems.push({ file: relative(ROOT, file), snippet: m[0].replace(/\s+/g, ' ').trim() });
  }
}

console.log(`\n渲染文本检查：扫了 ${files.length} 个页面。`);

if (problems.length === 0) {
  console.log('✔ 没有发现被原样印出来的 **');
  process.exit(0);
}

console.log('\n发现 ' + problems.length + ' 处星号被印在页面上：\n');
for (const p of problems.slice(0, 30)) {
  console.log(`  ${p.file}`);
  console.log(`    …${p.snippet}…`);
}
if (problems.length > 30) console.log(`\n  （其余 ${problems.length - 30} 处略）`);

console.log(`
怎么改：
  · 正文里 —— 把贴在内侧的全角标点挪到 ** 外面：「**同步**」，不要 **「同步」**；
    结尾是句号同理：**结论**。后面，不要 **结论。**后面。
  · banner.content —— 它只认 HTML：写 <strong>重点</strong>，写 ** 会原样显示。
  · title / description / summary —— 纯文本，不要写任何标记。
  · src/data 的 desc / note —— 确认渲染它的组件调了 card-text.ts 的 descHtml()。
`);

process.exit(listOnly ? 0 : 1);
