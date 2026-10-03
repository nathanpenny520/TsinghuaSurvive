#!/usr/bin/env node
/**
 * 课程资料索引生成器
 * ============================================================
 * 本站不镜像任何课程资料，只做「哪门课、在哪个资料库、有什么类型的材料」的索引。
 * 这份索引不靠人肉整理，而是从 `reference/` 下的四个公开资料库里扫出来：
 *
 *   reference/REKCARC-TSC-UHT/            计算机系课程攻略（按学期分的课程目录）
 *   reference/WeiYangXueXi.github.io/     未央书院学习资料共享计划（mkdocs）
 *   reference/sast-skill-docs/            计算机系学生科协技能引导文档（mkdocs）
 *   reference/ssast-readme.github.io/     软件学院 ReadMe 互助文档（mkdocs）
 *
 * 用法：
 *   node scripts/build-course-index.mjs          # 重新生成 src/data/course-index.json
 *   node scripts/build-course-index.mjs --check  # 只校验现有 JSON，不重写（CI 用）
 *
 * ⚠️ `reference/` 是本地参考资料，不进仓库。生成结果 `src/data/course-index.json`
 *    要提交进仓库，这样构建和 CI 都不依赖这些大目录。
 *
 * ⚠️ 课程名里如果带老师姓名/昵称（例如「面向对象程序设计基础-刘知远老师」），
 *    一律在 NAME_OVERRIDES 里归一化成课程名 —— 本站不出现对具体老师的指向。
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

const ROOT = resolve(import.meta.dirname, '..');
const REF = join(ROOT, 'reference');
const OUT = join(ROOT, 'src/data/course-index.json');
const CHECK_ONLY = process.argv.includes('--check');

const warnings = [];
const warn = (msg) => warnings.push(msg);

// ── 资料库位置 ─────────────────────────────────────────────────────────

const ARCHIVES = {
  rekcarc: {
    dir: join(REF, 'REKCARC-TSC-UHT'),
    /** 顶层不是课程目录的条目 */
    skipNames: new Set([
      'LICENSE',
      'Makefile',
      'make.bat',
      'setup.py',
      'source',
      'site',
      'img',
      'README.md',
      '贡献方法.md',
      '参考书目.md',
      '收录内容.md',
    ]),
  },
  weiyang: {
    dir: join(REF, 'WeiYangXueXi.github.io'),
    nav: join(REF, 'WeiYangXueXi.github.io/mkdocs.yml'),
  },
  sast: {
    dir: join(REF, 'sast-skill-docs'),
    courseIndex: join(REF, 'sast-skill-docs/docs/courses/index.md'),
  },
  readme: {
    dir: join(REF, 'ssast-readme.github.io'),
    nav: join(REF, 'ssast-readme.github.io/mkdocs.yml'),
  },
};

/** 学期目录的展示顺序（REKCARC 的顶层目录名） */
const REKCARC_TERMS = [
  '大一上',
  '大一下',
  '大一小学期',
  '大二上',
  '大二下',
  '大二小学期',
  '大三上',
  '大三下',
  '大三小学期',
  '大四上',
  '大四下',
  '研究生',
];

/**
 * 课程名归一化：带老师姓名/昵称的目录合并回课程本身。
 * 只做「去掉人名」和「统一写法」两类改动，不改课程含义。
 */
const NAME_OVERRIDES = {
  '大学物理英-老毕': '大学物理（英文教学班）',
  '面向对象程序设计基础-刘知远老师': '面向对象程序设计基础',
  '面向对象程序设计基础-姚海龙老师': '面向对象程序设计基础',
  'Week_1-Qt': '程序设计训练·Qt 周',
  'Week_2-Socket': '程序设计训练·Socket 周',
  'Week_3-Python': '程序设计训练·Python 周',
  '2023-python课堂': 'Python 课堂（2023 小学期）',
  '贵系 Rust 小学期': 'Rust 程序设计（小学期）',
  计网: '计算机网络原理',
  软工: '软件工程',
  复变函数: '复变函数引论',
  形式与政策: '形势与政策',
  '微积分 A2': '微积分A(2)',
  '大学物理 B2': '大学物理B(2)',
  '数据结构 OJ 较难作业解析': '数据结构',
  推研机试整理: '推研机试资料',
  保研考试: '保研（推研）考试资料',
  reame: '小学期说明',
};

