/**
 * Host half of the API-balance bundle.
 *
 * The browser cannot read API keys or call vendor endpoints cross-origin, so
 * this half owns every key-side balance read and answers two loopback routes:
 *
 *   GET /plugins-api/api-balance/sources
 *     -> { ok: true, sources: [{ id, label, provider, keyHint, supported, note }] }
 *   GET /plugins-api/api-balance?source=<id>[&refresh=1]
 *     -> { ok: true, id, wallets: [{ currency, total, granted, toppedUp }], isAvailable }
 *     -> { ok: false, reason: 'no-key' | 'unsupported' | 'unauthorized' | 'http' | 'network' }
 *
 * Keys stay in the Host process: they are never echoed in a response and never
 * logged. The signed-in DeepSeek account wallet is read by the browser half from
 * the account Remote namespace, not here.
 */

/** Values used when the Loader row supplies no config. */
const DEFAULTS = {
  /** Base path this bundle claims on the Web server. */
  routePath: '/plugins-api/api-balance',
  /** How long one successful vendor answer is reused, in milliseconds. */
  cacheMs: 60_000,
  /** Bound on one vendor request, in milliseconds. */
  timeoutMs: 15_000,
  /** Extra or overriding provider entries, same shape as {@link CATALOG}. */
  providers: [],
}

/** Providers this bundle can read, with the credential each one uses. */
const CATALOG = [
  { id: 'deepseek', label: 'DeepSeek', keyEnv: 'DEEPSEEK_API_KEY', adapter: 'deepseek' },
  { id: 'openrouter', label: 'OpenRouter', keyEnv: 'OPENROUTER_API_KEY', adapter: 'openrouter' },
  {
    id: 'moonshot',
    label: 'Moonshot (Kimi)',
    /* The pi-ai provider stores the mainland key under MOONSHOTAI_CN_API_KEY;
       the other spellings cover the official SDK and the international route. */
    keyEnvs: ['MOONSHOTAI_CN_API_KEY', 'MOONSHOTAI_API_KEY', 'MOONSHOT_API_KEY'],
    keyEnv: 'MOONSHOTAI_CN_API_KEY',
    adapter: 'moonshot',
  },
  { id: 'siliconflow', label: 'SiliconFlow', keyEnv: 'SILICONFLOW_API_KEY', adapter: 'siliconflow' },
  {
    id: 'openai',
    label: 'OpenAI',
    keyEnv: 'OPENAI_API_KEY',
    adapter: null,
    note: 'OpenAI \u4e0d\u5bf9 API Key \u63d0\u4f9b\u4f59\u989d\u63a5\u53e3',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    keyEnv: 'ANTHROPIC_API_KEY',
    adapter: null,
    note: 'Anthropic \u4e0d\u5bf9 API Key \u63d0\u4f9b\u4f59\u989d\u63a5\u53e3',
  },
  {
    id: 'zai-coding-cn',
    label: '\u667a\u8c31 GLM\uff08\u56fd\u5185\u7f16\u7801\u5957\u9910\uff09',
    keyEnvs: ['ZAI_CODING_CN_API_KEY'],
    keyEnv: 'ZAI_CODING_CN_API_KEY',
    adapter: null,
    /* Verified 2026-11: /api/paas/v4/models authenticates this key, but every
       balance path is 404 and /api/biz/customer/account/balance/v2 answers 403
       "请求地址不允许访问" — the console route only accepts a browser session. */
    note: '\u667a\u8c31\u53ea\u5bf9\u7f51\u9875\u767b\u5f55\u6001\u5f00\u653e\u4f59\u989d\u63a5\u53e3\uff0cAPI Key \u65e0\u6cd5\u67e5\u8be2\uff1b\u8bf7\u5230 open.bigmodel.cn \u8d22\u52a1\u4e2d\u5fc3\u67e5\u770b',
  },
  {
    id: 'zai',
    label: 'Z.ai (GLM)',
    keyEnvs: ['ZAI_API_KEY'],
    keyEnv: 'ZAI_API_KEY',
    adapter: null,
    note: 'Z.ai \u53ea\u5bf9\u7f51\u9875\u767b\u5f55\u6001\u5f00\u653e\u4f59\u989d\u63a5\u53e3\uff0cAPI Key \u65e0\u6cd5\u67e5\u8be2\uff1b\u8bf7\u5230 z.ai \u63a7\u5236\u53f0\u67e5\u770b',
  },
  {
    id: 'zhipu',
    label: '\u667a\u8c31 GLM',
    keyEnv: 'ZHIPU_API_KEY',
    adapter: null,
    note: '\u667a\u8c31\u672a\u63d0\u4f9b\u516c\u5f00\u4f59\u989d\u63a5\u53e3',
  },
]

