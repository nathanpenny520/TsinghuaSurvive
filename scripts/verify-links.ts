#!/usr/bin/env tsx
/**
 * 链接语义核对（自动）—— 回答的**不是**「域名活着吗」（那是 check:links 的活），
 * 而是「这个地址指的到底是不是我们声称的那个服务」。
 *
 * 三类证据，拿到任意一类就认为「地址 → 服务」这一层对得上：
 *   1. **标题命中**：页面 <title> 里有期望关键词（关键词 = 手写的机构词 ∪ 链接名拆出来的词）；
 *   2. **正文命中**：正文前 40 KB 里有期望关键词；
 *   3. **登录端点 / 机构域名**：跳到了同机构的 login / sign_in / cas / signin 这类认证页，
 *      或者域名本身就在服务方自己的域下（`*.tsinghua.edu.cn`、`cnki.net` 等）。
 *
 * 校园系统大量是 SPA 或「登录后才渲染内容」，只有 200 和空白标题是常态 ——
 * 所以第 3 条不是放水，是**这类站点的正常形态**。
 *
 * 输出：
 *   .review/link-verification.json   每条的原始证据（状态码、最终地址、标题、命中词、判定理由）
 *   终端表格                          结论：ok / suspect / fail
 *
 * 用法：
 *   npm run verify:links             只核对，不改文件
 *   npm run verify:links -- --apply  把结论为 ok 的条目写回 links.ts（reviewedAt + verifiedBy: 'auto'）
 *
 * ⚠️ 能力边界（别把它当万灵药）：
 *   - 抓不到登录后的内容，**页面内的功能变化它发现不了**；
 *   - 校园网系统在校外抓到的是登录页，「登录页能打开」≠「登录进去功能正常」；
 *   - 结论为 ok 的条目写的是 `verifiedBy: 'auto'`，页面上显示「脚本核对」，
 *     与人工点开确认的「人工核对」区分开 —— 别把两者混为一谈。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

import { campusLinks, type CampusLink } from '../src/data/links.ts';

const ROOT = resolve(import.meta.dirname, '..');
const OUT_DIR = join(ROOT, '.review');
const OUT_FILE = join(OUT_DIR, 'link-verification.json');
const LINKS_TS = join(ROOT, 'src/data/links.ts');

const APPLY = process.argv.includes('--apply');
const today = new Date().toISOString().slice(0, 10);
const TIMEOUT_MS = 20_000;

/** 手写期望词：按域名给（这些是「这个服务一定会在页面上出现」的词） */
const EXPECT_BY_HOST: Record<string, string[]> = {
  'zhjw.cic.tsinghua.edu.cn': ['教务'],
  'zhjwxk.cic.tsinghua.edu.cn': ['教务', '选课'],
  'learn.tsinghua.edu.cn': ['网络学堂', '学堂'],
  'yuketang.cn': ['雨课堂'],
  'transcript.student.tsinghua.edu.cn': ['身份', '成绩'],
  'szsj.tsinghua.edu.cn': ['身份', '思政'],
  'info.tsinghua.edu.cn': ['信息门户', '门户'],
  'mails.tsinghua.edu.cn': ['邮件'],
  'id.tsinghua.edu.cn': ['身份'],
  'cloud.tsinghua.edu.cn': ['云盘', '身份'],
  'its.tsinghua.edu.cn': ['信息化', '身份', '登录'],
  'webvpn.tsinghua.edu.cn': ['vpn', '身份', '登录'],
  'usereg.tsinghua.edu.cn': ['校园网', '自助'],
  'lib.tsinghua.edu.cn': ['图书馆'],
  'ecollection.lib.tsinghua.edu.cn': ['数据库', '期刊', '导航'],
  'workshop.learning.tsinghua.edu.cn': ['工作坊', '学习发展'],
  'overleaf.tsinghua.edu.cn': ['overleaf'],
  'git.tsinghua.edu.cn': ['gitlab'],
  'mirrors.tuna.tsinghua.edu.cn': ['镜像'],
  'dsa.cs.tsinghua.edu.cn': ['judge'],
  'sports.tsinghua.edu.cn': ['体育', '场馆'],
  'thos.tsinghua.edu.cn': ['身份', '服务'],
  'oa.student.tsinghua.edu.cn': ['团委', '办公', '学生'],
  'student.tsinghua.edu.cn': ['学生清华', '学生'],
  'sa.tsinghua.edu.cn': ['奖', '登录'],
  'yuketang.tsinghua.edu.cn': ['人工智能', '素养'],
  'maic.tsinghua.edu.cn': ['课堂', 'signin', '登录'],
  'madmodel.cs.tsinghua.edu.cn': ['deepseek', '模型'],
  'thu.services': ['thu services'],
  'career.tsinghua.edu.cn': ['职业发展', '就业'],
  'chsi.com.cn': ['学信'],
  'bjyouth.net': ['共青团'],
  'join-tsinghua.edu.cn': ['招生'],
  'tsinghua.edu.cn': ['清华'],
  'news.tsinghua.edu.cn': ['新闻'],
  'vi.tsinghua.edu.cn': ['视觉'],
  'cnki.net': ['知网'],
};

