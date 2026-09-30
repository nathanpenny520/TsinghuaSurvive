import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { docsLoader, i18nLoader } from '@astrojs/starlight/loaders';
import { docsSchema, i18nSchema } from '@astrojs/starlight/schema';

/**
 * 全站内容模型。所有经验帖的 frontmatter 都按这里校验，
 * 写错字段会在 `npm run build` / `npm run dev` 时直接报错，而不是静默生成坏页面。
 */
export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      extend: z.object({
        /** 适用阶段，可多选。用于「大一/大二…」筛选 */
        stage: z
          .array(z.enum(['本科新生', '本科低年级', '本科高年级', '研究生', '全阶段']))
          .default(['全阶段']),
        /** 主题标签，用于聚合与搜索 */
        tags: z.array(z.string()).default([]),
        /** 作者署名（可以写昵称 + 院系） */
        authors: z.array(z.string()).default([]),
        /** 内容状态：草稿不参与构建校验提醒，过期内容会在页面顶部提示 */
        status: z.enum(['draft', 'stable', 'outdated']).default('stable'),
        /** 最近一次人工核对内容的日期，用于「内容可能已过期」提示 */
        reviewedAt: z.coerce.date().optional(),
        /** 一句话摘要，显示在卡片和搜索引擎结果里 */
        summary: z.string().optional(),
      }),
    }),
  }),

  /**
   * Starlight 的界面文案覆盖集合。本站是纯中文，暂时留空即可，
   * 但集合必须声明，否则构建时会报 "collection i18n does not exist"。
   * 以后要改「上一页 / 下一页」这类系统文案，在 src/content/i18n/zh-CN.json 里覆盖。
   */
  i18n: defineCollection({ loader: i18nLoader(), schema: i18nSchema() }),
};