/**
 * Per-vendor balance readers. `parse` maps the vendor body onto the shared
 * wallet shape and throws when the body is not what this adapter expects.
 */
const ADAPTERS = {
  deepseek: {
    endpoint: 'https://api.deepseek.com/user/balance',
    parse(body) {
      const infos = Array.isArray(body?.balance_infos) ? body.balance_infos : []
      if (infos.length === 0) throw new Error('deepseek: no balance_infos')
      return infos.map((info) => ({
        currency: typeof info?.currency === 'string' ? info.currency : 'CNY',
        total: String(info?.total_balance ?? '0'),
        granted: String(info?.granted_balance ?? '0'),
        toppedUp: String(info?.topped_up_balance ?? '0'),
      }))
    },
  },
  openrouter: {
    endpoint: 'https://openrouter.ai/api/v1/credits',
    parse(body) {
      const credits = Number(body?.data?.total_credits)
      const usage = Number(body?.data?.total_usage)
      if (!Number.isFinite(credits) || !Number.isFinite(usage)) throw new Error('openrouter: unexpected body')
      const remaining = Math.max(0, credits - usage)
      return [{ currency: 'USD', total: remaining.toFixed(2), granted: '0', toppedUp: remaining.toFixed(2) }]
    },
  },
  moonshot: {
    endpoint: 'https://api.moonshot.cn/v1/users/me/balance',
    parse(body) {
      const data = body?.data
      if (data === null || typeof data !== 'object') throw new Error('moonshot: unexpected body')
      return [
        {
          currency: 'CNY',
          total: String(data.available_balance ?? '0'),
          granted: String(data.voucher_balance ?? '0'),
          toppedUp: String(data.cash_balance ?? '0'),
        },
      ]
    },
  },
  siliconflow: {
    endpoint: 'https://api.siliconflow.cn/v1/user/info',
    parse(body) {
      const data = body?.data
      if (data === null || typeof data !== 'object') throw new Error('siliconflow: unexpected body')
      return [
        {
          currency: 'CNY',
          total: String(data.totalBalance ?? data.balance ?? '0'),
          granted: String(data.balance ?? '0'),
          toppedUp: String(data.chargeBalance ?? '0'),
        },
      ]
    },
  },
}

/** The Web server is the only required service; credentials stay optional. */
export const inject = ['webServer']

/**
 * Merge configured provider entries over the built-in catalog.
 * @param extra - entries from the Loader row's `providers` config.
 * @returns the effective provider list.
 */
function mergeProviders(extra) {
  const merged = CATALOG.map((entry) => ({ ...entry }))
  if (!Array.isArray(extra)) return merged
  for (const entry of extra) {
    if (entry === null || typeof entry !== 'object' || typeof entry.id !== 'string') continue
    const at = merged.findIndex((candidate) => candidate.id === entry.id)
    if (at === -1) merged.push({ ...entry })
    else merged[at] = { ...merged[at], ...entry }
  }
  return merged
}

/**
 * Show only the tail of a key, enough to tell two keys of one provider apart.
 * @param value - the resolved secret.
 * @returns a hint such as `\u20267ade`.
 */
function keyHint(value) {
  if (typeof value !== 'string' || value.length < 8) return undefined
  return '\u2026' + value.slice(-4)
}

/**
 * Serve key-side balances to the browser half.
 * @param ctx - Host plugin context.
 * @param config - Loader row config overrides for {@link DEFAULTS}.
 */
