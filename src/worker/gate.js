/**
 * 额度与配置的协调者（Durable Object）。
 *
 * 为什么需要一个 Durable Object，而不是 Workers KV：
 *   1. **每日总预算是硬闸门**，它必须是全局一致的计数。KV 是最终一致的，
 *      并发请求下会数漏（免费档 KV 还有每天 1,000 次写入的限制，问答一多就直接写不进去）。
 *      Durable Object 的存储是单点的、强一致的，正是为这种「一个计数器」准备的。
 *   2. 它顺便承担了后台配置与第三方 API Key 的存放（见下方 encryptSecret）。
 *      这样不需要再开 KV namespace —— 少一个要手工创建、要维护 id 的资源。
 *
 * 用**单个**实例（idFromName('global')）：所有问答请求在这里排队。
 * 本站的量级（每天几百次问答）完全够用，换来的是计数绝对不会错。
 *
 * 两个计数器刻意用不同的持久化策略：
 *   - 每日总预算：落盘（硬闸门，重启也不能丢）
 *   - 单 IP 限流：只在内存里（软闸门，重启重置可以接受）
 * 后者不落盘还有一个隐私上的理由：**站上不留用户 IP**。限流只需要一个短时间窗内的计数，
 * 没有理由把它写进磁盘。
 */

/**
 * 第三方 API Key 的加解密（AES-GCM）。
 *
 * 为什么后台填的 Key 要加密再存：Durable Object 的存储不是密钥保险箱——
 * 任何能读这个 Worker 存储的人（账号被拿到、或代码里加了打印）都能看到明文。
 * 加密之后，攻击者还需要 Worker 的 `CONFIG_ENC_KEY` 才能解开，多一道独立的门槛。
 *
 * 主密钥从 Worker Secret 派生（SHA-256 → AES-GCM key），**不在仓库、不在配置里**。
 * 没配 `CONFIG_ENC_KEY` 时不接受写入：宁可不支持「后台填 Key」，也不存明文。
 */
async function deriveKey(env) {
  const material = env.CONFIG_ENC_KEY;
  if (!material) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function toBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function encryptSecret(env, plain) {
  const key = await deriveKey(env);
  if (!key) throw new Error('没有配置 CONFIG_ENC_KEY，拒绝写入密钥');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
  return { iv: toBase64(iv), ct: toBase64(new Uint8Array(cipher)), v: 1 };
}

async function decryptSecret(env, stored) {
  if (!stored?.iv || !stored?.ct) return null;
  const key = await deriveKey(env);
  if (!key) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(stored.iv) },
      key,
      fromBase64(stored.ct),
    );
    return new TextDecoder().decode(plain);
  } catch {
    // 主密钥换过之后旧密文解不开：当作「没配」处理，让后台重新填一次
    return null;
  }
}

/** 能够被后台覆盖的字段（白名单）。**不做通用合并**：配置项一旦能被任意改写，
 *  系统提示词、供应商地址这些安全相关的东西就都暴露在后台表单里了。 */
const OVERRIDABLE_KEYS = new Set([
  'provider',
  'model',
  'base_url',
  'model_external',
  'temperature',
  'max_tokens',
  'system_prompt_extra',
]);

function sanitizeOverrides(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const [key, value] of Object.entries(input)) {
    if (!OVERRIDABLE_KEYS.has(key)) continue;
    if (key === 'temperature' || key === 'max_tokens') {
      const number = Number(value);
      if (Number.isFinite(number)) out[key] = number;
      continue;
    }
    if (typeof value === 'string') out[key] = value.slice(0, 2000);
  }
  return out;
}

