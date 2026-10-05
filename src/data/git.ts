/**
 * Git 元信息 —— 「这个站是谁在维护、最近改了什么」这件事，不该靠人手工维护一份清单。
 *
 * 借鉴了 mkdocs 生态里的两个插件（git-revision-date-localized / git-authors）：
 * 它们把「最后更新时间」和「贡献者统计」直接从 Git 历史里读出来。
 * 这里用 `git log` 做同样的事，构建时执行，缺失历史时静默降级。
 *
 * ⚠️ CI 里必须 `fetch-depth: 0`，否则只有最后一个 commit，统计会失真。
 *    （.github/workflows/deploy.yml 已经这么配了，原因也写在那里。）
 */
import { execFileSync } from 'node:child_process';

export type Commit = {
  hash: string;
  /** YYYY-MM-DD */
  date: string;
  author: string;
  subject: string;
  /** 从 conventional commit 前缀里解析出来的类型，例如 feat / fix / docs */
  type: string;
  /** 去掉前缀之后的描述 */
  text: string;
};

export type Contributor = {
  name: string;
  commits: number;
  first: string;
  last: string;
  /** 他改过的文章数（只统计 src/content/docs 下的文件） */
  pages: number;
};

const SEP = '\u001f';

function run(args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      timeout: 15_000,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    // 没有 git、没有历史、或者根本不是仓库：都当作「拿不到」，页面降级显示
    return null;
  }
}

const TYPES: Record<string, string> = {
  feat: '新功能',
  fix: '修复',
  docs: '文档',
  content: '内容',
  ci: '构建与部署',
  chore: '杂项',
  refactor: '重构',
  style: '样式',
  perf: '性能',
  test: '测试',
  revert: '回滚',
};

let commitCache: Commit[] | null = null;

/**
 * 提交标题是**纯文本**渲染的（更新日志页用 <span> 直接印），不解析 Markdown。
 * 所以标题里写了 `**加粗**` 的话，星号会原样显示在页面上——`npm run check:markup`
 * 会把它当成缺陷拦下来（它数的是产物里的可见文本，认不出这行字其实来自 git log）。
 * 提交信息不受作者之外的人控制、也不该让整站部署失败，所以在这里统一去掉强调标记。
 */
function plainText(raw: string): string {
  return raw
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** 最近提交（按时间倒序）。拿不到 git 历史时返回空数组。 */
export function recentCommits(limit = 200): Commit[] {
  if (!commitCache) {
    const raw = run(['log', `--max-count=500`, `--pretty=format:%H${SEP}%ad${SEP}%an${SEP}%s`, '--date=short']);
    commitCache = raw
      ? raw
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const [hash = '', date = '', author = '', subject = ''] = line.split(SEP);
            const match = subject.match(/^(\w+)(?:\(([^)]*)\))?:\s*(.+)$/);
            const type = match ? match[1]!.toLowerCase() : 'other';
            return {
              hash: hash.slice(0, 7),
              date,
              author,
              subject: plainText(subject),
              type,
              text: plainText(match ? match[3]! : subject),
            };
          })
      : [];
  }
  return commitCache.slice(0, limit);
}

export function commitTypes(): { type: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const commit of recentCommits(500)) {
    counts.set(commit.type, (counts.get(commit.type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, label: TYPES[type] ?? '其他', count }))
    .sort((a, b) => b.count - a.count);
}

/** 贡献者统计：提交数、首次/最近提交日期、改过的文章数 */
export function contributors(): Contributor[] {
  const raw = run([
    'log',
    '--pretty=format:@@@%an' + SEP + '%ad',
    '--date=short',
    '--name-only',
  ]);
  if (!raw) return [];

  const stats = new Map<string, { commits: number; first: string; last: string; pages: Set<string> }>();
  let current: string | null = null;

  for (const line of raw.split('\n')) {
    if (line.startsWith('@@@')) {
      const [name = '', date = ''] = line.slice(3).split(SEP);
      if (!name) continue;
      const entry = stats.get(name) ?? { commits: 0, first: date, last: date, pages: new Set<string>() };
      entry.commits += 1;
      if (date && date < entry.first) entry.first = date;
      if (date && date > entry.last) entry.last = date;
      stats.set(name, entry);
      current = name;
    } else if (line.startsWith('src/content/docs/') && current) {
      stats.get(current)?.pages.add(line);
    }
  }

  return [...stats.entries()]
    .map(([name, entry]) => ({
      name,
      commits: entry.commits,
      first: entry.first,
      last: entry.last,
      pages: entry.pages.size,
    }))
    .sort((a, b) => b.commits - a.commits || a.name.localeCompare(b.name));
}

const fileDateCache = new Map<string, Date | null>();

/**
 * 某个文件最后一次被改动的日期（`git log -1 -- <path>`）。
 * 拿不到 git 历史时返回 null —— 调用方自己决定要不要退回到别的日期，这里不编。
 */
export function fileLastUpdated(relativePath: string): Date | null {
  if (fileDateCache.has(relativePath)) return fileDateCache.get(relativePath) ?? null;
  const raw = run(['log', '-1', '--format=%ad', '--date=short', '--', relativePath]);
  const value = raw?.trim();
  const date = value ? new Date(`${value}T00:00:00Z`) : null;
  fileDateCache.set(relativePath, date);
  return date;
}

/**
 * 全站最近一次更新的日期。
 * 只统计内容与代码目录，避免日志、缓存文件的改动把日期顶到最新。
 */
export function lastContentUpdate(): string | null {
  const raw = run([
    'log',
    '-1',
    '--pretty=format:%ad',
    '--date=short',
    '--',
    'src',
    'scripts',
    'astro.config.mjs',
  ]);
  return raw?.trim() || null;
}

/** 文章 frontmatter 里署名的作者（去重，排除占位符） */
export function signedAuthors(all: string[]): string[] {
  const placeholders = new Set(['待补充', 'TODO', '']);
  return [...new Set(all.map((a) => a.trim()))].filter((a) => a && !placeholders.has(a));
}
