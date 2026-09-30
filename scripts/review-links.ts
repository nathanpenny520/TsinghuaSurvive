#!/usr/bin/env node
/**
 * 链接人工核对工作台
 * =====================================================================
 * 解决一个具体问题：`links.ts` 里的 `reviewedAt`（「这个入口现在还是干这件事」）
 * 只有人能填，但 38 条链接一条条点开、回来改文件、再提 PR，很烦。
 *
 * 两步走：
 *
 *   1) 生成核对清单（本地 HTML，不联网、不上传任何东西）
 *        npm run review:links              # 生成 .review/link-review.html
 *        npm run review:links -- --open    # 生成并直接打开
 *
 *      在页面里逐条点「打开 → 看过 → ✓/✗」，进度存在浏览器 localStorage，
 *      关掉浏览器不会丢。核对完点「导出」，得到一个 link-review.json。
 *
 *   2) 把结果写回代码
 *        npm run review:links:apply -- ~/Downloads/link-review.json           # 只看 diff
 *        npm run review:links:apply -- ~/Downloads/link-review.json --write   # 真的改
 *
 *      ✓ 的条目会被写上 `reviewedAt: '<导出日期>'`；✗ 且填了新地址的会替换 `url`
 *      （同样记 reviewedAt，因为你已经确认过新地址）；✗ 且只是备注的会写进
 *      `.review/link-issues.md`，需要你自己决定怎么改。
 *
 * 为什么不用在线表单：核对链接需要先在校园网/校外分别打开看，本地工具最省事，
 * 而且不涉及任何账号、不上传任何数据。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { campusLinks } from '../src/data/links.ts';
import linkStatus from '../src/data/link-status.json' with { type: 'json' };

const ROOT = resolve(import.meta.dirname, '..');
const OUT_DIR = join(ROOT, '.review');
const HTML_OUT = join(OUT_DIR, 'link-review.html');
const ISSUES_OUT = join(OUT_DIR, 'link-issues.md');
const LINKS_TS = join(ROOT, 'src/data/links.ts');

const args = process.argv.slice(2);
const takeFlag = (name: string) => args.includes(name);
const takeValue = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const status = linkStatus as {
  checkedAt: string;
  results: Record<string, { ok: boolean; status: number | null; error?: string }>;
};

const today = new Date().toISOString().slice(0, 10);

// ── 第 2 步：把核对结果写回 links.ts ────────────────────────────────────

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 找到某个 url 所在的条目在行数组里的范围 [urlLine, endLine) */
function findEntry(lines: string[], url: string): { urlLine: number; endLine: number } | null {
  const urlLine = lines.findIndex((line) => new RegExp(`^\\s*url:\\s*'${escapeRegExp(url)}',?\\s*$`).test(line));
  if (urlLine === -1) return null;
  for (let i = urlLine + 1; i < lines.length; i += 1) {
    if (/^\s{2}\},?\s*$/.test(lines[i])) return { urlLine, endLine: i };
  }
  return null;
}

type ReviewResult = { status?: string; newUrl?: string; note?: string };

