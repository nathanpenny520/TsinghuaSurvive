/**
 * 站内 AI 问答的 Worker 入口。
 *
 * 这个 Worker 同时承担两件事：
 *   1. 托管静态站点（原来那个"纯静态资源"的形态没变，静态请求仍然不经这里，见 wrangler.jsonc 的 run_worker_first）
 *   2. 提供 /api/* —— 问答接口、公开配置、以及后台用的配置接口
 *
 * 请求链路（POST /api/ask）：
 *   校验入参 → 限流（不扣额度）→ Turnstile → 检索 → 相关度闸门 → 扣额度 → 生成并流式返回
 *
 * 两道闸门放在生成之前，是因为**免费额度（10,000 Neurons/天 ≈ 250 次问答）是真正的稀缺资源**：
 *   相关度闸门挡掉「站里根本没有的问题」，额度闸门挡掉「今天问得太多了」。
 *   两者都会返回一个 200 的说明 + 最相关的文章链接，而不是报错——用户仍然拿到了有用的东西。
 *
 * 输出统一是 NDJSON（每行一个 JSON），不是 SSE：
 *   浏览器端按行 split 即可，不需要处理 SSE 的分帧规则；每行结构固定，出错也能在流中间报。
 */
import { loadKnowledge, search, isConfident, buildMessages } from './retrieval.js';
import { streamCompletion, testCompletion } from './providers.js';
import { verifyTurnstile, expectedHostnames } from './turnstile.js';

export { AskGate } from './gate.js';

/** 配置与索引都 memoize 在模块作用域：isolate 复用，所以每个 isolate 只读一次 */
let configPromise = null;

function loadConfig(env) {
  if (!configPromise) {
    configPromise = (async () => {
      const response = await env.ASSETS.fetch(new Request('https://assets.local/ai-config.json'));
      if (!response.ok) throw new Error(`ai-config.json 读取失败：${response.status}`);
      return response.json();
    })().catch((error) => {
      configPromise = null;
      throw error;
    });
  }
  return configPromise;
}

/**
 * 清掉配置缓存。**只有测试用**（scripts/check-ai-worker.mjs 要在同一个进程里跑多组配置）。
 * 生产环境不需要：ai-config.json 只会随部署变化，而部署必然换 isolate。
 * 注意后台的「运行时覆盖」不走这个缓存——它每次请求都从 Durable Object 现读，改完立即生效。
 */
export function resetConfigCache() {
  configPromise = null;
}

/** 后台可以覆盖的扁平字段 → 合并进 answer 段 */
function mergeOverrides(base, overrides) {
  const answer = { ...base.answer };
  for (const key of ['provider', 'model', 'base_url', 'model_external', 'system_prompt_extra']) {
    if (typeof overrides[key] === 'string' && overrides[key] !== '') answer[key] = overrides[key];
  }
  for (const key of ['temperature', 'max_tokens']) {
    if (typeof overrides[key] === 'number') answer[key] = overrides[key];
  }
  return { ...base, answer };
}

function gate(env) {
  return env.ASK_GATE.get(env.ASK_GATE.idFromName('global'));
}

