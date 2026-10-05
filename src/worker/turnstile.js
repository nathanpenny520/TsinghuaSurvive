/**
 * 人机校验（Turnstile）—— 服务端 siteverify。
 *
 * 为什么公开问答必须有人机校验：`/api/ask` 是**未登录就能调用**的接口，
 * 而每次调用都在消耗 Workers AI 的免费额度（10,000 Neurons/天 ≈ 250 次问答）。
 * 一个脚本几分钟就能把当天的额度刷干净，站上的问答对所有真人就都不可用了。
 *
 * 校验在**服务端**做，浏览器只负责拿 token：
 *   浏览器 → 我们的 Worker → challenges.cloudflare.com/turnstile/v0/siteverify
 * 绝不能让浏览器直接调 siteverify：那要求把 secret 发到前端，等于公开 secret。
 *
 * 三处 fail-closed：网络失败、上游非 2xx、返回体不是 JSON —— 全部当作校验不通过。
 * 宁可让真人重试一次，也不能在风控失灵时把接口敞开。
 */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * 允许的前端域名。
 *
 * 优先取 Worker 变量 `TURNSTILE_HOSTNAMES`（逗号分隔），回落到 ai.config.yml 的 turnstile.hostnames。
 *
 * 为什么正式值走 Worker 变量而不是 YAML：**正式环境的名单里绝不能有 localhost**，
 * 否则拿着本地页面的 token 就能打正式接口（令牌是按 widget 的域名签发的，
 * 放行 localhost 等于给任何人在本机伪造请求留了口子）。
 * 本地开发时用 `.dev.vars` 覆盖成 localhost，两份名单物理隔离，不会手滑带到线上。
 */
function expectedHostnames(env, config) {
  const fromEnv = String(env.TURNSTILE_HOSTNAMES ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
  if (fromEnv.length) return fromEnv;
  return Array.isArray(config?.hostnames) ? config.hostnames.filter(Boolean) : [];
}

/**
 * 校验一个 Turnstile token。
 * @returns {Promise<{ok: true} | {ok: false, code: string}>}
 */
export async function verifyTurnstile(env, { token, ip, action, hostnames }) {
  const secret = env.TURNSTILE_SECRET_KEY;
  const allowed = hostnames ?? [];

  // 没配 secret 就不放行（fail-closed）。这是有意的：
  // 宁可问答暂时不可用并在日志里喊出来，也不要因为忘记配 secret 而敞开一个烧额度的接口。
  if (!secret) return { ok: false, code: 'server_not_configured' };
  if (allowed.length === 0) return { ok: false, code: 'server_not_configured' };
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) {
    return { ok: false, code: 'missing_token' };
  }

  let result;
  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({
        secret,
        response: token,
        ...(ip ? { remoteip: ip } : {}),
      }),
    });
    if (!response.ok) return { ok: false, code: 'verify_http_error' };
    result = await response.json();
  } catch {
    // 网络错误、超时、返回体不是 JSON：一律当作不通过
    return { ok: false, code: 'verify_failed' };
  }

  if (!result?.success) return { ok: false, code: 'challenge_failed' };
  // action 与前端挂件的 data-action 必须一致：防止拿别的表单（比如登录）的 token 来换问答额度
  if (action && result.action !== action) return { ok: false, code: 'action_mismatch' };
  // hostname 必须在白名单里：token 可以是被别的站点签发的
  if (!allowed.includes(result.hostname)) return { ok: false, code: 'hostname_mismatch' };

  return { ok: true };
}

export { expectedHostnames };
