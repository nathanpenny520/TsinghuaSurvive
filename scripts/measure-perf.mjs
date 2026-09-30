#!/usr/bin/env node
/**
 * 本地性能实测 —— 用无头 Chrome 打开真实构建产物，量一次「打开一页到底要多少字节、多少请求、多久」。
 *
 * 为什么不用 Lighthouse：它要装依赖。这个脚本只用 Chrome 的 DevTools 协议 + 浏览器自带的
 * Navigation/Resource Timing API，够回答「这个页面重不重、有没有失控」。
 *
 * 用法：
 *   npm run build
 *   npx http-server dist -p 4321 &             # 或 npm run preview
 *   npm run measure:perf -- --base http://127.0.0.1:4321
 *
 * ⚠️ 三个必须知道的局限（读数字之前先看）：
 *   1. 本地静态服务器**不做 gzip/brotli**，所以 transferSize 偏大；脚本会额外算一遍
 *      HTML 的 gzip 大小，那个数字更接近 Cloudflare 上的真实传输量。
 *   2. 只跑一次、单机、无网络延迟模拟 —— 这是「量级参考」，不是实验室数据。
 *   3. 校园网内的真实体验还受出口和国际链路影响，这个脚本测不出来。
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { gzipSync } from 'node:zlib';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};

const BASE = argOf('--base', 'http://127.0.0.1:4321').replace(/\/$/, '');
const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');

const PAGES = [
  { path: '/', label: '首页' },
  { path: '/courses/', label: '课程资料索引（最重的一页）' },
  { path: '/guides/links/', label: '校内常用链接' },
  { path: '/skills/', label: '技能入门' },
];

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
  console.log('○ 没有找到 Chrome，跳过性能实测（可用 CHROME_PATH 指定）');
  process.exit(0);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const freePort = () =>
  new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

const port = await freePort();
const chrome = spawn(
  chromePath,
  [
    '--headless',
    '--disable-gpu',
    // 这两个参数和 e2e-smoke.mjs 里的是同一组，原因见那里的注释：
    // Chrome 111 起 DevTools 的 WebSocket 会校验 Origin（Node 客户端要放行），
    // 受限环境里 Chrome 自己的沙箱起不来会让渲染进程直接崩、evaluate 永不返回。
    '--remote-allow-origins=*',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${process.env.TMPDIR ?? '/tmp'}/tsinghua-guide-perf`,
    '--no-first-run',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

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

const ready = await waitForChrome();
if (!ready) {
  console.error('✖ Chrome 没能在 10 秒内启动 DevTools 端口');
  chrome.kill();
  process.exit(1);
}

const results = [];

try {
  for (const page of PAGES) {
    const response = await fetch(
      `http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`,
      { method: 'PUT' },
    );
    const target = await response.json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));

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

    await send('Network.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Page.enable');
    await send('Page.navigate', { url: `${BASE}${page.path}` });
    // 等页面稳定：导航完成 + 客户端脚本跑完
    await sleep(2500);

    const metrics = (
      await send('Runtime.evaluate', {
        expression: `(() => {
          const nav = performance.getEntriesByType('navigation')[0] ?? {};
          const resources = performance.getEntriesByType('resource');
          const sum = (list) => list.reduce((total, item) => total + (item.transferSize || 0), 0);
          const byType = (type) => resources.filter((item) => item.initiatorType === type);
          return {
            ttfb: Math.round(nav.responseStart ?? 0),
            domContentLoaded: Math.round(nav.domContentLoadedEventEnd ?? 0),
            load: Math.round(nav.loadEventEnd ?? 0),
            htmlTransfer: nav.transferSize ?? 0,
            htmlDecoded: nav.decodedBodySize ?? 0,
            requests: resources.length,
            resourcesTransfer: sum(resources),
            scriptBytes: sum(byType('script')),
            scriptCount: byType('script').length,
            cssBytes: sum(byType('link')),
            imgBytes: sum(byType('img')),
            fontBytes: sum(resources.filter((item) => /\\.(woff2?|ttf)(\\?|$)/.test(item.name))),
          };
        })()`,
        returnByValue: true,
      })
    ).result.value;

    const htmlFile = join(DIST, page.path.replace(/^\//, ''), 'index.html');
    const indexPath = htmlFile.endsWith('index.html') ? htmlFile : join(DIST, 'index.html');
    const htmlPath = existsSync(htmlFile) ? htmlFile : indexPath;
    const gzip = existsSync(htmlPath) ? gzipSync(readFileSync(htmlPath)).length : 0;

    results.push({ ...page, ...metrics, htmlGzip: gzip });
    ws.close();
  }
} finally {
  chrome.kill();
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const ms = (value) => `${value} ms`;

console.log(`\n本地实测（${BASE}）—— 单次加载、禁用缓存、无网络延迟模拟\n`);
console.log(
  ['页面', '请求数', 'HTML(gzip)', 'HTML(原始)', 'JS', 'CSS', '资源合计', 'TTFB', 'DCL', 'Load'].join('\t'),
);
for (const line of results) {
  console.log(
    [
      line.label,
      line.requests,
      kb(line.htmlGzip),
      kb(line.htmlTransfer),
      `${kb(line.scriptBytes)} / ${line.scriptCount} 个`,
      kb(line.cssBytes),
      kb(line.resourcesTransfer),
      ms(line.ttfb),
      ms(line.domContentLoaded),
      ms(line.load),
    ].join('\t'),
  );
}

console.log(`\n说明：`);
console.log(`  · HTML(gzip) 是把构建产物 gzip 一遍的结果，最接近 Cloudflare 上的真实传输量；`);
console.log(`  · HTML(原始)/JS/CSS/资源合计来自浏览器计时 API，本机服务器不压缩，所以偏大；`);
console.log(`  · 想要更权威的数字（LCP/CLS/INP），请用 PageSpeed Insights 或 Lighthouse。`);