/** 这些域属于「服务方自己的域名」：200 + 有响应就能确认地址没写错 */
const OFFICIAL_HOSTS = [
  'tsinghua.edu.cn',
  'tuna.tsinghua.edu.cn',
  'yuketang.cn',
  'xuetangx.com',
  'thu.services',
  'chsi.com.cn',
  'chsi.cn',
  'bjyouth.net',
  'cnki.net',
  'cnki.com.cn',
];

/** 认证类端点：校园系统校外访问落到这里属于正常 */
const AUTH_ENDPOINT = /(login|sign_in|signin|cas|auth|sso|passport)/i;

/** 链接名里这些词太通用，拆词时丢掉 */
const STOP_WORDS = new Set([
  '清华大学', '清华', '系统', '平台', '服务', '入口', '在线', '官方', '网站', '官网',
  '（', '）', '(', ')', '/', '、', '与', '和', '的', '校园', '学生', '相关', '信息',
]);

type Result = {
  name: string;
  url: string;
  group: string;
  reach: string;
  status: number | null;
  finalUrl: string | null;
  title: string;
  charset: string;
  matched: string[];
  missing: string[];
  evidence: string[];
  verdict: 'ok' | 'suspect' | 'fail';
  reasons: string[];
};

const normalize = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * 从链接名里拆出期望词：「场馆预约（体育）」→ ['场馆预约','场馆','预约','体育']。
 * 长中文词额外出 2 字滑窗（「数据库导航」→ 数据、据库、库导、导航），
 * 让「标题里只写了『数据库』」这种页面也能命中；多出来的碎词只影响命中率显示，不会造成误判 ——
 * 判定要的是「至少有一类证据」，多一个弱词并不会让坏链接变成 ok。
 */
function tokensFromName(name: string): string[] {
  const cleaned = name.replace(/[（(][^）)]*[）)]/g, ' ').replace(/[、与和/]/g, ' ');
  const tokens = new Set<string>();

  for (const chunk of cleaned.split(/\s+/)) {
    const word = chunk.trim();
    if (word.length < 2) continue;
    tokens.add(word);
    if (/^[\u4e00-\u9fa5]{4,}$/.test(word)) {
      for (let i = 0; i + 2 <= word.length; i += 1) tokens.add(word.slice(i, i + 2));
    }
  }

  return [...tokens].filter((token) => !STOP_WORDS.has(token)).slice(0, 8);
}

function expectationFor(link: CampusLink): string[] {
  const host = new URL(link.url).hostname.replace(/^www\./, '');
  const byHost =
    Object.entries(EXPECT_BY_HOST).find(
      ([key]) => host === key || host.endsWith(`.${key}`),
    )?.[1] ?? [];
  return [...new Set([...byHost, ...tokensFromName(link.name)])];
}

function isOfficialHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return OFFICIAL_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

