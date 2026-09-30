#!/usr/bin/env node
/**
 * 媒体与视频检查 —— 三件事，都是为了不让「图挂了 / 视频没嵌上」静默发生。
 *
 * 1. 视频语法糖写法校验（`::bilibili[...]` / `::video[...]`）
 *    写错、写在句子中间、`:::` 忘了闭合 —— 这三种都会让页面少一块。
 *
 * 2. 外链图片守卫
 *    微信/微博/飞书的临时图片链接会失效（历史文章里的图会整片变空），
 *    http:// 图片在 https 站点上会被浏览器拦掉。这些必须在合并前拦住。
 *
 * 3. 产物比对（加 --dist）
 *    ⚠️ 这一条是必需的，不是锦上添花：Astro 的内容加载器遇到渲染错误时**只打印日志、
 *    构建仍然以退出码 0 结束**，并且那一页的正文会整个变空（实测）。
 *    也就是说「构建成功」并不代表内容都在，必须自己数一遍产物里有没有对应的视频容器。
 *
 * 用法：
 *   npm run check:media             只扫源码（CI 内容检查阶段，不用等构建）
 *   npm run check:media -- --dist   额外比对 dist 产物（构建之后跑）
 *   npm run check:media -- --strict 警告也当错误
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

const ROOT = resolve(import.meta.dirname, '..');
const DOCS_DIR = join(ROOT, 'src/content/docs');
const DIST = join(ROOT, 'dist');
const CONFIG = join(ROOT, 'public/admin/config.yml');

const strict = process.argv.includes('--strict');
const checkDist = process.argv.includes('--dist');
const annotate = Boolean(process.env.GITHUB_ACTIONS) || process.argv.includes('--annotate');

const findings = [];
const error = (message, file, line, hint) =>
  findings.push({ level: 'error', message, file, line, hint });
const warn = (message, file, line, hint) => findings.push({ level: 'warn', message, file, line, hint });

// ── 允许的图片域名（从后台配置里推导，避免两处漂移）──────────────────────

// 站点自己的域名 + 推荐的 R2 媒体域名（即使 config.yml 里还是占位符，这两个也应当被认）
const allowedHosts = new Set(['tsinghua.nathanpenny.fun', 'media.nathanpenny.fun']);
try {
  const config = parseYaml(readFileSync(CONFIG, 'utf8'));
  const publicUrl = config?.media_libraries?.cloudflare_r2?.public_url;
  if (typeof publicUrl === 'string' && /^https?:\/\//.test(publicUrl)) {
    const host = new URL(publicUrl).host;
    // 占位符不算数，否则「白名单」会把一个不存在的域名当成合法来源
    if (!/REPLACE|TODO|xxxx|example\.com/i.test(host)) allowedHosts.add(host);
  }
} catch {
  warn('读不到 public/admin/config.yml 里的 public_url，图片域名白名单只能靠默认值。', 'public/admin/config.yml');
}

/** 已知会失效或不允许的图片源 */
const BAD_HOST_PATTERNS = [
  { pattern: /(^|\.)qpic\.cn$/i, why: '微信/QQ 图片链接有有效期，过期后全站图片变空' },
  { pattern: /(^|\.)sinaimg\.cn$/i, why: '微博图床有防盗链，站外引用经常 403' },
  { pattern: /(^|\.)byteimg\.com$/i, why: '飞书/字节的临时图片链接会过期' },
  { pattern: /(^|\.)githubusercontent\.com$/i, why: 'raw.githubusercontent.com 在境内不稳定，图片应当放 R2' },
];

// ── 工具 ───────────────────────────────────────────────────────────────

function walk(dir, filter, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, filter, acc);
    else if (filter(full)) acc.push(full);
  }
  return acc.sort();
}

// Starlight 会忽略以 _ 开头的文件（例如 src/content/docs/_template.md 模板），这里保持一致
const isDoc = (p) => ['.md', '.mdx'].includes(extname(p)) && !p.split('/').pop().startsWith('_');

/** 与 check-content.ts 保持一致的「文件 → 站点路径」映射 */
function routeOf(file) {
  const rel = relative(DOCS_DIR, file).replace(/\\/g, '/');
  const id = rel.replace(/\.mdx?$/, '');
  if (id === 'index') return '/';
  if (id.endsWith('/index')) return `/${id.slice(0, -'/index'.length)}/`;
  return `/${id}/`;
}

// ── 1. 语法糖写法校验 ──────────────────────────────────────────────────