function applyReview(file?: string) {
  if (!file || !existsSync(file)) {
    console.error(`✖ 找不到核对结果文件：${file ?? '(没给路径)'}`);
    console.error('   用法：npm run review:links:apply -- ~/Downloads/link-review.json [--write]');
    process.exit(1);
  }

  const payload = JSON.parse(readFileSync(file, 'utf8')) as {
    reviewedAt?: string;
    reviewer?: string;
    results?: Record<string, ReviewResult>;
  };
  const reviewedAt = typeof payload.reviewedAt === 'string' ? payload.reviewedAt : today;
  const results: Record<string, ReviewResult> = payload.results ?? {};
  const write = takeFlag('--write');

  const lines = readFileSync(LINKS_TS, 'utf8').split('\n');
  const changes = [];
  const issues = [];

  for (const [url, result] of Object.entries(results)) {
    const entry = findEntry(lines, url);
    if (!entry) {
      issues.push(`- ⚠️ 结果里的链接在 links.ts 里找不到（可能已被改过）：${url}`);
      continue;
    }

    if (result.status === 'issue' && !result.newUrl) {
      issues.push(`- ✗ **${url}**\n  - 备注：${result.note || '（没写）'}`);
      continue;
    }

    const name = lines
      .slice(Math.max(0, entry.urlLine - 8), entry.urlLine)
      .join(' ')
      .match(/name:\s*'([^']+)'/)?.[1];

    // 1) 有新地址就替换
    if (result.status === 'issue' && result.newUrl) {
      lines[entry.urlLine] = `    url: '${result.newUrl}',`;
      changes.push(`  · ${name ?? url}：更换地址 → ${result.newUrl}`);
    }

    // 2) 写入 / 更新 reviewedAt（在条目结尾之前插入）
    const body = lines.slice(entry.urlLine, entry.endLine);
    const existing = body.findIndex((line) => /^\s*reviewedAt:/.test(line));
    if (existing >= 0) {
      const line = entry.urlLine + existing;
      if (lines[line].includes(`'${reviewedAt}'`)) {
        changes.push(`  · ${name ?? url}：reviewedAt 已经是 ${reviewedAt}，跳过`);
        continue;
      }
      lines[line] = `    reviewedAt: '${reviewedAt}',`;
      changes.push(`  · ${name ?? url}：更新 reviewedAt → ${reviewedAt}`);
    } else {
      lines.splice(entry.endLine, 0, `    reviewedAt: '${reviewedAt}',`);
      changes.push(`  · ${name ?? url}：记上 reviewedAt = ${reviewedAt}`);
    }
  }

  console.log(`\n核对结果：${Object.keys(results).length} 条，可写入 ${changes.length} 条${write ? '' : '（预览模式，未改动文件）'}\n`);
  for (const line of changes) console.log(line);

  if (issues.length) {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(
      ISSUES_OUT,
      `# 核对时标记为「有问题」的链接\n\n导出日期：${reviewedAt}\n\n${issues.join('\n')}\n`,
    );
    console.log(`\n有 ${issues.length} 条标记了问题，已写入 ${ISSUES_OUT}（这些条目不会自动改，需要你自己决定怎么处理）`);
  }

  if (!write) {
    console.log('\n确认无误后加 --write 真正写入：');
    console.log(`  npm run review:links:apply -- ${file} --write\n`);
    return;
  }

  writeFileSync(LINKS_TS, lines.join('\n'));
  console.log(`\n✔ 已写回 ${LINKS_TS}`);
  console.log('  接着跑：npm run check:content && npm run build\n');
}

// ── 第 1 步：生成核对清单 ──────────────────────────────────────────────