export function apply(ctx, config) {
  const options = { ...DEFAULTS, ...(config || {}) }
  const providers = mergeProviders(options.providers)
  const sourcesPath = options.routePath.replace(/\/$/, '') + '/sources'
  const values = new Map()
  const valuesInflight = new Map()
  let sourcesCache
  let sourcesInflight

  /** Credential names one provider may use, most specific first. */
  const credentialRefs = (provider) =>
    Array.isArray(provider.keyEnvs) && provider.keyEnvs.length > 0
      ? provider.keyEnvs
      : [provider.keyEnv]

  /**
   * Read one provider's credential: credential store first, launching environment second.
   * @param provider - catalog entry naming the key.
   * @returns the secret and a display hint, or undefined when unconfigured.
   */
  const readKey = async (provider) => {
    const refs = credentialRefs(provider)
    try {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) {
        for (const ref of refs) {
          const hit = await credentials.resolve(ref)
          if (hit !== undefined && typeof hit.value === 'string' && hit.value.trim() !== '') {
            return { value: hit.value.trim(), hint: keyHint(hit.value.trim()), ref }
          }
        }
      }
    } catch (error) {
      ctx.logger?.warn?.(`[api-balance] credential lookup failed: ${error?.message ?? String(error)}`)
    }
    for (const ref of refs) {
      const ambient = process.env[ref]
      if (typeof ambient === 'string' && ambient.trim() !== '') {
        return { value: ambient.trim(), hint: keyHint(ambient.trim()), ref }
      }
    }
    return undefined
  }

  /** List the providers whose key is actually configured. */
  const listSources = async () => {
    if (sourcesCache !== undefined && Date.now() - sourcesCache.at < 15_000) return sourcesCache.value
    if (sourcesInflight !== undefined) return sourcesInflight
    sourcesInflight = (async () => {
      const list = []
      for (const provider of providers) {
        const key = await readKey(provider)
        if (key === undefined) continue
        list.push({
          id: provider.id,
          label: provider.label,
          provider: provider.id,
          keyHint: key.hint,
          supported: ADAPTERS[provider.adapter] !== undefined && ADAPTERS[provider.adapter] !== null,
          note: provider.note,
        })
      }
      sourcesCache = { at: Date.now(), value: list }
      return list
    })().finally(() => {
      sourcesInflight = undefined
    })
    return sourcesInflight
  }

  /**
   * Ask one vendor for its wallet.
   * @param provider - catalog entry to read.
   * @returns the shared balance envelope.
   */
  const fetchSource = async (provider) => {
    const adapter = ADAPTERS[provider.adapter]
    if (adapter === undefined || adapter === null) {
      return { ok: false, reason: 'unsupported', note: provider.note }
    }
    const key = await readKey(provider)
    if (key === undefined) return { ok: false, reason: 'no-key' }
    try {
      const response = await fetch(provider.endpoint ?? adapter.endpoint, {
        headers: { authorization: 'Bearer ' + key.value, accept: 'application/json' },
        signal: AbortSignal.timeout(options.timeoutMs),
      })
      if (response.status === 401 || response.status === 403) {
        return { ok: false, reason: 'unauthorized', status: response.status }
      }
      if (!response.ok) return { ok: false, reason: 'http', status: response.status }
      const body = await response.json()
      const wallets = adapter.parse(body)
      return {
        ok: true,
        id: provider.id,
        wallets,
        isAvailable: body?.is_available !== false,
        at: Date.now(),
      }
    } catch (error) {
      ctx.logger?.warn?.(
        `[api-balance] ${provider.id} balance request failed: ${error?.message ?? String(error)}`,
      )
      return { ok: false, reason: 'network' }
    }
  }

  /**
   * Read one source, reusing a fresh answer unless forced.
   * @param provider - catalog entry to read.
   * @param force - bypass the cache (the panel's refresh).
   * @returns the shared balance envelope.
   */
  const readSource = async (provider, force) => {
    const cached = values.get(provider.id)
    if (!force && cached !== undefined && Date.now() - cached.at < options.cacheMs) return cached.value
    const running = valuesInflight.get(provider.id)
    if (running !== undefined) return running
    const request = fetchSource(provider)
      .then((value) => {
        values.set(provider.id, { at: Date.now(), value })
        return value
      })
      .finally(() => {
        valuesInflight.delete(provider.id)
      })
    valuesInflight.set(provider.id, request)
    return request
  }

  /**
   * Reject a request this route does not serve.
   * @returns true when the handler may continue.
   */
  const prepare = (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' })
      res.end()
      return false
    }
    if (req.headers['sec-fetch-site'] === 'cross-site') {
      res.writeHead(403)
      res.end()
      return false
    }
    return true
  }

  const sendJson = (req, res, value) => {
    const body = JSON.stringify(value)
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(body),
    })
    res.end(req.method === 'HEAD' ? undefined : body)
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: sourcesPath,
        async handler(req, res) {
          if (!prepare(req, res)) return
          sendJson(req, res, { ok: true, sources: await listSources() })
        },
      }),
    'api-balance: sources route',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: options.routePath,
        async handler(req, res) {
          if (!prepare(req, res)) return
          const url = new URL(String(req.url ?? '/'), 'http://localhost')
          const id = url.searchParams.get('source') ?? ''
          const provider = providers.find((candidate) => candidate.id === id)
          if (provider === undefined) {
            sendJson(req, res, { ok: false, reason: 'unknown-source' })
            return
          }
          sendJson(req, res, await readSource(provider, url.searchParams.get('refresh') === '1'))
        },
      }),
    'api-balance: balance route',
  )
}