/** 资料类型识别规则：命中即归类，一个条目可以有多个类型 */
const KIND_RULES = [
  [/exam|期中|期末|往年|真题|试题|考卷|试卷|past[_-]?paper/i, '往年题'],
  [/cheat|A4|速查|开卷/i, '速查表'],
  [/ans(wer)?|solution|答案|解答|题解|参考解/i, '答案'],
  [/note|笔记|复习|提纲|总结|整理/i, '笔记'],
  [/hw|homework|作业|assignment|\bpa\d|lab\d/i, '作业'],
  [/大作业|课程设计|\bproject\b|proj\d/i, '大作业'],
  [/实验|lab\b|lab[_-]/i, '实验'],
  [/slide|课件|ppt|讲义|lecture|课堂/i, '课件'],
  [/book|教材|参考书|书目/i, '书目'],
  [/interview|面试|机试|保研|推研/i, '推研资料'],
];

function kindsOf(name) {
  const kinds = [];
  for (const [re, kind] of KIND_RULES) {
    if (re.test(name) && !kinds.includes(kind)) kinds.push(kind);
  }
  return kinds;
}

/** 统一课程名：去空白、统一括号、去掉人名后缀，用于合并不同资料库里的同一门课 */
function normalizeName(raw) {
  let name = raw.trim();
  if (NAME_OVERRIDES[name]) name = NAME_OVERRIDES[name];
  return name
    .replace(/[（(]\s*([0-9]+)\s*[)）]/g, '($1)')
    .replace(/\s+/g, '')
    .toLowerCase()
    .replace(/[（(]/g, '(')
    .replace(/[）)]/g, ')');
}

/** 展示用名字：保留原始写法（取第一次出现的），去掉文件名扩展名和结尾的老师标注 */
function displayName(raw) {
  let name = raw.trim().replace(/\.(md|pdf|pptx?|docx?|zip|txt)$/i, '');
  if (NAME_OVERRIDES[name]) name = NAME_OVERRIDES[name];
  return name.replace(/[-_—]\s*[\u4e00-\u9fa5]{1,4}(老师|教授)?$/, '').trim() || name;
}

// ── 课程分类 ───────────────────────────────────────────────────────────

const CATEGORY_RULES = [
  [/体育|运动|游泳|篮球|足球|排球|乒乓|羽毛|网球|健美|武术|田径|体育专项/, '体育'],
  [/英语|听说|读写|学术英语|日语|德语|法语|俄语|外语/, '外语'],
  [
    /马克思|思想政治|思想道德|法治|近现代史|党史|毛泽东|习近平|形势与政策|形式与政策|思政|自然辩证法|社会主义/,
    '思政',
  ],
  [
    /写作与沟通|写沟|大学语文|文学|导读|庄子|艺术|音乐|美术|哲学|历史|经济|管理|心理|社科|通识/,
    '通识与人文',
  ],
  [/化学|生物|有机|无机|物理化学|生化/, '化学与生物'],
  [/物理|力学|电磁|光学|量子|热学|统计力学|电动力学|相对论/, '物理'],
  [
    /微积分|线性代数|高等代数|几何|复变|数理方程|概率|统计|随机|数值|最优化|优化|拓扑|代数|数论|离散数学|泛函|常微分|数学实验|数学分析/,
    '数学',
  ],
  [
    /程序|计算|数据|算法|编译|操作系统|网络|数据库|软件|机器学习|人工智能|神经网络|图形|并行|体系结构|汇编|数字逻辑|电路|电子|信号|控制|自动化|密码|安全|存储|多媒体|图像|人机交互|虚拟现实|搜索引擎|形式语言|VLSI|嵌入式/,
    '计算机与信息',
  ],
];

function categoryOf(name) {
  for (const [re, category] of CATEGORY_RULES) {
    if (re.test(name)) return category;
  }
  return '其他';
}

const CATEGORY_ORDER = [
  '数学',
  '物理',
  '化学与生物',
  '计算机与信息',
  '思政',
  '外语',
  '通识与人文',
  '体育',
  '其他',
];

// ── 索引累加器 ─────────────────────────────────────────────────────────

/** key = normalizeName(name) */
const courses = new Map();

