/**
 * AI 索引的页面取舍规则 —— **构建脚本和检查脚本必须用同一份**。
 *
 * 为什么单独抽出来：如果两边各写一遍，就会出现「构建时排除了、检查时却要求覆盖」
 * 或者反过来的情况，而两种都表现为 CI 报一个看不懂的错。
 *
 * 排除的是「聚合/导航页」：/tags/<标签>/、/stages/<阶段>/ 的正文就是一批文章卡片
 * （标题 + 一句话摘要 + 标签），这些内容 100% 来自文章页本身。
 * 把它们放进索引有两个坏处：
 *   1. 提问「军训要准备什么」会命中 /tags/军训/ 这张列表，而不是《军训生存指南》正文，
 *      模型拿到的材料变成一句摘要，答案质量直接下降；
 *   2. 六十几张列表页会稀释倒排表的 idf，让真正的文章页权重变低。
 *
 * 反例是 /courses/ —— 它形式上也是聚合页，但**内容不来自任何别的页面**：
 * 142 门课、185 条资料、参考书目的结构化数据只有它这里有。所以不能按「是不是列表页」一刀切，
 * 只能是显式名单。
 */
const AGGREGATE_PAGE_PATTERNS = [/^\/tags\//, /^\/stages\//];

/**
 * @param {string} url 站点路径，例如 `/tags/军训/`
 * @returns {boolean}
 */
export function isAggregatePage(url) {
  return AGGREGATE_PAGE_PATTERNS.some((pattern) => pattern.test(url));
}

export { AGGREGATE_PAGE_PATTERNS };
