#!/usr/bin/env tsx
/**
 * 内容检查 —— 在构建**之前**跑，把问题拦在部署前面。
 *
 * 为什么需要它：Astro 的 zod schema 只能校验 frontmatter 的**类型**，
 * 校验不了这些东西：
 *   - 站内链接指向了一个不存在的页面（改文件名时最容易漏）
 *   - 文件名用了中文（会在微信里变成一长串 %E5%AD%A6...）
 *   - reviewedAt 写在未来、或者已经太久没核对
 *   - links.ts / resources.ts 里的占位符和过期核对日期
 *
 * 用法：
 *   npm run check:content            普通模式：错误退出 1，警告只提示
 *   npm run check:content -- --strict  严格模式：警告也当错误（发布前用）
 *
 * 阈值来自根目录 content-policy.json —— 与站点上的时效看门狗共用同一份配置。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

import { campusLinks } from '../src/data/links.ts';
import { resources } from '../src/data/resources.ts';

const ROOT = resolve(import.meta.dirname, '..');
const DOCS_DIR = join(ROOT, 'src/content/docs');
const PAGES_DIR = join(ROOT, 'src/pages');
const PUBLIC_DIR = join(ROOT, 'public');

const policy = JSON.parse(readFileSync(join(ROOT, 'content-policy.json'), 'utf8')) as {
  staleAfterMonths: number;
  linkVerifiedStaleAfterMonths: number;
  placeholderAuthors: string[];
  placeholderUrlValues: string[];
  sidebarOrderWarning: number;
};

const strict = process.argv.includes('--strict');
const annotate = Boolean(process.env.GITHUB_ACTIONS) || process.argv.includes('--annotate');

type Level = 'error' | 'warn';

type Finding = {
  level: Level;
  file?: string;
  line?: number;
  message: string;
  hint?: string;
};

const findings: Finding[] = [];
const add = (f: Finding) => findings.push(f);
const error = (message: string, file?: string, line?: number, hint?: string) =>
  add({ level: 'error', message, file, line, hint });
const warn = (message: string, file?: string, line?: number, hint?: string) =>
  add({ level: 'warn', message, file, line, hint });

// ── 工具 ───────────────────────────────────────────────────────────────

function walk(dir: string, filter: (p: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, filter));
    else if (filter(full)) out.push(full);
  }
  return out.sort();
}

function parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string } {
  if (!raw.startsWith('---')) return { data: {}, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { data: {}, body: raw };
  const header = raw.slice(raw.indexOf('\n', 3) + 1, end);
  const body = raw.slice(end + 4);
  let data: Record<string, unknown> = {};
  try {
    data = (parseYaml(header) ?? {}) as Record<string, unknown>;
  } catch (err) {
    error(`frontmatter YAML 解析失败：${(err as Error).message}`, relative(ROOT, currentFile), 1);
  }
  return { data, body };
}

function monthsBetween(from: Date, now: Date): number {
  let months = (now.getFullYear() - from.getFullYear()) * 12 + (now.getMonth() - from.getMonth());
  if (now.getDate() < from.getDate()) months -= 1;
  return months;
}

function toDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return undefined;
}

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

// ── 收集内容 ───────────────────────────────────────────────────────────

type Doc = {
  file: string;
  id: string;
  route: string;
  data: Record<string, unknown>;
};

let currentFile = '';
const docs: Doc[] = [];

for (const file of walk(DOCS_DIR, (p) => ['.md', '.mdx'].includes(extname(p)))) {
  currentFile = file;
  const raw = readFileSync(file, 'utf8');
  const { data } = parseFrontmatter(raw);

  const rel = relative(DOCS_DIR, file);
  const id = rel.replace(/\.mdx?$/, '').split('\\').join('/');
  const route = id === 'index' ? '/' : `/${id}/`;

  docs.push({ file, id, route, data });

  // 1) 文件名规范：必须是 ASCII slug，否则分享出去的网址会被百分号编码
  const name = basename(rel, extname(rel));
  if (name !== 'index' && name !== '404' && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    error(
      `文件名「${name}」不是 ASCII slug。文件名会变成网址，中文网址在微信里转发会变成一长串 %E5%AD%A6...`,
      relative(ROOT, file),
      1,
      '改成英文小写加连字符，标题写在 frontmatter 的 title 里',
    );
  }

  // 2) reviewedAt 不能写在未来
  const reviewedAt = toDate(data.reviewedAt);
  if (data.reviewedAt !== undefined && !reviewedAt) {
    error(`reviewedAt 不是合法日期：${String(data.reviewedAt)}`, relative(ROOT, file), 1);
  }
  if (reviewedAt && reviewedAt.getTime() > Date.now()) {
    error(`reviewedAt 写在了未来：${reviewedAt.toISOString().slice(0, 10)}`, relative(ROOT, file), 1);
  }

  // 3) 作者是占位符 → 警告（不阻断，但发布前应该清掉）
  // 首页和 404 是结构性页面，不存在「作者」这个概念，跳过
  const structural = id === 'index' || id === '404';
  const authors = asStringArray(data.authors);
  if (!structural && authors.length === 0) {
    warn('没有填 authors', relative(ROOT, file), 1, '可以写真实署名，也可以写「匿名学长」');
  } else if (
    !structural &&
    authors.length > 0 &&
    authors.every((a) => policy.placeholderAuthors.includes(a.trim()))
  ) {
    warn(
      `authors 仍是占位符（${authors.join('、')}）`,
      relative(ROOT, file),
      1,
      '换成真实署名，或明确写「匿名」',
    );
  }

  // 4) 缺少 description：影响搜索摘要和分享卡片
  if (!data.description) {
    warn('缺少 description', relative(ROOT, file), 1, '一句话摘要，搜索引擎和分享卡片都用它');
  }

  // 5) sidebar.order 缺失或过大
  const sidebar = data.sidebar as { order?: number } | undefined;
  if (sidebar?.order !== undefined && sidebar.order >= policy.sidebarOrderWarning) {
    warn(`sidebar.order = ${sidebar.order} 偏大，目录里会排到最后`, relative(ROOT, file), 1);
  }

  // 6) 时效：超过阈值没有重新核对
  if (reviewedAt) {
    const months = monthsBetween(reviewedAt, new Date());
    if (months >= policy.staleAfterMonths) {
      warn(
        `已 ${months} 个月未重新核对（阈值 ${policy.staleAfterMonths} 个月），页面顶部会出现过期提示`,
        relative(ROOT, file),
        1,
      );
    }
  }
}

// 7) 同一目录内 sidebar.order 重复 → 目录顺序不确定
const byDir = new Map<string, Map<number, string[]>>();
for (const doc of docs) {
  const order = (doc.data.sidebar as { order?: number } | undefined)?.order;
  if (order === undefined) continue;
  const dir = dirname(doc.id);
  const perDir = byDir.get(dir) ?? new Map<number, string[]>();
  perDir.set(order, [...(perDir.get(order) ?? []), doc.id]);
  byDir.set(dir, perDir);
}
for (const [dir, orders] of byDir) {
  for (const [order, ids] of orders) {
    if (ids.length > 1) {
      error(
        `目录 ${dir || '/'} 下有 ${ids.length} 篇文章的 sidebar.order 都是 ${order}：${ids.join('、')}`,
        undefined,
        undefined,
        '目录顺序会不确定，给它们不同的 order',
      );
    }
  }
}

// ── 构建合法路由集合，用于检查站内链接 ──────────────────────────────────

const routes = new Set<string>(['/']);

/** 中文路径可能以原文或百分号编码两种形式出现，两种都要登记，否则会误报死链 */
function addRoute(route: string) {
  routes.add(route);
  try {
    routes.add(decodeURIComponent(route));
  } catch {
    /* 非法编码就只登记原文 */
  }
}

