/**
 * 校外/校内的其他资料库，以及「用这些资料时不能越过的那几条线」。
 *
 * 和 `courses.ts` 的分工：
 *   courses.ts  —— 被打通到课程级别的那 4 个资料库（能按课程查询）
 *   archives.ts —— 不按课程组织的资源站，以及使用规则
 *
 * 所有链接都来自参考资料与站点维护者自己的收藏夹，`reach` 是实测或未实测的真实状态。
 */
import type { Reach } from './courses';

export type ArchiveLink = {
  label: string;
  url: string;
  reach: Reach;
  note?: string;
};

export type ExtraArchive = {
  name: string;
  short: string;
  org: string;
  desc: string;
  /** 适合什么场景 */
  strength: string;
  caution: string;
  license: string;
  links: ArchiveLink[];
};

export const extraArchives: ExtraArchive[] = [
  {
    name: '自动化系课程攻略（OpenDA Wiki）',
    short: 'OpenDA',
    org: '自动化系同学维护',
    desc: '自动化系的课程攻略 Wiki，按课程讲内容、考核与经验，偏「这门课到底在讲什么」。',
    strength: '想了解某门自动化系专业课的实际内容和考核方式时看它',
    caution: '内容按届更新，换老师或改大纲后可能过期。',
    license: '以项目页声明为准',
    links: [
      { label: '站点点开就进', url: 'https://open-da.github.io/OpenDA-Wiki/preface/', reach: '未实测' },
      { label: 'GitHub 仓库', url: 'https://github.com/Open-DA/OpenDA', reach: '需代理' },
    ],
  },
  {
    name: 'CS 自学指南（csdiy.wiki）',
    short: 'CS 自学指南',
    org: '社区维护',
    desc: '按知识方向整理的校外优质课程路线图，每门课都写清前置要求、难度和大概投入时间。',
    strength: '课内没听懂、想找一门讲得更清楚的课来补的时候',
    caution: '它面向自学，进度和考核与清华课程不对应，别用它替代课内要求。',
    license: '以项目页声明为准',
    links: [{ label: '站点', url: 'https://csdiy.wiki/', reach: '未实测' }],
  },
  {
    name: 'OI Wiki',
    short: 'OI Wiki',
    org: '社区维护',
    desc: '算法与数据结构的中文百科，从入门到竞赛级都有，配合课程学习很合适。',
    strength: '数据结构、算法、图论、计算几何这类课的知识点查漏补缺',
    caution: '它面向算法竞赛，部分实现与课内要求不完全一致，交作业前以课程要求为准。',
    license: '以项目页声明为准',
    links: [{ label: '站点', url: 'https://oi-wiki.org/', reach: '未实测' }],
  },
  {
    name: '清华乐学工作坊资料',
    short: '乐学资源',
    org: '学校学习发展中心相关',
    desc: '学业指导类讲座资料：如何规划大学学业、时间管理、学业受挫后怎么办、推研面试准备等。',
    strength: '遇到「学不动了」「该怎么规划」这类问题时，比经验帖更系统',
    caution: '需要校园网；讲座按学期更新，具体安排以校内通知为准。',
    license: '版权归学校所有，仅作学习使用',
    links: [
      {
        label: '资料页',
        url: 'https://workshop.learning.tsinghua.edu.cn/web/index.php/materials/index',
        reach: '校园网',
      },
    ],
  },
  {
    name: '校内云盘上的共享资料（未央）',
    short: '校内云盘',
    org: '未央书院资料共享计划',
    desc: '在清华云盘上的一份课程资料合集，主要是数理基础课的复习资料与习题课解答。',
    strength: '不想克隆整个仓库、只想拿某个课程资料包的时候',
    caution: '云盘链接可能失效；分享范围与版权以分享者说明为准，不要再往外转。',
    license: '以分享者说明为准',
    links: [
      { label: '云盘目录', url: 'https://cloud.tsinghua.edu.cn/d/cc494ee97f884a3b9ffb', reach: '校园网' },
    ],
  },
  {
    name: '浙江大学课程攻略共享计划（zju-icicles）',
    short: 'zju-icicles',
    org: '浙江大学同学维护',
    desc: '国内最早的课程攻略共享项目之一，REKCARC-TSC-UHT 就是受它启发建立的。',
    strength: '想看看别的学校怎么组织资料库，或者跨校找同类课程材料',
    caution: '课程设置与清华不同，只能作为知识性参考，不适用于学分与考核。',
    license: '以项目页声明为准',
    links: [
      { label: 'GitHub 仓库', url: 'https://github.com/QSCTech/zju-icicles', reach: '需代理' },
    ],
  },
  {
    name: '上海交通大学课程资料分享（SJTU-Courses）',
    short: 'SJTU-Courses',
    org: '上海交通大学同学维护',
    desc: '按课程组织的资料仓库，结构和思路与前面几个类似。',
    strength: '跨校对照同类课程的内容深度与作业形式',
    caution: '同上：跨校资料不能替代本校课程要求。',
    license: '以项目页声明为准',
    links: [
      { label: 'GitHub 仓库', url: 'https://github.com/kxxwz/SJTU-Courses', reach: '需代理' },
    ],
  },
];

/**
 * 使用这些资料时不能越过的那几条线。
 * 这几条比链接本身重要 —— 链接失效只是麻烦，越线是处分。
 */
export const usageRules: { title: string; body: string }[] = [
  {
    title: '往年题用来看「考什么」，不用来背答案',
    body: '课程攻略库自己写得很清楚：题目每年会变，助教也知道这些库存在。把往年题当复习提纲和难度参考，而不是押题册；直接把答案抄进作业或实验报告，属于抄袭。',
  },
  {
    title: '作业答案只用来对照思路',
    body: '看完答案自己重写一遍，和复制粘贴是两件事。多数课程对「雷同作业」的判定并不需要一模一样 —— 思路、变量名、错误都相同就足够说明问题。',
  },
  {
    title: '不把课程内部材料往公开库上传',
    body: '老师发的课件、内部讲义、考试原卷、含他人信息的名单与成绩，都不应该出现在公开仓库或网盘里。这一类东西一旦外传，责任在传的人身上。',
  },
  {
    title: '尊重原库的许可与署名',
    body: '这些库多为 CC BY-SA 或 CC BY-NC-SA 许可：可以转载和改写，但要署名、非商业使用、并以相同方式共享。直接搬运时请把原库和作者一起带上。',
  },
  {
    title: '发现侵权内容，走原库的 Issue 渠道',
    body: '如果你是被收录材料的作者且不希望公开，去对应仓库提 Issue 要求下架，比在群里抱怨有效得多。本站只做索引，不代为删除任何第三方内容。',
  },
];