function addCourse(
  rawName,
  { archive, path, kinds = [], terms = [], books = [], files, topics, detail, label },
) {
  if (!rawName) return;
  const key = normalizeName(rawName);
  if (!key) return;

  let entry = courses.get(key);
  if (!entry) {
    entry = {
      name: displayName(rawName),
      category: categoryOf(rawName),
      terms: [],
      books: [],
      sources: [],
    };
    courses.set(key, entry);
  }

  for (const term of terms) {
    if (!entry.terms.includes(term)) entry.terms.push(term);
  }
  for (const book of books) {
    if (book && !entry.books.includes(book)) entry.books.push(book);
  }

  if (archive && path) {
    const existing = entry.sources.find((s) => s.archive === archive && s.path === path);
    if (existing) {
      for (const kind of kinds) if (!existing.kinds.includes(kind)) existing.kinds.push(kind);
    } else {
      const source = { archive, path, kinds: [...kinds] };
      if (label) source.label = label;
      if (files !== undefined) source.files = files;
      if (topics?.length) source.topics = topics;
      if (detail) source.detail = detail;
      entry.sources.push(source);
    }
  }
}

// ── 1) REKCARC：按学期目录扫课程文件夹 ─────────────────────────────────

function scanRekcarc() {
  const { dir, skipNames } = ARCHIVES.rekcarc;
  if (!existsSync(dir)) {
    warn('没有找到 reference/REKCARC-TSC-UHT，跳过计算机系课程攻略');
    return;
  }

  /** 统计一个课程目录里的文件数，并推断资料类型 */
  function inspect(courseDir) {
    let files = 0;
    const kinds = new Set();
    const walk = (current, depth) => {
      if (depth > 2) return;
      for (const name of readdirSync(current)) {
        const full = join(current, name);
        let isDir = false;
        try {
          isDir = statSync(full).isDirectory();
        } catch {
          continue;
        }
        if (isDir) {
          for (const kind of kindsOf(name)) kinds.add(kind);
          walk(full, depth + 1);
        } else {
          files += 1;
          for (const kind of kindsOf(name)) kinds.add(kind);
        }
      }
    };
    walk(courseDir, 0);
    return { files, kinds: [...kinds] };
  }

  for (const term of REKCARC_TERMS) {
    const termDir = join(dir, term);
    if (!existsSync(termDir)) continue;
    for (const name of readdirSync(termDir)) {
      if (skipNames.has(name)) continue;
      const full = join(termDir, name);
      if (!statSync(full).isDirectory()) continue; // 「分流面试回顾.md」这类单文件不是课程
      const { files, kinds } = inspect(full);
      addCourse(name, {
        archive: 'rekcarc',
        path: `${term}/${name}`,
        kinds: kinds.length ? kinds : ['课程资料'],
        terms: [term],
        files,
      });
    }
  }
}

// ── 2) REKCARC 参考书目 → 挂到对应课程上 ────────────────────────────────

function parseRekcarcBooks() {
  const file = join(ARCHIVES.rekcarc.dir, '参考书目.md');
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, 'utf8').split('\n');
  const out = [];
  let term = '';
  let course = '';
  let buffer = [];

  const flush = () => {
    const text = buffer.join(' ').replace(/\s+/g, ' ').trim();
    if (course && text) out.push({ term, course, text });
    buffer = [];
  };

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    const h3 = line.match(/^###\s+(.+?)\s*$/);
    if (h2) {
      flush();
      term = h2[1];
      course = '';
    } else if (h3) {
      flush();
      course = h3[1];
    } else if (course && line.trim() && !line.startsWith('[TOC]')) {
      buffer.push(line.trim());
    }
  }
  flush();
  return out;
}

// ── 3) mkdocs 导航（未央 / ReadMe）：按 nav 结构还原课程与资料路径 ────────

/** nav 递归展开：返回 [{title, path, trail}]，path 为空表示只是分组 */
function flattenNav(node, trail = []) {
  const out = [];
  if (node === null || node === undefined) return out;
  if (typeof node === 'string') {
    out.push({ title: trail[trail.length - 1] ?? node, path: node, trail });
    return out;
  }
  if (Array.isArray(node)) {
    for (const item of node) out.push(...flattenNav(item, trail));
    return out;
  }
  for (const [title, value] of Object.entries(node)) {
    out.push(...flattenNav(value, [...trail, title]));
  }
  return out;
}

