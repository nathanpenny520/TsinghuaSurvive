/**
 * 视频嵌入语法糖 —— 让作者在正文里写一行，就能插入视频，而不是手写 <iframe>。
 *
 * 支持的写法（`::` 是 leaf directive，`:::` 是 container directive，两种都认）：
 *
 *   ::bilibili[BV1xx411c7mD]                          ← 推荐，只用写 BV 号
 *   ::bilibili[https://www.bilibili.com/video/BV1xx411c7mD]
 *   ::bilibili[BV1xx411c7mD | 演示：怎么用这个工具]      ← 竖线后面是图注
 *   ::video[https://media.nathanpenny.fun/uploads/20260930-ab12cd.mp4]
 *   ::video[https://.../demo.mp4 | 报到当天的路线]
 *
 * 输出一个 16:9 自适应的容器（样式在 src/styles/custom.css 的 .media-embed）。
 *
 * 为什么是「Sätteri 插件」而不是 remark 插件：
 *   Astro 7 的默认 Markdown 处理器是 Sätteri（Rust 实现），`markdown.remarkPlugins`
 *   只有在另外装 @astrojs/markdown-remark、把整站换回 unified 管线之后才可用。
 *   为了这一行语法糖换掉全站的 Markdown 渲染器不划算，所以用 Sätteri 自己的插件接口
 *   （Starlight 的 :::tip 提示块也是这么接的）。插件按**声明式节点**产出 figure/iframe，
 *   不走「注入裸 HTML」那条路 —— 裸 HTML 在 .mdx 里会被当成 JSX 解析，属性写法稍有不一致就炸。
 *
 * 写错的语法**直接让构建失败**（而不是静默输出一段坏 HTML）：本站的原则是
 * 「宁可构建报错，也不要页面上悄悄少一块」。同一个规则在 scripts/check-media.mjs 里
 * 还有一份纯文本版，好处是不用等构建就能在 CI 的内容检查阶段先报出来。
 */

/** 支持的指令名 */
const EMBEDS = new Set(['bilibili', 'video']);

/** 用 hName/hProperties 产出真实 HTML 元素（和 Starlight 处理提示块的手法一致） */
function el(tagName, properties, children = []) {
  return {
    type: 'paragraph',
    data: { hName: tagName, hProperties: properties },
    children,
  };
}

const text = (value) => ({ type: 'text', value });

/** 从各种写法里抠出 BV 号 / av 号 */
export function toBilibiliId(raw) {
  const bv = raw.match(/BV[0-9A-Za-z]{10}/);
  if (bv) return { kind: 'bvid', id: bv[0] };
  const av = raw.match(/av(\d+)/i);
  if (av) return { kind: 'aid', id: av[1] };
  return null;
}

/** 把 `内容 | 图注` 拆成两段；图注可选 */
export function splitCaption(raw) {
  const index = raw.indexOf('|');
  if (index === -1) return { value: raw.trim(), caption: '' };
  return { value: raw.slice(0, index).trim(), caption: raw.slice(index + 1).trim() };
}

function locationOf(node, ctx) {
  const file = ctx?.fileURL?.pathname?.split('/').slice(-2).join('/');
  const line = node?.position?.start?.line;
  return `${file || '内容文件'}${line ? ` 第 ${line} 行` : ''}`;
}

/** 造出 ::bilibili 的 figure；语法不对就抛错（构建失败，CI 会拦住） */
export function buildBilibili(raw, node, ctx) {
  const { value, caption } = splitCaption(raw);
  const parsed = toBilibiliId(value);
  if (!parsed) {
    throw new Error(
      `::bilibili[...] 里没找到 BV 号或 av 号：「${value}」（${locationOf(node, ctx)}）。\n` +
        '  正确写法：::bilibili[BV1xx411c7mD]，或者把整条视频链接粘进方括号里。',
    );
  }
  const query = parsed.kind === 'bvid' ? `bvid=${parsed.id}` : `aid=${parsed.id}`;
  const src =
    `https://player.bilibili.com/player.html?${query}&page=1` +
    '&high_quality=1&danmaku=0&autoplay=0';

  return el('figure', { class: 'media-embed' }, [
    el('div', { class: 'media-embed__frame' }, [
      el('iframe', {
        src,
        title: caption || 'B 站视频',
        loading: 'lazy',
        scrolling: 'no',
        allowfullscreen: 'true',
        referrerpolicy: 'no-referrer',
      }),
    ]),
    ...(caption ? [el('figcaption', {}, [text(caption)])] : []),
  ]);
}

