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
import { archives, archiveOrder, courses, sourceLink } from '../src/data/courses.ts';
import { extraArchives } from '../src/data/archives.ts';
import { tools, toolGroups } from '../src/data/tools.ts';
import linkStatus from '../src/data/link-status.json' with { type: 'json' };

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
  // Starlight 会忽略以 _ 开头的文件（例如 _template.md 模板），
  // 它们不参与构建，也不应该被当成文章检查。
  if (basename(file).startsWith('_')) continue;

  currentFile = file;
  const raw = readFileSync(file, 'utf8');
  const { data } = parseFrontmatter(raw);

  const rel = relative(DOCS_DIR, file);
  const id = rel.replace(/\.mdx?$/, '').split('\\').join('/');
  // skills/index.md 这种嵌套首页，Starlight 生成的是目录路由 /skills/ 而不是 /skills/index/
  const route =
    id === 'index' ? '/' : id.endsWith('/index') ? `/${id.slice(0, -'/index'.length)}/` : `/${id}/`;

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

  // 「网址活着」由 `npm run check:links` 实测（link-status.json），
  // 这里只负责「有人确认过这个入口还是干这件事吗」—— 也就是 reviewedAt。
  // 未核对的条目合并成一条警告：避免几十条链接把输出刷满，具体数量进「债务总账」。
  if (!link.reviewedAt) continue;

  const reviewedAt = toDate(link.reviewedAt);
  if (!reviewedAt) {
    error(`links.ts：${link.name} 的 reviewedAt 不是合法日期：${link.reviewedAt}`, 'src/data/links.ts');
    continue;
  }
  if (reviewedAt.getTime() > Date.now()) {
    error(`links.ts：${link.name} 的 reviewedAt 写在了未来`, 'src/data/links.ts');
    continue;
  }
  const months = monthsBetween(reviewedAt, new Date());
  if (months >= policy.linkVerifiedStaleAfterMonths) {
    warn(
      `links.ts：${link.name} 已 ${months} 个月没有人工重新确认`,
      'src/data/links.ts',
      undefined,
      '网址会变，点开确认后更新 reviewedAt',
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

  // 站内条目（在线清单、在线表格）：url 是站内绝对路径，不要当外链校验
  if (!isPlaceholder && item.internal) {
    if (!item.url!.startsWith('/')) {
      error(
        `resources.ts：${item.name} 标了 internal，但 url 不是站内绝对路径（${item.url}）`,
        'src/data/resources.ts',
        undefined,
        "站内条目的 url 要写成 '/xxx/' 这样的路径",
      );
    } else {
      const target = item.url!.split('#')[0];
      const known =
        routes.has(target) ||
        routes.has(target.endsWith('/') ? target : `${target}/`) ||
        routes.has(target.replace(/\/$/, ''));
      if (!known) {
        error(
          `resources.ts：${item.name} 指向的站内页面不存在：${item.url}`,
          'src/data/resources.ts',
          undefined,
          '改文件名或删页面后，记得同步这里',
        );
      }
    }
    continue;
  }

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

// ── 检查 links.ts 的可达性标注与实测结果 ────────────────────────────────

const REACH_VALUES = ['校园网', '公网', '未实测'];
const unreviewedLinks = campusLinks.filter((l) => !l.reviewedAt);
for (const link of campusLinks) {
  if (!REACH_VALUES.includes(link.reach)) {
    error(
      `links.ts：${link.name} 的 reach 只能是 ${REACH_VALUES.join(' / ')}，现在写的是「${link.reach}」`,
      'src/data/links.ts',
    );
  }
  if (link.reviewedAt && !toDate(link.reviewedAt)) {
    error(`links.ts：${link.name} 的 reviewedAt 不是合法日期：${link.reviewedAt}`, 'src/data/links.ts');
  }
  if (link.verifiedBy && !['human', 'auto'].includes(link.verifiedBy)) {
    error(
      `links.ts：${link.name} 的 verifiedBy 只能是 'human' 或 'auto'，现在是「${link.verifiedBy}」`,
      'src/data/links.ts',
    );
  }
  if (link.verifiedBy && !link.reviewedAt) {
    error(
      `links.ts：${link.name} 填了 verifiedBy 却没有 reviewedAt`,
      'src/data/links.ts',
      undefined,
      '没有核对日期，核对方式就没有意义',
    );
  }
  // scriptBlocked 的含义是「脚本会被拦，但浏览器里正常」——后半句是人工判断，
  // 所以必须有人工核对日期；否则就等于凭猜给一条没测过的链接盖了章。
  if (link.scriptBlocked && !link.reviewedAt) {
    error(
      `links.ts：${link.name} 标了 scriptBlocked 但没有 reviewedAt`,
      'src/data/links.ts',
      undefined,
      '「浏览器里正常」是人工判断，先点开确认再填 reviewedAt',
    );
  }
}

/** link-status.json 是 `npm run check:links` 的产物，过期或失败都要提醒 */
const status = linkStatus as {
  checkedAt: string;
  reachable: number;
  total: number;
  results: Record<string, { ok: boolean; status: number | null; error?: string }>;
};

const statusDate = toDate(status.checkedAt);
if (!statusDate) {
  error(`link-status.json 的 checkedAt 不是合法日期：${status.checkedAt}`, 'src/data/link-status.json');
} else {
  const months = monthsBetween(statusDate, new Date());
  if (months >= policy.linkVerifiedStaleAfterMonths) {
    warn(
      `链接实测结果已经 ${months} 个月没更新`,
      'src/data/link-status.json',
      undefined,
      '跑一次 npm run check:links 重新实测',
    );
  }
}

if (unreviewedLinks.length) {
  warn(
    `links.ts：${unreviewedLinks.length}/${campusLinks.length} 条链接还没有人工核对日期（页面上显示「待人工核对」）`,
    'src/data/links.ts',
    undefined,
    `例：${unreviewedLinks
      .slice(0, 3)
      .map((l) => l.name)
      .join('、')}…… 点开确认后填 reviewedAt`,
  );
}

const uncheckedLinks = campusLinks.filter((link) => !status.results[link.url]);
const brokenLinks = campusLinks.filter((link) => status.results[link.url]?.ok === false);

if (uncheckedLinks.length) {
  warn(
    `links.ts：${uncheckedLinks.length} 条链接没有实测记录`,
    'src/data/links.ts',
    undefined,
    '跑一次 npm run check:links（新加的链接会漏掉）',
  );
}

if (brokenLinks.length) {
  warn(
    `links.ts：${brokenLinks.length} 条链接最近一次实测打不开`,
    'src/data/links.ts',
    undefined,
    `例：${brokenLinks
      .slice(0, 3)
      .map((l) => l.name)
      .join('、')}…… 可能只是需要校园网，确认后更新 reach 或换入口`,
  );
}

// ── 检查课程索引（course-index.json 与 courses.ts） ─────────────────────

const archiveIds = new Set(Object.keys(archives));
const courseNames = new Set<string>();
let coursesWithoutSources = 0;
let sourcesChecked = 0;

for (const id of archiveOrder) {
  if (!archiveIds.has(id)) {
    error(`courses.ts：归档 ${id} 在 archiveOrder 里但没有定义`, 'src/data/courses.ts');
  }
}

for (const course of courses) {
  if (courseNames.has(course.name)) {
    error(`course-index.json 里有重名课程：${course.name}`, 'src/data/course-index.json');
  }
  courseNames.add(course.name);

  if (!course.sources.length) {
    coursesWithoutSources += 1;
    continue;
  }

  for (const source of course.sources) {
    sourcesChecked += 1;
    if (!archiveIds.has(source.archive)) {
      error(
        `course-index.json：${course.name} 引用了未知资料库「${source.archive}」`,
        'src/data/course-index.json',
      );
      continue;
    }
    if (!source.path) {
      error(`course-index.json：${course.name} 有一条资料没有路径`, 'src/data/course-index.json');
    }
    if (!source.kinds.length) {
      error(`course-index.json：${course.name} 的「${source.path}」没有资料类型`, 'src/data/course-index.json');
    }
    const link = sourceLink(source);
    try {
      new URL(link.url);
    } catch {
      error(
        `courses.ts：${course.name} 的链接拼不出来（${link.url}）`,
        'src/data/courses.ts',
      );
    }
  }
}

// extraArchives 里的链接同样要合法
for (const archive of extraArchives) {
  if (!archive.links.length) {
    warn(`archives.ts：${archive.name} 没有任何链接`, 'src/data/archives.ts');
  }
  for (const link of archive.links) {
    try {
      new URL(link.url);
    } catch {
      error(`archives.ts：${archive.name} 的 url 不合法：${link.url}`, 'src/data/archives.ts');
    }
  }
}

// ── 检查 tools.ts（学生自建工具清单） ───────────────────────────────────
// 这里最容易出的错不是链接写错，而是**状态栏被随手写成「活跃」**：
// 那一个字会被读者当成「可以放心用」。所以状态与可达性都按白名单校验。

const TOOL_STATUS = ['活跃', '不活跃', '已停止', '未核实'];
const TOOL_ACCESS = ['公网', '校园网', '需代理', '未实测'];
const toolNames = new Set<string>();

for (const tool of tools) {
  if (toolNames.has(tool.name)) {
    error(`tools.ts 里有重名条目：${tool.name}`, 'src/data/tools.ts');
  }
  toolNames.add(tool.name);

  try {
    new URL(tool.url);
  } catch {
    error(`tools.ts：${tool.name} 的 url 不合法：${tool.url}`, 'src/data/tools.ts');
  }

  if (!TOOL_STATUS.includes(tool.status)) {
    error(
      `tools.ts：${tool.name} 的 status 只能是 ${TOOL_STATUS.join(' / ')}，现在写的是「${tool.status}」`,
      'src/data/tools.ts',
    );
  }
  if (!TOOL_ACCESS.includes(tool.access)) {
    error(
      `tools.ts：${tool.name} 的 access 只能是 ${TOOL_ACCESS.join(' / ')}，现在写的是「${tool.access}」`,
      'src/data/tools.ts',
    );
  }
  if (!toolGroups.includes(tool.group)) {
    error(
      `tools.ts：${tool.name} 的 group「${tool.group}」不在 toolGroups 里，页面上这一组不会出现`,
      'src/data/tools.ts',
    );
  }
  if (!tool.desc.trim()) {
    error(`tools.ts：${tool.name} 没有写 desc`, 'src/data/tools.ts');
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
  console.log(
    `\n检查了 ${docs.length} 篇文章、${campusLinks.length} 条链接、${resources.length} 条资料、` +
      `${courses.length} 门课（${sourcesChecked} 条资料索引）、${tools.length} 个第三方工具\n`,
  );
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
  待人工核对链接: campusLinks.filter((l) => !l.reviewedAt).length,
  待补充资料: resources.filter(
    (r) => !r.url || policy.placeholderUrlValues.includes(r.url.trim()),
  ).length,
  只有书目没有资料索引的课: coursesWithoutSources,
  状态未核实的第三方工具: tools.filter((t) => t.status === '未核实').length,
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