function generateHtml({ reviewer = '' } = {}) {
  /** 把数据塞进 HTML 里，页面完全离线可用 */
  const items = campusLinks.map((link) => ({
    name: link.name,
    url: link.url,
    desc: link.desc,
    group: link.group,
    reach: link.reach,
    origin: link.origin ?? '',
    note: link.note ?? '',
    reviewedAt: link.reviewedAt ?? '',
    probe: status.results[link.url]
      ? status.results[link.url].ok
        ? `可访问（${status.results[link.url].status}）`
        : `实测打不开（${status.results[link.url].error ?? status.results[link.url].status}）`
      : '无实测记录',
    probeOk: status.results[link.url]?.ok !== false,
  }));

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>链接人工核对 · 清华生存指南</title>
<style>
  :root { color-scheme: dark; --bg:#16171d; --card:#1d1f27; --line:#33363f; --fg:#e8e9ed; --dim:#9aa0ad; --accent:#c39bf5; --ok:#6fd39b; --bad:#f08b8b; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.7 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
  header { position: sticky; top:0; background:rgba(22,23,29,.96); backdrop-filter: blur(6px); border-bottom:1px solid var(--line); padding:12px 20px; z-index:10; }
  h1 { margin:0 0 6px; font-size:17px; }
  .bar { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
  .bar button { background:#2a2d37; color:var(--fg); border:1px solid var(--line); border-radius:6px; padding:5px 10px; cursor:pointer; font-size:13px; }
  .bar button:hover { border-color:var(--accent); }
  .bar button.primary { background:#3a2c50; border-color:var(--accent); }
  .progress { flex:1 1 160px; height:8px; background:#2a2d37; border-radius:99px; overflow:hidden; min-width:120px; }
  .progress > i { display:block; height:100%; background:var(--accent); width:0; }
  .count { color:var(--dim); font-variant-numeric: tabular-nums; }
  main { max-width: 880px; margin:0 auto; padding:16px 20px 80px; }
  .hint { color:var(--dim); font-size:13px; margin:10px 0 18px; }
  .card { background:var(--card); border:1px solid var(--line); border-left:4px solid var(--line); border-radius:8px; padding:12px 14px; margin-bottom:12px; }
  .card[data-status="ok"] { border-left-color: var(--ok); }
  .card[data-status="issue"] { border-left-color: var(--bad); }
  .card.probe-bad { background:#241c1c; }
  .card h2 { margin:0 0 4px; font-size:15px; }
  .card a { color:var(--accent); word-break: break-all; }
  .meta { color:var(--dim); font-size:12px; }
  .tags { display:flex; flex-wrap:wrap; gap:6px; margin:6px 0; }
  .tag { font-size:12px; border:1px solid var(--line); border-radius:99px; padding:1px 8px; color:var(--dim); }
  .tag.bad { color:var(--bad); border-color:#5a3535; }
  .desc { margin:6px 0; }
  .actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
  .actions button { border-radius:6px; padding:5px 12px; cursor:pointer; border:1px solid var(--line); background:#2a2d37; color:var(--fg); }
  .actions button.ok[aria-pressed="true"] { background:#1f3a2c; border-color:var(--ok); color:var(--ok); }
  .actions button.issue[aria-pressed="true"] { background:#3a2222; border-color:var(--bad); color:var(--bad); }
  .issue-box { display:none; margin-top:8px; gap:6px; flex-direction:column; }
  .issue-box.open { display:flex; }
  .issue-box input, .issue-box textarea { background:#14151a; color:var(--fg); border:1px solid var(--line); border-radius:6px; padding:6px 8px; font:inherit; width:100%; }
  .issue-box textarea { min-height:52px; resize:vertical; }
  kbd { background:#2a2d37; border:1px solid var(--line); border-bottom-width:2px; border-radius:4px; padding:0 4px; font-size:12px; }
  .done { opacity:.62; }
</style>
</head>
<body>
<header>
  <h1>链接人工核对清单 <span class="count" id="count"></span></h1>
  <div class="bar">
    <div class="progress"><i id="bar"></i></div>
    <button id="filter-todo">只看未核对</button>
    <button id="filter-all">显示全部</button>
    <button id="mark-rest">其余全部标为「已核对」</button>
    <button class="primary" id="export">导出 link-review.json</button>
    <button id="reset">清空本地记录</button>
  </div>
</header>
<main>
  <p class="hint">
    逐条点「打开」（或按 <kbd>o</kbd>），看完内容后按 <kbd>y</kbd> 记「没问题」，按 <kbd>n</kbd> 记「有问题」并填新地址或备注。
    <kbd>j</kbd>/<kbd>k</kbd> 上下移动。标记过的卡片会留在原位变暗（切换筛选时才重新排列），进度存在浏览器本地，关掉页面不会丢。
    核对的是「这个入口现在还是干这件事吗」——链接能不能打开已经由 <code>npm run check:links</code> 实测过。
  </p>
  <div id="list"></div>
</main>
<script>
  var ITEMS = ${JSON.stringify(items)};
  var STORE = 'tsinghua-guide-link-review-v1';
  var state = JSON.parse(localStorage.getItem(STORE) || '{}');
  var filter = 'todo';
  var cursor = 0;

  function save() { localStorage.setItem(STORE, JSON.stringify(state)); }
  function entryOf(url) { return state[url] || (state[url] = { status: '', newUrl: '', note: '' }); }
  function reviewed(url) { return state[url] && state[url].status; }

  function render() {
    var list = document.getElementById('list');
    list.innerHTML = '';
    var shown = 0;
    ITEMS.forEach(function (item, index) {
      var done = reviewed(item.url);
      if (filter === 'todo' && done) return;
      shown += 1;
      var st = state[item.url] || { status: '', newUrl: '', note: '' };
      var card = document.createElement('section');
      card.className = 'card' + (done ? ' done' : '') + (item.probeOk ? '' : ' probe-bad');
      card.dataset.status = st.status || '';
      card.dataset.index = String(index);
      card.innerHTML =
        '<h2>' + (index + 1) + '. ' + esc(item.name) + '</h2>' +
        '<div class="tags">' +
          '<span class="tag">' + esc(item.group) + '</span>' +
          '<span class="tag">' + esc(item.reach) + '</span>' +
          '<span class="tag' + (item.probeOk ? '' : ' bad') + '">' + esc(item.probe) + '</span>' +
          (item.reviewedAt ? '<span class="tag">已核对 ' + esc(item.reviewedAt) + '</span>' : '<span class="tag">未核对</span>') +
          (item.origin ? '<span class="tag">来源：' + esc(item.origin) + '</span>' : '') +
        '</div>' +
        '<div class="desc">' + esc(item.desc) + '</div>' +
        (item.note ? '<div class="meta">提示：' + esc(item.note) + '</div>' : '') +
        '<div class="meta"><a href="' + esc(item.url) + '" target="_blank" rel="noopener">' + esc(item.url) + '</a></div>' +
        '<div class="actions">' +
          '<button class="open">打开（o）</button>' +
          '<button class="ok" aria-pressed="' + (st.status === 'ok') + '">✓ 没问题（y）</button>' +
          '<button class="issue" aria-pressed="' + (st.status === 'issue') + '">✗ 有问题（n）</button>' +
        '</div>' +
        '<div class="issue-box' + (st.status === 'issue' ? ' open' : '') + '">' +
          '<input class="new-url" placeholder="新地址（如果入口搬了；留空表示只写备注，不会自动改）" value="' + esc(st.newUrl || '') + '" />' +
          '<textarea class="note" placeholder="备注：哪里不对、现在该去哪找">' + esc(st.note || '') + '</textarea>' +
        '</div>';

      card.querySelector('.open').addEventListener('click', function () { window.open(item.url, '_blank', 'noopener'); });
      card.querySelector('.ok').addEventListener('click', function () { setStatus(item.url, 'ok', card); });
      card.querySelector('.issue').addEventListener('click', function () { setStatus(item.url, 'issue', card); });
      card.querySelector('.new-url').addEventListener('input', function (e) { entryOf(item.url).newUrl = e.target.value; save(); });
      card.querySelector('.note').addEventListener('input', function (e) { entryOf(item.url).note = e.target.value; save(); });
      card.addEventListener('click', function () { cursor = index; });
      list.appendChild(card);
    });

    if (!shown) {
      list.innerHTML = '<p class="hint">这个筛选下没有条目了。点上面的「显示全部」或「导出」继续。</p>';
    }
    updateProgress();
  }

  // 只更新这一张卡片，不整表重绘：否则在「只看未核对」筛选下，标记完的卡片会立刻消失，
  // 后面的卡片向上顶，很容易连着标错下一条。
  function setStatus(url, status, card) {
    var entry = entryOf(url);
    entry.status = entry.status === status ? '' : status;
    save();
    if (card) {
      card.dataset.status = entry.status || '';
      card.classList.toggle('done', Boolean(entry.status));
      card.querySelector('.ok').setAttribute('aria-pressed', String(entry.status === 'ok'));
      card.querySelector('.issue').setAttribute('aria-pressed', String(entry.status === 'issue'));
      card.querySelector('.issue-box').classList.toggle('open', entry.status === 'issue');
      if (entry.status === 'issue') card.querySelector('.new-url').focus();
    }
    updateProgress();
  }

  function updateProgress() {
    var done = ITEMS.filter(function (i) { return reviewed(i.url); }).length;
    document.getElementById('count').textContent = done + ' / ' + ITEMS.length + ' 已核对';
    document.getElementById('bar').style.width = (done / ITEMS.length * 100).toFixed(1) + '%';
  }

  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  document.getElementById('filter-todo').addEventListener('click', function () { filter = 'todo'; render(); });
  document.getElementById('filter-all').addEventListener('click', function () { filter = 'all'; render(); });

  document.getElementById('mark-rest').addEventListener('click', function () {
    if (!confirm('把还没标记的条目全部标成「已核对」？只在你确实逐条打开看过之后再用。')) return;
    ITEMS.forEach(function (item) {
      if (!reviewed(item.url)) entryOf(item.url).status = 'ok';
    });
    save();
    render();
  });

  document.getElementById('filter-all').addEventListener('dblclick', function () {
    /* 双击「显示全部」不做额外事情：留个位置给未来的快捷操作 */
  });

  document.getElementById('reset').addEventListener('click', function () {
    if (!confirm('清空浏览器里保存的核对记录？')) return;
    state = {};
    save();
    render();
  });

  document.getElementById('export').addEventListener('click', function () {
    var results = {};
    ITEMS.forEach(function (item) {
      var st = state[item.url];
      if (st && st.status) {
        results[item.url] = { status: st.status, newUrl: st.newUrl || '', note: st.note || '' };
      }
    });
    var payload = { reviewedAt: '${today}', reviewer: ${JSON.stringify(reviewer)}, results: results };
    var text = JSON.stringify(payload, null, 2);
    var blob = new Blob([text], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'link-review.json';
    a.click();
    navigator.clipboard && navigator.clipboard.writeText(text).catch(function () {});
    alert('已导出 link-review.json（同时尝试复制到剪贴板）。\\n\\n下一步在项目目录里跑：\\n' +
      'npm run review:links:apply -- ~/Downloads/link-review.json\\n' +
      '确认 diff 无误后加 --write。');
  });

  document.addEventListener('keydown', function (event) {
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;
    var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
    if (!cards.length) return;
    var current = cards.findIndex(function (c) { return Number(c.dataset.index) === cursor; });
    var key = event.key.toLowerCase();
    if (key === 'j' || key === 'k') {
      var next = key === 'j' ? Math.min(cards.length - 1, (current < 0 ? -1 : current) + 1)
                             : Math.max(0, (current < 0 ? 1 : current) - 1);
      var card = cards[next];
      cursor = Number(card.dataset.index);
      card.scrollIntoView({ block: 'center', behavior: 'smooth' });
      event.preventDefault();
      return;
    }
    var target = cards.find(function (c) { return Number(c.dataset.index) === cursor; }) || cards[0];
    if (!target) return;
    if (key === 'o') target.querySelector('.open').click();
    if (key === 'y') target.querySelector('.ok').click();
    if (key === 'n') { target.querySelector('.issue').click(); setTimeout(function () { target.querySelector('.new-url').focus(); }, 50); }
  });

  render();
</script>
</body>
</html>
`;
}

// ── 入口 ───────────────────────────────────────────────────────────────

const applyFile = takeValue('--apply') ?? (args[0] && !args[0].startsWith('--') ? args[0] : undefined);

if (applyFile) {
  applyReview(applyFile);
} else {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(HTML_OUT, generateHtml({ reviewer: takeValue('--reviewer') ?? '' }));

  const pending = campusLinks.filter((link) => !link.reviewedAt).length;
  const broken = campusLinks.filter((link) => status.results[link.url]?.ok === false).length;

  console.log(`✔ 核对清单已生成：${HTML_OUT}`);
  console.log(`  待人工核对 ${pending} / ${campusLinks.length} 条${broken ? `；其中实测打不开 ${broken} 条（清单里用红底标出）` : ''}`);
  console.log('\n  打开它，逐条看完点 ✓ / ✗，然后导出 link-review.json：');
  console.log('    npm run review:links -- --open');
  console.log('    npm run review:links:apply -- ~/Downloads/link-review.json        # 看 diff');
  console.log('    npm run review:links:apply -- ~/Downloads/link-review.json --write # 写回代码\n');

  if (takeFlag('--open')) {
    try {
      execFileSync('open', [HTML_OUT], { stdio: 'ignore' });
      console.log('  已在浏览器中打开。\n');
    } catch {
      console.log('  （自动打开失败，请手动打开上面那个文件）\n');
    }
  }
}
