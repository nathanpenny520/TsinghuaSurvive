#!/usr/bin/env node
/**
 * 交互冒烟测试 —— 用无头 Chrome 真的点一遍页面上那几个用 JS 的地方。
 *
 * 为什么需要它：`npm run check:content` 能保证 HTML 生成对了，但保证不了
 * 「筛选器点了有没有反应」。`/courses/` 的课程筛选、`/guides/links/` 的链接搜索
 * 都是纯客户端的，静态检查看不见。
 *
 * 用法：
 *   npm run build
 *   npx http-server dist -p 4321 &        # 或者 npx astro preview
 *   npm run check:e2e -- --base http://127.0.0.1:4321
 *
 * 找不到 Chrome 时会打印一行提示并跳过（退出码 0），不会打断任何流程。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};

const BASE = argOf('--base', 'http://127.0.0.1:4321').replace(/\/$/, '');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const chromePath = CHROME_CANDIDATES.find((path) => existsSync(path));
if (!chromePath) {
  console.log('○ 没有找到 Chrome，跳过交互冒烟测试（可用 CHROME_PATH 指定）');
  process.exit(0);
}

const failures = [];
const check = (label, condition, detail = '') => {
  if (condition) {
    console.log(`  ✔ ${label}${detail ? ` —— ${detail}` : ''}`);
  } else {
    console.log(`  ✖ ${label}${detail ? ` —— ${detail}` : ''}`);
    failures.push(label);
  }
};

const freePort = () =>
  new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const port = await freePort();
const chrome = spawn(
  chromePath,
  [
    '--headless',
    '--disable-gpu',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${process.env.TMPDIR ?? '/tmp'}/tsinghua-guide-e2e`,
    '--no-first-run',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

/** 等 DevTools 端口起来 */
async function waitForChrome() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return true;
    } catch {
      /* 还没起来 */
    }
    await sleep(250);
  }
  return false;
}

/** 打开一个页面并返回一个能执行 JS 的会话 */
async function openPage(url) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
    method: 'PUT',
  });
  const target = await response.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  let id = 0;
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const myId = ++id;
      const onMessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.id !== myId) return;
        ws.removeEventListener('message', onMessage);
        resolve(message.result);
      };
      ws.addEventListener('message', onMessage);
      ws.send(JSON.stringify({ id: myId, method, params }));
    });

  const evaluate = async (expression) =>
    (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result
      ?.value;

  return { evaluate, close: () => ws.close() };
}

const ready = await waitForChrome();
if (!ready) {
  console.error('✖ Chrome 没能在 10 秒内启动 DevTools 端口');
  chrome.kill();
  process.exit(1);
}

