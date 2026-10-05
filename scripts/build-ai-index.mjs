#!/usr/bin/env node
/**
 * AI 问答索引构建 —— 把**渲染产物**切成可检索、可引用的内容块。
 *
 * 为什么读 dist/ 的 HTML，而不是读 src/content/docs 的 Markdown：
 *   1. **锚点必须是对的。** 引用要能精确跳到某一小节，而标题 id 是 Astro 渲染时生成的
 *      （中文标题、重复标题、标点都会影响结果）。自己再实现一遍 slug 规则，迟早和渲染结果漂移，
 *      表现为「点进去跳不到那一节」——这种缺陷没人会主动报，所以从产物里把 id 抠出来最稳。
 *   2. **MDX 页面里有 JSX 组件**（选课工作台、课程索引、清单）。源文件里的组件代码是噪声，
 *      渲染完的 HTML 才是用户真正看到的内容。
 *   3. 与站内搜索（Pagefind）**同一套可见性口径**：只索引 `data-pagefind-body` 里的内容，
 *      跳过带 `data-pagefind-ignore` 的块。AI 答得出来的东西，和搜得出来的东西一致。
 *
 * 产物是两个文件（为什么要拆开见下方 writeIndex 的注释）：
 *   dist/ai-index.json   —— 分块元数据 + 倒排索引（小、要 JSON.parse）
 *   dist/ai-corpus.txt   —— 全部块正文，用 \u001e 分隔（大、只做字符串切分）
 *
 * 用法：
 *   npm run build                      # astro build 之后自动跑（见 package.json）
 *   npm run build:ai-index             # 只重建索引，需要先有 dist/
 *   node scripts/build-ai-index.mjs --stats
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
// 分词器与 Worker 共用同一份实现（见 src/utils/ai-tokenize.mjs 顶部注释）
import { tokenize } from '../src/utils/ai-tokenize.mjs';
import { isAggregatePage } from '../src/utils/ai-pages.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const DOCS_DIR = join(ROOT, 'src/content/docs');
const OUT_INDEX = join(DIST, 'ai-index.json');
const OUT_CORPUS = join(DIST, 'ai-corpus.txt');

const showStats = process.argv.includes('--stats');

/** 块正文长度边界（字符）。太短的碎片检索噪声大，太长的块会挤占模型上下文。 */
const CHUNK_MAX = 700;
const CHUNK_MIN = 120;

/**
 * 倒排索引剪枝。三个阈值都是为了控制 ai-index.json 的体积——
 * 它每次冷启动都要 JSON.parse 一遍，而免费档每次调用只有 10ms CPU，所以必须压到几百 KB。
 *
 * 高频词（df 超过 30% 的块）几乎等于停用词，留着只降低区分度。
 *
 * 另外两条是**排序质量**的关键，不是为了省体积，实测踩过：
 *   只出现一次的 bigram 占全部词条的 62%，大多是跨词边界的碎片；
 *   而「全文词频少于 3 次」的 bigram 更危险——它们是碎片，idf 却因为罕见而最高。
 *   实测提问「军训要准备什么」时，「要准」「备什」两个碎片的 idf 是 5.55（比「军训」的 4.21 还高），
 *   把 /contribute/ 的《你需要准备什么》顶到了真正的《军训生存指南》前面。
 *   碎片只在讨论它们的文章里密集出现，所以用「全文词频」把它们筛掉，比列停用词表可靠。
 */
const MAX_DF_RATIO = 0.3;
const MIN_DF = 2;
const MIN_TF = 3;
const MAX_POSTINGS = 60;

if (!existsSync(DIST)) {
  console.error('✖ 找不到 dist/：先跑 npm run build（本脚本读的是渲染产物，不是源 Markdown）');
  process.exit(1);
}

// ── 1. 找出所有参与索引的页面 ──────────────────────────────────────────────

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

/**
 * 源文件路径 → 站点 URL。
 *
 * 站点开了 trailingSlash: 'always'，且**没有任何一篇用 frontmatter 的 slug 覆盖路径**
 * （2026-10-05 核对）。所以路径可以直接推导；推不出来就让 check-ai-index 报错，
 * 而不是静默漏掉一篇。以后真有人写了 slug:，CI 会在这里拦住。
 */
