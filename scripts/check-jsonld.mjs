#!/usr/bin/env node
/**
 * 结构化数据校验 —— 扫描 dist/ 里的每一页 HTML，检查 <script type="application/ld+json">。
 *
 * 为什么需要它：JSON-LD 写错**不会报错**，只会静默失效（搜索引擎读到坏 JSON 就当没有）。
 * 而且很容易出现「同一页两条互相矛盾的 @type」这种问题 —— 页面自己写一份、
 * Head 组件再写一份，谁都不会发现，直到搜索结果里出现奇怪的标题。
 *
 * 用法：
 *   npm run build && npm run check:jsonld
 *   npm run check:jsonld -- --dir dist
 *
 * 检查项：
 *   1. 每个页面至少有一条 JSON-LD，且必须是合法 JSON；
 *   2. 同一页不能有两条同 @type 的实体（抢类型）；
 *   3. 必备字段：Article 要有 headline/url/author；WebSite 要有 name/url；
 *      CollectionPage 要有 name/url/mainEntity；BreadcrumbList 的 position 要从 1 连续递增；
 *   4. 占位署名（待补充 / TODO / 匿名）不能出现在 author 里；
 *   5. 所有 url 必须是同站绝对地址（避免出现 localhost 或相对路径）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const dirFlagIndex = process.argv.indexOf('--dir');
const DIST = resolve(ROOT, dirFlagIndex >= 0 ? process.argv[dirFlagIndex + 1] : 'dist');

const PLACEHOLDER_AUTHORS = new Set(['待补充', 'TODO', '匿名']);

const errors = [];
const error = (file, message) => errors.push(`${file}: ${message}`);

function walkHtml(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkHtml(full));
    else if (name.endsWith('.html')) out.push(full);
  }
  return out.sort();
}

const files = walkHtml(DIST);
if (!files.length) {
  console.error(`✖ ${DIST} 里没有 HTML —— 先跑 npm run build`);
  process.exit(1);
}

let blocks = 0;
let pages = 0;
const typeCount = new Map();

for (const file of files) {
  const rel = relative(ROOT, file);
  const html = readFileSync(file, 'utf8');
  const matches = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];

  if (!matches.length) {
    // 404 页和 RSS 之外的页面都应该有结构化数据
    if (!rel.endsWith('404.html')) error(rel, '没有 JSON-LD');
    continue;
  }

  pages += 1;
  const entities = [];

  for (const match of matches) {
    blocks += 1;
    const raw = match[1].trim();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (parseError) {
      error(rel, `JSON-LD 不是合法 JSON：${parseError.message}`);
      continue;
    }
    for (const entity of Array.isArray(parsed) ? parsed : [parsed]) {
      if (entity && typeof entity === 'object') entities.push(entity);
    }
  }

  // 同一页不能出现两个抢同一个 @type 的实体
  const seen = new Map();
  for (const entity of entities) {
    const type = String(entity['@type'] ?? '(缺少 @type)');
    seen.set(type, (seen.get(type) ?? 0) + 1);
    typeCount.set(type, (typeCount.get(type) ?? 0) + 1);

    if (!entity['@context']) error(rel, `${type} 缺少 @context`);

    if (type === 'Article') {
      for (const field of ['headline', 'url', 'author']) {
        if (!entity[field]) error(rel, `Article 缺少 ${field}`);
      }
      const authors = Array.isArray(entity.author) ? entity.author : [entity.author];
      for (const author of authors) {
        const name = typeof author === 'object' && author ? String(author.name ?? '') : String(author ?? '');
        if (PLACEHOLDER_AUTHORS.has(name)) error(rel, `Article 的 author 还是占位符：${name}`);
      }
    }

    if (type === 'WebSite') {
      for (const field of ['name', 'url']) {
        if (!entity[field]) error(rel, `WebSite 缺少 ${field}`);
      }
    }

    if (type === 'CollectionPage') {
      for (const field of ['name', 'url', 'mainEntity']) {
        if (!entity[field]) error(rel, `CollectionPage 缺少 ${field}`);
      }
      const count = entity.mainEntity?.numberOfItems;
      if (typeof count !== 'number' || count <= 0) {
        error(rel, `CollectionPage 的 mainEntity.numberOfItems 不是正数：${String(count)}`);
      }
    }

    if (type === 'BreadcrumbList') {
      const items = entity.itemListElement;
      if (!Array.isArray(items) || !items.length) {
        error(rel, 'BreadcrumbList 没有 itemListElement');
      } else {
        items.forEach((item, index) => {
          if (item.position !== index + 1) {
            error(rel, `BreadcrumbList 第 ${index + 1} 项的 position 是 ${item.position}，应为 ${index + 1}`);
          }
          if (!item.name) error(rel, `BreadcrumbList 第 ${index + 1} 项缺少 name`);
          if (!item.item) error(rel, `BreadcrumbList 第 ${index + 1} 项缺少 item`);
          else if (!/^https?:\/\//.test(String(item.item))) {
            error(rel, `BreadcrumbList 第 ${index + 1} 项的 item 不是绝对地址：${item.item}`);
          }
        });
      }
    }

    for (const [key, value] of Object.entries(entity)) {
      if (key !== 'url' && key !== 'item' && key !== '@id') continue;
      if (typeof value !== 'string') continue;
      if (!/^https?:\/\//.test(value)) {
        error(rel, `${type} 的 ${key} 不是绝对地址：${value}`);
      }
      if (value.includes('localhost') || value.includes('127.0.0.1')) {
        error(rel, `${type} 的 ${key} 指向本地地址：${value}`);
      }
    }
  }

  for (const [type, count] of seen) {
    if (count > 1) error(rel, `同一页出现 ${count} 个 ${type}（互相冲突，搜索引擎只会挑一个）`);
  }
}

console.log(`\n检查了 ${files.length} 个页面，其中 ${pages} 个带结构化数据，共 ${blocks} 个 JSON-LD 块。`);
console.log(
  `类型分布：${[...typeCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${type}×${count}`)
    .join('  ')}`,
);

if (errors.length) {
  console.error(`\n✖ 结构化数据有问题（${errors.length} 条）：`);
  for (const line of errors.slice(0, 30)) console.error(`  · ${line}`);
  if (errors.length > 30) console.error(`  · … 还有 ${errors.length - 30} 条`);
  process.exit(1);
}

console.log('\n✔ 结构化数据检查通过');
