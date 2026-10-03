/**
 * 卡片文案的小工具。
 *
 * 为什么需要它：`desc` 里写了 `**重点**`，但卡片是用 JSX 表达式渲染的，不是 Markdown ——
 * 直接 `{item.desc}` 会把星号原样印在页面上（站内常用链接页曾经有三处这样）。
 * 两个组件（LinkGrid、ToolDirectory）都要这个转换，所以放在这里，避免两边各写一遍再各自漂移。
 */

/** 转义 HTML 后把成对的 `**` 变成 <strong>；单个星号原样保留（域名、通配符不会被动到） */
export function descHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

/** 搜索用的纯文本：去掉加粗标记，否则搜「图书馆」这类词会被星号干扰 */
export function descPlain(text: string): string {
  return text.replace(/\*\*/g, '');
}
