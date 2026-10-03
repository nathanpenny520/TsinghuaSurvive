/**
 * 校内常用链接 —— 结构化数据，改这一个文件就能更新页面。
 *
 * ## 关于两个日期字段
 * - `checkedAt` 由 `npm run check:links` 自动写入 `link-status.json`，
 *   表示**这个网址实测能打开**的日期（校外网络，脚本跑的）。
 *   它只证明「域名活着」，不证明「入口还是干这件事」。
 * - `reviewedAt` 是**核对日期**：确认过「这个入口现在还是干这件事」的日子。
 *   没填的条目页面上会显示「核对：待补」角标 —— 网址会迁移，这一步不能省。
 * - `verifiedBy` 说明这次核对是**谁做的**：
 *     `'human'`（默认）＝有人点开看过，页面显示「人工核对」；
 *     `'auto'`        ＝`npm run verify:links` 抓页面比对标题与关键词得出的结论，
 *                       页面显示「脚本核对」，证据留在 `.review/link-verification.json`。
 *   两者不是一个可信度级别：脚本只能确认「地址还指向那个服务」，确认不了登录后的功能。
 *
 * ## 关于 `reach`
 * - `校园网`：校内系统，需要在校园网内或连 WebVPN 才能正常使用。
 * - `公网`：校内外都能打开。
 * - `未实测`：还没确认过，页面会照实标出来。
 *
 * ## 关于 `origin`
 * 记这条链接是从哪来的（官方站 / 维护者收藏夹 / 某个资料库），
 * 方便以后有人追查「这条是不是抄来的」。
 */

export type Reach = '校园网' | '公网' | '未实测';

export type CampusLink = {
  /** 显示名称 */
  name: string;
  /** 完整网址 */
  url: string;
  /** 一句话说明它到底能干什么 */
  desc: string;
  /** 分类 */
  group: LinkGroup;
  /** 可达性 */
  reach: Reach;
  /** 核对日期；不填表示还没核对过 */
  reviewedAt?: string;
  /** 谁来核对的：'human' 人工点开（默认）/ 'auto' 脚本抓页面比对；不填按人工处理 */
  verifiedBy?: 'human' | 'auto';
  /** 来源 */
  origin?: string;
  /** 需要额外提醒的事（比如「要先开 WebVPN」） */
  note?: string;
  /**
   * 该站对**非浏览器请求**返回反爬状态码（如 412），所以 `npm run check:links`
   * 一定测不过，页面上会显示「脚本被拦」而不是「实测打不开」。
   * 设了这个字段就**必须**有 reviewedAt：说「浏览器里正常」是一次人工判断，不能是猜的。
   * 目前只有 cet-bm.neea.edu.cn 需要（WAF 返回 412）。
   */
  scriptBlocked?: boolean;
};

export type LinkGroup =
  | '教学与选课'
  | '信息与账号'
  | '图书馆与科研'
  | '办事与生活'
  | '校内平台与 AI'
  | '成长与出路'
  | '官方与资讯';

export const linkGroups: LinkGroup[] = [
  '教学与选课',
  '信息与账号',
  '图书馆与科研',
  '办事与生活',
  '校内平台与 AI',
  '成长与出路',
  '官方与资讯',
];

