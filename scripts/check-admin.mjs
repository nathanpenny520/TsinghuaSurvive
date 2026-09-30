#!/usr/bin/env node
/**
 * 后台配置校验 —— 防止「后台悄悄丢字段」和「占位符忘了换」这两类事故。
 *
 * 为什么需要它：
 *   1. Sveltia CMS 保存一篇文章时，只会写回**配置里声明过的字段**。配置漏了一个字段
 *      （比如某篇文章有 sidebar.hidden，而配置里只声明了 sidebar.order），作者在后台点一次
 *      保存，那个字段就没了 —— 页面上什么都不报错，只是行为变了。这类「静默丢数据」
 *      必须在 CI 里拦住。
 *   2. R2 的 access_key_id / public_url 是占位符时，后台能改文字但传不了图。
 *      占位符不阻断部署（跟 check-content 对占位符的态度一致），但必须显式提醒。
 *
 * 用法：
 *   npm run check:admin              普通模式：字段丢失=错误，占位符=警告
 *   npm run check:admin -- --strict  严格模式：警告也当错误（发布前用）
 *
 * 它与 src/content.config.ts 的分工：zod 校验 frontmatter 的**类型**，
 * 这里校验「后台配置能不能无损地编辑这些 frontmatter」。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { parse as parseYaml } from 'yaml';
import Ajv from 'ajv';

const ROOT = resolve(import.meta.dirname, '..');
const CONFIG = join(ROOT, 'public/admin/config.yml');
const ADMIN_HTML = join(ROOT, 'public/admin/index.html');
const DOCS_DIR = join(ROOT, 'src/content/docs');
const CMS_PACKAGE = '@sveltia/cms';

/**
 * 读 wrangler 的 jsonc（允许 // 与 /* *​/ 注释）。
 * 刻意不用 YAML 解析器凑合：JSON 的子集在 YAML 里不是同一个语法，会解析失败或读出意外结构。
 * 这里只处理我们自己的文件，规则简单：去掉注释（跳过字符串内部），再交给 JSON.parse。
 */
function parseJsonc(raw) {
  let out = '';
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    const next = raw[i + 1];

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
        out += char;
      }
      continue;
    }
    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      out += char;
      if (char === '\\') {
        out += next ?? '';
        i += 1;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }
    out += char;
  }
  return JSON.parse(out);
}

const strict = process.argv.includes('--strict');
const annotate = Boolean(process.env.GITHUB_ACTIONS) || process.argv.includes('--annotate');

const findings = [];
const error = (message, file, hint) => findings.push({ level: 'error', message, file, hint });
const warn = (message, file, hint) => findings.push({ level: 'warn', message, file, hint });

// ── 读取配置 ───────────────────────────────────────────────────────────

if (!existsSync(CONFIG)) {
  console.error('✖ 找不到 public/admin/config.yml —— 站内后台的配置文件丢了。');
  process.exit(1);
}

let config;
try {
  config = parseYaml(readFileSync(CONFIG, 'utf8'));
} catch (err) {
  console.error(`✖ public/admin/config.yml 不是合法 YAML：${err.message}`);
  process.exit(1);
}

// ── 0. 用官方 JSON Schema 校验整份配置 ────────────────────────────────
//
// 为什么必须有这一步：把选项写在**错误的层级**时，CMS 只在浏览器控制台打印一句 warning，
// 然后**静默忽略**它 —— 后台照样能打开，只是那个功能不起作用。
// 2026-09-30 实测踩到过两次：`commit_messages` 写在顶层（应在 backend 下）、
// `slug.editable` 写在顶层（应在集合级）。肉眼看配置发现不了，所以直接拿官方 schema 卡。
//
// schema 来自 node_modules 里的 @sveltia/cms（版本与 public/admin/index.html 锁定的版本必须一致，
// 下面第 3 节会校验这件事），这样「校验用的 schema」和「编辑者实际加载的 CMS」永远对得上。

