#!/usr/bin/env node
/**
 * 订阅与收录守卫 —— 校验 sitemap / RSS / robots。
 *
 * 为什么需要它：这三样东西坏了**构建完全不会报错**。
 * 典型事故：
 *   - sitemap 里指向一个已经不存在的页面（改文件名时最容易发生）→ 搜索引擎抓到 404；
 *   - RSS 输出 0 条或 XML 不闭合 → 订阅器直接报错，读者再也收不到更新；
 *   - robots.txt 里一句 `Disallow: /` 手滑 → 整站从搜索结果里消失，几周后才发现。
 *
 * 用法：
 *   npm run build && npm run check:feeds
 *   npm run check:feeds -- --dir dist
 *
 * 检查项见下面每个函数上方的注释。不需要任何新依赖。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const dirFlag = process.argv.indexOf('--dir');
const DIST = resolve(ROOT, dirFlag >= 0 ? process.argv[dirFlag + 1] : 'dist');

const errors = [];
const warnings = [];
const error = (message) => errors.push(message);
const warn = (message) => warnings.push(message);

/**
 * 极简 XML 良构性检查：只做标签配对与属性引号检查。
 * 不用引依赖做完整校验 —— 这些文件都是我们自己生成的，能抓到「标签没闭合」这类事故就够了。
 */
function checkWellFormed(xml, label) {
  const withoutComments = xml.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '');
  const stack = [];
  const tagPattern = /<(\/?)([A-Za-z_][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let match;

  while ((match = tagPattern.exec(withoutComments))) {
    const [, closing, name, attrs, selfClosing] = match;
    // 属性里的引号必须成对，否则解析出的 attrs 会长得不对劲
    if (!/(\/?)>$/.test(match[0])) {
      error(`${label}: 标签 <${name}> 之后的属性引号似乎没有闭合`);
      return;
    }
    if (closing) {
      const opened = stack.pop();
      if (opened !== name) {
        error(`${label}: 标签不匹配 —— </${name}> 对应的是 <${opened ?? '（没有）'}>`);
        return;
      }
    } else if (!selfClosing) {
      stack.push(name);
    }
    void attrs;
  }

  if (stack.length) {
    error(`${label}: 有未闭合的标签 ${stack.map((t) => `<${t}>`).join('、')}`);
  }
}

/**
 * 把站点绝对地址换算成 dist 里的相对路径。
 * ⚠️ sitemap 里中文是百分号编码（%E7%A7%91%E7%A0%94），而磁盘上是原始 UTF-8，
 * 两种都要能对上，否则会把「/tags/科研/」误报成死链。
 */
function urlToRoute(url) {
  const raw = `/${url.replace(/^https?:\/\/[^/]+\//, '')}`;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    /* 非法编码就只用原文 */
  }
  return { raw, decoded };
}

/** 这个地址在 dist 里真的存在吗（原文或解码后的路径任一命中即可） */
function routeExists(url, routeSet) {
  const { raw, decoded } = urlToRoute(url);
  return routeSet.has(raw) || routeSet.has(decoded);
}

const readFile = (name) => {
  const full = join(DIST, name);
  if (!existsSync(full)) return null;
  return { full, text: readFileSync(full, 'utf8') };
};

/** dist 里实际存在的页面路径（用于反查 sitemap/RSS 的链接是否有对应文件） */
function actualRoutes() {
  const routes = new Set();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === 'pagefind' || name === '_astro') continue;
        walk(full);
      } else if (name.endsWith('.html')) {
        const rel = relative(DIST, full).split('\\').join('/');
        routes.add(`/${rel.replace(/index\.html$/, '').replace(/\.html$/, '')}/`.replace('//', '/'));
      }
    }
  };
  walk(DIST);
  return routes;
}

const routes = actualRoutes();
if (!routes.size) {
  console.error(`✖ ${DIST} 里没有 HTML —— 先跑 npm run build`);
  process.exit(1);
}

let siteOrigin = null;

// ── 1) sitemap-index.xml / sitemap-0.xml ───────────────────────────────
const sitemapIndex = readFile('sitemap-index.xml');
const sitemap = readFile('sitemap-0.xml');

