// Offline harness for dsh-plugin-api-wallet.
//
//  1. Client half: evaluate client.js with a tiny React/hook shim, then drive
//     the chip through mount → follow the session provider → pin → follow again.
//  2. Host half: evaluate index.js against a fake Cordis context and exercise
//     both routes, the credential lookup, guards and caching.
//
// No network, no credentials: fetch is stubbed in both halves.
// Run: node test/check-api-balance.mjs
import { pathToFileURL } from 'node:url'

const pluginDir = new URL('../', import.meta.url)
const dictionaries = {}

// ------------------------------------------------------------------ browser

const requests = []
let route = async () => ({ ok: false, reason: 'no-key' })

const storage = new Map()
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
}

globalThis.document = {
  baseURI: 'http://127.0.0.1:64333/',
  visibilityState: 'visible',
  head: { appendChild() {} },
  createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
  addEventListener() {},
  removeEventListener() {},
}
globalThis.fetch = async (url) => {
  requests.push(String(url))
  const body = await route(String(url))
  return {
    ok: true,
    status: 200,
    async json() {
      return body
    },
  }
}

let loaded
globalThis.window = {
  __ModuleLoader__: {
    load: (definition) => {
      loaded = definition
    },
  },
}

/** Minimal hook shim: one render pass, effects re-run when deps change. */
const hooks = { values: [], index: 0 }
const React = {
  createElement(type, props, ...children) {
    return { type, props: props || {}, children }
  },
  useState(initial) {
    const at = hooks.index++
    if (!(at in hooks.values)) hooks.values[at] = initial
    const set = (value) => {
      hooks.values[at] = typeof value === 'function' ? value(hooks.values[at]) : value
    }
    return [hooks.values[at], set]
  },
  useEffect(effect, deps) {
    const at = hooks.index++
    const previous = hooks.values[at]
    const changed =
      previous === undefined ||
      deps === undefined ||
      previous.deps === undefined ||
      deps.length !== previous.deps.length ||
      deps.some((value, index) => value !== previous.deps[index])
    if (!changed) return
    if (previous !== undefined && typeof previous.cleanup === 'function') previous.cleanup()
    hooks.values[at] = { deps, cleanup: effect() }
  },
  useRef(initial) {
    const at = hooks.index++
    if (!(at in hooks.values)) hooks.values[at] = { current: initial }
    return hooks.values[at]
  },
  useSyncExternalStore(_subscribe, getSnapshot) {
    hooks.index++
    return getSnapshot()
  },
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function textOf(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return textOf(node.children)
}

/** Render the chip once from a clean hook slate. */
function render(component, props) {
  hooks.index = 0
  return component(props)
}

/** Start a fresh component instance (hook state does not leak between mounts). */
function mount(component, props) {
  hooks.values = []
  hooks.index = 0
  return component(props)
}

/** Depth-first search for the first node matching the predicate. */
function find(node, predicate) {
  if (node === null || typeof node !== 'object') return undefined
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, predicate)
      if (hit !== undefined) return hit
    }
    return undefined
  }
  if (predicate(node)) return node
  return find(node.children, predicate)
}

function findAll(node, predicate, out = []) {
  if (node === null || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, out)
    return out
  }
  if (predicate(node)) out.push(node)
  findAll(node.children, predicate, out)
  return out
}

const byClass = (name) => (node) => {
  const className = node.props && node.props.className
  return typeof className === 'string' && className.split(' ').includes(name)
}

const translate = (dict) => (key) => dict[key] || key

// ---------------------------------------------------------------- client half

await import(new URL('client.js', pluginDir).href)
if (loaded === undefined) throw new Error('client module did not register')
if (loaded.id !== 'dsh-plugin-api-wallet') throw new Error('unexpected module id ' + loaded.id)
const required = loaded.factory((name) => {
  if (name === 'react') return React
  throw new Error('unexpected require ' + name)
})

const accountWallet = {
  status: 'ready',
  value: [{ currency: 'CNY', balance: '19.91' }],
  bonusWallets: [{ currency: 'CNY', balance: '2.00' }],
}