function findCmsPackage() {
  try {
    const require = createRequire(import.meta.url);
    let dir = dirname(require.resolve(CMS_PACKAGE));
    for (let i = 0; i < 6; i += 1) {
      const pkgPath = join(dir, 'package.json');
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        if (pkg.name === CMS_PACKAGE) return { dir, version: pkg.version };
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    /* 下面统一报错 */
  }
  return null;
}

const cmsPackage = findCmsPackage();
if (!cmsPackage) {
  error(
    `没找到 ${CMS_PACKAGE}（devDependency）。它提供后台配置的官方 schema，也是校验的基准。`,
    'package.json',
    'npm install 之后再跑一次。',
  );
} else {
  const schemaPath = join(cmsPackage.dir, 'schema/sveltia-cms.json');
  if (!existsSync(schemaPath)) {
    error(`没找到官方配置 schema：${relative(ROOT, schemaPath)}`, 'package.json');
  } else {
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
    const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
    const validate = ajv.compile(schema);
    if (!validate(config)) {
      // ajv 在 backend 这种 anyOf 结构上会一次吐出十几条互相重复的错误，
      // 其中一半是「因为另一个键错了，所以这个分支也不匹配」。这里做两件事：
      //   1. 把 additionalProperties 汇总成「哪些键根本不存在」——这条最有用；
      //   2. 其余按「路径 + 关键字 + 消息」去重，最多列 5 条。
      const extraProps = new Set();
      const messages = [];
      const seen = new Set();

      for (const issue of validate.errors ?? []) {
        if (issue.keyword === 'additionalProperties' && issue.params?.additionalProperty) {
          extraProps.add(`${issue.instancePath || ''}/${issue.params.additionalProperty}`);
          continue;
        }
        const key = `${issue.instancePath}|${issue.keyword}|${issue.message}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const allowed = issue.params?.allowedValues
          ? `（允许的值：${issue.params.allowedValues.map((v) => JSON.stringify(v)).join(' / ')}）`
          : '';
        messages.push(`${issue.instancePath || '/'} ${issue.message}${allowed}`);
      }

      if (extraProps.size) {
        error(
          `配置里有官方 schema 不认识的键：${[...extraProps].join('、')}`,
          'public/admin/config.yml',
          '多半是写错了层级（比如 commit_messages 属于 backend）或拼错了选项名 —— CMS 会静默忽略它们。',
        );
      }
      for (const message of messages.slice(0, 5)) {
        error(`配置不符合官方 schema：${message}`, 'public/admin/config.yml');
      }
      if (messages.length > 5) {
        warn(`另有 ${messages.length - 5} 条 schema 问题未列出，先修上面这些。`, 'public/admin/config.yml');
      }
    }
  }
}

// ── 1. 关键开关 ────────────────────────────────────────────────────────

if (config.backend?.name !== 'github') {
  error(`backend.name 应为 github，现在是 ${JSON.stringify(config.backend?.name)}`, 'public/admin/config.yml');
}
if (config.backend?.repo !== 'nathanpenny520/TsinghuaSurvive') {
  error(`backend.repo 指向了别的仓库：${JSON.stringify(config.backend?.repo)}`, 'public/admin/config.yml');
}

const authMethods = Array.isArray(config.backend?.auth_methods) ? config.backend.auth_methods : [];
if (!authMethods.includes('oauth')) {
  error(
    'backend.auth_methods 里没有 oauth：后台只能靠令牌登录，编辑者要自己创建和管理 PAT。',
    'public/admin/config.yml',
    '加上 oauth（必要时配好 base_url 指向 auth-worker）。',
  );
}
if (authMethods.includes('oauth') && !config.backend?.base_url) {
  error(
    'auth_methods 里有 oauth，但没有 backend.base_url：CMS 会去用 Netlify 的默认 OAuth 中转，站点点不通。',
    'public/admin/config.yml',
    '填 https://auth.nathanpenny.fun（即 auth-worker 部署出来的地址）。',
  );
}

// ── 1b. OAuth 中转：配置与部署产物不能漂移 ──────────────────────────────
//
// 这两个地址写在两个文件里（CMS 配置 / Worker 配置），任何一处改了另一处没改，
// 表现都是「点 GitHub 登录之后回到后台仍然是未登录」——很难查，所以在 CI 里先比一遍。

const AUTH_WRANGLER = join(ROOT, 'auth-worker/wrangler.jsonc');
const AUTH_WORKER_ENTRY = join(ROOT, 'auth-worker/src/index.js');

if (authMethods.includes('oauth')) {
  if (!existsSync(AUTH_WRANGLER)) {
    error('auth-worker/wrangler.jsonc 不存在：OAuth 中转没有部署配置。', 'auth-worker/wrangler.jsonc');
  } else {
    let authConfig = null;
    try {
      authConfig = parseJsonc(readFileSync(AUTH_WRANGLER, 'utf8'));
    } catch (err) {
      error(`auth-worker/wrangler.jsonc 解析失败：${err.message}`, 'auth-worker/wrangler.jsonc');
    }

    if (authConfig) {
      const baseUrl = config.backend?.base_url;
      const route = authConfig.routes?.[0]?.pattern;
      if (baseUrl && route) {
        let baseHost = '';
        try {
          baseHost = new URL(baseUrl).host;
        } catch {
          error(`backend.base_url 不是合法网址：${baseUrl}`, 'public/admin/config.yml');
        }
        if (baseHost && baseHost !== route) {
          error(
            `backend.base_url（${baseHost}）与 auth-worker 的自定义域名（${route}）不一致：` +
              '登录会成功跳转但回不到后台。',
            'public/admin/config.yml',
            '两处改成同一个域名。',
          );
        }
      }

      const allowed = authConfig.vars?.ALLOWED_DOMAINS ?? '';
      if (!allowed) {
        error(
          'auth-worker 的 vars.ALLOWED_DOMAINS 是空的：任何网站都能拿你的中转去换令牌（防滥用失效）。',
          'auth-worker/wrangler.jsonc',
          '至少写上 *.nathanpenny.fun,localhost。',
        );
      } else if (!allowed.includes('nathanpenny.fun') && !allowed.includes('*')) {
        warn(
          `ALLOWED_DOMAINS（${allowed}）里没有站点域名，后台登录会被中转拒绝。`,
          'auth-worker/wrangler.jsonc',
        );
      }
    }
  }

  if (!existsSync(AUTH_WORKER_ENTRY)) {
    error('auth-worker/src/index.js 不存在：OAuth 中转没有代码。', 'auth-worker/src/index.js');
  } else {
    const entry = readFileSync(AUTH_WORKER_ENTRY, 'utf8');
    // 内联的是上游代码，必须保留来源与许可信息（MIT 的要求，也是以后升级的依据）
    if (!/sveltia\/sveltia-cms-auth/.test(entry) || !/LICENSE\.txt/.test(entry)) {
      error(
        'auth-worker/src/index.js 缺少上游来源/许可注释（MIT 要求保留版权声明，升级时也要靠它定位版本）。',
        'auth-worker/src/index.js',
      );
    }
  }
  if (!existsSync(join(ROOT, 'auth-worker/LICENSE.txt'))) {
    error('auth-worker/LICENSE.txt 不存在：内联 MIT 代码必须带许可文件。', 'auth-worker/LICENSE.txt');
  }
  if (!existsSync(join(ROOT, 'auth-worker/README.md'))) {
    error('auth-worker/README.md 不存在：中转的部署与升级步骤必须有据可查。', 'auth-worker/README.md');
  }
}

if (config.publish_mode !== 'editorial_workflow') {
  error(
    'publish_mode 必须是 editorial_workflow：否则后台保存会直推 main，绕过 PR 预览与全套 CI 校验。',
    'public/admin/config.yml',
  );
}
if (config.slug && Object.keys(config.slug).length) {
  warn(
    '顶层 slug 选项只认编码/大小写这类设置；editable/pattern/hint 必须写在每个集合的 slug 里（写错层级会被 CMS 静默忽略）。',
    'public/admin/config.yml',
  );
}

// ── 2. 媒体库（R2）─────────────────────────────────────────────────────

const PLACEHOLDER = /REPLACE|TODO|xxxx|example\.com/i;
const r2 = config.media_libraries?.cloudflare_r2;

if (!r2) {
  error('没有配置 cloudflare_r2 媒体库：后台将无法上传图片和视频。', 'public/admin/config.yml');
} else {
  for (const key of ['access_key_id', 'bucket', 'account_id', 'public_url']) {
    if (!r2[key]) error(`cloudflare_r2.${key} 没填。`, 'public/admin/config.yml');
  }
  if (typeof r2.access_key_id === 'string' && PLACEHOLDER.test(r2.access_key_id)) {
    warn(
      'cloudflare_r2.access_key_id 还是占位符：后台能改文字，但媒体库传不了图。',
      'public/admin/config.yml',
      '照 HANDOVER.md「站内后台」一节建 R2 令牌后替换。',
    );
  }
  if (typeof r2.public_url === 'string' && PLACEHOLDER.test(r2.public_url)) {
    warn(
      'cloudflare_r2.public_url 还是占位符：图片能上传也显示不出来。',
      'public/admin/config.yml',
      '给 R2 桶配公开域名（推荐 media.nathanpenny.fun）后替换。',
    );
  }
}
if (config.media_libraries?.default !== false) {
  warn(
    'media_libraries.default 不是 false：仓库内媒体库仍然可用，图片可能被存进 Git（会让仓库越来越重）。',
    'public/admin/config.yml',
  );
}
if (!config.media_libraries?.all?.transformations?.raster_image?.format) {
  warn(
    '没有配置图片转换（raster_image.format: webp）：手机拍的照片会原样上传，读者要下几 MB 的图。',
    'public/admin/config.yml',
  );
}

// ── 3. 后台页面 ────────────────────────────────────────────────────────

if (!existsSync(ADMIN_HTML)) {
  error('缺少 public/admin/index.html —— 后台页面不存在。', 'public/admin/index.html');
} else {
  const html = readFileSync(ADMIN_HTML, 'utf8');
  if (!/name="robots"[^>]*noindex/.test(html)) {
    error('后台页面缺少 <meta name="robots" content="noindex">，会被搜索引擎收录。', 'public/admin/index.html');
  }
  if (!/sveltia-cms@(\d+\.\d+\.\d+)/.test(html) && !/VERSION\s*=\s*'(\d+\.\d+\.\d+)'/.test(html)) {
    error(
      '后台页面里的 Sveltia 版本号没有锁定（应为 x.y.z 这样的固定版本）：跟 latest 会在某天悄悄换掉行为。',
      'public/admin/index.html',
    );
  }

  // 后台页面加载的版本，必须和 package.json 里依赖的版本一致：
  // 上面第 0 节用的就是那个版本的官方 schema。两者不同步时，
  // 「校验通过」这句话就不再代表「编辑者实际加载的 CMS 也认为配置合法」。
  if (cmsPackage) {
    const pinned = html.match(/VERSION\s*=\s*'(\d+\.\d+\.\d+)'/)?.[1]
      ?? html.match(/sveltia-cms@(\d+\.\d+\.\d+)/)?.[1];
    if (pinned && pinned !== cmsPackage.version) {
      error(
        `后台页面锁定的 Sveltia 版本（${pinned}）和 package.json 里依赖的版本（${cmsPackage.version}）不一致。`,
        'public/admin/index.html',
        `改成一致（当前依赖版本是 ${cmsPackage.version}），否则 schema 校验的结论对不上真实运行的后台。`,
      );
    }
  }
}

// ── 4. 字段覆盖率：后台声明的字段必须能装下所有 frontmatter ──────────────

/** 收集某个目录下、指定扩展名的文档及其 frontmatter 键 */
function collectDocs(dir, extensions) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) continue;
    if (name.startsWith('_')) continue;
    const ext = extname(full).replace('.', '');
    if (!extensions.includes(ext)) continue;
    const raw = readFileSync(full, 'utf8');
    if (!raw.startsWith('---')) {
      out.push({ file: full, keys: new Set() });
      continue;
    }
    const end = raw.indexOf('\n---', 3);
    const header = raw.slice(raw.indexOf('\n', 3) + 1, end);
    let data = {};
    try {
      data = parseYaml(header) ?? {};
    } catch (err) {
      error(`frontmatter 解析失败：${err.message}`, relative(ROOT, full));
      continue;
    }
    out.push({ file: full, keys: new Set(Object.keys(data)) });
  }
  return out;
}

/** 把配置里的字段列表摊平成「顶层字段名 → 嵌套字段名集合」 */
function declaredFields(fields) {
  const map = new Map();
  for (const field of fields ?? []) {
    if (!field?.name) continue;
    const nested = new Set();
    for (const child of field.fields ?? []) {
      if (child?.name) nested.add(child.name);
    }
    map.set(field.name, nested);
  }
  return map;
}

const collections = (config.collections ?? []).filter((c) => c && c.folder);
const fileCollections = (config.collections ?? []).filter((c) => c && c.files);

// 4a. 目录型集合
const coveredFiles = new Set();
for (const collection of collections) {
  const dir = join(ROOT, collection.folder);
  const extension = collection.extension ?? 'md';
  const declared = declaredFields(collection.fields);
  const docs = collectDocs(dir, [extension]);

  if (docs.length === 0) {
    warn(`集合 ${collection.name} 在 ${collection.folder} 下一个 .${extension} 文件都没匹配到。`, 'public/admin/config.yml');
  }
  if (!declared.has('body')) {
    error(`集合 ${collection.name} 没有声明 body 字段：作者将无法编辑正文。`, 'public/admin/config.yml');
  }

  // 每个目录集合都要自己声明 slug 规则：顶层 slug 与集合级 slug 是**两套不同的选项**，
  // 把 editable/pattern 写在顶层会被 CMS 静默忽略（2026-09-30 实测），结果就是文件名可能变成中文网址。
  if (collection.slug?.editable !== true || !collection.slug?.pattern) {
    error(
      `集合 ${collection.name} 缺少集合级 slug 规则（editable: true + pattern）：作者将无法自己填英文文件名。`,
      'public/admin/config.yml',
      '锚点 &doc-slug 定义在第一个集合上，其他集合写 slug: *doc-slug。',
    );
  }
  if (extension === 'mdx' && !collection.description) {
    error(
      `集合 ${collection.name} 处理 .mdx（含组件），必须写 description 提醒作者不要动 import 那几行。`,
      'public/admin/config.yml',
    );
  }

  for (const doc of docs) {
    coveredFiles.add(doc.file);
    for (const key of doc.keys) {
      if (declared.has(key)) continue;
      error(
        `${relative(ROOT, doc.file)} 里有 frontmatter 字段「${key}」，但集合 ${collection.name} 没声明它 —— ` +
          '在后台保存这篇文章会把这个字段丢掉。',
        'public/admin/config.yml',
        `在 config.yml 的集合 ${collection.name} 字段表里补上 ${key}。`,
      );
    }
  }
  // 反向检查（「声明了但没人用」）刻意不做：可选字段（reviewedAt、banner…）本来就大多数文章不填，
  // 全网报一遍只会让人习惯性忽略警告。真出问题时是「漏声明」那一侧，也就是上面的正向检查。
}

// 4c. 单文件集合
for (const collection of fileCollections) {
  for (const file of collection.files ?? []) {
    const full = join(ROOT, file.file);
    if (!existsSync(full)) {
      error(`集合 ${collection.name} 指向的 ${file.file} 不存在。`, 'public/admin/config.yml');
      continue;
    }
    coveredFiles.add(full);
    const raw = readFileSync(full, 'utf8');
    const end = raw.indexOf('\n---', 3);
    const header = raw.slice(raw.indexOf('\n', 3) + 1, end);
    let data = {};
    try {
      data = parseYaml(header) ?? {};
    } catch (err) {
      error(`frontmatter 解析失败：${err.message}`, relative(ROOT, full));
      continue;
    }
    const declared = declaredFields(file.fields);
    for (const key of Object.keys(data)) {
      if (declared.has(key)) continue;
      error(
        `${file.file} 里有 frontmatter 字段「${key}」，但集合 ${collection.name} 的「${file.label ?? file.name}」没声明它。`,
        'public/admin/config.yml',
      );
    }
  }
}

// 4d. 有没有内容文件在后台里根本看不到
function walkDocs(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkDocs(full, acc);
    else if (/\.mdx?$/.test(name) && !name.startsWith('_')) acc.push(full);
  }
  return acc;
}
for (const file of walkDocs(DOCS_DIR).sort()) {
  if (coveredFiles.has(file)) continue;
  warn(
    `${relative(ROOT, file)} 不在任何后台集合里 —— 这篇内容在后台看不到，只能改代码。`,
    'public/admin/config.yml',
    '在 config.yml 里加一个对应扩展名的集合，或确认它本来就该走代码维护。',
  );
}

// ── 5. 输出 ────────────────────────────────────────────────────────────

const errors = findings.filter((f) => f.level === 'error');
const warns = findings.filter((f) => f.level === 'warn');

for (const finding of warns) {
  const text = `${finding.file ? `[${finding.file}] ` : ''}${finding.message}${finding.hint ? ` —— ${finding.hint}` : ''}`;
  if (annotate) console.log(`::warning title=后台配置::${text}`);
  console.log(`▲ ${text}`);
}
for (const finding of errors) {
  const text = `${finding.file ? `[${finding.file}] ` : ''}${finding.message}${finding.hint ? ` —— ${finding.hint}` : ''}`;
  if (annotate) console.log(`::error title=后台配置::${text}`);
  console.error(`✖ ${text}`);
}

console.log(
  `\n后台配置检查：${collections.length} 个目录集合 + ${fileCollections.length} 个单文件集合，` +
    `${coveredFiles.size} 个内容文件被后台覆盖。`,
);

if (errors.length || (strict && warns.length)) {
  console.error(
    `\n✖ 后台配置检查未通过：${errors.length} 个错误${strict ? `、${warns.length} 个警告（严格模式）` : ''}\n`,
  );
  process.exit(1);
}

console.log(`✔ 后台配置检查通过${warns.length ? `（${warns.length} 条提醒）` : ''}`);