function loadNav(file) {
  if (!existsSync(file)) {
    warn(`没有找到 ${file}，跳过对应的资料库`);
    return null;
  }
  const doc = parseYaml(readFileSync(file, 'utf8'));
  return flattenNav(doc?.nav ?? []);
}

/**
 * 未央：课程指引里是固定三层的 nav 结构
 *   课程指引 → (基础课 | 专业课 | 通识选修课) → [类别] → 课程 → [子页…]
 * 所以课程名在 trail 里的位置是固定的：基础课/专业课取第 4 个，通识选修课取第 3 个。
 */
function scanWeiyang() {
  if (!existsSync(ARCHIVES.weiyang.nav)) {
    warn('没有找到 reference/WeiYangXueXi.github.io/mkdocs.yml，跳过未央学习');
    return;
  }
  const entries = loadNav(ARCHIVES.weiyang.nav);
  if (!entries) return;

  for (const entry of entries) {
    if (entry.trail[0] !== '课程指引' || !entry.path?.startsWith('courses/')) continue;
    const segments = entry.path.split('/');
    const group = segments[1];
    if (!['basic', 'professional', 'general'].includes(group)) continue;

    // 课程目录：basic/<类别>/<课程> 或 general/<课程>
    const courseSegments = group === 'general' ? 3 : 4;
    if (segments.length <= courseSegments) continue; // courses/index.md 这种介绍页

    const titleIndex = group === 'general' ? 2 : 3;
    const courseTitle = entry.trail[titleIndex];
    if (!courseTitle) continue;

    const kinds = kindsOf(`${courseTitle} ${entry.path}`);
    if (/hw_ans|\/ans(\/|$)/.test(entry.path)) kinds.push('答案');
    addCourse(courseTitle, {
      archive: 'weiyang',
      path: segments.slice(0, courseSegments).join('/'),
      kinds: kinds.length ? [...new Set(kinds)] : ['课程资料'],
      // nav 里的叶子标题（「作业答案」「Python 程序设计笔记」）比路径末段好读
      label: entry.trail[entry.trail.length - 1],
    });
  }

  // 选课指南的类别页单独进「选课指南」，不混进课程索引
  for (const entry of entries) {
    if (entry.trail[0] !== '选课指南' || !entry.path) continue;
    if (!/^course_selection\/[^/]+\/index\.md$/.test(entry.path)) continue;
    addCourse(`${entry.trail[1]}（选课指南）`, {
      archive: 'weiyang',
      path: entry.path.replace(/\/index\.md$/, ''),
      kinds: ['选课指南'],
      detail: '按课程类别整理的选课建议',
    });
  }
}

/** ReadMe：nav 结构是 板块 → 课程 → 文档，课程名固定在 trail 第 2 个位置 */
function scanReadme() {
  if (!existsSync(ARCHIVES.readme.nav)) {
    warn('没有找到 reference/ssast-readme.github.io/mkdocs.yml，跳过 ReadMe 互助文档');
    return;
  }
  const entries = loadNav(ARCHIVES.readme.nav);
  if (!entries) return;

  const SECTIONS = { 课程笔记: 'note/', 作业攻略: 'homework/' };

  for (const [section, prefix] of Object.entries(SECTIONS)) {
    for (const entry of entries) {
      if (entry.trail[0] !== section || !entry.path?.startsWith(prefix)) continue;
      // 板块下的散页（note/other.md、homework/homework.md）不是课程
      if (entry.path.split('/').length < 3) continue;
      const courseTitle = entry.trail[1];
      if (!courseTitle || courseTitle === '介绍') continue;

      let kinds = kindsOf(`${courseTitle} ${entry.path}`);
      if (section === '课程笔记') kinds = kinds.length ? kinds : ['笔记'];
      if (section === '作业攻略') kinds = [...new Set(['作业', ...kinds])];

      addCourse(courseTitle, {
        archive: 'readme',
        path: entry.path.replace(/\.md$/, ''),
        kinds,
        label: entry.trail[entry.trail.length - 1],
      });
    }
  }
}

