/**
 * 课程资料索引 —— 数据与「资料库档案」都放在这里。
 *
 * 数据来源：`src/data/course-index.json`，由 `scripts/build-course-index.mjs`
 * 从几个公开的校内资料库扫描生成（扫描对象见脚本头部注释）。
 * 本站**不镜像任何课程文件**，只回答一个问题：
 *   「这门课，哪个资料库里有材料，是什么类型的材料」。
 *
 * 改数据请改生成脚本再重新生成，不要手工编辑 JSON：
 *   node scripts/build-course-index.mjs
 */
import raw from './course-index.json';

// ── 类型 ───────────────────────────────────────────────────────────────

/** 资料库在校园网/公网的可达性 —— 这一栏比链接本身更重要 */
export type Reach = '校园网' | '公网' | '需代理' | '未实测';

export type ArchiveId = 'rekcarc' | 'weiyang' | 'readme' | 'sast';

export type ArchiveLink = {
  label: string;
  url: string;
  reach: Reach;
  note?: string;
};

export type Archive = {
  id: ArchiveId;
  name: string;
  short: string;
  org: string;
  desc: string;
  /** 内容许可 */
  license: string;
  links: ArchiveLink[];
  /** 这个库的强项 */
  strength: string;
  /** 使用它的时候要注意什么 */
  caution: string;
};

export type SourceRef = {
  archive: ArchiveId;
  /** 资料库内的路径，链接由 courses.ts 组装 */
  path: string;
  kinds: string[];
  /** 该目录下的文件数量（只有 REKCARC 有） */
  files?: number;
  /** 该资料库里相关章节的标题（只有 SAST 课程指引有） */
  topics?: string[];
  /** 资料库 nav 里的条目标题（比路径末段好读，例如「作业答案」「Python 程序设计笔记」） */
  label?: string;
  detail?: string;
};

export type Course = {
  name: string;
  category: string;
  terms: string[];
  books: string[];
  sources: SourceRef[];
};

type CourseIndexFile = {
  categories: string[];
  courses: Course[];
};

const index = raw as unknown as CourseIndexFile;

export const courseCategories: string[] = index.categories;
export const courses: Course[] = index.courses;

// ── 资料库档案 ─────────────────────────────────────────────────────────

/**
 * 每个资料库都写清楚：谁维护的、能拿到什么、怎么访问、有什么坑。
 * `reach` 是实测结论（校园网内直接测的），不确定的一律标「未实测」，
 * 不猜 —— 猜错的链接会让人白折腾半小时。
 */
export const archives: Record<ArchiveId, Archive> = {
  rekcarc: {
    id: 'rekcarc',
    name: '清华大学计算机系课程攻略（REKCARC-TSC-UHT）',
    short: '计算机系课程攻略',
    org: '计算机系同学自发维护',
    desc: '按学期组织的课程目录，每门课下面放往年题、作业、笔记、速查表。同类项目里材料最全的一个。',
    license: '贡献者编写部分采用 CC BY-SA 4.0；课程材料版权归各自作者',
    strength: '往年题与考试资料最全，覆盖从大一到大四加研究生',
    caution:
      '库里明确写着「别背 repo 里的东西」——每年题目会变，助教也知道这份库存在。资料用来复习和对照思路，不是用来押题或交作业。',
    links: [
      {
        label: '校内 GitLab 镜像',
        url: 'https://git.tsinghua.edu.cn/pkuanonym/REKCARC-TSC-UHT',
        reach: '校园网',
        note: '校内浏览与克隆都快得多，也不消耗国际流量',
      },
      {
        label: 'GitHub 仓库',
        url: 'https://github.com/PKUanonym/REKCARC-TSC-UHT',
        reach: '需代理',
        note: '校园网内 github.com 网页端打不开（实测 2026-09-30）',
      },
      {
        label: '在线文档站',
        url: 'https://rekcarc-tsc-uht.readthedocs.io/en/latest/',
        reach: '未实测',
      },
    ],
  },
  weiyang: {
    id: 'weiyang',
    name: '未央书院学习资料共享计划',
    short: '未央学习',
    org: '未央书院同学维护',
    desc: '按「基础课 / 专业课」分类的课程资料与作业答案，另有选课指南、技能培训、乐学资源等板块。',
    license: '文档内容 CC BY-NC-SA 4.0；网站源码 MIT',
    strength: '作业答案与课程笔记较全，选课指南按课程类别组织',
    caution: '作业答案用来看思路和自查，直接抄进作业里就是学术不端。部分页面最后一次更新较早。',
    links: [
      { label: '站点', url: 'https://weiyangxuexi.github.io/', reach: '未实测' },
      {
        label: '校内 GitLab 镜像',
        url: 'https://git.tsinghua.edu.cn/shenzhiy21/WeiYangXueXi-github-io/',
        reach: '校园网',
      },
      {
        label: 'GitHub 仓库',
        url: 'https://github.com/WeiYangXueXi/WeiYangXueXi.github.io',
        reach: '需代理',
      },
    ],
  },
  readme: {
    id: 'readme',
    name: 'ReadMe 软件学院互助文档',
    short: 'ReadMe 互助文档',
    org: '软件学院学生组织维护',
    desc: '课程笔记与作业攻略：操作系统复习提纲、数据结构 OJ 解析、软工踩坑记录，还有写给新生的信。',
    license: '以项目页声明为准',
    strength: '复习提纲与作业思路写得细，偏「怎么学会」而不是「抄答案」',
    caution: '部分内容是特定年份的课程安排，换老师或改大纲后可能不再适用。',
    links: [
      { label: '站点', url: 'https://ssast-readme.github.io/', reach: '未实测' },
      {
        label: 'GitHub 仓库',
        url: 'https://github.com/ssast-readme/ssast-readme.github.io',
        reach: '需代理',
      },
    ],
  },
  sast: {
    id: 'sast',
    name: '计算机系学生科协技能引导文档',
    short: 'SAST 技能引导文档',
    org: '计算机系学生科协维护',
    desc: '不是课程资料，而是「上这门课需要哪些前置技能」的地图：Git、Linux、LaTeX、各语言入门、前后端与 AI。',
    license: '以站点声明为准',
    strength: '把课程和技能对应起来，适合「上课听不懂因为不会工具」的情况',
    caution: '它是入门引导，不替代教材；涉及具体课程要求时以任课教师为准。',
    links: [
      { label: '站点', url: 'https://docs.net9.org/', reach: '未实测' },
      {
        label: 'GitHub 仓库',
        url: 'https://github.com/SAST-skill-docers/sast-skill-docs',
        reach: '需代理',
      },
    ],
  },
};

