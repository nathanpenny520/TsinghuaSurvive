#!/usr/bin/env node
/**
 * AI 索引与检索质量检查。
 *
 * 为什么必须进 CI：这套东西的失败方式全是**静默**的——
 *   - 索引脚本把某篇漏掉了：页面照开，只是那篇永远检索不到；
 *   - 块里的锚点算错了：引用卡片能点，但跳过去停在页面顶部而不是那一节；
 *   - 分词或权重改动让排序退化：「军训」的问题答成了「准备」的问题，没有任何报错；
 *   - 索引体积涨到几 MB：冷启动 JSON.parse 吃掉免费档 10ms 的 CPU 预算，表现为随机 500。
 * 靠人眼是发现不了这些的，所以这里逐条查，并且**跑一组真实提问**核对排序结果。
 *
 * 用法：
 *   npm run check:ai            # 需要先 npm run build
 *   npm run check:ai -- --list  # 只列问题，不返回失败码
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { loadKnowledge, search, isConfident } from '../src/worker/retrieval.js';
import { isAggregatePage } from '../src/utils/ai-pages.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const INDEX_FILE = join(DIST, 'ai-index.json');
const CORPUS_FILE = join(DIST, 'ai-corpus.txt');
const listOnly = process.argv.includes('--list');

/** 体积上限（KB）。超过就说明冷启动解析会挤占免费档的 CPU 预算，见 build-ai-index.mjs。 */
const MAX_INDEX_KB = 900;
const MAX_CORPUS_KB = 1500;

/**
 * 检索自测用例 —— **改动分词、权重、剪枝参数之后，这里必须全绿**。
 *
 * `expect: 'answer'` 表示应该去问模型；`expect: 'refuse'` 表示应该老实说「站内没有」。
 * `top` 是期望排第一的 URL（只对重要的、排错了就一定说明回归的用例写）。
 */
const RETRIEVAL_CASES = [
  { q: '绩点是怎么算的？', expect: 'answer', top: '/academics/gpa/' },
  { q: '军训要准备什么', expect: 'answer', top: '/freshman/military-training/' },
  { q: '怎么找导师进实验室', expect: 'answer', top: '/research/finding-a-lab/' },
  { q: '奖学金怎么评', expect: 'answer', top: '/academics/scholarships/' },
  { q: '宿舍网络怎么弄', expect: 'answer', top: '/freshman/dorm-and-network/' },
  { q: '挂科了怎么办', expect: 'answer', top: '/mindset/after-failure/' },
  { q: '食堂哪个好吃', expect: 'answer' },
  { q: '自行车丢了怎么办', expect: 'answer' },
  { q: '转专业', expect: 'answer' },
  { q: 'Python 怎么装', expect: 'answer' },
  { q: '怎么和导师发邮件', expect: 'answer' },
  { q: '体测不及格怎么办', expect: 'answer' },
  { q: '怎么申请奖学金', expect: 'answer' },
  // 拒答：站内确实没有的内容。第三条尤其重要——实测 grep 过，26 万字里「四级」出现 0 次。
  { q: '今天天气怎么样', expect: 'refuse' },
  // 课程索引页（/courses/）里有 142 门课的数据，所以「量子力学」这类课名是**答得出来**的
  { q: '量子力学', expect: 'answer', top: '/courses/' },
  { q: '四级没过怎么办', expect: 'refuse' },
  { q: '帮我写一首诗', expect: 'refuse' },
  { q: '推荐一部电影', expect: 'refuse' },
  { q: 'aaaa bbbb 不存在的东西', expect: 'refuse' },
];

const problems = [];
const report = (level, message) => problems.push({ level, message });

if (!existsSync(INDEX_FILE) || !existsSync(CORPUS_FILE)) {
  console.error('✖ 找不到 AI 索引产物：先跑 npm run build');
  process.exit(1);
}

// ── 1. 体积 ───────────────────────────────────────────────────────────────
const indexKb = statSync(INDEX_FILE).size / 1024;
const corpusKb = statSync(CORPUS_FILE).size / 1024;
if (indexKb > MAX_INDEX_KB) {
  report('error', `ai-index.json 有 ${indexKb.toFixed(0)} KB，超过上限 ${MAX_INDEX_KB} KB：冷启动 JSON.parse 会挤占免费档的 CPU 预算。请调紧 build-ai-index.mjs 的剪枝参数。`);
}
if (corpusKb > MAX_CORPUS_KB) {
  report('error', `ai-corpus.txt 有 ${corpusKb.toFixed(0)} KB，超过上限 ${MAX_CORPUS_KB} KB。`);
}

// ── 2. 产物内部一致性 ─────────────────────────────────────────────────────
const index = JSON.parse(readFileSync(INDEX_FILE, 'utf8'));
const corpus = readFileSync(CORPUS_FILE, 'utf8').split('\u001e');

if (index.version !== 1) report('error', `ai-index.json 的 version 是 ${index.version}，Worker 只认 1。`);
if (corpus.length !== index.chunks.length) {
  report('error', `索引块数（${index.chunks.length}）与正文块数（${corpus.length}）不一致——两个文件不是同一次构建产出的。`);
}
if (index.chunks.length < 100) {
  report('error', `只切出 ${index.chunks.length} 个块，明显偏少：HTML 抽取很可能失效了（选择器变了？）。`);
}