/** Fake session-model projection: the session's current provider route. */
function makeSessionService(initial) {
  const state = { provider: initial, listeners: new Set() }
  const face = {
    getSnapshot: () => ({ next: { provider: state.provider } }),
    subscribe(listener) {
      state.listeners.add(listener)
      return () => state.listeners.delete(listener)
    },
  }
  return {
    service: {
      binding: () => ({
        session: { projections: { faceOf: (name) => (name === 'modelSelection' ? face : undefined) } },
      }),
    },
    set(provider) {
      state.provider = provider
      for (const listener of [...state.listeners]) listener()
    },
  }
}

function makeClientContext({ account = true, provider = 'moonshotai-cn' } = {}) {
  const flags = { signedIn: account }
  const session = makeSessionService(provider)
  const ctx = {
    effect(fn) {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    locale: {
      register(ns, dict) {
        dictionaries[ns] = dict.zh
        return () => {}
      },
      bind: (ns) => translate(dictionaries[ns] || {}),
      getSnapshot: () => ({ active: 'zh-CN' }),
    },
    slots: {
      inject(_name, callback) {
        callback()
      },
      register(_declaration, component) {
        ctx._component = component
        return () => {}
      },
    },
    /* Cordis throws when a non-injected service is read as a property; the
       plugin must use ctx.get() instead. */
    remote: {
      get account() {
        throw new Error('cannot get property "account" without inject')
      },
    },
    get(name) {
      if (name === 'sessions') return session.service
      if (name !== 'remote.account') throw new Error('cannot get property "' + name + '" without inject')
      return {
        getState: async () => ({
          ok: true,
          value: { status: flags.signedIn ? 'credential-stored' : 'signed-out', links: {}, attempt: null },
        }),
        getBalance: async () => ({ ok: true, value: accountWallet }),
      }
    },
    _flags: flags,
    _session: session,
  }
  return ctx
}

let failures = 0
const check = (ok, label, detail) => {
  if (ok) {
    console.log('ok   ' + label)
  } else {
    failures += 1
    console.log('FAIL ' + label + (detail === undefined ? '' : ' → ' + detail))
  }
}

route = async (url) => {
  if (url.endsWith('/sources')) {
    return {
      ok: true,
      sources: [
        { id: 'deepseek', label: 'DeepSeek', keyHint: '…7ade', supported: true },
        { id: 'moonshot', label: 'Moonshot (Kimi)', keyHint: '…9f21', supported: true },
        { id: 'openai', label: 'OpenAI', supported: false, note: 'OpenAI 不对 API Key 提供余额接口' },
      ],
    }
  }
  if (url.includes('source=deepseek')) {
    return {
      ok: true,
      id: 'deepseek',
      isAvailable: true,
      wallets: [{ currency: 'CNY', total: '986.13', granted: '0.00', toppedUp: '986.13' }],
    }
  }
  if (url.includes('source=moonshot')) {
    return {
      ok: true,
      id: 'moonshot',
      isAvailable: true,
      wallets: [{ currency: 'CNY', total: '12.34', granted: '0.00', toppedUp: '12.34' }],
    }
  }
  return { ok: false, reason: 'unknown-source' }
}

const ctxClient = makeClientContext({ provider: 'moonshotai-cn' })
required.apply(ctxClient)
const chip = ctxClient._component
const props = { sessionId: 'session-1' }
let tree = mount(chip, props)
await settle()
await settle()
tree = render(chip, props)

check(
  textOf(find(tree, byClass('dshApiBalance'))).includes('Moonshot (Kimi)'),
  'chip follows the session provider on mount',
  textOf(tree),
)
check(textOf(tree).includes('¥12.34'), 'chip shows the followed wallet', textOf(tree))

// The panel lists the follow row plus every configured source.
find(tree, byClass('dshApiBalance')).props.onClick()
render(chip, props)
await settle()
await settle()
tree = render(chip, props)
let rows = findAll(tree, byClass('dshBalanceRow'))
check(rows.length === 5, 'panel lists follow + four sources', String(rows.length))
let rowText = rows.map((row) => textOf(row).replace(/\s+/g, ' ').trim())
check(rowText[0].includes('跟随当前模型'), 'first row follows the model', JSON.stringify(rowText))
check(
  rowText.some((text) => text.includes('DeepSeek 账号') && text.includes('¥21.91')),
  'account row shows the wallet',
  JSON.stringify(rowText),
)
check(
  rowText.some((text) => text.includes('…7ade')) && rowText.some((text) => text.includes('…9f21')),
  'key rows carry their hints',
  JSON.stringify(rowText),
)
check(
  rowText.some((text) => text.includes('OpenAI') && text.includes('无余额接口')),
  'unsupported vendor is listed as such',
  JSON.stringify(rowText),
)

// Pinning a source wins over the session provider.
const keyRow = rows.find((row) => textOf(row).includes('…7ade'))
keyRow.props.onClick()
render(chip, props)
await settle()
await settle()
tree = render(chip, props)
check(textOf(tree).includes('¥986.13'), 'pinning switches the wallet', textOf(tree))
check(storage.get('dsh.api-balance.source') === 'deepseek', 'pin is persisted', String(storage.get('dsh.api-balance.source')))
ctxClient._session.set('moonshotai-cn')
await settle()
tree = render(chip, props)
check(textOf(tree).includes('¥986.13'), 'a pinned source ignores provider changes', textOf(tree))

// Following again tracks the provider from then on.
find(tree, byClass('dshApiBalance')).props.onClick()
render(chip, props)
await settle()
await settle()
tree = render(chip, props)
const followRow = findAll(tree, byClass('dshBalanceRow'))[0]
followRow.props.onClick()
render(chip, props)
await settle()
await settle()
tree = render(chip, props)
check(textOf(tree).includes('¥12.34'), 'following restores the model wallet', textOf(tree))
check(storage.has('dsh.api-balance.source') === false, 'following clears the pin', String(storage.get('dsh.api-balance.source')))

ctxClient._session.set('deepseek-official')
await settle()
await settle()
tree = render(chip, props)
check(
  textOf(find(tree, byClass('dshApiBalance'))).includes('DeepSeek') && textOf(tree).includes('¥986.13'),
  'switching the model switches the wallet',
  textOf(tree),
)
check(
  requests.some((url) => url.includes('source=deepseek')),
  'key values come from the host route',
  JSON.stringify(requests.slice(0, 5)),
)

// A signed-out profile offers only key sources, and picks up a later sign-in.
const ctxKeysOnly = makeClientContext({ account: false })
storage.clear()
required.apply(ctxKeysOnly)
let keyTree = mount(ctxKeysOnly._component, props)
await settle()
await settle()
keyTree = render(ctxKeysOnly._component, props)
find(keyTree, byClass('dshApiBalance')).props.onClick()
render(ctxKeysOnly._component, props)
await settle()
await settle()
keyTree = render(ctxKeysOnly._component, props)
check(findAll(keyTree, byClass('dshBalanceRow')).length === 4, 'no account row when signed out')

ctxKeysOnly._flags.signedIn = true
find(keyTree, byClass('dshApiBalance')).props.onClick()
render(ctxKeysOnly._component, props)
find(render(ctxKeysOnly._component, props), byClass('dshApiBalance')).props.onClick()
render(ctxKeysOnly._component, props)
await settle()
await settle()
keyTree = render(ctxKeysOnly._component, props)
check(
  findAll(keyTree, byClass('dshBalanceRow')).length === 5,
  'account row appears after sign-in',
  JSON.stringify(findAll(keyTree, byClass('dshBalanceRow')).map((row) => textOf(row))),
)

// z.ai: the provider is recognised, but the vendor has no API-key balance route.
route = async (url) => {
  if (url.endsWith('/sources')) {
    return {
      ok: true,
      sources: [
        { id: 'deepseek', label: 'DeepSeek', keyHint: '…7ade', supported: true },
        {
          id: 'zai-coding-cn',
          label: '智谱 GLM（国内编码套餐）',
          supported: false,
          note: '智谱只对网页登录态开放余额接口，API Key 无法查询；请到 open.bigmodel.cn 财务中心查看',
        },
      ],
    }
  }
  if (url.includes('source=deepseek')) {
    return { ok: true, id: 'deepseek', isAvailable: true, wallets: [{ currency: 'CNY', total: '900.00', granted: '0', toppedUp: '900.00' }] }
  }
  return { ok: false, reason: 'unknown-source' }
}
const ctxZai = makeClientContext({ provider: 'zai-coding-cn' })
storage.clear()
required.apply(ctxZai)
let zaiTree = mount(ctxZai._component, props)
await settle()
await settle()
zaiTree = render(ctxZai._component, props)
check(
  textOf(find(zaiTree, byClass('dshApiBalance'))).includes('智谱'),
  'z.ai provider is followed',
  textOf(zaiTree),
)
check(
  textOf(zaiTree).includes('无余额接口'),
  'z.ai explains the missing amount instead of showing another wallet',
  textOf(zaiTree),
)
find(zaiTree, byClass('dshApiBalance')).props.onClick()
render(ctxZai._component, props)
await settle()
await settle()
zaiTree = render(ctxZai._component, props)
const zaiRows = findAll(zaiTree, byClass('dshBalanceRow')).map((row) => textOf(row).replace(/\s+/g, ' ').trim())
check(
  zaiRows.some((text) => text.includes('open.bigmodel.cn')),
  'z.ai row carries the console hint',
  JSON.stringify(zaiRows),
)

// ------------------------------------------------------------ host half

const hostModule = await import(new URL('index.js', pluginDir).href)

function makeHost({ keys = {}, platform = {} } = {}) {
  const routes = new Map()
  const ctx = {
    effect(fn) {
      const dispose = fn()
      ctx.disposers.push(dispose)
      return dispose
    },
    disposers: [],
    get(name) {
      if (name !== 'credentials') return undefined
      return {
        async resolve(ref) {
          const value = keys[ref]
          return value === undefined ? undefined : { value, source: 'credential-store' }
        },
      }
    },
    webServer: {
      register(route) {
        routes.set(route.path, route)
        return () => {}
      },
    },
    logger: { warn() {}, info() {} },
  }
  ctx.routes = routes
  globalThis.fetch = async (url, init) => {
    ctx.lastRequest = { url: String(url), init }
    const answer = platform[String(url)] ?? platform.default ?? { ok: true, status: 200, body: {} }
    return {
      ok: answer.ok !== false,
      status: answer.status ?? 200,
      async json() {
        return answer.body ?? {}
      },
    }
  }
  return ctx
}

async function call(ctx, path, { method = 'GET', headers = {} } = {}) {
  const pathname = path.split('?')[0]
  const entry = ctx.routes.get(pathname)
  if (entry === undefined) throw new Error('no route ' + pathname)
  const out = { status: 0, body: '' }
  const res = {
    writeHead(status) {
      out.status = status
    },
    end(body) {
      out.body = body ?? ''
    },
  }
  await entry.handler({ method, url: path, headers }, res)
  return out
}

const deepseekBody = {
  is_available: true,
  balance_infos: [{ currency: 'CNY', total_balance: '986.13', granted_balance: '0.00', topped_up_balance: '986.13' }],
}
const moonshotBody = {
  code: 0,
  data: { available_balance: 12.34, voucher_balance: 0, cash_balance: 12.34 },
}

const hostCtx = makeHost({
  keys: {
    DEEPSEEK_API_KEY: 'sk-offline-fixture',
    MOONSHOTAI_CN_API_KEY: 'sk-moonshot-fixture',
    OPENAI_API_KEY: 'sk-openai-fixture',
    ZAI_CODING_CN_API_KEY: 'zai-coding-fixture',
  },
  platform: {
    'https://api.deepseek.com/user/balance': { body: deepseekBody },
    'https://api.moonshot.cn/v1/users/me/balance': { body: moonshotBody },
  },
})
hostModule.apply(hostCtx, {})
check(hostCtx.routes.has('/plugins-api/api-balance'), 'host registers the balance route')
check(hostCtx.routes.has('/plugins-api/api-balance/sources'), 'host registers the sources route')

const sourcesAnswer = JSON.parse((await call(hostCtx, '/plugins-api/api-balance/sources')).body)
const sourceIds = sourcesAnswer.sources.map((source) => source.id)
check(sourceIds.includes('deepseek') && sourceIds.includes('moonshot') && sourceIds.includes('openai'), 'sources list configured keys only', JSON.stringify(sourceIds))
check(!sourceIds.includes('siliconflow'), 'unconfigured vendors stay out', JSON.stringify(sourceIds))
check(
  sourcesAnswer.sources.find((source) => source.id === 'moonshot').keyHint === '…ture',
  'moonshot is found through MOONSHOTAI_CN_API_KEY',
  JSON.stringify(sourcesAnswer.sources.find((source) => source.id === 'moonshot')),
)
check(
  sourcesAnswer.sources.find((source) => source.id === 'openai').supported === false,
  'openai marked unsupported',
)
check(
  sourceIds.includes('zai-coding-cn') &&
    sourcesAnswer.sources.find((source) => source.id === 'zai-coding-cn').supported === false &&
    String(sourcesAnswer.sources.find((source) => source.id === 'zai-coding-cn').note).includes('open.bigmodel.cn'),
  'z.ai coding key listed with a console hint',
  JSON.stringify(sourcesAnswer.sources.find((source) => source.id === 'zai-coding-cn')),
)
check(!JSON.stringify(sourcesAnswer).includes('sk-offline-fixture'), 'key never returned by the sources route')

const balanceAnswer = JSON.parse((await call(hostCtx, '/plugins-api/api-balance?source=deepseek')).body)
check(
  balanceAnswer.ok === true && balanceAnswer.wallets[0].total === '986.13',
  'deepseek wallet mapped',
  JSON.stringify(balanceAnswer),
)
check(hostCtx.lastRequest.init.headers.authorization === 'Bearer sk-offline-fixture', 'bearer token used')
check(!JSON.stringify(balanceAnswer).includes('sk-offline-fixture'), 'key never returned by the balance route')
check(balanceAnswer.isAvailable === true, 'availability passed through')

const moonshotAnswer = JSON.parse((await call(hostCtx, '/plugins-api/api-balance?source=moonshot')).body)
check(
  moonshotAnswer.ok === true && moonshotAnswer.wallets[0].total === '12.34',
  'moonshot wallet mapped',
  JSON.stringify(moonshotAnswer),
)

const unsupported = JSON.parse((await call(hostCtx, '/plugins-api/api-balance?source=openai')).body)
check(
  unsupported.ok === false && unsupported.reason === 'unsupported',
  'unsupported vendor answers unsupported',
  JSON.stringify(unsupported),
)

const unknown = JSON.parse((await call(hostCtx, '/plugins-api/api-balance?source=nope')).body)
check(unknown.ok === false && unknown.reason === 'unknown-source', 'unknown source refused', JSON.stringify(unknown))

check((await call(hostCtx, '/plugins-api/api-balance', { method: 'POST' })).status === 405, 'POST refused')
check(
  (await call(hostCtx, '/plugins-api/api-balance', { headers: { 'sec-fetch-site': 'cross-site' } })).status === 403,
  'cross-site refused',
)

const before = hostCtx.lastRequest
await call(hostCtx, '/plugins-api/api-balance?source=deepseek')
check(hostCtx.lastRequest === before, 'second read inside 60s reuses the cache')

const forced = await call(hostCtx, '/plugins-api/api-balance?source=deepseek&refresh=1')
check(JSON.parse(forced.body).ok === true && hostCtx.lastRequest !== before, 'refresh=1 bypasses the cache')

const unauthorizedCtx = makeHost({
  keys: { DEEPSEEK_API_KEY: 'sk-revoked' },
  platform: { default: { ok: false, status: 401 } },
})
hostModule.apply(unauthorizedCtx, {})
const unauthorized = JSON.parse((await call(unauthorizedCtx, '/plugins-api/api-balance?source=deepseek')).body)
check(
  unauthorized.ok === false && unauthorized.reason === 'unauthorized',
  '401 mapped to unauthorized',
  JSON.stringify(unauthorized),
)

console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)')
process.exit(failures === 0 ? 0 : 1)