export class AskGate {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    /** 单 IP 限流窗口：只存内存，理由见文件头注释 */
    this.ipWindows = new Map();
  }

  async fetch(request) {
    const url = new URL(request.url);
    try {
      switch (url.pathname) {
        case '/check':
          return this.handleCheck(await request.json());
        case '/config':
          return json(await this.state.storage.get('overrides') ?? {});
        case '/save-config':
          return this.handleSaveConfig(await request.json());
        case '/save-key':
          return this.handleSaveKey(await request.json());
        case '/status':
          return this.handleStatus();
        // 只给 Worker 自己用：Worker 不会把这条路由代理给浏览器（见 index.js）。
        // 密钥仍然要经过一次网络（DO → Worker），但两端都在 Cloudflare 内部，且全程 TLS。
        case '/apikey':
          return json({ apiKey: await decryptSecret(this.env, await this.state.storage.get('apikey')) });
        default:
          return json({ error: 'not_found' }, 404);
      }
    } catch (error) {
      return json({ error: 'gate_error', message: String(error?.message ?? error).slice(0, 200) }, 500);
    }
  }

  /**
   * 限流 + 每日预算。
   *
   * 分成两步调用（先 check 不扣、再 consume 扣），是为了让「Turnstile 没通过」
   * 和「每次刷新页面」这类请求不消耗当天的问答额度。
   */
  async handleCheck({ ip, limitPerHour = 12, dailyAnswers = 200, consume = false }) {
    const now = Date.now();
    const windowKey = `${ip ?? 'unknown'}|${Math.floor(now / 3_600_000)}`;
    const used = this.ipWindows.get(windowKey) ?? 0;

    // 顺手清掉过期窗口，避免内存里越积越多（这个 DO 活得比单个窗口长得多）
    if (this.ipWindows.size > 5000) {
      const currentHour = Math.floor(now / 3_600_000);
      for (const key of this.ipWindows.keys()) {
        if (Number(key.split('|')[1]) !== currentHour) this.ipWindows.delete(key);
      }
    }

    if (used >= limitPerHour) {
      return json({ allowed: false, reason: 'ip_limit', retryAfterSeconds: 3600 - Math.floor((now % 3_600_000) / 1000) });
    }

    // 每日预算按 UTC 日期归零，与 Cloudflare 免费额度的重置时间（每天 00:00 UTC）对齐
    const dayKey = `budget:${new Date(now).toISOString().slice(0, 10)}`;
    const spent = (await this.state.storage.get(dayKey)) ?? 0;
    if (spent >= dailyAnswers) {
      return json({ allowed: false, reason: 'daily_budget', budgetLeft: 0 });
    }

    if (consume) {
      this.ipWindows.set(windowKey, used + 1);
      await this.state.storage.put(dayKey, spent + 1);
    }

    return json({
      allowed: true,
      budgetLeft: Math.max(0, dailyAnswers - spent - (consume ? 1 : 0)),
      ipUsed: used + (consume ? 1 : 0),
      ipLimit: limitPerHour,
    });
  }

  async handleSaveConfig({ overrides }) {
    const clean = sanitizeOverrides(overrides);
    await this.state.storage.put('overrides', clean);
    return json({ saved: true, overrides: clean });
  }

  async handleSaveKey({ apiKey }) {
    if (apiKey === null || apiKey === '') {
      await this.state.storage.delete('apikey');
      return json({ saved: true, hasKey: false });
    }
    if (typeof apiKey !== 'string' || apiKey.length < 8 || apiKey.length > 500) {
      return json({ error: 'bad_key' }, 400);
    }
    await this.state.storage.put('apikey', {
      ...(await encryptSecret(this.env, apiKey)),
      // 只存指纹，不存明文片段：后台要能确认「填的是哪一个 Key」，
      // 但存尾四位仍然是把密钥的一部分留在了存储里。
      fingerprint: await fingerprint(apiKey),
    });
    return json({ saved: true, hasKey: true });
  }

  async handleStatus() {
    const [overrides, storedKey, budget] = await Promise.all([
      this.state.storage.get('overrides'),
      this.state.storage.get('apikey'),
      this.state.storage.get(`budget:${new Date().toISOString().slice(0, 10)}`),
    ]);
    return json({
      overrides: overrides ?? {},
      hasKey: Boolean(storedKey),
      // 只回显指纹：后台需要知道「填的是哪一个」，但没有任何理由把 Key 本身发回浏览器
      keyFingerprint: storedKey?.fingerprint ?? null,
      budgetUsedToday: budget ?? 0,
      canStoreKey: Boolean(this.env.CONFIG_ENC_KEY),
    });
  }
}

/** Key 的短指纹，用于后台确认「当前配的是哪一个」，不泄露 Key 本身 */
async function fingerprint(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest).slice(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
