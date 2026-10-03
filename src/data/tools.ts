/**
 * 学生自建工具与脚本 —— 结构化数据，改这一个文件就能更新页面。
 *
 * 为什么单独一个文件、而不是塞进 `links.ts`：
 *   links.ts 收的是**学校自己的系统入口**（每一条都要人工/脚本核对「入口还是干这件事」）；
 *   这里收的是**第三方工具**（学生或校友写的 App、插件、脚本），它们会停更、会失效、
 *   有的还会读取你页面上的成绩和课表。两类东西的可信度结构不一样，混在一张表里会误导人。
 *
 * 关于 `status` 和 `access` 两个字段：
 *   - `access` 只回答「在校内网络能不能打开」。托管在 GitHub 的工具标「需代理」，
 *     读法是**「打不开的时候挂代理」**，不是「一定打不开」—— 国内访问 GitHub 时通时不通，
 *     别把它当永久结论（一次实测：2026-09-30 网页端超时，2026-10-03 连续 5 次 200；复测记录见 /guides/links/）。
 *   - `status` 不是感觉出来的，取证据的顺序是：
 *       1. 上游 thuservices 自己写的状态（「可用 / 不再维护 / 未测试」）；
 *       2. 托管在 GitHub 的项目，查仓库 API 的 `archived` 与 `pushed_at`：
 *          archived = true → 已停止；最近一次提交在 `statusCheckedAt` 前 18 个月内 → 活跃；
 *          更早 → 不活跃；查不到（404 / 无仓库）→ 未核实。
 *     两者冲突时（例如上游写「可用」但仓库已归档）**以更保守的为准，并把冲突写进 `note`**。
 *     页面上会显示 `statusCheckedAt`，过期了就该重跑一遍（更新记录见 REFERENCE-NOTES 第九节）。
 *     随手填「活跃」的代价是：读者会把账号交给一个停更的项目。
 *
 * 数据来源：thuservices（https://thu.services/）的《一些脚本和工具》，本站只做筛选、
 * 补上「谁维护、能不能打开、有什么代价」，链接一律指向原项目。
 */

/** 维护状态的核对日期：上面那套规则是哪天跑出来的。页面会显示它，过期了就该重跑。 */
export const statusCheckedAt = '2026-10-03';

export type ToolStatus = '活跃' | '不活跃' | '已停止' | '未核实';
export type ToolAccess = '公网' | '校园网' | '需代理' | '未实测';

export type StudentTool = {
  /** 显示名称 */
  name: string;
  /** 原始项目地址（一律指向作者自己的发布页） */
  url: string;
  /** 它到底解决什么问题，以及用之前要知道的代价 */
  desc: string;
  /** 分类 */
  group: ToolGroup;
  /** 支持平台，例如「iOS / Android」「油猴脚本」 */
  platforms: string;
  /** 上游项目的维护状态 */
  status: ToolStatus;
  /** 校内网络能不能打开 */
  access: ToolAccess;
  /** 来自哪里 */
  origin?: string;
  /** 额外提醒 */
  note?: string;
};

export type ToolGroup =
  | '选课与课表'
  | '成绩与学籍'
  | '网络学堂与 INFO'
  | '生活小事'
  | '资料与云盘'
  | '社区与备份'
  | '科研与实践';

export const toolGroups: ToolGroup[] = [
  '选课与课表',
  '成绩与学籍',
  '网络学堂与 INFO',
  '生活小事',
  '资料与云盘',
  '社区与备份',
  '科研与实践',
];