for (const doc of docs) {
  addRoute(doc.route);
  for (const tag of asStringArray(doc.data.tags)) {
    addRoute(`/tags/${encodeURIComponent(tag)}/`);
    addRoute(`/tags/${tag}/`);
  }
  for (const stage of asStringArray(doc.data.stage)) {
    addRoute(`/stages/${encodeURIComponent(stage)}/`);
    addRoute(`/stages/${stage}/`);
  }
}

// 自定义页面（src/pages）
for (const file of walk(PAGES_DIR, () => true)) {
  const rel = relative(PAGES_DIR, file).split('\\').join('/');
  if (rel.includes('[')) continue; // 动态路由已由 tags/stages 计算
  const noExt = rel.replace(/\.(astro|ts|js|md)$/, '');
  if (noExt.startsWith('rss.xml')) {
    routes.add('/rss.xml');
    continue;
  }
  routes.add(noExt === 'index' ? '/' : `/${noExt.replace(/(^|\/)index$/, '')}/`.replace('//', '/'));
  routes.add(`/${noExt}/`);
}

// 静态资源（public）
for (const file of walk(PUBLIC_DIR, () => true)) {
  routes.add(`/${relative(PUBLIC_DIR, file).split('\\').join('/')}`);
}

// ── 检查站内链接 ───────────────────────────────────────────────────────

const INTERNAL_LINK = /\]\((\/[^)\s]*)\)|href="(\/[^"]*)"/g;

for (const doc of docs) {
  currentFile = doc.file;
  const raw = readFileSync(doc.file, 'utf8');
  const { body } = parseFrontmatter(raw);
  const seen = new Set<string>();

  for (const match of body.matchAll(INTERNAL_LINK)) {
    let target = match[1] ?? match[2] ?? '';
    if (!target.startsWith('/') || target.startsWith('//')) continue;
    target = target.split('#')[0].split('?')[0];
    if (!target || seen.has(target)) continue;
    seen.add(target);
    if (routes.has(target) || routes.has(target.endsWith('/') ? target : `${target}/`)) continue;
    // 链接里可能写的是编码形式，而路由表里是原文（或反过来），两种都试一次
    let decoded = target;
    try {
      decoded = decodeURIComponent(target);
    } catch {
      /* 保持原样 */
    }
    if (
      routes.has(decoded) ||
      routes.has(decoded.endsWith('/') ? decoded : `${decoded}/`)
    )
      continue;

    const line = body.slice(0, match.index).split('\n').length;
    error(
      `站内链接指向不存在的页面：${target}`,
      relative(ROOT, doc.file),
      line,
      '改文件名或移动文章后，记得同步所有引用它的链接',
    );
  }
}