export const archiveOrder: ArchiveId[] = ['rekcarc', 'weiyang', 'readme', 'sast'];

// ── 链接组装 ───────────────────────────────────────────────────────────

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

/**
 * 把「资料库 + 库内路径」组装成可点的链接。
 * 有几个库在校园网里打不开（github.com）或走校内镜像更快，
 * 所以这里返回的是**首选入口**，同时把可达性一起带出来，由页面显示角标。
 */
export function sourceLink(ref: SourceRef): { url: string; reach: Reach; label: string } {
  switch (ref.archive) {
    case 'rekcarc':
      return {
        // 校内镜像优先：校园网内更快，也不吃国际流量
        url: `https://git.tsinghua.edu.cn/pkuanonym/REKCARC-TSC-UHT/-/tree/master/${encodePath(ref.path)}`,
        reach: '校园网',
        label: '校内 GitLab 打开该课程目录',
      };
    case 'weiyang':
      return {
        url: `https://weiyangxuexi.github.io/${encodePath(ref.path)}/`,
        reach: '未实测',
        label: '未央学习打开该页',
      };
    case 'readme':
      return {
        url: `https://ssast-readme.github.io/${encodePath(ref.path)}/`,
        reach: '未实测',
        label: 'ReadMe 打开该页',
      };
    case 'sast':
      return { url: 'https://docs.net9.org/courses/', reach: '未实测', label: '技能引导文档的课程指引' };
  }
}

/** GitHub 上对应的目录（校园网内打不开，留给有代理的人） */
export function sourceGithubLink(ref: SourceRef): string | null {
  if (ref.archive === 'rekcarc') {
    return `https://github.com/PKUanonym/REKCARC-TSC-UHT/tree/master/${encodePath(ref.path)}`;
  }
  return null;
}

// ── 统计与查询 ─────────────────────────────────────────────────────────

export const ALL_KINDS = [
  '往年题',
  '作业',
  '答案',
  '笔记',
  '速查表',
  '课件',
  '实验',
  '大作业',
  '书目',
  '推研资料',
  '选课指南',
  '入门文档',
  '课程资料',
];

/** 页面筛选用：一门课涉及到的所有资料类型 */
export function kindsOfCourse(course: Course): string[] {
  const kinds = new Set<string>();
  for (const source of course.sources) {
    for (const kind of source.kinds) kinds.add(kind);
  }
  return [...kinds];
}

/** 页面筛选用：一门课出现在哪些资料库里 */
export function archivesOfCourse(course: Course): ArchiveId[] {
  return [...new Set(course.sources.map((s) => s.archive))];
}

export function sourceCount(): number {
  return courses.reduce((sum, course) => sum + course.sources.length, 0);
}

/** 首页/页面顶部用的一句话统计 */
export function courseIndexSummary() {
  const perArchive = {} as Record<ArchiveId, number>;
  for (const id of archiveOrder) perArchive[id] = 0;
  for (const course of courses) {
    for (const id of archivesOfCourse(course)) perArchive[id] += 1;
  }
  return {
    courses: courses.length,
    sources: sourceCount(),
    withBooks: courses.filter((c) => c.books.length > 0).length,
    perArchive,
  };
}

/** 资料类型 → 展示顺序 */
export function sortKinds(kinds: string[]): string[] {
  return [...kinds].sort((a, b) => ALL_KINDS.indexOf(a) - ALL_KINDS.indexOf(b));
}