export const campusLinks: CampusLink[] = [
  // ── 教学与选课 ──────────────────────────────────────────────
  {
    name: '教学门户（选课 / 成绩 / 培养方案）',
    url: 'https://zhjw.cic.tsinghua.edu.cn/',
    desc: '选课、查成绩、看培养方案和学籍信息的入口。开学前先把这里摸熟。',
    group: '教学与选课',
    reach: '校园网',
    origin: '学校官方',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '本科生选课系统',
    url: 'https://zhjwxk.cic.tsinghua.edu.cn/',
    desc: '选课季直接进这一台。选课轮次、退课与补选的时间节点以教务通知为准。',
    group: '教学与选课',
    reach: '校园网',
    origin: '维护者收藏夹',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '网络学堂',
    url: 'https://learn.tsinghua.edu.cn/f/wlxt/index/course/student/',
    desc: '课程通知、课件下载、作业提交、讨论区。开学第一周就要摸熟。',
    group: '教学与选课',
    reach: '校园网',
    origin: '学校官方',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '雨课堂',
    url: 'https://www.yuketang.cn/',
    desc: '不少课用它点名、发课件、随堂测验。手机端用得更多。',
    group: '教学与选课',
    reach: '公网',
    origin: '维护者收藏夹',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '第二成绩单',
    url: 'https://transcript.student.tsinghua.edu.cn/',
    desc: '记录课外经历与能力的官方系统（社工、志愿、竞赛等），保研和求职时用得上。',
    group: '教学与选课',
    reach: '校园网',
    origin: '维护者收藏夹',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '思政实践选课',
    url: 'https://szsj.tsinghua.edu.cn/',
    desc: '思政实践类课程的选课与记录入口。具体开课与要求以院系通知为准。',
    group: '教学与选课',
    reach: '校园网',
    origin: '维护者收藏夹',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '四六级报名（CET）',
    url: 'https://cet-bm.neea.edu.cn/',
    desc: '全国大学英语四六级考试的报名入口。免修英语、毕业审核和部分交流项目会看这个成绩，**报名窗口很短**，别等通知转几手才想起来。',
    group: '教学与选课',
    reach: '公网',
    note: '报名与缴费时间以官方通知为准',
    origin: '维护者收藏夹',
    scriptBlocked: true,
    // 由站点维护者人工确认（2026-09-30）：该站首页返回一个 412 状态、410 字节的空壳，标题和正文都是空的，
    // 真正的内容由页内 AJAX 去 resource.neea.edu.cn 取回来再注入 #mbox；这导致
    // `npm run verify:links` 抓不到任何佐证、按设计拒绝写回（结论见 .review/link-verification.json），
    // 所以这条的核对方式是 human 而不是 auto —— 两者在页面上是两个不同的可信度级别，别混。
    reviewedAt: '2026-09-30',
    verifiedBy: 'human',
  },
  {
    name: '四六级成绩查询',
    url: 'https://cjcx.neea.edu.cn/',
    desc: '查历次四六级成绩。需要成绩证明时也在这里办，不用回头翻旧截图。',
    group: '教学与选课',
    reach: '公网',
    origin: '维护者收藏夹',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: 'courseX（课程信息共享计划）',
    url: 'https://tsinghua.app/courses',
    desc: '按学期整理的课程信息共享站，能看到某门课在往年学期的开课情况与基本信息。**课程索引回答「资料在哪」，它回答「这门课什么时候开过」**，两者互补。',
    group: '教学与选课',
    reach: '公网',
    note: '学生自建，非学校官方；信息按学期更新，以教学门户和院系通知为准',
    origin: '维护者提供的资料',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },

  // ── 信息与账号 ──────────────────────────────────────────────
  {
    name: '信息门户（info）',
    url: 'https://info.tsinghua.edu.cn/',
    desc: '校内各类系统的总入口：通知、办事、财务、宿舍、一卡通等。找不到入口就来这里翻。',
    group: '信息与账号',
    reach: '校园网',
    origin: '学校官方',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '清华邮箱',
    url: 'https://mails.tsinghua.edu.cn/',
    desc: '学校官方邮件。联系导师、投稿、申请材料都用它，务必每天看。',
    group: '信息与账号',
    reach: '公网',
    origin: '学校官方',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '电子身份服务系统（id）',
    url: 'https://id.tsinghua.edu.cn/f/welcome',
    desc: '账号、密码、二次验证都在这里管。**忘记密码或换手机时第一时间来这里。**',
    group: '信息与账号',
    reach: '校园网',
    note: '改密码、绑手机要靠它，建议开学就记下这个入口',
    origin: '维护者收藏夹',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '清华云盘',
    url: 'https://cloud.tsinghua.edu.cn/',
    desc: '校内网盘，课程资料与共享目录常用它。分享链接的访问范围由分享者设定。',
    group: '信息与账号',
    reach: '校园网',
    origin: '维护者收藏夹',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '信息化用户服务平台',
    url: 'https://its.tsinghua.edu.cn/',
    desc: '网络、账号、正版软件、报修这类问题的官方服务入口。',
    group: '信息与账号',
    reach: '校园网',
    origin: '维护者收藏夹',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '校园网自助服务系统（802.1X 密码）',
    url: 'https://usereg.tsinghua.edu.cn/',
    desc: '校园网账号的自服务入口：注册/修改 802.1X 密码、看在线设备与流量。连不上无线网先来这里。',
    group: '信息与账号',
    reach: '公网',
    note: '连不上校园网时也能打开（用手机流量）——所以它是排查网络问题的第一站',
    origin: '资料库（ReadMe 互助文档）',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: 'WebVPN',
    url: 'https://webvpn.tsinghua.edu.cn/',
    desc: '在校外访问校内系统用。**先把这一条存下来**，不然放假回家会抓瞎。',
    group: '信息与账号',
    reach: '公网',
    origin: '维护者收藏夹',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: 'eduroam（校外漫游上网）',
    url: 'https://eduroam.tsinghua.edu.cn/',
    desc: '注册后在别的学校（含海外高校）也能自动连上无线网，不用每次找访客账号。校内还是连校园网，用不到它。',
    group: '信息与账号',
    reach: '公网',
    note: '应急场景最有用：去外校开会、交换、访学时先注册好',
    origin: 'thuservices（thu.services）信息汇总',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '校友邮箱（毕业后仍可用）',
    url: 'https://mailservice.tsinghua.org.cn/',
    desc: '毕业前在这里激活，可以得到 abbr@tsinghua.org.cn 的校友邮箱。离校后再激活会麻烦得多，毕业季顺手做掉。',
    group: '信息与账号',
    reach: '公网',
    note: '激活入口会跳到电子身份服务系统登录，属于正常流程',
    origin: 'thuservices（thu.services）信息汇总',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '校园网认证入口（官方工具 Tunet）',
    url: 'https://login.tsinghua.edu.cn/',
    desc: '官方认证工具与认证页入口，替代了旧的 Tunet-2018。无人值守的服务器、Linux 机器另有命令行认证方案，见「校园网进阶」那一页。',
    group: '信息与账号',
    reach: '校园网',
    note: '2024 年末认证系统升级过一轮，本页之外的第三方工具可用性要以各自项目页为准',
    origin: 'thuservices（thu.services）信息汇总',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },

  // ── 图书馆与科研 ────────────────────────────────────────────
  {
    name: 'Abook（高教社教材配套资源）',
    url: 'https://abook.hep.com.cn/',
    desc: '高等教育出版社教材的配套数字课程与资源。用统编教材的课，这里常有习题解答和拓展材料。',
    group: '图书馆与科研',
    reach: '公网',
    note: '需要自己注册；只有高教社的教材能在上面找到',
    origin: '维护者收藏夹',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '清华大学图书馆',
    url: 'https://lib.tsinghua.edu.cn/',
    desc: '馆藏检索、数据库入口、座位预约、文献传递。写论文的起点。',
    group: '图书馆与科研',
    reach: '公网',
    origin: '学校官方',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '数据库导航',
    url: 'https://ecollection.lib.tsinghua.edu.cn/databasenav/entrance/databaseNav',
    desc: '按学科找数据库。**从校内入口进才有订阅权限**，校外走 WebVPN。',
    group: '图书馆与科研',
    reach: '校园网',
    origin: '维护者收藏夹',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '电子期刊导航',
    url: 'https://ecollection.lib.tsinghua.edu.cn/journalnav/home',
    desc: '按刊名或学科定位期刊，看某本刊学校有没有订阅。',
    group: '图书馆与科研',
    reach: '校园网',
    origin: '维护者收藏夹',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '乐学工作坊资料',
    url: 'https://workshop.learning.tsinghua.edu.cn/web/index.php/materials/index',
    desc: '学业指导类讲座资料：学业规划、时间管理、受挫之后怎么办、推研面试准备。',
    group: '图书馆与科研',
    reach: '校园网',
    origin: '资料库（未央学习）',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '校内 Overleaf（在线 LaTeX）',
    url: 'https://overleaf.tsinghua.edu.cn/',
    desc: '学校提供的 Overleaf 服务，多人协作写报告很方便。用校内账号登录。',
    group: '图书馆与科研',
    reach: '校园网',
    origin: '维护者收藏夹',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '校内 GitLab',
    url: 'https://git.tsinghua.edu.cn/',
    desc: '校内代码托管平台。几个课程攻略库在这里都有镜像，**校园网内比 GitHub 快得多**。',
    group: '图书馆与科研',
    reach: '校园网',
    origin: '维护者收藏夹',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '开源软件镜像站（TUNA）',
    url: 'https://mirrors.tuna.tsinghua.edu.cn/',
    desc: '装 Python / Node / Linux 发行版时把源换成它，下载速度差一个数量级。',
    group: '图书馆与科研',
    reach: '公网',
    origin: '维护者收藏夹',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: 'Tsinghua Online Judge',
    url: 'https://dsa.cs.tsinghua.edu.cn/oj/',
    desc: '数据结构等课程可能用到的判题平台。课程要求以任课教师说明为准。',
    group: '图书馆与科研',
    reach: '公网',
    origin: '维护者收藏夹',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '教参服务平台（课程教材电子版）',
    url: 'https://ereserves.lib.tsinghua.edu.cn/',
    desc: '清华大学电子教学参考书服务平台：在版权允许的范围内提供课程教材与教参的扫描电子版。**教材太贵、图书馆只有两三本时，先来这里搜。**',
    group: '图书馆与科研',
    reach: '校园网',
    note: '校外要先连 WebVPN；平台上没有的书，可以按图书馆页面上的方式申请扫描',
    origin: 'thuservices（thu.services）信息汇总',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '文泉学堂（清华社电子图书）',
    url: 'https://lib-tsinghua.wqxuetang.com/',
    desc: '清华大学出版社的电子教材库，用统编教材的课常能在这里找到原书。**从校内入口进才有订阅权限。**',
    group: '图书馆与科研',
    reach: '校园网',
    note: '校外走 WebVPN；不要用第三方「下载器」批量搬运，那类脚本会绕过版权限制',
    origin: 'thuservices（thu.services）信息汇总',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: 'LibGuides（学科资源指南）',
    url: 'https://tsinghua.cn.libguides.com/',
    desc: '图书馆按学科做的资源导航：这个方向该用哪些数据库、哪些工具书。写综述找文献时比盲搜省时间。',
    group: '图书馆与科研',
    reach: '公网',
    origin: 'thuservices（thu.services）信息汇总',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },

  // ── 办事与生活 ──────────────────────────────────────────────
  {
    name: '在线服务系统（thos）',
    url: 'https://thos.tsinghua.edu.cn/',
    desc: '各类线上办事表单的入口：证明开具、场地申请、审批流程等。',
    group: '办事与生活',
    reach: '校园网',
    origin: '维护者收藏夹',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '学生活动申请平台',
    url: 'https://oa.student.tsinghua.edu.cn/',
    desc: '班级、社团办活动要走的手续入口。办活动前先来看需要哪些材料。',
    group: '办事与生活',
    reach: '校园网',
    origin: '维护者收藏夹',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '学生清华',
    url: 'https://student.tsinghua.edu.cn/',
    desc: '学生工作相关的信息与服务入口。',
    group: '办事与生活',
    reach: '校园网',
    origin: '维护者收藏夹',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '场馆预约（体育）',
    url: 'https://www.sports.tsinghua.edu.cn/venue/',
    desc: '体育馆、游泳馆、球场等场馆的预约入口。热门时段要提前抢。',
    group: '办事与生活',
    reach: '校园网',
    origin: '维护者收藏夹',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '奖学金申请',
    url: 'https://sa.tsinghua.edu.cn/',
    desc: '奖学金、助学金相关的申请与评审入口。**时间和材料要求以当年通知为准。**',
    group: '办事与生活',
    reach: '校园网',
    origin: '维护者收藏夹',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '后勤综合服务平台',
    url: 'https://pt.tsinghua.edu.cn/',
    desc: '网上报修、校医院各科室挂号、校内各单位电话、动态校园地图、客房与订车服务都在这里。**宿舍东西坏了的第一站。**',
    group: '办事与生活',
    reach: '校园网',
    note: '报修和挂号通常需要登录，具体流程以平台内说明为准',
    origin: 'thuservices（thu.services）信息汇总',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '紫荆码（网页版）',
    url: 'https://zijing.tsinghua.edu.cn/tp_jp/h6?m=jp',
    desc: '不依赖微信打开紫荆码：首次登录后再刷新一次页面即可显示。手机里可以「添加到主屏幕」当快捷方式。',
    group: '办事与生活',
    reach: '校园网',
    note: '这种方式下「地点扫码」不能用；需要扫码的场合还是走微信里的官方入口',
    origin: 'thuservices（thu.services）信息汇总',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '校园卡系统（新版）',
    url: 'https://card.tsinghua.edu.cn/',
    desc: '新版校园卡的综合服务网站：充值、挂失解挂、密码修改、流水查询。微信小程序「清华校园卡」是同源入口，手机上更方便。',
    group: '办事与生活',
    reach: '校园网',
    note: '旧的 ecard.tsinghua.edu.cn 已经解析不到了（实测 2026-10-03），别再用旧链接',
    origin: 'thuservices（thu.services）信息汇总',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '虚拟仿真教学资源平台（VR）',
    url: 'https://vr.tsinghua.edu.cn/',
    desc: '校内虚拟仿真实验与教学资源入口，部分课程会指定在上面做实验；也有公共教室的 VR 导览，找教室时用得上。',
    group: '办事与生活',
    reach: '校园网',
    origin: 'thuservices（thu.services）信息汇总',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '校园交通与校车路线',
    url: 'https://www.tsinghua.edu.cn/zjqh/syxx/xyjt.htm',
    desc: '校内校车路线图与实时运行查询方式。**住在南区、双清或要去东门外时，先看一趟车的时间。**',
    group: '办事与生活',
    reach: '公网',
    origin: 'thuservices（thu.services）信息汇总',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },

  // ── 校内平台与 AI ───────────────────────────────────────────
  {
    name: '清华 AI 素养学习中心',
    url: 'https://yuketang.tsinghua.edu.cn/ai/learning-center',
    desc: '学校的人工智能素养课程入口（雨课堂平台）。想系统了解 AI 从这开始。',
    group: '校内平台与 AI',
    reach: '校园网',
    origin: '维护者收藏夹',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: 'MAIC：自适应课堂',
    url: 'https://www.maic.tsinghua.edu.cn/',
    desc: '校内 AI 辅助教学平台，部分课程会用到。是否使用以任课教师安排为准。',
    group: '校内平台与 AI',
    reach: '校园网',
    origin: '维护者收藏夹',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '校内大模型服务入口',
    url: 'https://madmodel.cs.tsinghua.edu.cn/',
    desc: '校内提供的大模型服务入口。**用之前先看清课程对 AI 工具的规定。**',
    group: '校内平台与 AI',
    reach: '校园网',
    note: '账号与可用范围以官方说明为准',
    origin: '维护者收藏夹',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '清华常用信息汇总（第三方）',
    url: 'https://thu.services/',
    desc: '学生做的信息汇总站，把各类校内入口和服务按主题整理在一起，可作为交叉验证。',
    group: '校内平台与 AI',
    reach: '未实测',
    note: '第三方站点，不是学校官方，信息可能滞后',
    origin: '维护者收藏夹',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },

  // ── 成长与出路 ──────────────────────────────────────────────
  {
    name: '托福（TOEFL）报名',
    url: 'https://www.toefl.cn/',
    desc: '出国申请的语言考试报名入口。考位要提前抢，**备考期和期末撞车是最常见的安排失误**。',
    group: '成长与出路',
    reach: '公网',
    origin: '维护者收藏夹',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: 'GRE 报名',
    url: 'https://takethegre.cn/',
    desc: '北美研究生入学考试的报名入口。不是所有项目都要，**先确认目标项目的要求再决定考不考**。',
    group: '成长与出路',
    reach: '公网',
    origin: '维护者收藏夹',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: 'WYAST（未央科协学生站）',
    url: 'https://wyast.github.io/',
    desc: '学生自建的资讯、教程与学习资源站，偏工科方向。可以看看同龄人在学什么。',
    group: '成长与出路',
    reach: '未实测',
    note: '学生自建，不是学校官方；内容按届更新，别当制度依据',
    origin: '维护者收藏夹',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: 'Advice Hub（学业建议）',
    url: 'https://liuyifan22.github.io/advice/',
    desc: '学生整理的学业建议：怎么规划学期、怎么选方向、踩过哪些坑。和本站同类，可以对照着看。',
    group: '成长与出路',
    reach: '未实测',
    note: '学生自建，不是学校官方；经验贴不能替代官方规定',
    origin: '维护者收藏夹',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '清华大学就业信息网',
    url: 'https://career.tsinghua.edu.cn/',
    desc: '实习与校招信息、宣讲会日程、职业发展中心的服务入口。',
    group: '成长与出路',
    reach: '公网',
    origin: '学校官方',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '学信网',
    url: 'https://www.chsi.com.cn/',
    desc: '学籍学历查询与在线验证报告。出国、求职、办手续时常被要求提供。',
    group: '成长与出路',
    reach: '公网',
    origin: '维护者收藏夹',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '清华大学飞跃数据库（推研 / 出国案例库）',
    url: 'https://database.feiyue.online/',
    desc: '学生整理的经验案例库：按案例、专业、方向、项目组织，能看到别人申请什么、什么背景、走到哪一步。**想了解"这条路真实长什么样"时，先看案例，再谈规划。**',
    group: '成长与出路',
    reach: '公网',
    note: '学生自建，非学校官方；案例是个体经验，不能替代当年官方通知',
    origin: '维护者提供的资料',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '北京共青团',
    url: 'https://www.bjyouth.net/',
    desc: '团员注册、志愿项目与团组织关系相关的系统。团支书会经常用。',
    group: '成长与出路',
    reach: '公网',
    origin: '维护者收藏夹',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '清华大学本科招生网',
    url: 'https://www.join-tsinghua.edu.cn/',
    desc: '招生政策与院系介绍。给还在高中的学弟学妹转发时用得上。',
    group: '成长与出路',
    reach: '公网',
    origin: '维护者收藏夹',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },

  // ── 官方与资讯 ──────────────────────────────────────────────
  {
    name: '清华大学官网',
    url: 'https://www.tsinghua.edu.cn/',
    desc: '学校层面的新闻、通知、机构与院系导航。',
    group: '官方与资讯',
    reach: '公网',
    origin: '学校官方',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '清华大学新闻网',
    url: 'https://news.tsinghua.edu.cn/',
    desc: '校内新闻与人物报道，找「学校最近在发生什么」时看这里。',
    group: '官方与资讯',
    reach: '公网',
    origin: '学校官方',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '院系设置',
    url: 'https://www.tsinghua.edu.cn/yxsz.htm',
    desc: '全校院系一览，顺着能找到各院系官网与教师主页。找信息时的第一条线索。',
    group: '官方与资讯',
    reach: '公网',
    origin: '维护者收藏夹',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '未央书院官网（院系官网的样子）',
    url: 'https://www.wyc.tsinghua.edu.cn/index.htm',
    desc: '这里放一个书院官网当例子，重点不是它本身：**培养方案的细节、选课限制、替代与免修，第一站应该是你自己院系的官网和教务**，而不是任何第三方文档（包括本站）。',
    group: '官方与资讯',
    reach: '公网',
    note: '每个院系都有自己的官网，从「院系设置」进',
    origin: '维护者收藏夹',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '视觉形象识别系统（官方模板）',
    url: 'https://vi.tsinghua.edu.cn/',
    desc: '官方 PPT 模板、校徽与配色规范。做汇报、做海报时别自己乱拼一个。',
    group: '官方与资讯',
    reach: '校园网',
    origin: '维护者收藏夹',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
  {
    name: '中国知网（CNKI）',
    url: 'https://www.cnki.net/',
    desc: '中文学术文献检索。**全文下载要走图书馆的订阅入口，直接打开是要付费的。**',
    group: '官方与资讯',
    reach: '公网',
    note: '校外访问全文请走图书馆数据库导航，别自己买',
    origin: '维护者收藏夹',
    reviewedAt: '2026-10-03',
    verifiedBy: 'auto',
  },
];

/** 按分类分组，供页面直接渲染 */
export function linksByGroup() {
  return linkGroups
    .map((group) => ({ group, items: campusLinks.filter((l) => l.group === group) }))
    .filter((g) => g.items.length > 0);
}
