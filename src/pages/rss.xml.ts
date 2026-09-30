/**
 * RSS feed。
 *
 * 日期只用 reviewedAt（人工核对日期），没有就省略 pubDate —— 不拿构建时间冒充更新日期。
 */
import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { publishedDocs, hrefFor } from '../data/browse';

export async function GET(context: APIContext) {
  const docs = await publishedDocs();
  const site = context.site ?? new URL('https://tsinghua.nathanpenny.fun');

  // 有核对日期的排前面，其余按标题稳定排序
  const sorted = [...docs].sort((a, b) => {
    const da = a.data.reviewedAt instanceof Date ? a.data.reviewedAt.getTime() : 0;
    const db = b.data.reviewedAt instanceof Date ? b.data.reviewedAt.getTime() : 0;
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
    items: sorted.map((entry) => ({
      title: entry.data.title,
      description: entry.data.summary ?? entry.data.description ?? '',
      link: hrefFor(entry.id),
      categories: entry.data.tags ?? [],
      ...(entry.data.reviewedAt instanceof Date ? { pubDate: entry.data.reviewedAt } : {}),
    })),
  });
}