function sourceToUrl(file) {
  const rel = relative(DOCS_DIR, file).replace(/\\/g, '/').replace(/\.mdx?$/, '');
  if (rel === 'index') return '/';
  if (rel.endsWith('/index')) return `/${rel.slice(0, -'/index'.length)}/`;
  return `/${rel}/`;
}

/** 从 frontmatter 取元数据；没有 frontmatter 就返回空对象（内容检查会另外拦） */
function readFrontmatter(file) {
  const raw = readFileSync(file, 'utf8');
  if (!raw.startsWith('---')) return {};
  const end = raw.indexOf('\n---', 3);
  if (end < 0) return {};
  try {
    return parseYaml(raw.slice(3, end)) ?? {};
  } catch {
    return {};
  }
}

/** reviewedAt 在 YAML 里可能是字符串也可能是 Date，统一成 YYYY-MM-DD */
function toDateString(value) {
  if (!value) return undefined;
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
  const text = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : undefined;
}

// ── 2. HTML → 结构化文本 ──────────────────────────────────────────────────

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** 整块丢弃的标签：它们的文本不是「文章内容」 */
const DROP_TAGS = new Set(['script', 'style', 'svg', 'textarea', 'nav', 'button']);

/** 块级标签：前后要断行，否则 `<p>甲</p><p>乙</p>` 会粘成「甲乙」 */
const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'li', 'ul', 'ol', 'tr', 'td', 'th',
  'blockquote', 'pre', 'figure', 'figcaption', 'table', 'h1', 'h2', 'h3', 'h4',
  'h5', 'h6', 'details', 'summary', 'aside', 'header', 'footer', 'dt', 'dd',
]);

/** 数字实体与几个常见命名实体。够用了：Astro 产物里不会出现别的怪实体。 */
function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function parseAttrs(tag) {
  const attrs = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? '');
  }
  return attrs;
}

/**
 * 有没有这个属性（**含无值属性**）。
 *
 * 为什么要单独判：`data-pagefind-ignore` 是布尔属性，写法是 `<span data-pagefind-ignore>`，
 * 没有 `="…"`，上面靠 `key="value"` 匹配的 parseAttrs 抓不到它。
 * 踩过一次：Starlight 给标题锚点加了个 `<span class="sr-only" data-pagefind-ignore>本节：…</span>`
 * （只为屏幕阅读器准备），漏判之后这句「本节：标题」被当成正文收进索引，
 * 表现为每块正文开头莫名其妙多一行，标题路径也跟着错位。
 */
function hasAttr(tag, name) {
  return new RegExp(`[\\s"']${name}(?=[\\s=/>])`).test(tag);
}

/**
 * 极简 HTML 分词器。
 *
 * 为什么不引第三方解析器：输入是我们自己构建出的、结构已知的 Astro 产物，
 * 需要的只有「跳过某些子树 + 按标题切段 + 收集文本」三件事。
 * 引一个 DOM 实现（jsdom 之类）会让构建变慢、依赖变重，而换来的健壮性在本场景用不上。
 * 代价是必须有两个守卫兜底：产物里不能残留标签（见 check-ai-index），
 * 以及每个锚点必须真的存在于 HTML 里（同上）。
 *
 * 返回 [{id, path, text}]：按 h2/h3 切好的小节，path 是「H2 › H3」形式的标题路径。
 */