// ── 检查 links.ts / resources.ts ───────────────────────────────────────

const linkNames = new Set<string>();
for (const link of campusLinks) {
  if (linkNames.has(link.name)) error(`links.ts 里有重名条目：${link.name}`, 'src/data/links.ts');
  linkNames.add(link.name);

  try {
    new URL(link.url);
  } catch {
    error(`links.ts 里 ${link.name} 的 url 不是合法网址：${link.url}`, 'src/data/links.ts');
  }

  if (!link.verified) {
    warn(
      `links.ts：${link.name} 还没有 verified 日期（页面上会显示「待核对」）`,
      'src/data/links.ts',
      undefined,
      "亲自点开确认后填 verified: '2026-09-30'",
    );
    continue;
  }

  const verified = toDate(link.verified);
  if (!verified) {
    error(`links.ts：${link.name} 的 verified 不是合法日期：${link.verified}`, 'src/data/links.ts');
    continue;
  }
  if (verified.getTime() > Date.now()) {
    error(`links.ts：${link.name} 的 verified 写在了未来`, 'src/data/links.ts');
    continue;
  }
  const months = monthsBetween(verified, new Date());
  if (months >= policy.linkVerifiedStaleAfterMonths) {
    warn(
      `links.ts：${link.name} 的链接已 ${months} 个月未重新确认`,
      'src/data/links.ts',
      undefined,
      '网址会变，点开确认后更新 verified',
    );
  }
}

const resourceNames = new Set<string>();
for (const item of resources) {
  if (resourceNames.has(item.name)) {
    error(`resources.ts 里有重名条目：${item.name}`, 'src/data/resources.ts');
  }
  resourceNames.add(item.name);

  const isPlaceholder =
    !item.url || policy.placeholderUrlValues.includes(item.url.trim()) || item.url === 'TODO';

  if (isPlaceholder) {
    warn(
      `resources.ts：${item.name} 还没有下载链接（页面上显示「待补充」）`,
      'src/data/resources.ts',
    );
    if (item.code) {
      error(
        `resources.ts：${item.name} 填了提取码但没有链接`,
        'src/data/resources.ts',
        undefined,
        '提取码没有链接就没意义',
      );
    }
    continue;
  }

  try {
    new URL(item.url!);
  } catch {
    error(`resources.ts：${item.name} 的 url 不是合法网址：${item.url}`, 'src/data/resources.ts');
  }
}

// ── 输出 ───────────────────────────────────────────────────────────────

const errors = findings.filter((f) => f.level === 'error');
const warnings = findings.filter((f) => f.level === 'warn');

function emit(f: Finding) {
  const where = f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : '';
  const text = `${f.message}${f.hint ? ` —— ${f.hint}` : ''}`;
  if (annotate) {
    const kind = f.level === 'error' ? 'error' : 'warning';
    console.log(`::${kind}${f.file ? ` file=${f.file}` : ''}${f.line ? `,line=${f.line}` : ''}::${text}`);
  } else {
    console.log(`${f.level === 'error' ? '✖' : '▲'} ${where ? `${where}  ` : ''}${text}`);
  }
}

if (!annotate) {
  console.log(`\n检查了 ${docs.length} 篇文章、${campusLinks.length} 条链接、${resources.length} 条资料\n`);
}

for (const f of errors) emit(f);
if (errors.length && warnings.length && !annotate) console.log('');
for (const f of warnings) emit(f);

// 债务总账：发布前该清掉多少东西
const debt = {
  待补作者: docs.filter((d) => {
    const a = asStringArray(d.data.authors);
    return a.length === 0 || a.every((x) => policy.placeholderAuthors.includes(x.trim()));
  }).length,
  待核对页面: docs.filter((d) => d.data.status === 'draft').length,
  未标注核对日期: docs.filter((d) => !toDate(d.data.reviewedAt)).length,
  待核对链接: campusLinks.filter((l) => !l.verified).length,
  待补充资料: resources.filter(
    (r) => !r.url || policy.placeholderUrlValues.includes(r.url.trim()),
  ).length,
};

if (!annotate) {
  console.log('\n── 债务总账（不阻断构建，但发布前应该清） ──');
  for (const [key, value] of Object.entries(debt)) {
    console.log(`  ${key}: ${value}`);
  }
  console.log('');
}

const failed = errors.length > 0 || (strict && warnings.length > 0);

if (annotate) {
  console.log(
    `内容检查：${errors.length} 个错误、${warnings.length} 个警告${strict ? '（严格模式）' : ''}`,
  );
}

if (failed) {
  const reason = errors.length
    ? `${errors.length} 个错误`
    : `${warnings.length} 个警告（--strict 模式）`;
  console.error(`\n✖ 内容检查未通过：${reason}\n`);
  process.exit(1);
}

console.log(strict ? '✔ 内容检查通过（严格模式）' : '✔ 内容检查通过');