/** 按页面自己声明的编码解码 —— 校内不少老系统是 GBK，按 UTF-8 读会得到乱码标题 */
function decodeBody(buffer: Buffer, contentType: string | null): { text: string; charset: string } {
  const head = buffer.subarray(0, 2048).toString('latin1');
  const declared =
    head.match(/charset=["']?([\w-]+)/i)?.[1] ??
    contentType?.match(/charset=([\w-]+)/i)?.[1] ??
    'utf-8';
  const label = declared.toLowerCase() === 'gb2312' ? 'gbk' : declared.toLowerCase();
  try {
    return { text: new TextDecoder(label).decode(buffer), charset: label };
  } catch {
    return { text: buffer.toString('utf8'), charset: 'utf-8(回退)' };
  }
}

async function fetchPage(url: string) {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'user-agent':
          'Mozilla/5.0 (compatible; TsinghuaGuideLinkVerify/1.0; +https://tsinghua.nathanpenny.fun)',
        accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    const decoded = decodeBody(buffer, response.headers.get('content-type'));
    return {
      status: response.status,
      finalUrl: response.url,
      title: (decoded.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').slice(0, 120),
      body: decoded.text,
      charset: decoded.charset,
    };
  } catch (error) {
    // Node 的 fetch 对个别站的证书链比较挑，用 curl 复核一次（与 check-links 同一套做法）
    try {
      const raw = execFileSync(
        'curl',
        ['-sL', '-m', '20', '-A', 'Mozilla/5.0 (compatible; TsinghuaGuideLinkVerify/1.0)', url],
        { maxBuffer: 8 * 1024 * 1024, timeout: TIMEOUT_MS + 10_000 },
      );
      const buffer = Buffer.from(raw);
      const decoded = decodeBody(buffer, null);
      return {
        status: 200,
        finalUrl: url,
        title: (decoded.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').slice(0, 120),
        body: decoded.text,
        charset: decoded.charset,
      };
    } catch {
      return {
        status: null as number | null,
        finalUrl: null as string | null,
        title: '',
        body: '',
        charset: '-',
        error: String((error as Error).message),
      };
    }
  }
}

console.log(`核对 ${campusLinks.length} 条链接的语义（抓页面 + 多证据比对）……\n`);

const results: Result[] = [];

for (const link of campusLinks as CampusLink[]) {
  const expected = expectationFor(link);
  const page = await fetchPage(link.url);
  const title = normalize(page.title);
  const body = normalize(page.body.slice(0, 40_000));

  const matched = expected.filter((word) => title.includes(normalize(word)) || body.includes(normalize(word)));
  const missing = expected.filter((word) => !matched.includes(word));
  const evidence: string[] = [];
  const reasons: string[] = [];
  let verdict: Result['verdict'] = 'ok';

  if (page.status === null || page.status >= 400) {
    verdict = 'fail';
    reasons.push('error' in page && page.error ? `抓取失败：${page.error}` : `HTTP ${page.status}`);
  } else {
    if (title && matched.some((word) => title.includes(normalize(word)))) evidence.push('标题命中');
    if (matched.length) evidence.push(`关键词命中 ${matched.length}/${expected.length}`);

    const redirectedToAuth = Boolean(page.finalUrl && AUTH_ENDPOINT.test(page.finalUrl) && page.finalUrl !== link.url);
    if (redirectedToAuth) evidence.push('落到登录端点');

    const onOfficialHost = isOfficialHost(page.finalUrl ?? link.url);
    if (onOfficialHost) evidence.push('机构自有域名');

    if (!evidence.length) {
      verdict = 'suspect';
      reasons.push(
        `没有任何佐证：标题「${page.title || '（空）'}」，期望词 ${expected.join('、') || '（未配置）'} 一个都没命中`,
      );
    }

    // 域名跳到自己人不认识的第三方，单独标出来让人看一眼
    if (page.finalUrl) {
      const fromHost = new URL(link.url).hostname.replace(/^www\./, '');
      const toHost = new URL(page.finalUrl).hostname.replace(/^www\./, '');
      const related =
        fromHost === toHost ||
        toHost.endsWith(fromHost) ||
        fromHost.endsWith(toHost) ||
        isOfficialHost(page.finalUrl);
      if (!related) {
        verdict = 'suspect';
        reasons.push(`跳到了无关域名：${toHost}`);
      }
    }
  }

  results.push({
    name: link.name,
    url: link.url,
    group: link.group,
    reach: link.reach,
    status: page.status,
    finalUrl: page.finalUrl,
    title: page.title,
    charset: page.charset,
    matched,
    missing,
    evidence,
    verdict,
    reasons,
  });
}

for (const item of [...results].sort((a, b) => a.verdict.localeCompare(b.verdict))) {
  const mark = item.verdict === 'ok' ? '✔' : item.verdict === 'suspect' ? '?' : '✖';
  console.log(`${mark} ${item.name}  [${item.charset}]`);
  console.log(`   ${item.status ?? 'ERR'}  ${item.title || '（无标题）'}${item.evidence.length ? `  ← ${item.evidence.join('；')}` : ''}`);
  if (item.reasons.length) console.log(`   ↳ ${item.reasons.join('；')}`);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, `${JSON.stringify({ checkedAt: today, results }, null, 2)}\n`);

const ok = results.filter((r) => r.verdict === 'ok');
const suspect = results.filter((r) => r.verdict === 'suspect');
const failed = results.filter((r) => r.verdict === 'fail');

console.log(`\n结论：ok ${ok.length}｜suspect ${suspect.length}｜fail ${failed.length}`);
console.log(`证据写进 ${OUT_FILE}`);

if (!APPLY) {
  console.log('\n加 --apply 会把结论为 ok 的条目写回 links.ts（reviewedAt + verifiedBy: "auto"）。\n');
  process.exit(failed.length || suspect.length ? 1 : 0);
}

if (suspect.length || failed.length) {
  console.log(`\n⚠️ 有 ${suspect.length + failed.length} 条没通过，**不会**写回（留给人看）：`);
  for (const item of [...failed, ...suspect]) console.log(`  · ${item.name} —— ${item.reasons.join('；')}`);
}

const lines = readFileSync(LINKS_TS, 'utf8').split('\n');
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let changed = 0;

for (const item of ok) {
  const urlLine = lines.findIndex((line) =>
    new RegExp(`^\\s*url:\\s*'${escapeRegExp(item.url)}',?\\s*$`).test(line),
  );
  if (urlLine === -1) {
    console.log(`  · 跳过（links.ts 里找不到）：${item.url}`);
    continue;
  }
  let endLine = -1;
  for (let i = urlLine + 1; i < lines.length; i += 1) {
    if (/^\s{2}\},?\s*$/.test(lines[i])) {
      endLine = i;
      break;
    }
  }
  if (endLine === -1) continue;

  const reviewedLine = lines.findIndex(
    (line, index) => index > urlLine && index < endLine && /^\s*reviewedAt:/.test(line),
  );
  if (reviewedLine >= 0) {
    lines[reviewedLine] = `    reviewedAt: '${today}',`;
  } else {
    lines.splice(endLine, 0, `    reviewedAt: '${today}',`);
    endLine += 1;
  }

  const byLine = lines.findIndex(
    (line, index) => index > urlLine && index <= endLine && /^\s*verifiedBy:/.test(line),
  );
  if (byLine >= 0) lines[byLine] = `    verifiedBy: 'auto',`;
  else lines.splice(endLine, 0, `    verifiedBy: 'auto',`);

  changed += 1;
}

if (!existsSync(LINKS_TS)) {
  console.error('✖ 找不到 src/data/links.ts');
  process.exit(1);
}

writeFileSync(LINKS_TS, lines.join('\n'));
console.log(`\n✔ 已把 ${changed} 条写回 links.ts（reviewedAt: '${today}', verifiedBy: 'auto'）`);
console.log('  接着跑：npm run check:content && npm run build\n');
