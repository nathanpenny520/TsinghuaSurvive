/**
 * 中文友好的就绪分词 —— **构建期与运行时必须用同一份**。
 *
 * 为什么单独抽一个文件：索引脚本（scripts/build-ai-index.mjs）用它建倒排表，
 * Worker（src/worker/retrieval.js）用它切用户提问。两边只要有一点不一致
 * （比如一边保留了单字、另一边没保留），检索就会**静默变差**——
 * 不报错、不缺页，只是搜不到。所以两边 import 同一个函数，而不是各写一份。
 *
 * 切法：中文用**双字组（bigram）**，英文/数字按词，单字兜底。
 *   - 为什么不上分词器：中文分词词典与实现会随版本漂移，而本站的提问几乎都是实体词
 *     （「绩点」「保研」「军训」），bigram 对这类词的召回已经够好，且零依赖、结果可复现。
 *   - 为什么保留单字：像「分」「转」这类单字提问有兜底作用，代价只有索引里多几个高频词条
 *     （高频词在剪枝阶段本来就会被丢掉，见 build-ai-index.mjs 的 MAX_DF_RATIO）。
 *   - 为什么要 cut 英文的 `+.#_-`：站上有 `C++`、`node.js`、`gpa`、`3.3/4.0` 这类写法，
 *     按纯 `[a-z]+` 切会把 `c++` 切成 `c`，反而搜不到。
 */

/**
 * 虚词字符表：这些字几乎不携带话题信息，**由它们参与构成的 bigram 基本都是跨词边界的碎片**。
 *
 * 为什么需要这一步（实测踩过）：提问「军训要准备什么」会被切成
 * `军训 / 训要 / 要准 / 准备 / 备什 / 什么`，其中 `训要`、`要准`、`备什` 都是碎片。
 * 它们要么在索引里根本不存在（把覆盖率拉低，导致真正讲军训的那一篇被判成"不相关"），
 * 要么因为罕见而拿到很高的 idf（把不相关的块顶上来）。两头都会让检索变差。
 *
 * 判据：bigram 的**首字或尾字**是虚词字符就不收。这样能保住
 * `绩点 / 选课 / 保研 / 军训 / 食堂 / 培养 / 方案 / 专业 / 毕业 / 及格` 这类实词，
 * 砍掉 `的东 / 在的 / 要准 / 备什 / 不存 / 定要` 这类碎片。
 *
 * 刻意**不**收这些字：
 *   上 下 来 去 中 时 到 用 做 对 给 会 能 可 需 应 得 地 着 过 ——
 *     在 `上课 / 学分 / 给分 / 对策 / 需求 / 补考` 里是实义成分；
 *   及 —— `及格` 是站上的真词（「体测不及格怎么办」），收进来会把它砍成单字。
 * 教训：这张表每加一个字都要跑一遍 `npm run check:ai` 里的检索自测，
 * 它会让某些提问只剩一个词，进而被相关度闸门误拒。
 */
const FUNCTION_CHARS = new Set(
  '的了是在要什么怎样吗呢吧啊呀哦嘛和与或就都也很太这那哪有没不无我你他她它们之其而但并且因所被把请谁呗'.split(''),
);

/**
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  const tokens = [];
  const lower = String(text ?? '').toLowerCase();
  // 英文与数字：允许词内出现 + . # _ -（C++ / node.js / 3.3 / read-only）
  for (const m of lower.matchAll(/[a-z][a-z0-9+.#_-]{1,29}|\d+(?:\.\d+)?/g)) tokens.push(m[0]);
  // 中日韩统一表意文字：双字组，首尾含虚词字符的丢掉；单字 run 保留单字做兜底
  for (const m of lower.matchAll(/[\u3400-\u4dbf\u4e00-\u9fff]+/g)) {
    const run = m[0];
    if (run.length === 1) {
      if (!FUNCTION_CHARS.has(run)) tokens.push(run);
      continue;
    }
    for (let i = 0; i < run.length - 1; i += 1) {
      const bigram = run.slice(i, i + 2);
      if (FUNCTION_CHARS.has(bigram[0]) || FUNCTION_CHARS.has(bigram[1])) continue;
      tokens.push(bigram);
    }
  }
  return tokens;
}

/**
 * 提问侧的去噪：把疑问句式里对检索没用的部分削掉。
 *
 * 为什么需要：用户会写「请问清华的绩点到底是怎么算的呀？」。
 * bigram 会切出「请问」「问清」「的绩」「呀」这类碎片，其中与正文重叠的碎片
 * 会把不相关的块顶上来。这里只做**很保守**的削除（句末语气词、常见疑问前后缀），
 * 不做停用词表——停用词表是最容易过拟合、也最容易半年后说不清为什么的东西。
 */
const NOISE_PATTERNS = [
  /请问/g,
  /麻烦/g,
  /我想问(一下)?/g,
  /想问(一下)?/g,
  /(到底|究竟)/g,
  /(是什么|怎么办|怎么做|怎么弄|怎么搞|如何)/g,
  /(吗|呢|吧|呀|啊|嘛|哦|噢)(?=[？?。！!，,、\s]|$)/g,
  /[？?！!。，,、；;：:（）()「」『』【】《》“”"'’‘]/g,
];

/** @param {string} question @returns {string} */
export function normalizeQuestion(question) {
  let text = String(question ?? '');
  for (const pattern of NOISE_PATTERNS) text = text.replace(pattern, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * 提问里的「框架词」——组成问句、但不指示话题的那些词。
 *
 * 为什么要单独一张表，而不是靠 idf 自动降权：
 *   实测提问「军训要准备什么」，命中「军训」的《军训生存指南》**输给**了
 *   命中「准备 + 什么」的《你需要准备什么》——两个泛词的分和压过了一个专有词，
 *   而「什么」在索引里必然存在、idf 也不算低，靠统计量分不开。
 *   它们不是「停用词」（那是按语料统计出来的东西），而是**问句结构**：
 *   换任何话题都会出现，且不携带话题信息。表是封闭的、可枚举的，所以列出来是诚实的。
 *
 * 刻意**不**收那些有时是话题的词：不、没、有、会、能、要、对、给、上、下、来、去。
 * 「没有保上研」「有没有名额」里的「没有」是内容，删掉会答非所问。
 */
const QUESTION_FRAME_TERMS = new Set([
  '什么', '么样', '怎么', '怎样', '咋办', '哪个', '哪些', '哪种', '多少', '多久', '多长',
  '为什么', '何时', '哪里', '哪儿', '是否', '可以', '能不能', '要不要', '好不好', '什么样',
  '应该', '需要', '请问', '一下', '介绍', '有关', '关于',
]);

/**
 * 提问 → 参与检索的词（去重 + 去掉框架词）。
 * 求的是召回：删多了会搜不到，所以框架词表只收不含话题信息的词。
 * @param {string} question
 * @returns {string[]}
 */
export function queryTerms(question) {
  const all = tokenize(normalizeQuestion(question));
  const kept = all.filter((term) => !QUESTION_FRAME_TERMS.has(term));
  // 全被删光时（例如提问就是「怎么样」）退回原始词，交给上层的最低相关度闸门去拒答
  return [...new Set(kept.length ? kept : all)];
}