export const tools: StudentTool[] = [
  // ── 选课与课表 ──────────────────────────────────────────────
  {
    name: 'NextTHUxk（选课增强扩展）',
    url: 'https://github.com/smartThise/NextTHUxk',
    desc: '在选课页面上叠一层工作台：按类型/学分/时间筛选全校课程、预选阶段估算中签概率、抽签阶段看课余量与候补排名、暂存多套课表方案。功能覆盖面最广，也最需要你自己核对它读走了什么。',
    group: '选课与课表',
    platforms: 'Chrome / Firefox 扩展',
    status: '活跃',
    access: '需代理',
    origin: 'thuservices（thu.services）工具汇总',
    note: '第三方扩展能读到你的选课页面内容。装之前看清权限与来源，别在公共电脑上登录使用',
  },
  {
    name: '选课冲突标记（油猴脚本）',
    url: 'https://greasyfork.org/en/scripts/408340-tsinghuacourseconflictmarker',
    desc: '在选课操作界面把与已选课程时间冲突的候选课标红，鼠标悬停能看到和哪几门撞。选课季抢志愿时能省一点反复对照的工夫。',
    group: '选课与课表',
    platforms: '油猴（Tampermonkey）脚本',
    status: '未核实',
    access: '未实测',
    origin: 'thuservices（thu.services）工具汇总',
    note: '只支持整学期课：半学期课可能标出「假冲突」。开课信息页与选课查询页不生效，只在选课操作界面工作',
  },
  {
    name: '选课剩余课容标记（油猴脚本）',
    url: 'https://greasyfork.org/en/scripts/456440-colorful-course',
    desc: '给课程的报名人数上色，一眼看出哪些课还有余量、哪些已经挤爆，帮助决定志愿排序。',
    group: '选课与课表',
    platforms: '油猴脚本',
    status: '活跃',
    access: '未实测',
    origin: 'thuservices（thu.services）工具汇总',
    note: '状态依据是上游一句「脚本还在开发中」（greasyfork 在校园网内不可达，查不到更新日期）；功能会变，志愿顺序最终还是以你自己的培养方案为准',
  },
  {
    name: 'THUCourseHelper（课表 App）',
    url: 'https://github.com/Starrah/THUCourseHelper',
    desc: '安卓端的课程表工具，把选课结果变成一张能随时看的课表。',
    group: '选课与课表',
    platforms: 'Android',
    status: '不活跃',
    access: '需代理',
    origin: 'thuservices（thu.services）工具汇总',
  },

  // ── 成绩与学籍 ──────────────────────────────────────────────
  {
    name: 'Tsinghua GPA Calculator（油猴脚本）',
    url: 'https://greasyfork.org/zh-CN/scripts/410960-tsinghua-gpa-calculator',
    desc: '在 INFO「全部成绩」页面直接算出全部 GPA 与必限 GPA，按新、旧两套算法分别给出，保留完整精度（官方入口只给三位有效数字）。',
    group: '成绩与学籍',
    platforms: '油猴脚本',
    status: '未核实',
    access: '未实测',
    origin: 'thuservices（thu.services）工具汇总',
    note: '只能算已经录入系统并发布的成绩；没发布的成绩它读不到。算出来的数只用来自己心里有数，正式场合以教务处为准',
  },
  {
    name: '清华成绩刮刮乐',
    url: 'https://github.com/summivox/thu-scratch',
    desc: '把 INFO 出成绩的页面盖住，点一下才显示一门 —— 一个纯粹的体验型小工具。',
    group: '成绩与学籍',
    platforms: 'Chrome 插件 / 油猴脚本',
    status: '不活跃',
    access: '需代理',
    origin: 'thuservices（thu.services）工具汇总',
  },

  // ── 网络学堂与 INFO ─────────────────────────────────────────
  {
    name: 'THUInfo（移动端助手）',
    url: 'https://github.com/thu-info-community/thu-info-app',
    desc: '把网络学堂、校历、图书馆、教室信息等整合到一个 App 里，有 App Store 分发，是这类工具里维护最勤的一个（最近一次提交在 2026-09）。',
    group: '网络学堂与 INFO',
    platforms: 'iOS / Android',
    status: '活跃',
    access: '需代理',
    origin: 'thuservices（thu.services）工具汇总',
    note: '要以你的账号登录第三方 App —— 介意的话用自己的设备与专用密码，并留意权限。项目已从 UNIDY2002/THUInfo 迁到 thu-info-community/thu-info-app',
  },
  {
    name: 'LearnX（网络学堂客户端）',
    url: 'https://github.com/robertying/learnX',
    desc: '第三方网络学堂客户端：看通知、下课件、交作业，比网页版顺手，支持 iOS / iPadOS / macOS / Android。',
    group: '网络学堂与 INFO',
    platforms: 'iOS / iPadOS / macOS / Android',
    status: '活跃',
    access: '需代理',
    origin: 'thuservices（thu.services）工具汇总',
  },
  {
    name: 'Learn-Project（浏览器扩展）',
    url: 'https://github.com/Harry-Chen/Learn-Helper',
    desc: '把网络学堂里散落的事项按时间线和类型重排，明确今天该交什么。',
    group: '网络学堂与 INFO',
    platforms: 'Chrome / Firefox / Edge 扩展',
    status: '活跃',
    access: '需代理',
    origin: 'thuservices（thu.services）工具汇总',
    note: '项目已从 xxr3376/Learn-Project 迁到 Harry-Chen/Learn-Helper',
  },
  {
    name: 'thu-learn-downloader',
    url: 'https://github.com/liblaf/thu-learn-downloader',
    desc: '批量下载网络学堂某门课的全部文件与作业，整理成目录，适合期末集中复习时一次性拉全。',
    group: '网络学堂与 INFO',
    platforms: 'Linux / macOS / Windows（Python）',
    status: '已停止',
    access: '需代理',
    origin: 'thuservices（thu.services）工具汇总',
    note: '上游写「可用」，但作者已在 2026-09 归档仓库 —— 现在仍能下载，出问题不会再有人修。边界：这是**把课件作业拉到本地**的工具，不含刷课时、不含批量提交；课程材料有版权，**下载只供自己复习**，不要再转发或上传到公开网盘',
  },
  {
    name: 'INFO 新闻 RSS（InfoTsinghuaRSS）',
    url: 'https://github.com/84634E1A607A/InfoTsinghuaRSS',
    desc: '把 INFO 的通知做成一枚 RSS，支持按栏目过滤（例如排除招聘信息），不用每天手动刷门户。',
    group: '网络学堂与 INFO',
    platforms: '自部署（Python）',
    status: '活跃',
    access: '需代理',
    origin: 'thuservices（thu.services）工具汇总',
    note: '公共实例需要校内 Git 身份登录；自己部署的话，令牌与密码只放在自己机器上',
  },
  {
    name: '网络学堂 / INFO 消息推送机器人',
    url: 'https://github.com/Konano/thu-weblearn-tgbot',
    desc: '把网络学堂与 INFO 的新通知推到 Telegram，适合已经用 Telegram 的人（另有 thu-info-forwarder 走别的通道）。',
    group: '网络学堂与 INFO',
    platforms: '自部署（Python）',
    status: '已停止',
    access: '需代理',
    origin: 'thuservices（thu.services）工具汇总',
    note: '仓库已在 2026-03 归档（archived），只作了解；要用请找仍在维护的替代品',
  },
  {
    name: 'Rain Classroom Helper（雨课堂增强）',
    url: 'https://github.com/RainEggplant/rain-classroom-helper',
    desc: '给 PC / 平板上的雨课堂学生端做界面增强，大屏上课时更好用。',
    group: '网络学堂与 INFO',
    platforms: '油猴脚本',
    status: '已停止',
    access: '需代理',
    origin: 'thuservices（thu.services）工具汇总',
    note: '仓库已于 2022-03 归档，只作了解',
  },

  // ── 生活小事 ────────────────────────────────────────────────
  {
    name: '全校洗衣机状态（THU Info 网页版）',
    url: 'https://app.cs.tsinghua.edu.cn/',
    desc: '出门前先看哪台洗衣机空着，少跑几趟楼道。官方小程序「自助智能校园」（主页下方「附近的洗衣机」）是更稳的入口。',
    group: '生活小事',
    platforms: '网页 / 微信小程序',
    status: '未核实',
    access: '公网',
    origin: 'thuservices（thu.services）工具汇总',
    note: '这个入口是否还在维护未核实；更稳的是微信小程序「自助智能校园」里的「附近的洗衣机」。早年那个 washer.thu.services 接口已废弃，社区旧教程与机器人多数失效',
  },
  {
    name: '寝室电费查询脚本（TsinghuaElectric）',
    url: 'https://github.com/WhymustIhaveaname/TsinghuaElectric',
    desc: '把寝室电费余额抓出来，可以配合监控做低余额提醒，免得半夜断电。',
    group: '生活小事',
    platforms: '命令行脚本',
    status: '不活跃',
    access: '需代理',
    origin: 'thuservices（thu.services）工具汇总',
    note: '这类脚本要填你自己的账号信息，**别把带密码的配置提交到公开仓库**',
  },
  {
    name: '随机选择食堂（小程序）',
    url: 'https://github.com/SuXY15/RandomCanteen',
    desc: '选择困难时的随机数发生器：转到哪个食堂就去哪个。',
    group: '生活小事',
    platforms: '微信小程序',
    status: '不活跃',
    access: '需代理',
    origin: 'thuservices（thu.services）工具汇总',
  },
  {
    name: '清华上下课铃声（macOS）',
    url: 'https://github.com/LyricZhao/THU-Bell',
    desc: '在电脑上放清华的上下课铃声，假期在家自习时找回一点氛围（也用来提醒自己按课表节奏走）。',
    group: '生活小事',
    platforms: 'macOS',
    status: '不活跃',
    access: '需代理',
    origin: 'thuservices（thu.services）工具汇总',
  },

  // ── 资料与云盘 ──────────────────────────────────────────────
  {
    name: '清华云盘批量下载助手（CLI）',
    url: 'https://github.com/chenyifanthu/THU-Cloud-Downloader',
    desc: '分享的文件过大时网页端不好下，这个命令行工具直接拉整个分享链接，支持带密码链接与按类型/文件夹过滤。',
    group: '资料与云盘',
    platforms: '命令行（Python）',
    status: '不活跃',
    access: '需代理',
    origin: 'thuservices（thu.services）工具汇总',
    note: '最后提交 2024-10，仍可用但不再迭代。**只下你有权访问的内容**；别人分享的课程材料不要二次分发',
  },
  {
    name: '清华云盘下载助手（浏览器脚本）',
    url: 'https://github.com/lixc21/Seafile-Sharing-Link-Downloader',
    desc: '同一个问题的轻量解：不用装 Python，在浏览器里从 seafile 分享链接批量下载。',
    group: '资料与云盘',
    platforms: '油猴脚本',
    status: '不活跃',
    access: '需代理',
    origin: 'thuservices（thu.services）工具汇总',
    note: '最后提交 2024-03；同类需求优先用上面那个下载量更大的命令行版本',
  },
  {
    name: '清华云盘桌面客户端（seafile）',
    url: 'https://seafile.com/download/',
    desc: '官方同步客户端。Linux 上装桌面客户端（发行版里的 seafile-client）而不是终端版（seafile）：终端版需要另一个独立密码，那个密码你拿不到。',
    group: '资料与云盘',
    platforms: 'Windows / macOS / Linux',
    status: '活跃',
    access: '公网',
    origin: 'thuservices（thu.services）服务指北',
  },

  // ── 社区与备份 ──────────────────────────────────────────────
  {
    name: '闭社 - 清华站',
    url: 'https://thu.closed.social/',
    desc: '清华的社区型站点（BBS 的后继形态之一），讨论偏校内生活与吐槽。',
    group: '社区与备份',
    platforms: '网页',
    status: '未核实',
    access: '公网',
    origin: 'thuservices（thu.services）常用校外网站',
  },
  {
    name: 'thuhole memories（精品洞合集）',
    url: 'https://github.com/pb0316/thuhole_memories',
    desc: '从树洞里挑出来的内容合集。树洞本身已停止服务，全量备份的仓库也已下架，这份合集是还能找到的少数入口之一。',
    group: '社区与备份',
    platforms: 'GitHub 仓库',
    status: '不活跃',
    access: '需代理',
    origin: 'thuservices（thu.services）工具汇总',
    note: '存档里可能仍含他人的具体信息。**看到具体的人和事，不要截图传播**',
  },
  {
    name: '在线退学（工具导航）',
    url: 'https://tuixue.online/',
    desc: '一个把清华各类学生工具与信息站收在一起的导航站，可以拿来交叉验证「还有哪些工具存在」。',
    group: '社区与备份',
    platforms: '网页',
    status: '未核实',
    access: '公网',
    origin: 'thuservices（thu.services）常用校外网站',
    note: '导航站的收录标准不由本站把关，点进去的每个工具都要自己判断',
  },

  // ── 科研与实践 ──────────────────────────────────────────────
  {
    name: '研究生社会实践系统增强插件',
    url: 'https://github.com/pioet/thshijian-extension',
    desc: '给研究生社会实践系统加内嵌侧边栏、已选人数查询、中签概率排序与提交历史。',
    group: '科研与实践',
    platforms: '浏览器扩展',
    status: '活跃',
    access: '需代理',
    origin: 'thuservices（thu.services）工具汇总',
  },
];

/** 按分类分组，供页面直接渲染 */
export function toolsByGroup() {
  return toolGroups
    .map((group) => ({ group, items: tools.filter((t) => t.group === group) }))
    .filter((g) => g.items.length > 0);
}