try {
  console.log(`\n课程索引页 ${BASE}/courses/`);
  const courses = await openPage(`${BASE}/courses/`);
  await sleep(2500);

  const total = await courses.evaluate(`document.querySelectorAll('[data-course]').length`);
  check('渲染出课程卡片', total > 50, `${total} 门`);

  const controlsShown = await courses.evaluate(
    `!document.querySelector('.explorer__controls').hidden`,
  );
  check('JS 可用时显示筛选控件', controlsShown === true);

  const searchResult = await courses.evaluate(`(() => {
    const input = document.querySelector('[data-course-search]');
    input.value = '数据结构';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return [...document.querySelectorAll('[data-course]')].filter((c) => !c.hidden).length;
  })()`);
  check('搜索能过滤', searchResult > 0 && searchResult < total, `剩 ${searchResult} 门`);

  const categoryResult = await courses.evaluate(`(() => {
    const input = document.querySelector('[data-course-search]');
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    // 按 data-filter/data-value 定位，别依赖具体的 class 名（class 会随样式重构变）
    [...document.querySelectorAll('[data-filter="category"]')]
      .find((chip) => chip.dataset.value === '计算机与信息')
      ?.click();
    return [...document.querySelectorAll('[data-course]')].filter((c) => !c.hidden).length;
  })()`);
  check('类别筛选能过滤', categoryResult > 0 && categoryResult < total, `剩 ${categoryResult} 门`);

  const resetResult = await courses.evaluate(`(() => {
    document.querySelector('[data-course-reset]')?.click();
    return [...document.querySelectorAll('[data-course]')].filter((c) => !c.hidden).length;
  })()`);
  check('清除筛选能还原', resetResult === total, `${resetResult} 门`);

  const emptyStateWorks = await courses.evaluate(`(() => {
    const input = document.querySelector('[data-course-search]');
    input.value = 'zzz-不存在的课程-zzz';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return !document.querySelector('[data-course-empty]').hidden;
  })()`);
  check('无结果时显示空状态', emptyStateWorks === true);

  courses.close();

  console.log(`\n常用链接页 ${BASE}/guides/links/`);
  const links = await openPage(`${BASE}/guides/links/`);
  await sleep(2000);

  const linkTotal = await links.evaluate(`document.querySelectorAll('[data-link-card]').length`);
  check('渲染出链接卡片', linkTotal > 20, `${linkTotal} 条`);

  const linkResult = await links.evaluate(`(() => {
    const input = document.querySelector('[data-link-search]');
    input.value = '图书馆';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const visible = [...document.querySelectorAll('[data-link-card]')].filter((c) => !c.hidden).length;
    const hiddenSections = [...document.querySelectorAll('[data-link-section]')].filter((s) => s.hidden).length;
    return { visible, hiddenSections };
  })()`);
  check(
    '链接搜索能过滤并收起空分组',
    linkResult.visible > 0 && linkResult.visible < linkTotal && linkResult.hiddenSections > 0,
    `剩 ${linkResult.visible} 条，收起 ${linkResult.hiddenSections} 个分组`,
  );

  links.close();

  // ── 站内搜索（Pagefind）────────────────────────────────────────────────
  // 构建成功不等于搜得到：Pagefind 的中文分词、索引路径、片段读取都可能悄悄坏掉，
  // 而页面上没有任何提示。这里直接调用构建产物里的 Pagefind API 验一次真实检索。
  console.log(`\n站内搜索（Pagefind）`);
  const search = await openPage(`${BASE}/`);
  await sleep(2000);

  const queries = await search.evaluate(`(async () => {
    const pagefind = await import('/pagefind/pagefind.js');
    if (typeof pagefind.init === 'function') { try { await pagefind.init(); } catch {} }
    if (typeof pagefind.options === 'function') { await pagefind.options({ excerptLength: 20 }); }
    const out = {};
    // 否定用例必须用纯 ASCII 生僻串：Pagefind 对中文会按字切分，
    // 「不存在的词」里的「的」「在」会命中真实页面，那是分词行为不是 bug。
    for (const q of ['绩点', '课程资料索引', '往年题', 'zzzznopequery']) {
      const result = await pagefind.search(q);
      const top = [];
      for (const item of result.results.slice(0, 3)) {
        const data = await item.data();
        top.push(new URL(data.url, location.origin).pathname);
      }
      out[q] = { count: result.results.length, top };
    }
    return out;
  })()`);

  check(
    '中文关键词能搜到结果（分词正常）',
    queries['绩点']?.count > 0,
    `「绩点」命中 ${queries['绩点']?.count ?? 0} 条，首条 ${queries['绩点']?.top?.[0] ?? '—'}`,
  );
  check(
    '「绩点」首条命中对应页面',
    (queries['绩点']?.top ?? []).some((url) => url.includes('/academics/gpa/')),
  );
  check(
    '新板块（课程索引）已被索引',
    (queries['课程资料索引']?.top ?? []).some((url) => url.includes('/courses/')),
    `命中 ${queries['课程资料索引']?.count ?? 0} 条`,
  );
  check('无意义的查询返回 0 条', queries['zzzznopequery']?.count === 0);

  search.close();
} finally {
  chrome.kill();
}

if (failures.length) {
  console.error(`\n✖ 交互冒烟测试失败：${failures.length} 项\n`);
  process.exit(1);
}
console.log('\n✔ 交互冒烟测试通过\n');
process.exit(0);