if (!sitemapIndex) {
  error('缺少 dist/sitemap-index.xml —— @astrojs/sitemap 没跑或配置被改了');
} else {
  checkWellFormed(sitemapIndex.text, 'sitemap-index.xml');
  const children = [...sitemapIndex.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  if (!children.length) error('sitemap-index.xml 里没有任何 <sitemap><loc>');
  for (const child of children) {
    if (!/^https?:\/\//.test(child)) error(`sitemap-index.xml 里的地址不是绝对地址：${child}`);
    const origin = child.match(/^(https?:\/\/[^/]+)/)?.[1];
    if (origin && !siteOrigin) siteOrigin = origin;
    const file = child.replace(/^https?:\/\/[^/]+\//, '');
    if (!existsSync(join(DIST, file))) {
      error(`sitemap-index.xml 指向 ${child}，但 dist 里没有 ${file}`);
    }
  }
  if (!siteOrigin) error('sitemap-index.xml 里读不出站点域名');
}

const sitemapUrls = [];
if (!sitemap) {
  error('缺少 dist/sitemap-0.xml');
} else {
  checkWellFormed(sitemap.text, 'sitemap-0.xml');
  const locs = [...sitemap.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  if (locs.length < 10) error(`sitemap-0.xml 只有 ${locs.length} 条地址，明显偏少`);

  const seen = new Set();
  for (const loc of locs) {
    if (!/^https?:\/\//.test(loc)) {
      error(`sitemap-0.xml 里的地址不是绝对地址：${loc}`);
      continue;
    }
    const origin = loc.match(/^(https?:\/\/[^/]+)/)?.[1];
    if (origin && !siteOrigin) siteOrigin = origin;
    if (siteOrigin && origin !== siteOrigin) {
      error(`sitemap-0.xml 混入了别的域名：${loc}`);
    }
    if (seen.has(loc)) error(`sitemap-0.xml 里有重复地址：${loc}`);
    seen.add(loc);
    sitemapUrls.push(loc);

    // 每条地址都要能在 dist 里找到对应页面，否则就是死链进了 sitemap
    if (!routeExists(loc, routes)) error(`sitemap 指向不存在的页面：${loc}`);
  }

  // 反向检查：构建出来的页面有没有漏进 sitemap（404 本来就不该进去）
  const missing = [...routes].filter(
    (route) => route !== '/404/' && !sitemapUrls.some((loc) => routeExists(loc, new Set([route]))),
  );
  if (missing.length) {
    warn(`有 ${missing.length} 个页面没进 sitemap（例：${missing.slice(0, 3).join('、')}）`);
  }
}

// ── 2) rss.xml ────────────────────────────────────────────────────────
const rss = readFile('rss.xml');
let rssItemCount = 0;

if (!rss) {
  error('缺少 dist/rss.xml');
} else {
  checkWellFormed(rss.text, 'rss.xml');
  if (!/<rss[^>]+version="2\.0"/.test(rss.text)) error('rss.xml 不是 RSS 2.0');
  for (const field of ['title', 'link', 'description', 'language']) {
    if (!new RegExp(`<channel>[\\s\\S]*?<${field}>`).test(rss.text)) {
      error(`rss.xml 的 channel 缺少 <${field}>`);
    }
  }

  const items = [...rss.text.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  rssItemCount = items.length;
  if (!items.length) error('rss.xml 里一条 <item> 都没有');

  let missingPubDate = 0;
  for (const item of items) {
    const title = item.match(/<title>([\s\S]*?)<\/title>/)?.[1];
    const link = item.match(/<link>([\s\S]*?)<\/link>/)?.[1];
    if (!title) error('rss.xml 有条目缺少 <title>');
    if (!link) {
      error('rss.xml 有条目缺少 <link>');
      continue;
    }
    if (!/^https?:\/\//.test(link)) error(`rss.xml 有条目的 <link> 不是绝对地址：${link}`);
    if (!routeExists(link, routes)) error(`rss.xml 指向不存在的页面：${link}`);
    if (!/<pubDate>/.test(item)) missingPubDate += 1;
  }
  if (missingPubDate) {
    warn(
      `rss.xml 有 ${missingPubDate} 条没有 <pubDate>：这些文章既没有 reviewedAt，` +
        '也没有 git 提交记录（新写的文件在提交之前就是这个状态，提交后会自动补上）',
    );
  }
}

// ── 3) robots.txt ─────────────────────────────────────────────────────
const robots = readFile('robots.txt');
if (!robots) {
  error('缺少 dist/robots.txt');
} else {
  const text = robots.text.trim();
  if (!text) error('robots.txt 是空的');
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  const disallowAll = lines.some((line) => /^Disallow:\s*\/\s*$/i.test(line));
  const allowSomething = lines.some((line) => /^Allow:\s*\/\S/i.test(line));
  if (disallowAll && !allowSomething) {
    error('robots.txt 里有 `Disallow: /` 且没有任何 Allow —— 整站会被搜索引擎屏蔽（是不是手滑？）');
  }

  const sitemapLines = lines.filter((line) => /^Sitemap:/i.test(line));
  if (!sitemapLines.length) {
    error('robots.txt 没有 Sitemap 行 —— 搜索引擎找不到站点地图');
  } else {
    for (const line of sitemapLines) {
      const url = line.replace(/^Sitemap:\s*/i, '');
      if (!/^https?:\/\//.test(url)) error(`robots.txt 的 Sitemap 不是绝对地址：${url}`);
      if (siteOrigin && !url.startsWith(siteOrigin)) {
        error(`robots.txt 的 Sitemap 域名与站点不一致：${url}`);
      }
      const file = url.replace(/^https?:\/\/[^/]+\//, '');
      if (file && !existsSync(join(DIST, file))) {
        error(`robots.txt 指向的 ${file} 在 dist 里不存在`);
      }
    }
  }
}

// ── 输出 ──────────────────────────────────────────────────────────────
console.log(`\n站点域名：${siteOrigin ?? '（未知）'}`);
console.log(`页面数：${routes.size}｜sitemap：${sitemapUrls.length} 条｜RSS：${rssItemCount} 条`);

if (warnings.length) {
  console.log(`\n提示（${warnings.length} 条）：`);
  for (const line of warnings) console.log(`  · ${line}`);
}

if (errors.length) {
  console.error(`\n✖ 订阅与收录检查未通过（${errors.length} 条）：`);
  for (const line of errors) console.error(`  · ${line}`);
  process.exit(1);
}

console.log('\n✔ sitemap / RSS / robots 检查通过');