// ── 3. 每一块都要能落到真实页面上 ─────────────────────────────────────────
const htmlCache = new Map();
function pageHtml(url) {
  if (!htmlCache.has(url)) {
    const file = url === '/' ? join(DIST, 'index.html') : join(DIST, url.slice(1), 'index.html');
    htmlCache.set(url, existsSync(file) ? readFileSync(file, 'utf8') : null);
  }
  return htmlCache.get(url);
}

const missingPages = new Set();
const missingAnchors = new Set();
index.chunks.forEach((chunk, i) => {
  const html = pageHtml(chunk.u);
  if (html === null) {
    missingPages.add(chunk.u);
    return;
  }
  if (chunk.a && !html.includes(`id="${chunk.a}"`)) missingAnchors.add(`${chunk.u}#${chunk.a}`);
  const text = corpus[i] ?? '';
  if (!text.trim()) report('error', `第 ${i} 块的正文是空的（${chunk.u}）。`);
  // 含代码示例的块（贡献指南里的 frontmatter 模板、`<LinkCard />` 写法）本来就长这样
  if (!chunk.c && /<\/?[a-zA-Z][^>]*>/.test(text)) {
    report('warn', `第 ${i} 块的正文里出现尖括号（${chunk.u}）：${text.slice(0, 60)}`);
  }
});
if (missingPages.size) {
  report('error', `有 ${missingPages.size} 个索引 URL 在 dist 里找不到对应页面：${[...missingPages].slice(0, 5).join('、')}`);
}
if (missingAnchors.size) {
  report('error', `有 ${missingAnchors.size} 个锚点在页面里不存在（引用会跳错位置）：${[...missingAnchors].slice(0, 5).join('、')}`);
}

// ── 4. 覆盖度：参与站内搜索的页面都应该被索引到 ───────────────────────────
// 判据与构建脚本一致（见 src/utils/ai-pages.mjs）：所有带 data-pagefind-body 的页面，
// 减去显式排除的聚合/导航页。聚合页数量单独报出来，免得「排除规则」悄悄吃掉真页面。
const indexedUrls = new Set(index.chunks.map((c) => c.u));

function walkHtml(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkHtml(full, acc);
    else if (entry.name === 'index.html') acc.push(full);
  }
  return acc;
}

const allPages = walkHtml(DIST).map((file) => ({
  file,
  url: `/${relative(DIST, file).replace(/index\.html$/, '')}`,
}));

const searchable = allPages.filter(({ file }) => readFileSync(file, 'utf8').includes('data-pagefind-body'));
const aggregate = searchable.filter(({ url }) => isAggregatePage(url));
const expected = searchable.filter(({ url }) => !isAggregatePage(url));
const missed = expected.filter(({ url }) => !indexedUrls.has(url));

if (missed.length) {
  report('error', `有 ${missed.length} 个可搜索页面没有被 AI 索引覆盖：${missed.slice(0, 6).map((p) => p.url).join('、')}`);
}
if (expected.length < 10) {
  report('error', `只找到 ${expected.length} 个应索引的页面，明显偏少：判据本身可能失效了。`);
}

// ── 5. 检索质量自测（最重要的一项）────────────────────────────────────────
const env = {
  ASSETS: {
    fetch: async (request) => {
      const path = new URL(request.url).pathname;
      if (path === '/ai-index.json') return new Response(readFileSync(INDEX_FILE, 'utf8'));
      if (path === '/ai-corpus.txt') return new Response(readFileSync(CORPUS_FILE, 'utf8'));
      return new Response('not found', { status: 404 });
    },
  },
};

const knowledge = await loadKnowledge(env);
let failed = 0;

for (const testCase of RETRIEVAL_CASES) {
  const result = search(knowledge, testCase.q, { topK: 5, maxPerUrl: 2 });
  const answered = isConfident(result, { minScore: 6 });
  const expectedAnswer = testCase.expect === 'answer';
  const top = result.hits[0]?.url;

  if (answered !== expectedAnswer) {
    failed += 1;
    report('error', `检索自测失败：「${testCase.q}」应该${expectedAnswer ? '回答' : '拒答'}，实际${answered ? '回答' : '拒答'}（top=${top ?? '无'} 分数=${result.topScore.toFixed(1)} 命中词=${result.matchedInTop}/${result.terms.length}）`);
    continue;
  }
  if (testCase.top && top !== testCase.top) {
    failed += 1;
    report('error', `检索排序退步：「${testCase.q}」应命中 ${testCase.top}，实际第一名是 ${top}。`);
  }
}

// ── 6. 输出 ───────────────────────────────────────────────────────────────
const errors = problems.filter((p) => p.level === 'error');
const warns = problems.filter((p) => p.level === 'warn');

for (const item of warns) console.log(`▲ ${item.message}`);
for (const item of errors) console.error(`✖ ${item.message}`);

if (!listOnly && errors.length) process.exit(1);

console.log(
  `\nAI 索引检查：${index.stats.documents} 篇 → ${index.chunks.length} 块（另有 ${aggregate.length} 个聚合页按规则不索引），` +
    `索引 ${indexKb.toFixed(0)} KB + 正文 ${corpusKb.toFixed(0)} KB；` +
    `检索自测 ${RETRIEVAL_CASES.length - failed}/${RETRIEVAL_CASES.length} 通过。`,
);
