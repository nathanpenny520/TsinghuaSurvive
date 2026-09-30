#!/usr/bin/env tsx
/**
 * 链接可达性实测 —— 把「这条链接现在还打得开吗」变成机器能回答的问题。
 *
 * 为什么需要它：站内链接可以由 `check:content` 静态检查，但**校外网址只能真的去请求一次**。
 * 学校系统的域名和入口经常迁移，靠人肉隔几个月点一遍不现实，所以：
 *
 *   npm run check:links          实测所有链接，写入 src/data/link-status.json
 *   npm run check:links -- --fail   有链接打不开时以非 0 退出（CI 里可用）
 *
 * ⚠️ 这个脚本只证明「域名活着 + 返回 2xx/3xx」，
 *    **不代表入口还是干那件事** —— 后者只能人去点。
 *    页面上因此分成两个角标：「实测可访问」和「待人工核对」。
 *
 * ⚠️ 在校园网里跑和在公网跑，结果可能不一样：校内系统在公网也可能返回 200 的登录页。
 *    所以结果文件里会记下 `network` 字段，说明这份结果是哪种网络下测的。
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { campusLinks } from '../src/data/links.ts';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'src/data/link-status.json');
const FAIL_MODE = process.argv.includes('--fail');
const TIMEOUT_MS = 15_000;
const CONCURRENCY = 6;

type Result = {
  ok: boolean;
  /** HTTP 状态码；请求直接失败时为 null */
  status: number | null;
  /** 失败原因（截断后） */
  error?: string;
  /** 耗时（毫秒） */
  ms?: number;
};

async function probe(url: string): Promise<Result> {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        // 有些站点对空 UA 直接拒绝
        'user-agent': 'Mozilla/5.0 (compatible; TsinghuaGuideLinkCheck/1.0; +https://tsinghua.nathanpenny.fun)',
        accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      },
    });
    return { ok: response.status < 400, status: response.status, ms: Date.now() - started };
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause?.message;
    const message = String(cause ?? (error as Error).message ?? error).slice(0, 120);

    // Node 的 fetch 对个别站点的证书链/加密套件比较挑（例如 www.bjyouth.net 会直接
    // "fetch failed"，但 curl 能正常打开）。所以失败时用 curl 复核一次，避免误报。
    const viaCurl = probeWithCurl(url);
    if (viaCurl !== null) {
      return { ok: viaCurl < 400, status: viaCurl, ms: Date.now() - started };
    }
    return { ok: false, status: null, error: message, ms: Date.now() - started };
  }
}

/** 第二意见：curl 拿到的 HTTP 状态码；拿不到返回 null */
function probeWithCurl(url: string): number | null {
  try {
    const out = execFileSync(
      'curl',
      ['-s', '-o', '/dev/null', '-w', '%{http_code}', '-L', '-m', '15', url],
      { encoding: 'utf8', timeout: TIMEOUT_MS + 5000 },
    ).trim();
    const code = Number.parseInt(out, 10);
    return Number.isFinite(code) && code > 0 ? code : null;
  } catch {
    return null;
  }
}

/** 简单的并发池：一次最多跑 CONCURRENCY 个请求 */
async function mapPool<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]!);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

const today = new Date().toISOString().slice(0, 10);

console.log(`实测 ${campusLinks.length} 条链接（并发 ${CONCURRENCY}，单条超时 ${TIMEOUT_MS / 1000}s）……\n`);

const results = await mapPool(campusLinks, CONCURRENCY, async (link) => ({
  link,
  result: await probe(link.url),
}));

const failures = results.filter(({ result }) => !result.ok);

for (const { link, result } of results.sort((a, b) => Number(a.result.ok) - Number(b.result.ok))) {
  const mark = result.ok ? '✔' : '✖';
  const code = result.status ?? result.error ?? 'ERR';
  console.log(`${mark} ${String(code).padEnd(24)} ${link.name}  ${link.url}`);
}

const payload = {
  $comment:
    '由 npm run check:links 生成，请勿手工编辑。只证明网址当前可访问（HTTP < 400），不代表页面内容已人工核对。',
  checkedAt: today,
  /** 这份结果是在哪种网络环境下测的 */
  network: process.env.LINK_CHECK_NETWORK ?? '未标注（本地网络）',
  total: results.length,
  reachable: results.length - failures.length,
  results: Object.fromEntries(
    results.map(({ link, result }) => [
      link.url,
      {
        ok: result.ok,
        status: result.status,
        ...(result.error ? { error: result.error } : {}),
      },
    ]),
  ),
};

writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`);

console.log(`\n可访问 ${payload.reachable}/${payload.total}，结果写入 src/data/link-status.json（${today}）`);

if (failures.length) {
  console.log(`\n打不开的 ${failures.length} 条：`);
  for (const { link, result } of failures) {
    console.log(`  · ${link.name}（${link.url}）—— ${result.status ?? result.error}`);
  }
  if (FAIL_MODE) {
    console.error('\n✖ 有链接打不开（--fail 模式）');
    process.exit(1);
  }
  console.log('\n提示：打不开不一定是坏事，可能只是需要校园网。确认后更新 src/data/links.ts 里的 reach 字段。');
}