function extractSections(mainHtml) {
  const sections = [];
  let headingPath = [];
  let current = { id: null, text: '', hasCode: false };
  /** 进入 sl-markdown-content 时的栈深；在此之前的内容（hero/标题/页脚元信息）不计入 */
  let contentDepth = null;
  /** 需要整块跳过的栈深（>=0 表示跳过中） */
  let skipDepth = -1;
  /** 代码块栈深：代码示例里的 `<LinkCard />` 是被转义过的正文，不算「标签泄漏」 */
  let codeDepth = -1;
  const stack = [];

  const pushText = (text) => {
    if (skipDepth >= 0 || contentDepth === null) return;
    if (codeDepth >= 0) current.hasCode = true;
    current.text += text;
  };
  const pushBreak = () => {
    if (skipDepth >= 0 || contentDepth === null) return;
    if (current.text && !current.text.endsWith('\n')) current.text += '\n';
  };
  const flush = () => {
    const text = current.text.replace(/[ \t\u00a0]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
    if (text) {
      sections.push({
        id: current.id,
        level: current.level,
        text,
        hasCode: current.hasCode,
      });
    }
    current = { id: null, level: null, text: '', hasCode: false };
  };

  const tokenRe = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let last = 0;
  let match;

  while ((match = tokenRe.exec(mainHtml)) !== null) {
    if (match.index > last) pushText(decodeEntities(mainHtml.slice(last, match.index)));
    last = tokenRe.lastIndex;

    if (match[0].startsWith('<!--')) continue;

    const name = match[1].toLowerCase();
    const isEnd = match[0][1] === '/';

    if (isEnd) {
      const depth = stack.length - 1;
      stack.pop();
      if (skipDepth >= 0 && depth <= skipDepth) skipDepth = -1;
      if (contentDepth !== null && depth <= contentDepth) contentDepth = null;
      if (codeDepth >= 0 && depth <= codeDepth) codeDepth = -1;
      if (BLOCK_TAGS.has(name)) pushBreak();
      continue;
    }

    const attrs = parseAttrs(match[0]);
    const selfClosing = VOID_TAGS.has(name) || match[0].endsWith('/>');
    const entersContent = attrs.class?.split(/\s+/).includes('sl-markdown-content');

    if (!selfClosing) stack.push(name);

    // 已经要跳过的子树，只维护栈深，不做任何判定
    if (skipDepth >= 0) continue;

    // 是否进入正文容器（自身是容器，所以栈深记为「当前深度 - 1」之后的内容都算）
    if (entersContent && contentDepth === null) {
      contentDepth = stack.length - 1;
      continue;
    }

    if (DROP_TAGS.has(name) || hasAttr(match[0], 'data-pagefind-ignore')) {
      skipDepth = stack.length - 1;
      continue;
    }

    if ((name === 'pre' || name === 'code') && codeDepth < 0) {
      codeDepth = stack.length - 1;
      continue;
    }

    if (contentDepth === null) continue;

    if (name === 'h2' || name === 'h3') {
      flush();
      current.id = attrs.id ?? null;
      current.level = name === 'h2' ? 2 : 3;
      continue;
    }
    if (name === 'h1' || name === 'h4' || name === 'h5' || name === 'h6') {
      // 标题层级不参与分段，但也不要把标题文字粘进上一段
      pushBreak();
      continue;
    }
    if (BLOCK_TAGS.has(name)) pushBreak();
  }

  // ⚠️ 收尾的 flush 不能省。
  // sections 只在遇到下一个 h2/h3 时才落袋，所以循环结束后必须再落一次，
  // 否则**每一页的最后一段正文都会丢**；没有 h2/h3 的页面（标签页、阶段页）会整页丢。
  // 这个缺漏不会报任何错——检索结果里少一段，没人看得出来。实测就是这么发现的：
  // /tags/军训/ 这种只有正文没有标题的页面切出 0 个块。
  flush();

  // 标题文字与标题路径只能在这里补：分词时「先见到 <h3> 开标签、后攒完这一节的正文」，
  // 到 flush 那一刻还不知道标题文字是什么。sections 是按文档顺序排的，
  // 边遍历边维护每一级的标题，就能还原出「H2 › H3」这样的路径。
  const resolved = [];
  for (const section of sections) {
    const newline = section.text.indexOf('\n');
    const firstLine = newline >= 0 ? section.text.slice(0, newline) : section.text;
    // 约定：一节的正文第一行就是它的标题（标题标签自身的文字），60 字以内才认
    const headingIsFirstLine = Boolean(section.id) && firstLine.length <= 60;
    if (headingIsFirstLine) {
      section.text = newline >= 0 ? section.text.slice(newline + 1).trim() : '';
    }

    if (section.level) {
      resolved[section.level - 2] = headingIsFirstLine ? firstLine : '';
      resolved.length = section.level - 1;
      section.title = headingIsFirstLine ? firstLine : '';
    }
    section.path = resolved.filter(Boolean).join(' › ');
  }

  return sections.filter((s) => s.text.length > 0);
}

// ── 3. 分块 ───────────────────────────────────────────────────────────────

/**
 * 一个 h2/h3 小节可能很长（有的小节一两千字）。按段落贪心切到 CHUNK_MAX 以内。
 * 过短的尾巴并回上一块，避免产出「半句话」这种检索噪声。
 */
function splitSection(section) {
  const paragraphs = section.text.split('\n').map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let buffer = '';

  const flushBuffer = () => {
    const text = buffer.trim();
    if (text) chunks.push(text);
    buffer = '';
  };

  for (const paragraph of paragraphs) {
    if (buffer && buffer.length + paragraph.length + 1 > CHUNK_MAX) flushBuffer();
    // 单段本身就超长（表格、长清单）：硬切
    if (paragraph.length > CHUNK_MAX) {
      flushBuffer();
      for (let i = 0; i < paragraph.length; i += CHUNK_MAX) chunks.push(paragraph.slice(i, i + CHUNK_MAX));
      continue;
    }
    buffer = buffer ? `${buffer}\n${paragraph}` : paragraph;
  }
  flushBuffer();

  for (let i = 1; i < chunks.length; i += 1) {
    if (chunks[i].length < CHUNK_MIN) {
      chunks[i - 1] = `${chunks[i - 1]}\n${chunks[i]}`;
      chunks.splice(i, 1);
      i -= 1;
    }
  }
  // hasCode 按小节整体继承（保守）：只要这一节里有代码示例，就不再对它做「标签泄漏」判定
  return chunks.map((text) => ({ text, hasCode: section.hasCode === true }));
}

// ── 4. 分词与倒排索引 ─────────────────────────────────────────────────────

function countTerms(tokens) {
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

// ── 5. 主流程 ─────────────────────────────────────────────────────────────
//
// 页面清单**以渲染产物为准**（dist 下所有带 data-pagefind-body 的页面），
// 源文章的 frontmatter 只作为附加元数据。
//
// 为什么不反过来以 src/content/docs 为准：站上还有 5 个由 src/pages/*.astro 生成的页面
// （/courses/ 课程索引、/stages/、/tags/、/changelog/、/contributors/），它们没有源 Markdown，
// 但有实打实的内容——尤其 /courses/ 是「哪门课有往年题」的唯一入口。
// 早期版本按源文件列举，这 5 个页面全被漏掉，而检查脚本只能看到「索引里没有它」，
// 说不上来是漏了还是故意排除。以产物为准之后判据只剩一条，漏没漏一眼可查；
// 反向的风险（有源文件却没页面）由 check-ai-index 的覆盖度检查兜住。

const sourceFiles = walk(DOCS_DIR).filter((f) => {
  if (!/\.mdx?$/.test(f)) return false;
  // 下划线开头的是模板/草稿（_template.md），不对应任何线上页面
  return !relative(DOCS_DIR, f).split('/').some((segment) => segment.startsWith('_'));
});

/** URL → frontmatter。只有 src/content/docs 下的文章有，其余页面拿到空对象。 */
const frontmatterByUrl = new Map();
for (const file of sourceFiles) frontmatterByUrl.set(sourceToUrl(file), readFrontmatter(file));

/** dist 下所有页面（index.html），转成站点 URL */
const distPages = walk(DIST)
  .filter((file) => file.endsWith('/index.html'))
  .map((file) => ({ file, url: `/${relative(DIST, file).replace(/index\.html$/, '')}` }))
  .sort((a, b) => a.url.localeCompare(b.url));

const chunks = [];
const documents = [];
const skipped = [];
const aggregateSkipped = [];

for (const { file, url } of distPages) {
  if (isAggregatePage(url)) {
    // 聚合/导航页不索引，理由见 src/utils/ai-pages.mjs
    aggregateSkipped.push(url);
    continue;
  }
  const html = readFileSync(file, 'utf8');
  const mainStart = html.search(/<main\b[^>]*data-pagefind-body[^>]*>/);
  if (mainStart < 0) {
    // 404、/admin/ 等通过 pagefind: false 或不带正文容器退出索引，不算异常
    skipped.push({ file: relative(ROOT, file), url, reason: '页面没有 data-pagefind-body（不参与站内搜索）' });
    continue;
  }
  const mainEnd = html.lastIndexOf('</main>');
  const mainHtml = html.slice(mainStart, mainEnd > mainStart ? mainEnd : undefined);

  const meta = frontmatterByUrl.get(url) ?? {};
  const titleMatch = mainHtml.match(/<h1[^>]*id="_top"[^>]*>([\s\S]*?)<\/h1>/);
  const htmlTitle = html.match(/<title>([\s\S]*?)<\/title>/);
  const title = decodeEntities(
    (titleMatch?.[1] ?? meta.title ?? htmlTitle?.[1] ?? url).replace(/<[^>]*>/g, ''),
  )
    .replace(/\s*\|\s*清华生存指南\s*$/, '')
    .trim();

  const sections = extractSections(mainHtml);
  let chunkCount = 0;

  for (const section of sections) {
    for (const piece of splitSection(section)) {
      chunks.push({
        u: url,
        t: title,
        h: section.title || title,
        p: section.path || title,
        a: section.id ?? null,
        x: piece.text,
        c: piece.hasCode,
        s: typeof meta.status === 'string' ? meta.status : 'stable',
        r: toDateString(meta.reviewedAt),
        g: Array.isArray(meta.stage) ? meta.stage.filter((v) => typeof v === 'string') : [],
        k: Array.isArray(meta.tags) ? meta.tags.filter((v) => typeof v === 'string') : [],
      });
      chunkCount += 1;
    }
  }

  if (chunkCount === 0) {
    skipped.push({ file: relative(ROOT, file), url, reason: '正文为空（构建异常？）' });
    continue;
  }
  documents.push({ url, title, chunks: chunkCount });
}

if (chunks.length === 0) {
  console.error('✖ 一个内容块都没切出来：产物结构可能变了，检查 extractSections 的选择器。');
  process.exit(1);
}

const totalChunks = chunks.length;

// 倒排：正文（body）与标题（head）分开，标题命中的权重更高
const bodyPostings = new Map();
const headPostings = new Map();
/** 全文词频（不是 df）：用来识别跨词边界的碎片，见 MIN_TF 的注释 */
const bodyTf = new Map();
const headTf = new Map();
const bodyLens = [];

/**
 * 倒排表存的是**块号**，不存词频。
 *
 * 为什么砍掉词频：这是索引体积的最大头。带上 tf 时每个条目是 `[123,4]`（8 字节），
 * 只存块号是 `123`（4 字节），实测省掉约六成体积，而排序质量几乎无差别——
 * 662 个块的语料里，BM25 的长度归一化加「命中查询词的数量」已经足够区分好坏。
 * 换来的是冷启动时 JSON.parse 的时间从 8ms 降到 3ms 上下，直接决定免费额度能不能用。
 */
for (let i = 0; i < chunks.length; i += 1) {
  const body = countTerms(tokenize(chunks[i].x));
  bodyLens.push([...body.values()].reduce((a, b) => a + b, 0));
  for (const [term, tf] of body) {
    if (!bodyPostings.has(term)) bodyPostings.set(term, []);
    bodyPostings.get(term).push(i);
    bodyTf.set(term, (bodyTf.get(term) ?? 0) + tf);
  }
  const headTerms = countTerms(tokenize(`${chunks[i].t} ${chunks[i].h} ${chunks[i].k.join(' ')}`));
  for (const [term, tf] of headTerms) {
    if (!headPostings.has(term)) headPostings.set(term, []);
    headPostings.get(term).push(i);
    headTf.set(term, (headTf.get(term) ?? 0) + tf);
  }
}

/** 剪枝：高频词 ≈ 停用词；只出现一次的词、全文词频过低的词多是跨词边界的碎片；超长表按块号截断 */
const maxDf = Math.max(8, Math.floor(totalChunks * MAX_DF_RATIO));
function prune(postings, totalTf) {
  const out = {};
  let kept = 0;
  let droppedHighDf = 0;
  let droppedRare = 0;
  let droppedLowTf = 0;
  let truncated = 0;
  for (const [term, list] of postings) {
    if (list.length > maxDf) {
      droppedHighDf += 1;
      continue;
    }
    if (list.length < MIN_DF) {
      droppedRare += 1;
      continue;
    }
    if ((totalTf.get(term) ?? 0) < MIN_TF) {
      droppedLowTf += 1;
      continue;
    }
    let trimmed = list;
    if (list.length > MAX_POSTINGS) {
      trimmed = list.slice(0, MAX_POSTINGS);
      truncated += 1;
    }
    out[term] = trimmed;
    kept += 1;
  }
  return { out, kept, droppedHighDf, droppedRare, droppedLowTf, truncated };
}

const body = prune(bodyPostings, bodyTf);
const head = prune(headPostings, headTf);
const avgLen = Math.round(bodyLens.reduce((a, b) => a + b, 0) / bodyLens.length);
const threshold = Math.round(avgLen * 1.4);

/**
 * 为什么要拆成两个文件：
 *   ai-index.json 要 JSON.parse。把 50 万字正文塞进去，冷启动时就是一次 1MB+ 的解析，
 *   白白吃掉免费档每次调用 10ms 的 CPU 预算。
 *   正文单独放 ai-corpus.txt，运行时按 \u001e 切一刀即可（纯字符串扫描，几乎不耗 CPU），
 *   并且只在真正要用到片段正文时才读。
 *   代价是两份文件必须同一次构建产出——check-ai-index 会校验它们的块数一致。
 */
const index = {
  version: 1,
  builtAt: new Date().toISOString(),
  stats: {
    documents: documents.length,
    chunks: totalChunks,
    terms: Object.keys(body.out).length,
    headTerms: Object.keys(head.out).length,
    avgLen,
    longChunkThreshold: threshold,
    maxDf,
  },
  chunks: chunks.map((chunk, i) => ({
    u: chunk.u,
    t: chunk.t,
    h: chunk.h,
    p: chunk.p,
    a: chunk.a,
    len: bodyLens[i],
    s: chunk.s,
    // 含代码示例的块：只给检查脚本用（用来豁免「正文里有尖括号」的告警，见 check-ai-index）
    ...(chunk.c ? { c: 1 } : {}),
    ...(chunk.r ? { r: chunk.r } : {}),
    ...(chunk.g.length ? { g: chunk.g } : {}),
    ...(chunk.k.length ? { k: chunk.k } : {}),
  })),
  postings: body.out,
  head: head.out,
};

writeFileSync(OUT_INDEX, JSON.stringify(index));
writeFileSync(OUT_CORPUS, chunks.map((c) => c.x).join('\u001e'));

if (showStats || process.env.AI_INDEX_VERBOSE) {
  const indexBytes = statSync(OUT_INDEX).size;
  const corpusBytes = statSync(OUT_CORPUS).size;
  console.log(`索引：${documents.length} 篇 → ${totalChunks} 块`);
  console.log(`  ai-index.json  ${(indexBytes / 1024).toFixed(0)} KB（${index.stats.terms} 个正文词条）`);
  console.log(`  ai-corpus.txt  ${(corpusBytes / 1024).toFixed(0)} KB`);
  console.log(`  剪枝：高频词 ${body.droppedHighDf} 个、只出现一次的词 ${body.droppedRare} 个、低频碎片 ${body.droppedLowTf} 个；df 上限 ${maxDf}`);
  console.log(`  平均块长 ${avgLen} 词`);
  if (aggregateSkipped.length) {
    console.log(`  ○ 按规则跳过 ${aggregateSkipped.length} 个聚合/导航页（/tags/、/stages/，理由见 src/utils/ai-pages.mjs）`);
  }
  if (skipped.length) {
    for (const item of skipped) console.log(`  ○ 跳过 ${item.url}（${item.reason}）`);
  }
}

/**
 * 兜底：万一 HTML 抽取漏了标签，宁可在构建时炸掉，也不要把尖括号喂给模型。
 *
 * 例外是代码示例：`&lt;LinkCard /&gt;` 这种本来就是正文（贡献指南里就有），
 * 解码实体之后当然长着标签的样子。extractSections 会把这类块标出来，跳过判定。
 */
const leaked = chunks.find((c) => !c.c && /<\/?[a-zA-Z][^>]*>/.test(c.x));
if (leaked) {
  console.error(`✖ 块正文里残留了 HTML 标签（${leaked.u}）：${leaked.x.slice(0, 80)}`);
  process.exit(1);
}
