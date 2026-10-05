#!/usr/bin/env node
/**
 * 把 src/data/ai.config.yml 编译成 dist/ai-config.json。
 *
 * 为什么要有这一步（而不是让 Worker 直接读 YAML）：
 *   1. Worker 运行时没有 YAML 解析器，也不该为了读一份配置把它塞进包里；
 *   2. 同一份配置**前端也要用**（除密钥外的部分：是否启用、示例问题、Turnstile sitekey），
 *      编译成静态 JSON 之后前端可以直接读，不必多一次接口往返；
 *   3. 这个脚本是唯一能拦住「密钥被手滑写进公开配置」的地方。
 *
 * 用法：
 *   node scripts/build-ai-config.mjs          # 普通模式
 *   node scripts/build-ai-config.mjs --stats
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = join(ROOT, 'src/data/ai.config.yml');
const OUT = join(ROOT, 'dist/ai-config.json');

/**
 * 字段名里出现这些词就认为它想装密钥 —— 公开配置里绝不允许。
 *
 * 按「下划线/连字符切出来的词」判断，而不是整串正则：
 *   `api_key` → ['api','key'] 命中；
 *   `max_tokens` → ['max','tokens'] 不命中（`tokens` 是复数，刻意不在表里）；
 *   `turnstile.sitekey` → ['sitekey'] 不命中（sitekey 是公开值，本来就该进仓库）。
 * 自由文本字段（system_prompt_extra）不做内容扫描：提示词里出现「key」这个词很正常。
 */
const SECRET_KEY_WORDS = new Set(['secret', 'password', 'passwd', 'apikey', 'key', 'token', 'credential']);
const SECRET_KEY_ALLOWLIST = new Set(['sitekey', 'max_tokens']);

function looksLikeSecretKey(key) {
  if (SECRET_KEY_ALLOWLIST.has(key.toLowerCase())) return false;
  return key
    .toLowerCase()
    .split(/[_-]/)
    .some((segment) => SECRET_KEY_WORDS.has(segment));
}

if (!existsSync(SRC)) {
  console.error(`✖ 找不到 ${SRC}`);
  process.exit(1);
}

const config = parseYaml(readFileSync(SRC, 'utf8')) ?? {};

// ── 1. 密钥守卫 ───────────────────────────────────────────────────────────
// 这是这个脚本存在的主要理由。仓库是 public、产物也是公开的，
// 一行 `api_key:` 就等于把密钥贴到了互联网上，而它不会让任何检查失败、页面照样能开。
function findSecretLikeKeys(node, path = []) {
  const found = [];
  if (!node || typeof node !== 'object') return found;
  for (const [key, value] of Object.entries(node)) {
    const here = [...path, key];
    if (looksLikeSecretKey(key)) found.push(here.join('.'));
    found.push(...findSecretLikeKeys(value, here));
  }
  return found;
}

const secretLike = findSecretLikeKeys(config);
if (secretLike.length) {
  console.error('✖ ai.config.yml 里出现了疑似密钥的字段：');
  for (const key of secretLike) console.error(`    ${key}`);
  console.error('  密钥不允许进仓库。请用 `npx wrangler secret put <名字>`，或在后台 /admin/ai/ 里填。');
  process.exit(1);
}

// ── 2. 基本一致性 ─────────────────────────────────────────────────────────
const problems = [];
const provider = config.answer?.provider;
if (provider === 'openai-compatible' && !config.answer?.base_url) {
  problems.push('answer.provider 是 openai-compatible，但 answer.base_url 是空的。');
}
if (provider === 'workers-ai' && !config.answer?.model) {
  problems.push('answer.provider 是 workers-ai，但 answer.model 是空的。');
}
if (!['workers-ai', 'openai-compatible'].includes(provider)) {
  problems.push(`answer.provider 只能是 workers-ai 或 openai-compatible，现在是「${provider}」。`);
}
if (config.turnstile?.mode === 'enforce' && !config.turnstile?.sitekey) {
  // 只警告不阻断：本地开发和首次部署时确实还没有 sitekey，
  // 但正式站**必须**配好，否则 Worker 会 fail-closed 把问答全部拒掉（这是有意的）。
  console.warn('▲ turnstile.mode = enforce 但 sitekey 为空：前端挂件渲染不出来，/api/ask 会一律 403。');
  console.warn('  创建挂件：npx wrangler turnstile widget create …（见 HANDOVER.md「AI 问答」一节）');
}
if (config.turnstile?.mode !== 'enforce' && config.turnstile?.mode !== 'off') {
  problems.push(`turnstile.mode 只能是 enforce 或 off，现在是「${config.turnstile?.mode}」。`);
}
if (problems.length) {
  console.error('✖ ai.config.yml 有问题：');
  for (const problem of problems) console.error(`    ${problem}`);
  process.exit(1);
}

// ── 3. 输出 ───────────────────────────────────────────────────────────────
const output = {
  version: 1,
  builtAt: new Date().toISOString(),
  enabled: config.enabled !== false,
  answer: {
    provider,
    model: config.answer?.model ?? '',
    base_url: config.answer?.base_url ?? '',
    model_external: config.answer?.model_external ?? '',
    temperature: typeof config.answer?.temperature === 'number' ? config.answer.temperature : 0.2,
    max_tokens: config.answer?.max_tokens ?? 700,
    system_prompt_extra: config.answer?.system_prompt_extra ?? '',
    fallback_models: Array.isArray(config.answer?.fallback_models) ? config.answer.fallback_models : [],
  },
  retrieval: {
    top_k: config.retrieval?.top_k ?? 5,
    max_per_url: config.retrieval?.max_per_url ?? 2,
    min_score: config.retrieval?.min_score ?? 0,
  },
  turnstile: {
    mode: config.turnstile?.mode ?? 'enforce',
    sitekey: config.turnstile?.sitekey ?? '',
    action: config.turnstile?.action ?? 'ask',
    hostnames: Array.isArray(config.turnstile?.hostnames) ? config.turnstile.hostnames : [],
  },
  limits: {
    max_question_chars: config.limits?.max_question_chars ?? 200,
    per_ip_per_hour: config.limits?.per_ip_per_hour ?? 12,
    daily_answers: config.limits?.daily_answers ?? 200,
    degrade_to_search: config.limits?.degrade_to_search !== false,
  },
  ui: {
    title: config.ui?.title ?? '站内问答',
    placeholder: config.ui?.placeholder ?? '输入你的问题',
    examples: Array.isArray(config.ui?.examples) ? config.ui.examples : [],
  },
};

mkdirSync(resolve(OUT, '..'), { recursive: true });
writeFileSync(OUT, JSON.stringify(output, null, 2));

if (process.argv.includes('--stats')) {
  console.log(`AI 配置：provider=${output.answer.provider} model=${output.answer.model || output.answer.model_external}`);
  console.log(`  Turnstile：mode=${output.turnstile.mode} sitekey=${output.turnstile.sitekey ? '已配置' : '未配置'}`);
  console.log(`  限额：每 IP ${output.limits.per_ip_per_hour}/小时，全站 ${output.limits.daily_answers}/天`);
  console.log(`  → ${OUT}`);
}