const DIRECTIVE_LINE = /^(\s*)(:{2,3})(bilibili|video)\[(.*)\]\s*$/;
const ANY_DIRECTIVE = /:{1,3}(bilibili|video)\[/;

const docFiles = walk(DOCS_DIR, isDoc);

/**
 * 取出「真正会被渲染的文本」：跳过围栏代码块，并抹掉行内代码。
 * 这一步是必须的：文档里讲语法时会写 `::bilibili[BV号]`，那是示例，不是真的插视频。
 * 不跳过的话，讲语法的页面自己就会把检查搞红（第一版就踩了这个坑）。
 */
function* contentLines(raw) {
  const lines = raw.split('\n');
  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    yield { lineNumber: i + 1, text: line.replace(/`[^`]*`/g, '') };
  }
}

/** 每个文件里期望出现的视频容器数量（产物比对用） */
const expectedEmbeds = new Map();

for (const file of docFiles) {
  const rel = relative(ROOT, file);
  const lines = [...contentLines(readFileSync(file, 'utf8'))];
  let count = 0;

  for (const { lineNumber, text: line } of lines) {
    if (!ANY_DIRECTIVE.test(line)) continue;

    const match = DIRECTIVE_LINE.exec(line);
    if (!match) {
      error(
        '视频语法糖必须单独占一行（从行首开始，允许缩进），不能写在句子中间。',
        rel,
        lineNumber,
        '改成：单独一行写 ::bilibili[BV号]',
      );
      continue;
    }

    const [, indent, colons, name, raw] = match;
    const [value] = raw.split('|');
    const argument = value.trim();

    if (colons === ':' || colons === '::') {
      // 单冒号是「行内指令」，写法上就该报错；双冒号是标准的 leaf 指令
      if (colons === ':') {
        error(`行内写法 :${name}[...] 不被支持。`, rel, lineNumber, `改成单独一行的 ::${name}[...]`);
        continue;
      }
    }

    if (name === 'bilibili') {
      if (!/BV[0-9A-Za-z]{10}/.test(argument) && !/av\d+/i.test(argument)) {
        error(
          `::bilibili[...] 里没有 BV 号或 av 号：「${argument}」`,
          rel,
          lineNumber,
          '写成 ::bilibili[BV1xx411c7mD]，或把整条 B 站链接粘进方括号里。',
        );
        continue;
      }
    }

    if (name === 'video') {
      if (!/^https:\/\/\S+$/.test(argument)) {
        error(
          `::video[...] 只接受 https 开头的完整网址：「${argument}」`,
          rel,
          lineNumber,
          '视频先在后台媒体库上传（存到 R2），再把地址粘进来。',
        );
        continue;
      }
    }

    // ::: 形式必须闭合，否则会把后面整篇正文吞进这个容器里
    if (colons === ':::') {
      let closed = false;
      for (let j = i + 1; j < lines.length; j += 1) {
        const next = lines[j].text.trim();
        if (next === '') continue;
        closed = next === ':::';
        break;
      }
      if (!closed) {
        error(
          ':::bilibili[...] / :::video[...] 后面没有单独一行 ::: 收尾，会把后面的正文全吞掉。',
          rel,
          lineNumber,
          '推荐直接用两个冒号的写法 ::bilibili[...]（一行写完，不用闭合）。',
        );
        continue;
      }
    }

    void indent;
    count += 1;
  }

  if (count > 0) expectedEmbeds.set(file, { count, route: routeOf(file) });
}

// ── 2. 外链图片与裸 HTML 守卫 ─────────────────────────────────────────

const MD_IMAGE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const HTML_IMAGE = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
const HTML_MEDIA_TAG = /<(iframe|video)\b/i;

function checkImageUrl(url, rel, lineNumber, alt) {
  if (url.startsWith('/')) return; // 站内绝对路径（og 图、R2 之外的静态资源）
  if (url.startsWith('data:')) {
    warn('图片内联成了 data: URL，正文会变得很大。', rel, lineNumber);
    return;
  }
  if (url.startsWith('./') || url.startsWith('../')) {
    warn(
      `正文引用了仓库里的本地图片（${url}）—— 本站约定媒体放 R2，本地图片会让仓库越来越重。`,
      rel,
      lineNumber,
      '在后台媒体库里上传，用生成的 https 地址。',
    );
    return;
  }
  if (url.startsWith('http://')) {
    error(`图片用了 http://（会被浏览器当混合内容拦掉）：${url}`, rel, lineNumber);
    return;
  }
  if (!url.startsWith('https://')) return;

  let host;
  try {
    host = new URL(url).host;
  } catch {
    error(`图片地址不是合法网址：${url}`, rel, lineNumber);
    return;
  }

  const bad = BAD_HOST_PATTERNS.find((entry) => entry.pattern.test(host));
  if (bad) {
    error(`图片源 ${host} 不可靠：${bad.why}`, rel, lineNumber, '把图片传到 R2，用 media 域名引用。');
    return;
  }

  const isR2Dev = /^pub-[0-9a-f]+\.r2\.dev$/i.test(host);
  if (!allowedHosts.has(host) && !isR2Dev) {
    warn(
      `图片来自白名单之外的域名（${host}）：外部图床随时可能失效或加防盗链。`,
      rel,
      lineNumber,
      '把图片传到 R2，用 media 域名引用；确实要外链的话请在 PR 里说明。',
    );
  }

  if (alt !== undefined && alt.trim() === '') {
    warn('图片说明（alt）是空的：影响无障碍阅读和图片搜索。', rel, lineNumber);
  }
}

for (const file of docFiles) {
  const rel = relative(ROOT, file);

  // 同样只看「真正会被渲染的文本」：文档里举例的 ![](图片路径) 不该被当成真图片
  for (const { lineNumber, text: line } of contentLines(readFileSync(file, 'utf8'))) {
    for (const match of line.matchAll(MD_IMAGE)) {
      checkImageUrl(match[2], rel, lineNumber, match[1]);
    }
    for (const match of line.matchAll(HTML_IMAGE)) {
      checkImageUrl(match[1], rel, lineNumber, undefined);
    }
    if (HTML_MEDIA_TAG.test(line) && !ANY_DIRECTIVE.test(line)) {
      warn(
        '正文里手写了 <iframe> / <video> 标签：能用，但语法糖更不容易写错。',
        rel,
        lineNumber,
        '视频优先用 ::bilibili[BV号] / ::video[地址]。',
      );
    }
  }
}

// ── 3. 产物比对（--dist）──────────────────────────────────────────────

let distNote = '';
if (checkDist) {
  if (!existsSync(DIST)) {
    warn('还没有 dist/ 产物，跳过了产物比对。构建之后再跑一次。', undefined, undefined);
  } else {
    let mismatched = 0;

    for (const [file, info] of expectedEmbeds) {
      const htmlPath = info.route === '/'
        ? join(DIST, 'index.html')
        : join(DIST, info.route.replace(/^\//, ''), 'index.html');
      if (!existsSync(htmlPath)) {
        error(
          `${relative(ROOT, file)} 里有 ${info.count} 个视频语法糖，但产物里没有对应页面（${relative(ROOT, htmlPath)}）。`,
          relative(ROOT, file),
        );
        mismatched += 1;
        continue;
      }
      const html = readFileSync(htmlPath, 'utf8');
      // 只数最外层的 figure：`class="media-embed"` 和 `class="media-embed media-embed--video"` 都算，
      // 但不能把内部的 `class="media-embed__frame"` 也算成一个（那个 `_` 是关键）
      const rendered = (html.match(/class="media-embed(?:\s|")/g) || []).length;
      if (rendered !== info.count) {
        error(
          `源码里有 ${info.count} 个视频语法糖，产物里只渲染出 ${rendered} 个 —— 页面内容少了一块。`,
          relative(ROOT, file),
          undefined,
          '看构建日志里有没有「Error rendering」：Astro 的内容加载器出错时构建仍然返回 0。',
        );
        mismatched += 1;
      }
    }

    // 字面量残留 = 语法糖没生效（例如写在了句子中间）
    const htmlFiles = walk(DIST, (p) => p.endsWith('.html'));
    let leftovers = 0;

    /**
     * 只留「读者能看到的文字」：
     *   1. 去掉 script/style/代码块/行内代码（文档页会教这个语法，那些不是残留）；
     *   2. 再去掉其余所有标签 —— 这一步是必需的：Expressive Code 的「复制」按钮会把源码
     *      放进 data-code="::bilibili[...]" 这种属性里，属性里的字面量不该算残留。
     */
    const visibleText = (html) =>
      html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<pre[\s\S]*?<\/pre>/gi, '')
        .replace(/<code[\s\S]*?<\/code>/gi, '')
        .replace(/<[^>]+>/g, '');

    for (const htmlFile of htmlFiles) {
      const text = visibleText(readFileSync(htmlFile, 'utf8'));
      const match = text.match(/::(?:bilibili|video)\[/);
      if (!match) continue;
      leftovers += 1;
      error(
        `产物里出现了没被渲染的视频语法糖字面量（${relative(ROOT, htmlFile)}）—— 说明写法没被识别。`,
        relative(ROOT, htmlFile),
        undefined,
        '检查它是不是写在句子中间、或者冒号数量不对。',
      );
    }

    distNote = `产物比对：${expectedEmbeds.size} 个含视频的页面，${htmlFiles.length} 个 HTML 文件` +
      `${mismatched ? `，${mismatched} 个不一致` : ''}${leftovers ? `，${leftovers} 处字面量残留` : ''}。`;
  }
}

// ── 输出 ───────────────────────────────────────────────────────────────

const errors = findings.filter((f) => f.level === 'error');
const warns = findings.filter((f) => f.level === 'warn');
const format = (f) => `${f.file ?? ''}${f.line ? `:${f.line}` : ''}${f.file ? ' ' : ''}${f.message}` +
  (f.hint ? ` —— ${f.hint}` : '');

for (const finding of warns) {
  if (annotate) console.log(`::warning title=媒体检查::${format(finding)}`);
  console.log(`▲ ${format(finding)}`);
}
for (const finding of errors) {
  if (annotate) console.log(`::error title=媒体检查::${format(finding)}`);
  console.error(`✖ ${format(finding)}`);
}

console.log(
  `\n媒体检查：扫描 ${docFiles.length} 个内容文件，${expectedEmbeds.size} 个用了视频语法糖。${distNote ? ` ${distNote}` : ''}`,
);

if (errors.length || (strict && warns.length)) {
  console.error(`\n✖ 媒体检查未通过：${errors.length} 个错误${strict ? `、${warns.length} 个警告（严格模式）` : ''}\n`);
  process.exit(1);
}

console.log(`✔ 媒体检查通过${warns.length ? `（${warns.length} 条提醒）` : ''}`);
