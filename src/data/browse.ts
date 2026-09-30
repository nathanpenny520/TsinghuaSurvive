/**
 * 浏览页共用的 collection 查询。
 *
 * 「按标签浏览」和「按阶段浏览」两个页面都从这里取数据，
 * 保证过滤规则（排除 404、隐藏页、草稿）只有一份，不会两边不一致。
 */
import { getCollection, type CollectionEntry } from 'astro:content';

export type DocEntry = CollectionEntry<'docs'>;

/** 可以出现在浏览列表里的文章 */
export async function publishedDocs(): Promise<DocEntry[]> {
  const all = await getCollection('docs');
  return all.filter(
    (entry) =>
      entry.id !== '404' &&
      entry.id !== 'index' &&
      !entry.data.draft &&
      !entry.data.sidebar?.hidden
  );
}

/** 站点内路径：collection id 就是路径 */
export function hrefFor(id: string): string {
  return id === 'index' ? '/' : `/${id}/`;
}

/** 标签 → 文章列表 */
export function tagIndex(entries: DocEntry[]): Map<string, DocEntry[]> {
  const map = new Map<string, DocEntry[]>();
  for (const entry of entries) {
    for (const tag of entry.data.tags ?? []) {
      if (!tag) continue;
      const list = map.get(tag) ?? [];
      list.push(entry);
      map.set(tag, list);
    }
  }
  return sortIndex(map);
}

/** 阶段 → 文章列表 */
export function stageIndex(entries: DocEntry[]): Map<string, DocEntry[]> {
  const map = new Map<string, DocEntry[]>();
  for (const entry of entries) {
    for (const stage of entry.data.stage ?? []) {
      if (!stage) continue;
      const list = map.get(stage) ?? [];
      list.push(entry);
      map.set(stage, list);
    }
  }
  return sortIndex(map);
}

/** 组内按 sidebar.order 再按标题排，让列表顺序与侧边栏观感一致 */
function sortIndex(map: Map<string, DocEntry[]>): Map<string, DocEntry[]> {
  for (const [, list] of map) {
    list.sort((a, b) => {
      const orderA = a.data.sidebar?.order ?? 999;
      const orderB = b.data.sidebar?.order ?? 999;
      if (orderA !== orderB) return orderA - orderB;
      return a.data.title.localeCompare(b.data.title, 'zh-Hans-CN');
    });
  }
  return map;
}

/** 阶段的标准顺序，用于「按阶段浏览」页面的稳定排序 */
export const STAGE_ORDER = ['本科新生', '本科低年级', '本科高年级', '研究生', '全阶段'] as const;

export function sortStageNames(names: string[]): string[] {
  const known = STAGE_ORDER.filter((s) => names.includes(s));
  const unknown = names.filter((n) => !(STAGE_ORDER as readonly string[]).includes(n)).sort();
  return [...known, ...unknown];
}
