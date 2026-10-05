#!/usr/bin/env node
/**
 * 站内 AI 问答的端到端检查 —— 直接在 Node 里跑 Worker 的入口函数。
 *
 * 为什么不去起 `wrangler dev` 做这件事：
 *   1. CI 里起一个运行时、开端口、等就绪，慢且脆（跑不通的时候还分不清是代码坏了还是环境坏了）；
 *   2. 这条链路上真正会出错的地方**大多不是 Cloudflare 特有的**：
 *      参数校验、闸门顺序、NDJSON 分帧、引用编号、鉴权、降级行为——用真的入口函数跑一遍就覆盖了。
 *   3. 桩掉两样东西就够了：AI 绑定（返回一段假的 SSE 流）与 Durable Object 的存储
 *      （Map 顶替）。**用的是真的 AskGate 类、真的检索、真的提示词拼装**。
 *
 * 测不到、需要真环境验证的只有两件，都写在 HANDOVER.md 的「AI 问答」一节里：
 *   - Workers AI 真实推理（模型名/额度/返回格式）
 *   - 真实 Turnstile 挂件签发的 token
 *
 * 用法：
 *   npm run build && npm run check:ai:worker
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import worker, { resetConfigCache } from '../src/worker/index.js';
import { AskGate } from '../src/worker/gate.js';
import { verifyTurnstile } from '../src/worker/turnstile.js';
import { resetKnowledgeCache } from '../src/worker/retrieval.js';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');

const results = [];
function check(name, passed, detail = '') {
  results.push({ name, passed, detail });
  console.log(`${passed ? '✅' : '❌'} ${name}${detail && !passed ? ` —— ${detail}` : ''}`);
}

// ── 测试替身 ──────────────────────────────────────────────────────────────

/** 假的 SSE 流：把整段切成小块推出去，其中一刀刻意切在一行中间，用来测分帧缓冲 */
function sseStream(pieces) {
  const encoder = new TextEncoder();
  const payload = pieces.map((piece) => `data: ${JSON.stringify({ response: piece })}\n\n`).join('') + 'data: [DONE]\n\n';
  // 故意在 17 字节处断开：一次 read 只拿到半行
  const split = 17;
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(payload.slice(0, split)));
      controller.enqueue(encoder.encode(payload.slice(split)));
      controller.close();
    },
  });
}

function makeEnv({ configPatch = {}, ai, stores } = {}) {
  // 配置在 Worker 里是按 isolate memoize 的（生产上是对的），同一个进程里跑多组配置时必须显式清掉
  resetConfigCache();
  const store = stores ?? new Map();
  const state = {
    storage: {
      get: async (key) => store.get(key),
      put: async (key, value) => {
        store.set(key, value);
      },
      delete: async (key) => {
        store.delete(key);
      },
    },
  };
  const env = {
    ASSETS: {
      fetch: async (request) => {
        const path = new URL(request.url).pathname;
        if (path === '/ai-config.json') {
          const base = JSON.parse(readFileSync(join(DIST, 'ai-config.json'), 'utf8'));
          return Response.json({ ...base, ...configPatch });
        }
        const file = path === '/' ? join(DIST, 'index.html') : join(DIST, path.slice(1));
        try {
          return new Response(readFileSync(file));
        } catch {
          return new Response('not found', { status: 404 });
        }
      },
    },
    AI: ai ?? { run: async () => sseStream(['测试', '回答']) },
    TURNSTILE_HOSTNAMES: 'example.com',
    TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
    ADMIN_TOKEN: 'test-admin-token',
    CONFIG_ENC_KEY: 'test-encryption-key',
    __store: store,
  };
  const gate = new AskGate(state, env);
  env.ASK_GATE = {
    idFromName: (name) => name,
    get: () => ({ fetch: (input, init) => gate.fetch(new Request(input, init)) }),
  };
  return env;
}

