/**
 * RSS feed。
 *
 * 日期规则与页面上的「最后更新」一致：
 *   1. 优先用 frontmatter 的 reviewedAt（有人逐条核对过的日期）；
 *   2. 没有就用 git 最后一次提交该文件的日期；
 *   3. 两个都拿不到就省略 pubDate。
 * **不拿构建时间冒充更新日期** —— 那样每次部署所有文章看起来都"刚刚更新过"。
 */
import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { publishedDocs, hrefFor } from '../data/browse';
import { fileLastUpdated } from '../data/git';

/** collection id → 源文件路径（.md / .mdx 都试一遍） */
function sourceDate(id: string): Date | null {
  for (const ext of ['.md', '.mdx']) {
    const date = fileLastUpdated(`src/content/docs/${id}${ext}`);
    if (date) return date;
  }
  return null;
}

export async function GET(context: APIContext) {
  const docs = await publishedDocs();
  const site = context.site ?? new URL('https://tsinghua.nathanpenny.fun');

  /** 每篇的「最后更新」日期：人工核对优先，退回到 git 提交时间 */
  const dateOf = (entry: (typeof docs)[number]): Date | undefined =>
    entry.data.reviewedAt instanceof Date
      ? entry.data.reviewedAt
      : (sourceDate(entry.id) ?? undefined);

  const sorted = [...docs].sort((a, b) => {
    const da = dateOf(a)?.getTime() ?? 0;
    const db = dateOf(b)?.getTime() ?? 0;
    if (da !== db) return db - da;
    return a.data.title.localeCompare(b.data.title, 'zh-Hans-CN');
  });

  return rss({
    title: '清华生存指南',
    description:
      '来自学长学姐的清华生存经验：选课、绩点、科研、保研、食堂、心态。学生自发整理，非官方材料。',
    site,
    trailingSlash: true,
    customData: '<language>zh-cn</language>',
    items: sorted.map((entry) => {
      const pubDate = dateOf(entry);
      return {
        title: entry.data.title,
        description: entry.data.summary ?? entry.data.description ?? '',
        link: hrefFor(entry.id),
        categories: entry.data.tags ?? [],
        ...(pubDate ? { pubDate } : {}),
      };
    }),
  });
}
