/**
 * 内容时效策略的统一入口。
 *
 * 唯一数据源是根目录的 content-policy.json —— CI 的内容检查脚本
 * （scripts/check-content.mjs，跑在 Node 里）读的是同一个文件，
 * 这样「站点上显示过期提示」和「CI 里报过期警告」的阈值不会漂移。
 */
import raw from '../../content-policy.json';

export type ContentPolicy = {
  staleAfterMonths: number;
  linkVerifiedStaleAfterMonths: number;
  placeholderAuthors: string[];
  placeholderUrlValues: string[];
  sidebarOrderWarning: number;
};

export const policy: ContentPolicy = {
  staleAfterMonths: raw.staleAfterMonths,
  linkVerifiedStaleAfterMonths: raw.linkVerifiedStaleAfterMonths,
  placeholderAuthors: raw.placeholderAuthors,
  placeholderUrlValues: raw.placeholderUrlValues,
  sidebarOrderWarning: raw.sidebarOrderWarning,
};

/** 从某个日期算起过了多少个月（不足一个月按 0 计） */
export function monthsSince(date: Date, now: Date = new Date()): number {
  let months =
    (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth());
  if (now.getDate() < date.getDate()) months -= 1;
  return Math.max(months, 0);
}

/** 该日期是否已经超过策略规定的有效期 */
export function isStale(date: Date, now: Date = new Date()): boolean {
  return monthsSince(date, now) >= policy.staleAfterMonths;
}

/** 把日期格式化成「2026 年 3 月」 */
export function formatYearMonth(date: Date): string {
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;
}

/** 把日期格式化成 ISO 日期（2026-03-01） */
export function formatISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