async function gateFetch(env, path, body) {
  const response = await gate(env).fetch(`https://gate.internal${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return response.json();
}

/**
 * 定长时间比较。
 *
 * 为什么不用 `===`：字符串比较会在第一个不同的字符处提前返回，
 * 攻击者能通过响应时间一个字符一个字符地把管理口令试出来。
 * Web Crypto 没有提供 timingSafeEqual，所以自己按字节异或累加——累加不提前退出。
 */
function timingSafeEqual(a, b) {
  const left = new TextEncoder().encode(a ?? '');
  const right = new TextEncoder().encode(b ?? '');
  // 长度不同也要走完整轮比较，否则长度本身会通过时间泄露
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < length; i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}

/** NDJSON 流：先送来源，再一段段送正文，最后 done。任何一步出错都在流里报，而不是断掉。 */
function ndjson(producer) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      const send = (payload) => controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      const heartbeat = setInterval(() => {
        // 检索/首字之前的空档可能有好几秒，心跳让浏览器知道连接还活着（前端会忽略它）
        try {
          send({ type: 'ping' });
        } catch {
          clearInterval(heartbeat);
        }
      }, 5000);
      try {
        await producer(send);
      } catch (error) {
        console.error(JSON.stringify({ event: 'ask_stream_error', message: String(error?.message ?? error).slice(0, 200) }));
        try {
          send({ type: 'error', code: 'generation_failed', message: '生成回答时出错了，请稍后再试。' });
        } catch {
          /* 客户端已经断开，忽略 */
        }
      } finally {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* 已经关了 */
        }
      }
    },
  });
}

/** 命中结果 → 给前端和模型用的引用列表 */
function toSources(hits) {
  return hits.map((hit, index) => ({
    n: index + 1,
    title: hit.title,
    path: hit.path && hit.path !== hit.title ? hit.path : '',
    url: hit.url,
    anchor: hit.anchor,
    status: hit.status,
    reviewedAt: hit.reviewedAt ?? null,
  }));
}

async function handleAsk(request, env) {
  const config = await loadConfig(env);
  let overrides = {};
  try {
    overrides = await gateFetch(env, '/config');
  } catch {
    // 配置读不到不影响问答（用构建时的默认值继续），但额度闸门也会失效——下面的检查会兜住
  }
  const effective = mergeOverrides(config, overrides);

  if (!effective.enabled) {
    return json({ type: 'error', code: 'disabled', message: '站内问答当前未开放。' }, 503);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ type: 'error', code: 'bad_request', message: '请求格式不对。' }, 400);
  }

  const question = typeof payload?.question === 'string' ? payload.question.trim() : '';
  const maxChars = effective.limits.max_question_chars;
  if (question.length < 2 || question.length > maxChars) {
    return json({ type: 'error', code: 'bad_question', message: `问题需要在 2–${maxChars} 字之间。` }, 400);
  }

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const retrievalOptions = { topK: effective.retrieval.top_k, maxPerUrl: effective.retrieval.max_per_url };

  // ── 闸门 1：限流（不扣额度）────────────────────────────────────────────
  // 放在 Turnstile 前面：校验 token 要发一次外网请求，被刷的时候这一步最贵。
  let gateState;
  try {
    gateState = await gateFetch(env, '/check', {
      ip,
      limitPerHour: effective.limits.per_ip_per_hour,
      dailyAnswers: effective.limits.daily_answers,
      consume: false,
    });
  } catch {
    // 额度服务不可用时**不放行**：宁可暂时不可用，也不能让一个坏掉的闸门把钱烧光
    return json({ type: 'error', code: 'gate_unavailable', message: '问答服务暂时不可用，请稍后再试。' }, 503);
  }

  const knowledge = await loadKnowledge(env);
  const result = search(knowledge, question, retrievalOptions);

  if (!gateState.allowed) {
    if (gateState.reason === 'ip_limit') {
      return json(
        {
          type: 'notice',
          code: 'ip_limit',
          message: '问得有点快，请过一会儿再来。下面是和你的问题最相关的几篇：',
          sources: toSources(result.hits.slice(0, 3)),
        },
        429,
        { 'retry-after': String(gateState.retryAfterSeconds ?? 600) },
      );
    }
    return searchOnlyResponse(effective, result, 'daily_budget', '今天的问答额度用完了，先用这几篇顶上：');
  }

  // ── 闸门 2：人机校验 ──────────────────────────────────────────────────
  if (effective.turnstile.mode === 'enforce') {
    const verdict = await verifyTurnstile(env, {
      token: payload?.token,
      ip,
      action: effective.turnstile.action,
      hostnames: expectedHostnames(env, effective.turnstile),
    });
    if (!verdict.ok) {
      if (verdict.code === 'server_not_configured') {
        console.error(JSON.stringify({ event: 'turnstile_not_configured' }));
        return json({ type: 'error', code: 'not_configured', message: '问答服务还没配置好风控，暂时不可用。' }, 503);
      }
      return json({ type: 'error', code: 'challenge_failed', message: '人机校验没通过，请刷新页面后重试。' }, 403);
    }
  }

  // ── 闸门 3：相关度 ────────────────────────────────────────────────────
  // 站里根本没有相关内容时**不去问模型**：既省额度，也避免模型拿不相干的材料硬答。
  if (!isConfident(result, { minScore: effective.retrieval.min_score })) {
    return searchOnlyResponse(
      effective,
      result,
      'no_answer',
      '站内没有找到直接相关的内容。下面是可能沾边的几篇，也可以换个说法再问：',
    );
  }

  // ── 扣额度（到这里才真的会产生费用）──────────────────────────────────
  const consumed = await gateFetch(env, '/check', {
    ip,
    limitPerHour: effective.limits.per_ip_per_hour,
    dailyAnswers: effective.limits.daily_answers,
    consume: true,
  });
  if (!consumed.allowed) {
    return searchOnlyResponse(effective, result, 'daily_budget', '今天的问答额度用完了，先用这几篇顶上：');
  }

  const sources = toSources(result.hits);
  const messages = buildMessages(
    question,
    result.hits,
    effective.answer.system_prompt_extra,
  );
  const apiKey = effective.answer.provider === 'openai-compatible' ? await readApiKey(env) : null;
  if (effective.answer.provider === 'openai-compatible' && !apiKey) {
    return json({ type: 'error', code: 'no_api_key', message: '后台还没配置第三方模型的 API Key。' }, 503);
  }

  const started = Date.now();
  const models = [effective.answer.model, ...(effective.answer.fallback_models ?? [])].filter(Boolean);

  return new Response(
    ndjson(async (send) => {
      send({ type: 'sources', sources });
      let produced = false;
      let lastError = null;

      for (const model of models) {
        const attempt = { ...effective.answer, model };
        try {
          for await (const delta of streamCompletion(env, attempt, apiKey, messages)) {
            produced = true;
            send({ type: 'delta', text: delta });
          }
          if (produced) {
            lastError = null;
            break;
          }
        } catch (error) {
          lastError = error;
          if (produced) break; // 已经吐出内容了，不再换模型重来（会出现两段互相矛盾的回答）
        }
      }

      if (!produced) {
        throw lastError ?? new Error('模型没有返回任何内容');
      }

      send({ type: 'done', model: effective.answer.model, ms: Date.now() - started });
      // 结构化日志：**只记长度、命中的页面和耗时，不记用户问的原话**（站上不留用户问题）
      console.log(
        JSON.stringify({
          event: 'ask_ok',
          provider: effective.answer.provider,
          model: effective.answer.model,
          questionChars: question.length,
          sources: sources.map((s) => s.url),
          ms: Date.now() - started,
        }),
      );
    }),
    {
      headers: {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'cache-control': 'no-store',
        // 关掉中间层缓冲，否则流式在部分网络环境下会被攒成一坨再吐出来
        'x-accel-buffering': 'no',
      },
    },
  );
}

/** 降级路径：不做生成，只把最相关的几篇给出去 */
function searchOnlyResponse(config, result, code, message) {
  return json({
    type: 'notice',
    code,
    message,
    sources: toSources(result.hits.slice(0, Math.max(3, Math.min(config.retrieval.top_k, 5)))),
  });
}

async function readApiKey(env) {
  try {
    const { apiKey } = await gateFetch(env, '/apikey');
    return apiKey ?? null;
  } catch {
    return null;
  }
}

async function handlePublicConfig(env) {
  const config = await loadConfig(env);
  return json(
    {
      enabled: config.enabled,
      turnstileSiteKey: config.turnstile.sitekey,
      turnstileMode: config.turnstile.mode,
      turnstileAction: config.turnstile.action,
      maxQuestionChars: config.limits.max_question_chars,
      ui: config.ui,
    },
    200,
    { 'cache-control': 'public, max-age=300' },
  );
}

/** 后台接口的统一鉴权 */
function requireAdmin(request, env) {
  const token = env.ADMIN_TOKEN;
  if (!token) return { ok: false, response: json({ error: 'admin_not_configured' }, 503) };
  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!timingSafeEqual(provided, token)) {
    return { ok: false, response: json({ error: 'unauthorized' }, 401) };
  }
  return { ok: true };
}

async function handleAdmin(request, env, path) {
  const auth = requireAdmin(request, env);
  if (!auth.ok) return auth.response;

  if (path === '/api/admin/status') {
    const status = await gateFetch(env, '/status');
    const config = await loadConfig(env);
    return json({ config, status });
  }

  if (path === '/api/admin/config' && request.method === 'PUT') {
    const body = await request.json().catch(() => ({}));
    const saved = await gateFetch(env, '/save-config', { overrides: body.overrides ?? body });
    return json(saved);
  }

  if (path === '/api/admin/key' && request.method === 'PUT') {
    const body = await request.json().catch(() => ({}));
    const saved = await gateFetch(env, '/save-key', { apiKey: body.apiKey ?? null });
    return json(saved);
  }

  if (path === '/api/admin/test' && request.method === 'POST') {
    const config = await loadConfig(env);
    const overrides = await gateFetch(env, '/config');
    const effective = mergeOverrides(config, overrides);
    const apiKey = effective.answer.provider === 'openai-compatible' ? await readApiKey(env) : null;
    try {
      const reply = await testCompletion(env, effective.answer, apiKey);
      return json({ ok: true, reply });
    } catch (error) {
      return json({ ok: false, message: String(error?.message ?? error).slice(0, 300) }, 502);
    }
  }

  return json({ error: 'not_found' }, 404);
}

export default {
  // ctx 是 Workers 的标准第三参（这里用不到，因为没有后台任务要 waitUntil）
  async fetch(request, env, _ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      try {
        if (url.pathname === '/api/ask') {
          if (request.method !== 'POST') return json({ type: 'error', code: 'method_not_allowed' }, 405);
          return await handleAsk(request, env);
        }
        if (url.pathname === '/api/ai-config') return await handlePublicConfig(env);
        if (url.pathname.startsWith('/api/admin/')) return await handleAdmin(request, env, url.pathname);
        return json({ error: 'not_found' }, 404);
      } catch (error) {
        console.error(JSON.stringify({ event: 'api_error', path: url.pathname, message: String(error?.message ?? error).slice(0, 300) }));
        return json({ type: 'error', code: 'internal', message: '服务出错了，请稍后再试。' }, 500);
      }
    }

    // 其余请求一律走静态资源。正常情况下静态请求根本不会进到这里
    // （wrangler.jsonc 的 run_worker_first 只把 /api/* 交给 Worker），这里只是兜底。
    return env.ASSETS.fetch(request);
  },
};