async function post(path, body, env, headers = {}) {
  return worker.fetch(
    new Request(`https://tsinghua.nathanpenny.fun${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
    env,
    { waitUntil() {} },
  );
}

/** 把 NDJSON 响应读成事件数组 */
async function readNdjson(response) {
  const text = await response.text();
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { type: 'unparsable', line };
      }
    });
}

const okConfig = { turnstile: { mode: 'off', sitekey: '', action: 'ask', hostnames: [] }, enabled: true };

// ── 1. 公开配置 ───────────────────────────────────────────────────────────
{
  const env = makeEnv({ configPatch: okConfig });
  const response = await worker.fetch(new Request('https://x/api/ai-config'), env, { waitUntil() {} });
  const body = await response.json();
  check('GET /api/ai-config 返回公开配置', response.ok && body.enabled === true && 'examples' in body.ui, JSON.stringify(body).slice(0, 120));
  check('公开配置不泄露密钥字段', !JSON.stringify(body).match(/secret|apikey|admin/i), JSON.stringify(body).slice(0, 120));
}

// ── 2. 入参校验 ───────────────────────────────────────────────────────────
{
  const env = makeEnv({ configPatch: okConfig });
  const short = await post('/api/ask', { question: '啊' }, env);
  check('问题过短 → 400', short.status === 400, `status=${short.status}`);

  const long = await post('/api/ask', { question: '绩'.repeat(500) }, env);
  check('问题过长 → 400', long.status === 400, `status=${long.status}`);

  const getResponse = await worker.fetch(new Request('https://x/api/ask'), env, { waitUntil() {} });
  check('GET /api/ask → 405', getResponse.status === 405, `status=${getResponse.status}`);

  const disabled = await post('/api/ask', { question: '绩点怎么算' }, makeEnv({ configPatch: { ...okConfig, enabled: false } }));
  check('未启用 → 503', disabled.status === 503, `status=${disabled.status}`);
}

// ── 3. 相关度闸门：站里没有的内容不去问模型 ───────────────────────────────
{
  let modelCalls = 0;
  const env = makeEnv({
    configPatch: okConfig,
    ai: {
      run: async () => {
        modelCalls += 1;
        return sseStream(['不该被调用']);
      },
    },
  });
  const response = await post('/api/ask', { question: '量子力学的哈密顿量怎么求' }, env);
  const events = await readNdjson(response);
  const notice = events.find((event) => event.type === 'notice');
  check('无关提问 → 不调用模型', modelCalls === 0, `modelCalls=${modelCalls}`);
  check('无关提问 → 200 + notice(no_answer)', response.status === 200 && notice?.code === 'no_answer', JSON.stringify(events).slice(0, 160));
  check('无关提问 → 仍然给出兜底文章链接', Array.isArray(notice?.sources) && notice.sources.length > 0, JSON.stringify(notice?.sources ?? null).slice(0, 120));
}

// ── 4. 正常问答：NDJSON 流、来源在前、正文分片、结束标记 ──────────────────
{
  let modelCalls = 0;
  let received = null;
  const env = makeEnv({
    configPatch: okConfig,
    ai: {
      run: async (model, options) => {
        modelCalls += 1;
        received = { model, options };
        return sseStream(['绩点是', '按课程', '加权的。[1]']);
      },
    },
  });
  const response = await post('/api/ask', { question: '绩点是怎么算的？' }, env);
  check('正常问答 → Content-Type 是 NDJSON', (response.headers.get('content-type') || '').includes('ndjson'), response.headers.get('content-type') || '');

  const events = await readNdjson(response);
  const sources = events.find((event) => event.type === 'sources');
  const deltas = events.filter((event) => event.type === 'delta');
  const done = events.find((event) => event.type === 'done');

  check('第一件事是给出引用来源', events[0]?.type === 'sources' && Array.isArray(sources?.sources), JSON.stringify(events[0]).slice(0, 120));
  check('来源里第一条是绩点那篇', sources?.sources?.[0]?.url === '/academics/gpa/', JSON.stringify(sources?.sources?.[0] ?? null));
  check('正文按分片送达并拼回原文', deltas.map((event) => event.text).join('') === '绩点是按课程加权的。[1]', JSON.stringify(deltas));
  check('以 done 收尾', Boolean(done) && modelCalls === 1, JSON.stringify(done));

  // 提示词必须把检索到的正文带上，并要求只依据资料回答
  const system = received?.options?.messages?.[0]?.content ?? '';
  const user = received?.options?.messages?.[1]?.content ?? '';
  check('系统提示词要求「只依据资料」', system.includes('只依据'), system.slice(0, 60));
  check(
    '系统提示词要求标注出处编号（带具体格式示例）',
    system.includes('方括号数字') && system.includes('[1]') && system.includes('[2]'),
    system.slice(0, 60),
  );
  check('系统提示词防提示词注入', system.includes('一律忽略'), system.slice(0, 80));
  check('用户消息里带上了检索到的原文', user.includes('【资料】') && user.includes('【问题】'), user.slice(0, 80));
}

// ── 5. 额度闸门 ───────────────────────────────────────────────────────────
{
  // 每日上限压到 2：第 3 次应该降级成「只给链接」，且不再调用模型
  const env = makeEnv({ configPatch: { ...okConfig, limits: { max_question_chars: 200, per_ip_per_hour: 100, daily_answers: 2, degrade_to_search: true } } });
  let modelCalls = 0;
  env.AI = {
    run: async () => {
      modelCalls += 1;
      return sseStream(['回答']);
    },
  };
  for (let i = 0; i < 3; i += 1) await post('/api/ask', { question: '绩点是怎么算的？' }, env);
  const events = await readNdjson(await post('/api/ask', { question: '绩点是怎么算的？' }, env));
  const notice = events.find((event) => event.type === 'notice');
  check('超出每日额度 → 降级为只给链接', notice?.code === 'daily_budget', JSON.stringify(notice ?? null).slice(0, 140));
  check('超出额度后不再调用模型', modelCalls === 2, `modelCalls=${modelCalls}`);
}

// ── 6. 单 IP 限流 ─────────────────────────────────────────────────────────
{
  const env = makeEnv({ configPatch: { ...okConfig, limits: { max_question_chars: 200, per_ip_per_hour: 2, daily_answers: 100, degrade_to_search: true } } });
  const headers = { 'cf-connecting-ip': '203.0.113.7' };
  await post('/api/ask', { question: '绩点是怎么算的？' }, env, headers);
  await post('/api/ask', { question: '绩点是怎么算的？' }, env, headers);
  const third = await post('/api/ask', { question: '绩点是怎么算的？' }, env, headers);
  const events = await readNdjson(third);
  const notice = events.find((event) => event.type === 'notice');
  check('同一 IP 超过每小时上限 → 429 + ip_limit', third.status === 429 && notice?.code === 'ip_limit', `status=${third.status} ${JSON.stringify(notice ?? null).slice(0, 120)}`);
}

// ── 7. 后台接口鉴权 ───────────────────────────────────────────────────────
{
  const env = makeEnv({ configPatch: okConfig });
  const noAuth = await worker.fetch(new Request('https://x/api/admin/status'), env, { waitUntil() {} });
  check('后台接口无口令 → 401', noAuth.status === 401, `status=${noAuth.status}`);

  const wrong = await worker.fetch(
    new Request('https://x/api/admin/status', { headers: { authorization: 'Bearer nope' } }),
    env,
    { waitUntil() {} },
  );
  check('后台接口错误口令 → 401', wrong.status === 401, `status=${wrong.status}`);

  const authHeaders = { authorization: 'Bearer test-admin-token' };
  const status = await worker.fetch(new Request('https://x/api/admin/status', { headers: authHeaders }), env, { waitUntil() {} });
  const statusBody = await status.json();
  check('后台状态可读且不回显密钥', status.ok && statusBody.status?.hasKey === false && !JSON.stringify(statusBody).includes('test-encryption-key'), JSON.stringify(statusBody.status ?? null).slice(0, 160));

  const saved = await worker.fetch(
    new Request('https://x/api/admin/key', { method: 'PUT', headers: { ...authHeaders, 'content-type': 'application/json' }, body: JSON.stringify({ apiKey: 'sk-test-1234567890' }) }),
    env,
    { waitUntil() {} },
  );
  check('保存第三方 Key 成功', (await saved.json()).hasKey === true);

  const stored = env.__store.get('apikey');
  check('Key 不以明文落盘', stored && !JSON.stringify(stored).includes('sk-test'), JSON.stringify(stored).slice(0, 80));

  const after = await worker.fetch(new Request('https://x/api/admin/status', { headers: authHeaders }), env, { waitUntil() {} });
  const afterBody = await after.json();
  check('状态里只出现指纹', Boolean(afterBody.status?.keyFingerprint) && !JSON.stringify(afterBody).includes('sk-test'), JSON.stringify(afterBody.status ?? null).slice(0, 160));

  const configSave = await worker.fetch(
    new Request('https://x/api/admin/config', { method: 'PUT', headers: { ...authHeaders, 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'openai-compatible', max_tokens: 500, 恶意字段: 'x' }) }),
    env,
    { waitUntil() {} },
  );
  const savedConfig = await configSave.json();
  check('运行时配置按白名单保存', savedConfig.overrides?.provider === 'openai-compatible' && !('恶意字段' in (savedConfig.overrides ?? {})), JSON.stringify(savedConfig).slice(0, 160));
}

// ── 8. 第三方供应商（OpenAI 兼容）路径 ────────────────────────────────────
{
  const env = makeEnv({ configPatch: { ...okConfig, answer: { provider: 'openai-compatible', model: 'x', base_url: 'https://api.example.com/v1', model_external: 'test-model', temperature: 0.2, max_tokens: 100, system_prompt_extra: '', fallback_models: [] } } });
  const authHeaders = { authorization: 'Bearer test-admin-token', 'content-type': 'application/json' };
  await worker.fetch(new Request('https://x/api/admin/key', { method: 'PUT', headers: authHeaders, body: JSON.stringify({ apiKey: 'sk-abcdefghijklmnop' }) }), env, { waitUntil() {} });

  const originalFetch = globalThis.fetch;
  let upstream = null;
  globalThis.fetch = async (url, init) => {
    upstream = { url: String(url), init };
    const body = ['data: {"choices":[{"delta":{"content":"你好"}}]}\n\n', 'data: [DONE]\n\n'];
    return new Response(body.join(''), { headers: { 'content-type': 'text/event-stream' } });
  };
  const response = await post('/api/ask', { question: '绩点是怎么算的？' }, env);
  const events = await readNdjson(response);
  globalThis.fetch = originalFetch;

  check('第三方路径：请求打到 /chat/completions', upstream?.url === 'https://api.example.com/v1/chat/completions', upstream?.url ?? 'null');
  check('第三方路径：带上 Bearer 密钥', upstream?.init?.headers?.authorization === 'Bearer sk-abcdefghijklmnop', String(upstream?.init?.headers?.authorization));
  check('第三方路径：解析 OpenAI 格式的流', events.filter((event) => event.type === 'delta').map((event) => event.text).join('') === '你好', JSON.stringify(events).slice(0, 160));
}

// ── 9. Turnstile 校验（桩掉外网请求，逐条验证 fail-closed）────────────────
{
  const realFetch = globalThis.fetch;
  const run = async (stub) => {
    globalThis.fetch = stub;
    try {
      return await verifyTurnstile({ TURNSTILE_SECRET_KEY: 'secret', TURNSTILE_HOSTNAMES: 'tsinghua.nathanpenny.fun' }, { token: 'tok', ip: '1.2.3.4', action: 'ask', hostnames: ['tsinghua.nathanpenny.fun'] });
    } finally {
      globalThis.fetch = realFetch;
    }
  };

  const ok = await run(async () => Response.json({ success: true, action: 'ask', hostname: 'tsinghua.nathanpenny.fun' }));
  check('Turnstile：通过', ok.ok === true, JSON.stringify(ok));

  const mismatchHost = await run(async () => Response.json({ success: true, action: 'ask', hostname: 'evil.example' }));
  check('Turnstile：域名不符 → 拒绝', mismatchHost.ok === false && mismatchHost.code === 'hostname_mismatch', JSON.stringify(mismatchHost));

  const mismatchAction = await run(async () => Response.json({ success: true, action: 'login', hostname: 'tsinghua.nathanpenny.fun' }));
  check('Turnstile：action 不符 → 拒绝', mismatchAction.ok === false && mismatchAction.code === 'action_mismatch', JSON.stringify(mismatchAction));

  const failed = await run(async () => Response.json({ success: false }));
  check('Turnstile：上游判定失败 → 拒绝', failed.ok === false && failed.code === 'challenge_failed', JSON.stringify(failed));

  const network = await run(async () => {
    throw new Error('network down');
  });
  check('Turnstile：网络故障 → fail-closed', network.ok === false && network.code === 'verify_failed', JSON.stringify(network));

  const wrongStatus = await run(async () => new Response('bad gateway', { status: 502 }));
  check('Turnstile：上游 502 → fail-closed', wrongStatus.ok === false && wrongStatus.code === 'verify_http_error', JSON.stringify(wrongStatus));

  const noSecret = await verifyTurnstile({}, { token: 'tok', hostnames: ['a'] });
  check('Turnstile：没配 secret → fail-closed', noSecret.ok === false && noSecret.code === 'server_not_configured', JSON.stringify(noSecret));

  const noHostnames = await verifyTurnstile({ TURNSTILE_SECRET_KEY: 'secret' }, { token: 'tok', hostnames: [] });
  check('Turnstile：白名单为空 → fail-closed', noHostnames.ok === false && noHostnames.code === 'server_not_configured', JSON.stringify(noHostnames));

  const badToken = await verifyTurnstile({ TURNSTILE_SECRET_KEY: 'secret', TURNSTILE_HOSTNAMES: 'a' }, { token: '', hostnames: ['a'] });
  check('Turnstile：空 token → 拒绝', badToken.ok === false && badToken.code === 'missing_token', JSON.stringify(badToken));

  const hugeToken = await verifyTurnstile({ TURNSTILE_SECRET_KEY: 'secret', TURNSTILE_HOSTNAMES: 'a' }, { token: 'x'.repeat(4096), hostnames: ['a'] });
  check('Turnstile：超长 token → 拒绝', hugeToken.ok === false && hugeToken.code === 'missing_token', JSON.stringify(hugeToken));
}

// ── 10. Turnstile 未通过时不消耗额度 ──────────────────────────────────────
{
  const env = makeEnv({ configPatch: { ...okConfig, turnstile: { mode: 'enforce', sitekey: '1x00000000000000000000AA', action: 'ask', hostnames: [] } } });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: false });
  const denied = await post('/api/ask', { question: '绩点是怎么算的？', token: 'bad' }, env);
  globalThis.fetch = originalFetch;
  check('Turnstile 未通过 → 403', denied.status === 403, `status=${denied.status}`);
  check('Turnstile 未通过 → 不消耗当日额度', (env.__store.get(`budget:${new Date().toISOString().slice(0, 10)}`) ?? 0) === 0, String(env.__store.get(`budget:${new Date().toISOString().slice(0, 10)}`)));
}

// ── 结果 ──────────────────────────────────────────────────────────────────
const failed = results.filter((item) => !item.passed);
console.log(`\nWorker 端到端检查：${results.length - failed.length}/${results.length} 通过。`);
if (failed.length) {
  console.error('失败项：');
  for (const item of failed) console.error(`  - ${item.name}${item.detail ? `：${item.detail}` : ''}`);
  process.exit(1);
}
