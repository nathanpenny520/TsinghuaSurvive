// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import sitemap from '@astrojs/sitemap';

/**
 * 站点地址：决定 sitemap、canonical、OG 卡片里的绝对链接。
 * 这是绑定在 Cloudflare Worker 上的自定义域名。
 * ⚠️ 不要把这里改回 *.<账号>.workers.dev —— 该域名在境内被 DNS 污染，主域名不能用它。
 */
const SITE = 'https://tsinghua.nathanpenny.fun';

/**
 * 仓库地址：用于「编辑此页」链接，其他学长学姐可以直接跳去提 PR。
 */
const REPO = 'https://github.com/nathanpenny520/TsinghuaSurvive';

export default defineConfig({
  site: SITE,
  // 纯静态站点：构建产物在 dist/，由 Cloudflare Workers 静态资源托管
  output: 'static',
  trailingSlash: 'always',

  integrations: [
    starlight({
      title: '清华生存指南',
      description:
        '来自学长学姐的清华生存经验：选课、绩点、科研、保研、食堂、心态，以及那些没人会主动告诉你的事。',
      // 中文默认语言，Pagefind 会按 zh-CN 索引并启用中文分词
      defaultLocale: 'root',
      locales: {
        root: { label: '简体中文', lang: 'zh-CN' },
      },
      lastUpdated: true,
      pagination: true,
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
      editLink: {
        baseUrl: `${REPO}/edit/main/`,
      },
      // 右上角社交图标
      social: [{ icon: 'github', label: 'GitHub', href: REPO }],
      customCss: ['./src/styles/custom.css'],
      // 组件覆盖：
      //   Footer —— 文章元信息 + 全站免责声明
      //   Banner —— 内容时效看门狗（reviewedAt 过期自动提示）
      //   Head   —— 注入 JSON-LD 结构化数据
      components: {
        Footer: './src/components/Footer.astro',
        Banner: './src/components/Banner.astro',
        Head: './src/components/Head.astro',
      },
      sidebar: [
        {
          label: '开始之前',
          items: [
            { label: '如何使用本站', slug: 'start/how-to-use' },
            { label: '免责声明与内容边界', slug: 'start/disclaimer' },
          ],
        },
        {
          label: '新生入学',
          items: [{ autogenerate: { directory: 'freshman' } }],
        },
        {
          label: '学业',
          items: [{ autogenerate: { directory: 'academics' } }],
        },
        {
          label: '课程与资料',
          items: [
            { label: '课程资料索引', link: '/courses/' },
            { label: '课程参考书目', link: '/courses/books/' },
            { label: '外部资料库地图', slug: 'guides/archives' },
          ],
        },
        {
          label: '技能入门',
          items: [{ autogenerate: { directory: 'skills' } }],
        },
        {
          label: '科研与深造',
          items: [{ autogenerate: { directory: 'research' } }],
        },
        {
          label: '校园生活',
          items: [{ autogenerate: { directory: 'campus' } }],
        },
        {
          label: '心态与避坑',
          items: [{ autogenerate: { directory: 'mindset' } }],
        },
        {
          label: '实用工具',
          items: [
            { label: '按阶段浏览', link: '/stages/' },
            { label: '按标签浏览', link: '/tags/' },
            { label: '校内常用链接', slug: 'guides/links' },
            { label: '资料下载', slug: 'guides/resources' },
          ],
        },
        {
          label: '参与写作',
          items: [
            { label: '怎么贡献一篇经验帖', slug: 'contribute' },
            { label: '贡献者', link: '/contributors/' },
            { label: '更新日志', link: '/changelog/' },
          ],
        },
      ],
      head: [
        // 微信 / QQ 分享卡片
        { tag: 'meta', attrs: { property: 'og:locale', content: 'zh_CN' } },
        { tag: 'meta', attrs: { property: 'og:site_name', content: '清华生存指南' } },
        { tag: 'meta', attrs: { name: 'theme-color', content: '#660874' } },
        {
          tag: 'meta',
          attrs: { name: 'keywords', content: '清华大学,清华生存指南,选课,绩点,保研,新生攻略,学长经验' },
        },
        // 社交分享卡片图（由 scripts/generate-og.py 生成，全站统一一张）
        {
          tag: 'meta',
          attrs: { property: 'og:image', content: `${SITE}/og.png` },
        },
        { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
        { tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
        {
          tag: 'meta',
          attrs: { property: 'og:image:alt', content: '清华生存指南 —— 来自学长学姐的经验分享' },
        },
        { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
        { tag: 'meta', attrs: { name: 'twitter:image', content: `${SITE}/og.png` } },
        // RSS 订阅（阅读器会自动发现）
        {
          tag: 'link',
          attrs: {
            rel: 'alternate',
            type: 'application/rss+xml',
            title: '清华生存指南',
            href: `${SITE}/rss.xml`,
          },
        },
        // 百度/搜狗等中文搜索引擎的收录验证位（拿到验证码后填这里）
        // { tag: 'meta', attrs: { name: 'baidu-site-verification', content: 'TODO' } },
      ],
    }),
    sitemap(),
  ],
});