/** 造出 ::video 的 figure；只接受 https 完整地址 */
export function buildVideo(raw, node, ctx) {
  const { value, caption } = splitCaption(raw);
  if (!/^https:\/\/\S+$/i.test(value)) {
    throw new Error(
      `::video[...] 只接受 https 开头的完整网址，收到的是：「${value}」（${locationOf(node, ctx)}）。\n` +
        '  视频文件先在后台媒体库里上传（会存到 R2），再把拿到的地址粘进来。',
    );
  }
  return el('figure', { class: 'media-embed media-embed--video' }, [
    el('div', { class: 'media-embed__frame' }, [
      el('video', {
        src: value,
        controls: 'true',
        preload: 'metadata',
        playsinline: 'true',
      }),
    ]),
    ...(caption ? [el('figcaption', {}, [text(caption)])] : []),
  ]);
}

/** 指令名 → 构造器 */
const BUILDERS = { bilibili: buildBilibili, video: buildVideo };

/**
 * 取指令方括号里的内容。
 *
 * ⚠️ 这里有个坑：`:::`（container 指令）在没写闭合的 `:::` 时会把**后面整篇正文**
 * 都吞进 children。所以容器写法只接受「只有一个孩子（就是那个标签）」的情况，
 * 多出内容就直接报错 —— 否则作者会得到一个「后面半篇文章凭空消失」的页面。
 */
function labelOf(node, ctx) {
  if (node.type === 'containerDirective') {
    const children = node.children || [];
    if (children.length !== 1) {
      throw new Error(
        `:::${node.name}[...] 后面还有别的内容（${locationOf(node, ctx)}）。\n` +
          `  两个改法：① 换成两个冒号的写法 ::${node.name}[...]（推荐，一行写完，不用闭合）；\n` +
          '            ② 保留三个冒号，并在内容下面单独加一行 ::: 收尾。\n' +
          '  现在后面的内容会被吞掉，所以这里直接报错。',
      );
    }
    return (ctx.textContent(children[0]) || '').split('\n')[0].trim();
  }
  const raw = ctx.textContent(node) || '';
  return raw.split('\n')[0].trim();
}

/** 行级指令必须自己独占一个块，否则会产出 <p> 里套 <figure> 的非法结构 */
const BLOCK_PARENTS = new Set(['root', 'blockquote', 'listItem']);

function handleDirective(node, ctx) {
  const builder = BUILDERS[node.name];
  if (!builder) return undefined;

  const parent = ctx.parent(node);
  if (parent && !BLOCK_PARENTS.has(parent.type)) {
    throw new Error(
      `::${node.name}[...] 要单独占一行（现在写在了句子中间，${locationOf(node, ctx)}）。\n` +
        '  行内写法会产出非法的 HTML 结构，所以这里直接报错。',
    );
  }

  return builder(labelOf(node, ctx), node, ctx);
}

/**
 * Sätteri mdast 插件。`position: true` 是必须的：不显式声明要位置信息时，
 * Sätteri 会跳过行号采集（为了快 15%），报错里就指不出是哪一行。
 */
export const mediaEmbedPlugin = {
  name: 'media-embed',
  options: { position: true },

  leafDirective(node, ctx) {
    return handleDirective(node, ctx);
  },

  containerDirective(node, ctx) {
    return handleDirective(node, ctx);
  },

  textDirective(node, ctx) {
    if (!EMBEDS.has(node.name)) return undefined;
    // 单个冒号是「行内指令」，嵌在句子中间会产出 <p> 里套 <figure> 的非法结构。
    // 这里不留情面地报错：改成一个独立的 `::bilibili[...]` 就好。
    throw new Error(
      `::bilibili / ::video 要单独占一行（现在写在了句子中间，${locationOf(node, ctx)}）。\n` +
        '  行内写法会产出非法的 HTML 结构，所以这里直接报错。',
    );
  },
};

export default mediaEmbedPlugin;
