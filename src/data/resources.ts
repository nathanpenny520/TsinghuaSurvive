/**
 * 资料下载 / 站内工具清单。
 *
 * 两类条目，用 `internal` 区分：
 *   - 网盘外链（默认）：**文件本体不放本站**，只放第三方网盘链接 + 提取码
 *   - 站内页面（`internal: true`）：直接在站上就能用的东西（可勾选清单、在线表格），
 *     `url` 写站内绝对路径（`/xxx/`）
 *
 * 约定：
 * 1. `url` 留空或填 'TODO' 时，页面显示「待补充」，不会渲染成死链。
 * 2. 网盘链接容易失效，`checkedAt` 用来记录你最后一次确认链接可用的日期。
 * 3. 不要把含个人信息、学号、内部系统截图、他人隐私的文件放上来。
 *
 * 为什么有些东西做成站内页面而不是模板文件：
 *   - 清单要能在手机上勾、勾完还得记住，模板文件做不到；
 *   - 在线表格能在浏览器里算，改一个数字立刻看到缺口，比发一个 xlsx 有用；
 *   - 少一份文件，就少一个「链接失效」的入口。
 */

export type Resource = {
  /** 资料名称 */
  name: string;
  /** 网盘链接，或站内绝对路径（`internal: true` 时） */
  url?: string;
  /** 提取码（如有） */
  code?: string;
  /** 一句话说明里面是什么、适合谁 */
  desc: string;
  /** 分类 */
  group: string;
  /** 文件格式，如 PDF / Markdown / zip；站内工具写「站内工具」「站内页面」 */
  format?: string;
  /** 大小，如 '12 MB' */
  size?: string;
  /** 最后确认链接可用的日期 */
  checkedAt?: string;
  /** 指向站内页面而不是网盘文件 */
  internal?: boolean;
};

export const resourceGroups = ['新生入学', '学业与选课', '科研与深造', '求职与实习', '杂项'];

export const resources: Resource[] = [
  {
    name: '新生报到清单（可在线勾选）',
    url: '/freshman/arrival-checklist/',
    desc: '出发前的证件、到校当天、第一周的账号与基础设施——三条清单，勾选状态存在你自己的浏览器里。',
    group: '新生入学',
    format: '站内工具',
    internal: true,
  },
  {
    name: '学分缺口拆解表（在线填 + 导出 JSON）',
    url: '/academics/credit-planner/',
    desc: '把培养方案拆成「类别 → 学分下限 → 已修 → 缺口」，自动算每类还差多少学分。',
    group: '学业与选课',
    format: '站内工具',
    internal: true,
  },
  {
    name: '选课决策工作台（在线填 + 导出 JSON）',
    url: '/academics/course-decision/',
    desc: '把候选课填成一张表，自动算出先修缺口、期末撞车、开学撞车与每周投入是否超载。不预置课程数据，规则公开可核对。',
    group: '学业与选课',
    format: '站内工具',
    internal: true,
  },
  {
    name: '《大学如何学》课程资料（学业方法模板）',
    url: 'https://cloud.tsinghua.edu.cn/d/b41948f21a62412087aa/',
    desc: '一门学业指导课的课件与模板：SQ3R 阅读法、备考计划表、甘特图与晨间日记模板、与导师沟通自评表、生涯决策平衡单、简历范例等。**适合「知道该努力但不知道从哪下手」的时候翻。**',
    group: '学业与选课',
    format: '校内云盘',
    checkedAt: '2026-09-30',
  },
  {
    name: '联系导师 / 问老师事情的邮件怎么写',
    url: '/mindset/talking-to-advisors/',
    desc: '邮件只要四件事：你是谁、你要什么、为什么找他、怎么继续。附写法与追问节奏。',
    group: '科研与深造',
    format: '站内页面',
    internal: true,
  },
];