/** SAST：课程指引（课程 → 相关入门文档，只有标题没有独立页面） */
function scanSast() {
  const file = ARCHIVES.sast.courseIndex;
  if (!existsSync(file)) {
    warn('没有找到 reference/sast-skill-docs/docs/courses/index.md，跳过技能引导文档的课程指引');
    return;
  }
  const lines = readFileSync(file, 'utf8').split('\n');
  let course = '';
  let topics = [];
  const flush = () => {
    if (!course) return;
    const title = course.replace(/（[^）]*）/g, '').trim();
    addCourse(title, {
      archive: 'sast',
      path: 'courses',
      kinds: ['入门文档'],
      topics: [...topics],
      detail: '技能引导文档里与这门课相关的入门章节',
    });
    topics = [];
  };
  for (const line of lines) {
    const h3 = line.match(/^###\s+(.+?)\s*$/);
    const bullet = line.match(/^[-*]\s+(.+?)\s*$/);
    if (h3) {
      flush();
      course = h3[1];
    } else if (bullet && course) {
      topics.push(bullet[1]);
    }
  }
  flush();
}

// ── 组装输出 ───────────────────────────────────────────────────────────

scanRekcarc();
scanWeiyang();
scanReadme();
scanSast();

for (const { term, course, text } of parseRekcarcBooks()) {
  const key = normalizeName(course);
  let entry = courses.get(key);
  if (!entry) {
    // 参考书目里有、但资料库里没有对应目录的课（例如「汇编语言程序设计」）：
    // 依然建一条，只有书目没有资料链接 —— 对选课的人来说书目本身就是信息。
    const name = displayName(course);
    entry = { name, category: categoryOf(name), terms: [], books: [], sources: [] };
    courses.set(key, entry);
  }
  if (text && !entry.books.includes(text)) entry.books.push(text);
  if (term && REKCARC_TERMS.includes(term) && !entry.terms.includes(term)) entry.terms.push(term);
}

const list = [...courses.values()].map((entry) => ({
  ...entry,
  terms: entry.terms.sort(
    (a, b) => REKCARC_TERMS.indexOf(a) - REKCARC_TERMS.indexOf(b) || a.localeCompare(b),
  ),
  sources: entry.sources.sort((a, b) => a.archive.localeCompare(b.archive) || a.path.localeCompare(b.path)),
}));

list.sort((a, b) => {
  const byCategory = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
  if (byCategory !== 0) return byCategory;
  return a.name.localeCompare(b.name, 'zh-Hans-CN');
});

const payload = {
  $comment:
    '由 scripts/build-course-index.mjs 从 reference/ 下的公开资料库生成，请勿手工编辑。重新生成：node scripts/build-course-index.mjs',
  categories: CATEGORY_ORDER.filter((c) => list.some((course) => course.category === c)),
  courses: list,
};

const json = `${JSON.stringify(payload, null, 2)}\n`;

if (CHECK_ONLY) {
  // CI 和别人的机器上通常没有 reference/ 这些大目录，这时没法比对 —— 跳过而不是报错
  const inputsPresent = Object.values(ARCHIVES).some((archive) => existsSync(archive.dir));
  if (!inputsPresent) {
    console.log('○ 没有找到 reference/ 下的资料库，跳过课程索引一致性校验（需要在本地先克隆）');
    process.exit(0);
  }
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (current !== json) {
    console.error('✖ src/data/course-index.json 与 reference/ 里的资料库不一致，请重新生成');
    process.exit(1);
  }
  console.log(`✔ 课程索引与资料来源一致（${list.length} 门课）`);
} else {
  writeFileSync(OUT, json);
  const sourceCount = list.reduce((sum, c) => sum + c.sources.length, 0);
  const byArchive = {};
  for (const course of list) {
    for (const source of course.sources) {
      byArchive[source.archive] = (byArchive[source.archive] ?? 0) + 1;
    }
  }
  console.log(`✔ 写入 ${OUT}`);
  console.log(`  课程 ${list.length} 门，资料条目 ${sourceCount} 条`);
  console.log(`  按资料库：${Object.entries(byArchive).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  const withBooks = list.filter((c) => c.books.length).length;
  console.log(`  有参考书目的课程：${withBooks} 门`);
}

if (warnings.length) {
  console.log('\n提示：');
  for (const w of warnings) console.log(`  · ${w}`);
}
