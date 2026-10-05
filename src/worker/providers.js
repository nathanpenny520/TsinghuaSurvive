/**
 * 生成层 —— 把「模型怎么调」收敛成两个适配器，对外只暴露一种「文本流」。
 *
 * 为什么要抽象：站上要同时支持
 *   (a) Cloudflare Workers AI（走 Worker 的 AI 绑定，**不需要 API Key**，免费额度 10,000 Neurons/天），
 *   (b) 任何 OpenAI Chat Completions 兼容的第三方（DeepSeek / 智谱 / Kimi / 通义 / OpenRouter）。
 * 两者的差别只有「怎么发请求、怎么解析返回」；对上层而言都是「一段一段吐出文字的流」。
 * 这样后台里切换供应商就只是改配置，不需要改代码、不需要重新发版。
 *
 * 流式格式统一成 NDJSON（见 index.js 的说明），这里只负责把上游的 SSE 拆成文本片段。
 */

/**
 * 把 SSE 响应体切成一行一行。
 *
 * 为什么要自己写：`await response.text()` 会把整个回答缓冲下来再返回——
 * 用户要盯着空白等十几秒，而且流式输出本来就是为了让首字尽快出现。
 * 这里必须边读边吐，并且要处理「一次 read 拿到半行」的情况（buffer 保留残余）。
 */
async function* sseLines(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf('\n');
      while (index >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line) yield line;
        index = buffer.indexOf('\n');
      }
    }
    const tail = buffer.trim();
    if (tail) yield tail;
  } finally {
    // 上游中途断开时也要把 reader 放掉，否则这个请求的流会一直挂着
    try {
      reader.releaseLock();
    } catch {
      /* 已经关了，忽略 */
    }
  }
}

/**
 * 从一行 SSE 里取出文本增量。
 *
 * 兼容三种形状，因为不同模型族的返回字段不一样：
 *   `{"response":"…"}`                      —— Workers AI 原生文本生成模型
 *   `{"choices":[{"delta":{"content":"…"}}]}` —— OpenAI 兼容（以及 Workers AI 的兼容端点）
 *   `{"choices":[{"text":"…"}]}`             —— 少数补全式模型
 */
function extractDelta(payload) {
  if (typeof payload.response === 'string') return payload.response;
  const choice = payload.choices?.[0];
  if (typeof choice?.delta?.content === 'string') return choice.delta.content;
  if (typeof choice?.text === 'string') return choice.text;
  return '';
}

/**
 * 解析 SSE 行流，产出纯文本片段。
 * `[DONE]` 是 OpenAI 的结束标记；Workers AI 直接结束流。两者都要认。
 */
async function* textDeltas(lines) {
  for await (const line of lines) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      // 上游偶尔会夹带非 JSON 的心跳行，忽略而不是把整条回答打断
      continue;
    }
    const delta = extractDelta(payload);
    if (delta) yield delta;
  }
}

/**
 * 调 Workers AI（AI 绑定）。
 *
 * 用绑定而不是 REST API 的原因：**不需要 API Key**，免费额度也能直接用，
 * 少一个要保管、要轮换的密钥。只有需要第三方或更贵的模型时才走下面那条路。
 */
async function* streamWorkersAI(env, config, messages) {
  if (!env.AI) {
    throw new Error('这个 Worker 没有绑定 Workers AI（wrangler.jsonc 里缺 ai.binding）');
  }
  const model = config.model;
  const stream = await env.AI.run(model, {
    messages,
    stream: true,
    temperature: config.temperature,
    max_tokens: config.max_tokens,
  });
  if (!stream || typeof stream.getReader !== 'function') {
    throw new Error(`模型 ${model} 没有返回流（该模型可能不支持 stream）`);
  }
  yield* textDeltas(sseLines(stream));
}

/**
 * 调任意 OpenAI 兼容接口。
 *
 * base_url 只写到 /v1 为止，`/chat/completions` 在这里补——
 * 让后台填地址的人少一个填错的机会（多填/少填这一段是最常见的配置错误）。
 */
async function* streamOpenAICompatible(config, apiKey, messages) {
  if (!apiKey) throw new Error('没有配置第三方 API Key');
  const base = String(config.base_url ?? '').replace(/\/+$/, '');
  if (!base) throw new Error('没有配置 base_url');

  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      model: config.model_external || config.model,
      messages,
      stream: true,
      temperature: config.temperature,
      max_tokens: config.max_tokens,
    }),
  });

  if (!response.ok || !response.body) {
    // 只带回状态码和一小段错误文本：**绝不能把请求头或 Key 带进错误信息**，
    // 它会一路冒到日志和响应里。
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    throw new Error(`上游返回 ${response.status}：${detail}`);
  }

  yield* textDeltas(sseLines(response.body));
}

/**
 * 统一的流式入口。
 * @param {any} env Worker 环境（需要 AI 绑定）
 * @param {{provider: string}} config 生效配置（构建产物 + 后台覆盖合并后的结果）
 * @param {string|null} apiKey 第三方 API Key；workers-ai 时传 null
 * @param {{role: string, content: string}[]} messages
 * @returns {AsyncGenerator<string>}
 */
export async function* streamCompletion(env, config, apiKey, messages) {
  if (config.provider === 'openai-compatible') {
    yield* streamOpenAICompatible(config, apiKey, messages);
    return;
  }
  yield* streamWorkersAI(env, config, messages);
}

/**
 * 非流式的一次性调用 —— 后台「测试连接」按钮用。
 * 走同一套配置，但要求它在几秒内返回一句话，好让人当场知道 Key / 地址 / 模型名有没有问题。
 */
export async function testCompletion(env, config, apiKey) {
  const messages = [
    { role: 'system', content: '你是一个连通性测试。只回复两个字：可用。' },
    { role: 'user', content: '测试' },
  ];
  let text = '';
  for await (const delta of streamCompletion(env, { ...config, max_tokens: 16 }, apiKey, messages)) {
    text += delta;
    if (text.length > 40) break;
  }
  const trimmed = text.trim();
  if (!trimmed) throw new Error('模型返回了空内容');
  return trimmed.slice(0, 40);
}
