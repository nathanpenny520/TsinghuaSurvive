/**
 * 校内常用链接 —— 结构化数据，改这一个文件就能更新页面。
 *
 * 重要：`verified` 填你亲自点开确认过的日期（例如 '2026-09-30'）。
 * 没填的条目页面上会显示「待核对」角标，避免把过期或错误的网址发出去。
 */

export type CampusLink = {
  /** 显示名称 */
  name: string;
  /** 完整网址 */
  url: string;
  /** 一句话说明它到底能干什么 */
  desc: string;
  /** 分类 */
  group: LinkGroup;
  /** 亲自核对过的日期；不填表示还没核对 */
  verified?: string;
  /** 需要校园网 / VPN 才能访问 */
  campusOnly?: boolean;
};

export type LinkGroup =
  | '教学与选课'
  | '信息与生活'
  | '科研与学术'
  | '成长与出路'
  | '官方与资讯';

export const linkGroups: LinkGroup[] = [
  '教学与选课',
  '信息与生活',
  '科研与学术',
  '成长与出路',
  '官方与资讯',
];

export const campusLinks: CampusLink[] = [
  // ── 教学与选课 ──────────────────────────────────────────────
  {
    name: '教学门户（选课 / 成绩 / 培养方案）',
    url: 'https://zhjw.cic.tsinghua.edu.cn/',
    desc: '选课、查成绩、看培养方案和学籍信息的入口。具体域名请以信息门户内的跳转链接为准。',
    group: '教学与选课',
    campusOnly: true,
  },
  {
    name: '网络学堂',
    url: 'https://learn.tsinghua.edu.cn/',
    desc: '课程通知、课件下载、作业提交、讨论区。开学第一周就要摸熟。',
    group: '教学与选课',
    campusOnly: true,
  },
  {
    name: '雨课堂',
    url: 'https://www.yuketang.cn/',
    desc: '不少课用它点名、发课件、随堂测验。',
    group: '教学与选课',
  },
  {
    name: '清华大学图书馆',
    url: 'https://lib.tsinghua.edu.cn/',
    desc: '馆藏检索、数据库入口、座位预约、文献传递。写论文的起点。',
    group: '科研与学术',
  },

  // ── 信息与生活 ──────────────────────────────────────────────
  {
    name: '信息门户（info）',
    url: 'https://info.tsinghua.edu.cn/',
    desc: '校内各类系统的总入口：通知、办事、财务、宿舍、一卡通等。',
    group: '信息与生活',
    campusOnly: true,
  },
  {
    name: '清华邮箱',
    url: 'https://mails.tsinghua.edu.cn/',
    desc: '学校官方邮件。联系导师、投稿、申请材料都用它，务必每天看。',
    group: '信息与生活',
  },

  // ── 成长与出路 ──────────────────────────────────────────────
  {
    name: '清华大学就业信息网',
    url: 'https://career.tsinghua.edu.cn/',
    desc: '实习与校招信息、宣讲会日程、职业发展中心的服务入口。',
    group: '成长与出路',
  },

  // ── 官方与资讯 ──────────────────────────────────────────────
  {
    name: '清华大学官网',
    url: 'https://www.tsinghua.edu.cn/',
    desc: '学校层面的新闻、通知、机构与院系导航。',
    group: '官方与资讯',
  },
  {
    name: '清华大学新闻网',
    url: 'https://news.tsinghua.edu.cn/',
    desc: '校内新闻与人物报道，找「学校最近在发生什么」时看这里。',
    group: '官方与资讯',
  },
];

/** 按分类分组，供页面直接渲染 */
export function linksByGroup() {
  return linkGroups
    .map((group) => ({ group, items: campusLinks.filter((l) => l.group === group) }))
    .filter((g) => g.items.length > 0);
}
