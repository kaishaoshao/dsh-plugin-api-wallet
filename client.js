/**
 * API-balance decoration for the Web UI.
 *
 * Renders a compact `<source> ¥123.45` chip in `conversation.composer.dock` and
 * lets the user pick which balance it pins, or follow the model the session is
 * actually using:
 *
 *   follow (default) -> the source matching the session's current provider
 *   pinned           -> the source the user picked in the panel
 *
 *   account source -> ctx.get('remote.account').getBalance()
 *   key sources    -> GET /plugins-api/api-balance/sources
 *                     GET /plugins-api/api-balance?source=<id>[&refresh=1]
 *
 * The Host owns every key: the browser only ever receives wallet amounts.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-api-wallet',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Dictionary namespace owned by this plugin. */
    const NAMESPACE = 'apiBalance';
    /** Wallet refresh interval; the Host route caches one answer for 60s. */
    const REFRESH_MS = 5 * 60 * 1000;
    /** A re-selection closer than this to the previous read reuses the value. */
    const STALE_MS = 30 * 1000;
    /** Host route base, resolved against the page base so any mount works. */
    const ROUTE = 'plugins-api/api-balance';
    /** Browser-local memory of the pinned source; absent means "follow". */
    const STORAGE_KEY = 'dsh.api-balance.source';
    /** Currency symbol used for wallets the vendors name. */
    const SYMBOLS = { CNY: '\u00a5', USD: '$' };

    /** Provider id fragments mapped onto balance sources, first match wins. */
    const PROVIDER_SOURCES = [
      ['deepseek-account', 'account'],
      ['deepseek', 'deepseek'],
      ['moonshot', 'moonshot'],
      ['kimi', 'moonshot'],
      ['openrouter', 'openrouter'],
      ['siliconflow', 'siliconflow'],
      ['openai', 'openai'],
      ['anthropic', 'anthropic'],
      ['claude', 'anthropic'],
      /* Specific coding-plan routes come before the generic GLM aliases. */
      ['zai-coding', 'zai-coding-cn'],
      ['zai', 'zai'],
      ['zhipu', 'zhipu'],
      ['glm', 'zhipu'],
    ];

    const COPY = {
      en: {
        label: 'Balance',
        accountLabel: 'DeepSeek account',
        noSource: 'Not configured',
        noAccount: 'Signed out',
        loading: '\u2026',
        unsupported: 'No balance API',
        unauthorized: 'Key rejected',
        noKey: 'No key',
        failed: 'Unavailable',
        total: 'Total',
        toppedUp: 'Topped-up',
        granted: 'Granted',
        insufficient: 'Not enough balance to run a request',
        sourcesTitle: 'Balance source',
        followModel: 'Follow current model',
        followUnknown: 'provider not recognised',
        refreshAll: 'Refresh',
        refreshHint: 'Click to switch source',
        emptyHint:
          'No balance source yet: add an API key under Settings \u2192 Models, or sign in under Settings \u2192 Account.',
        unauthorizedHint: 'The vendor rejected this key (401/403). Check whether it was revoked or mistyped.',
        failedHint: 'The balance could not be read. Open the list and refresh.',
      },
      zh: {
        label: '\u4f59\u989d',
        accountLabel: 'DeepSeek \u8d26\u53f7',
        noSource: '\u672a\u914d\u7f6e',
        noAccount: '\u672a\u767b\u5f55',
        loading: '\u2026',
        unsupported: '\u65e0\u4f59\u989d\u63a5\u53e3',
        unauthorized: 'Key \u65e0\u6548',
        noKey: '\u672a\u914d\u7f6e Key',
        failed: '\u8bfb\u53d6\u5931\u8d25',
        total: '\u603b\u4f59\u989d',
        toppedUp: '\u5145\u503c\u4f59\u989d',
        granted: '\u8d60\u9001\u4f59\u989d',
        insufficient: '\u4f59\u989d\u4e0d\u8db3\uff0c\u65e0\u6cd5\u53d1\u8d77\u8bf7\u6c42',
        sourcesTitle: '\u4f59\u989d\u6765\u6e90',
        followModel: '\u8ddf\u968f\u5f53\u524d\u6a21\u578b',
        followUnknown: '\u672a\u8bc6\u522b\u670d\u52a1\u5546',
        refreshAll: '\u5237\u65b0',
        refreshHint: '\u70b9\u51fb\u5207\u6362\u4f59\u989d\u6765\u6e90',
        emptyHint:
          '\u8fd8\u6ca1\u6709\u53ef\u7528\u7684\u4f59\u989d\u6765\u6e90\uff1a\u5728\u201c\u8bbe\u7f6e \u2192 \u6a21\u578b\u201d\u91cc\u586b\u5165 API Key\uff0c\u6216\u5728\u201c\u8bbe\u7f6e \u2192 \u8d26\u6237\u201d\u767b\u5f55 DeepSeek \u8d26\u53f7\u3002',
        unauthorizedHint:
          '\u670d\u52a1\u5546\u62d2\u7edd\u4e86\u8fd9\u628a Key\uff08401/403\uff09\uff0c\u8bf7\u68c0\u67e5\u662f\u5426\u5df2\u88ab\u64a4\u9500\u3001\u6216\u662f\u590d\u5236\u6709\u8bef\u3002',
        failedHint: '\u8bfb\u53d6\u4f59\u989d\u5931\u8d25\uff0c\u6253\u5f00\u5217\u8868\u5237\u65b0\u91cd\u8bd5\u3002',
      },
    };

    const CSS = [
      '.dshBalanceWrap{position:relative;display:inline-flex;flex:none}',
      '.dshApiBalance{display:inline-flex;align-items:center;gap:6px;box-sizing:border-box;',
      'border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);',
      'font:inherit;font-size:var(--dsh-content-font-size-secondary,13px);',
      'line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));',
      'font-variant-numeric:tabular-nums;white-space:nowrap;cursor:pointer;padding:1px 8px;flex:none}',
      '.dshApiBalance:hover,.dshApiBalance[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover);',
      'color:var(--dsw-alias-label-secondary)}',
      '.dshApiBalance:focus-visible{outline:var(--dsw-focus-ring-width) solid ',
      'var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}',
      '.dshApiBalance-label{color:inherit;opacity:.9}',
      '.dshApiBalance-value{color:var(--dsw-alias-label-secondary);font-weight:500}',
      '.dshApiBalance:hover .dshApiBalance-value{color:var(--dsw-alias-label-primary)}',
      '.dshApiBalance-glyph{flex:none;display:grid;place-items:center}',
      '.dshApiBalance[data-phase="loading"] .dshApiBalance-glyph{animation:dshBalanceSpin 1s linear infinite}',
      '@keyframes dshBalanceSpin{to{transform:rotate(360deg)}}',
      '@media (prefers-reduced-motion: reduce){.dshApiBalance-glyph{animation:none!important}}',
      '.dshBalancePanel{position:absolute;bottom:calc(100% + 10px);left:50%;transform:translateX(-50%);z-index:60;',
      'width:308px;box-sizing:border-box;padding:6px;border-radius:var(--dsw-radius-lg);',
      'background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);',
      'border:.5px solid var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);',
      'color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;text-align:left}',
      '.dshBalancePanel-title{padding:6px 10px 4px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',
      '.dshBalanceRow{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;',
      'padding:7px 10px;border:0;border-radius:var(--dsw-radius-md);background:transparent;color:inherit;',
      'font:inherit;text-align:left;cursor:pointer}',
      '.dshBalanceRow:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dshBalanceRow[data-selected="true"]{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dshBalanceRow[data-static="true"]{cursor:default}',
      '.dshBalanceRow[data-static="true"]:hover{background:transparent}',
      '.dshBalanceRow-main{display:flex;flex-direction:column;min-width:0;flex:1}',
      '.dshBalanceRow-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dshBalanceRow-hint{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:14px;',
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dshBalanceRow-value{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);flex:none}',
      '.dshBalanceRow[data-selected="true"] .dshBalanceRow-value{color:var(--dsw-alias-label-primary);font-weight:500}',
      '.dshBalanceCheck{flex:none;color:var(--dsw-alias-state-business-primary);display:grid;place-items:center}',
      '.dshBalanceEmpty{margin:0;padding:6px 10px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}',
      '.dshBalanceFooter{display:flex;align-items:center;justify-content:space-between;gap:8px;',
      'border-top:.5px solid var(--dsw-alias-border-l3);margin-top:4px;padding:6px 10px 4px}',
      '.dshBalanceFooter-hint{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',
      '.dshBalanceRefresh{border:0;background:transparent;color:var(--dsw-alias-label-secondary);',
      'font:inherit;font-size:12px;line-height:18px;cursor:pointer;padding:2px 8px;border-radius:var(--dsw-radius-sm)}',
      '.dshBalanceRefresh:hover{background:var(--dsw-alias-interactive-bg-hover)}',
    ].join('');

    /**
     * Group the integer digits of a plain decimal string.
     * @param digits - integer part without sign.
     * @returns grouped digits.
     */
    function group(digits) {
      const trimmed = digits.replace(/^0+(?=\d)/, '') || '0';
      return trimmed.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    /**
     * Two-decimal currency text for a raw balance string.
     *
     * Positive sub-cent values render as `<¥0.01`, negative values keep at least
     * one cent of magnitude, and digits are truncated rather than rounded so the
     * chip never claims more credit than the wallet holds.
     * @param amount - decimal balance string from a vendor.
     * @param currency - wallet currency code.
     * @returns display text.
     */
    function formatBalance(amount, currency) {
      const symbol = SYMBOLS[currency] || '';
      const raw = String(amount === undefined || amount === null ? '0' : amount).trim();
      const negative = raw.startsWith('-');
      const unsigned = raw.replace(/^[+-]/, '');
      const parts = unsigned.split('.');
      const integer = parts[0] || '0';
      const fractionRaw = parts[1] || '';
      const fraction = (fractionRaw + '00').slice(0, 2);
      const zeroInteger = /^0*$/.test(integer);
      const zeroFraction = /^0*$/.test(fraction);
      if (!/[1-9]/.test(unsigned)) return symbol + '0.00';
      if (zeroInteger && zeroFraction) return (negative ? '-' : '<') + symbol + '0.01';
      return (negative ? '-' : '') + symbol + group(integer) + '.' + fraction;
    }

    /** Wallet glyph: a wallet outline with a clasp, drawn at the meter icon's 14px size. */
    function Glyph() {
      return h(
        'svg',
        {
          className: 'dshApiBalance-glyph',
          viewBox: '0 0 16 16',
          width: 14,
          height: 14,
          'aria-hidden': true,
        },
        h('path', {
          d: 'M1.5 5.2h13v6.3a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V5.2Z',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M1.5 5.2 3 3.4a1.6 1.6 0 0 1 1.2-.55h6.9',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
        }),
        h('circle', { cx: 11.4, cy: 8.4, r: 1.05, fill: 'currentColor' }),
      );
    }

    /** Tick shown on the active choice. */
    function Check() {
      return h(
        'svg',
        {
          className: 'dshBalanceCheck',
          viewBox: '0 0 16 16',
          width: 14,
          height: 14,
          'aria-hidden': true,
        },
        h('path', {
          d: 'M3 8.4 6.3 11.7 13 5',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => {
          const tag = document.createElement('style');
          tag.dataset.plugin = 'dsh-plugin-api-wallet';
          tag.dataset.pluginCss = 'dsh-plugin-api-wallet/chip';
          tag.textContent = CSS;
          document.head.appendChild(tag);
          return () => tag.remove();
        }, 'api-balance: styles');

        let t;
        try {
          ctx.effect(() => ctx.locale.register(NAMESPACE, COPY), 'api-balance: dictionaries');
          t = ctx.locale.bind(NAMESPACE);
        } catch {
          t = (key) => COPY.zh[key] || COPY.en[key] || key;
        }

        const version = (() => {
          const boot = globalThis.__DSH_BOOT__;
          const release = boot && boot.release;
          const candidates = [release && release.version, boot && boot.version];
          return candidates.find((value) => typeof value === 'string' && value !== '') || '0.0.0';
        })();

        const metadata = () => ({
          version,
          locale: String(ctx.locale.getSnapshot().active || 'en'),
          timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
        });

        /**
         * Resolve a Host route against the page base, so a sub-path mount and the
         * plain root both work.
         * @param suffix - path appended to {@link ROUTE}, such as `/sources`.
         * @param query - query string without the leading `?`.
         * @returns absolute request URL.
         */
        const routeUrl = (suffix, query) => {
          let url;
          try {
            url = new URL(ROUTE + (suffix || ''), document.baseURI).href;
          } catch {
            url = '/' + ROUTE + (suffix || '');
          }
          return query ? url + '?' + query : url;
        };

        /** Read one Remote result that answers either an envelope or a bare value. */
        const unwrap = (result) => {
          if (result !== null && typeof result === 'object' && 'ok' in result) {
            if (result.ok === false) throw new Error('api-balance: remote call refused');
            return result.value;
          }
          return result;
        };

        /**
         * A client service read without an inject requirement.
         *
         * Cordis throws when a non-injected service is read as a property, so
         * `ctx.get` is the way to probe for optional services.
         * @param name - service name.
         * @returns the service, or undefined.
         */
        const serviceOf = (name) => {
          try {
            return ctx.get(name);
          } catch {
            return undefined;
          }
        };

        /** Map a provider route id onto the balance source that reads it. */
        const sourceForProvider = (provider) => {
          const id = String(provider || '').toLowerCase();
          if (id === '') return undefined;
          const hit = PROVIDER_SOURCES.find(([needle]) => id.includes(needle));
          return hit === undefined ? undefined : hit[1];
        };

        /**
         * Read the session's current provider from its `modelSelection` projection.
         * @param sessionId - the slot's session.
         * @returns provider route id, or undefined when unavailable.
         */
        const readProvider = (sessionId) => {
          if (sessionId === undefined || sessionId === null) return undefined;
          try {
            const sessions = serviceOf('sessions');
            const binding = sessions && sessions.binding && sessions.binding(sessionId);
            const face = binding && binding.session && binding.session.projections
              ? binding.session.projections.faceOf('modelSelection')
              : undefined;
            if (face === undefined || typeof face.getSnapshot !== 'function') return undefined;
            const raw = face.getSnapshot();
            const current = (raw && (raw.next || raw.current)) || raw;
            const provider = current && (current.provider || current.route);
            return typeof provider === 'string' ? provider : undefined;
          } catch {
            return undefined;
          }
        };

        /**
         * Subscribe to provider changes for one session.
         * @param sessionId - the slot's session.
         * @param onChange - called with the new provider id.
         * @returns disposer (no-op when the projection is unavailable).
         */
        const watchProvider = (sessionId, onChange) => {
          try {
            const sessions = serviceOf('sessions');
            const binding = sessions && sessions.binding && sessions.binding(sessionId);
            const face = binding && binding.session && binding.session.projections
              ? binding.session.projections.faceOf('modelSelection')
              : undefined;
            if (face === undefined || typeof face.subscribe !== 'function') return () => {};
            return face.subscribe(() => onChange(readProvider(sessionId)));
          } catch {
            return () => {};
          }
        };

        /** List the key-side sources the Host can read. */
        const readKeySources = async () => {
          const response = await fetch(routeUrl('/sources'), {
            headers: { accept: 'application/json' },
            cache: 'no-store',
          });
          if (!response.ok) throw new Error('api-balance: sources answered ' + response.status);
          const body = await response.json();
          const list = Array.isArray(body?.sources) ? body.sources : [];
          return list.map((source) => ({
            id: String(source.id),
            label: String(source.label ?? source.id),
            kind: 'key',
            keyHint: typeof source.keyHint === 'string' ? source.keyHint : undefined,
            supported: source.supported !== false,
            note: typeof source.note === 'string' ? source.note : undefined,
          }));
        };

        /** Whether the signed-in DeepSeek account has a stored credential. */
        const readAccountSource = async () => {
          const account = serviceOf('remote.account');
          if (account === undefined) return false;
          const state = unwrap(await account.getState());
          return Boolean(state && state.status === 'credential-stored');
        };

        /** Fetch and normalize the account wallet. */
        const fetchAccount = async () => {
          const account = serviceOf('remote.account');
          if (account === undefined) return { phase: 'signed-out' };
          const balance = unwrap(await account.getBalance(metadata()));
          if (balance === null || balance === undefined) return { phase: 'signed-out' };
          if (balance.status === 'failed') return { phase: 'failed' };
          const wallets = (balance.value || []).map((wallet) => ({
            currency: wallet.currency,
            total: wallet.balance,
            granted: '0',
            toppedUp: wallet.balance,
          }));
          for (const bonus of balance.bonusWallets || []) {
            const known = wallets.find((wallet) => wallet.currency === bonus.currency);
            if (known === undefined) {
              wallets.push({ currency: bonus.currency, total: bonus.balance, granted: bonus.balance, toppedUp: '0' });
              continue;
            }
            known.granted = bonus.balance;
            known.total = (Number(known.toppedUp) + Number(bonus.balance)).toFixed(2);
          }
          return { phase: 'ready', wallets, isAvailable: true };
        };

        /** Fetch and normalize one key-side wallet. */
        const fetchKey = async (id, force) => {
          const query = 'source=' + encodeURIComponent(id) + (force ? '&refresh=1' : '');
          const response = await fetch(routeUrl('', query), {
            headers: { accept: 'application/json' },
            cache: 'no-store',
          });
          if (!response.ok) throw new Error('api-balance: route answered ' + response.status);
          const body = await response.json();
          if (!body || body.ok !== true) {
            const reason = body && typeof body.reason === 'string' ? body.reason : 'failed';
            if (reason === 'unsupported') return { phase: 'unsupported', note: body.note };
            if (reason === 'unauthorized') return { phase: 'unauthorized' };
            if (reason === 'no-key') return { phase: 'no-key' };
            return { phase: 'failed' };
          }
          return {
            phase: 'ready',
            wallets: Array.isArray(body.wallets) ? body.wallets : [],
            isAvailable: body.isAvailable !== false,
          };
        };

        const loadStored = () => {
          try {
            return localStorage.getItem(STORAGE_KEY);
          } catch {
            return null;
          }
        };
        const saveStored = (id) => {
          try {
            if (id === null) localStorage.removeItem(STORAGE_KEY);
            else localStorage.setItem(STORAGE_KEY, id);
          } catch {
            /* storage may be unavailable; the in-memory selection still works */
          }
        };

        let snapshot = {
          ready: false,
          sources: [],
          pinned: loadStored(),
          provider: undefined,
          selectedId: null,
          values: {},
        };
        const listeners = new Set();
        const publish = (patch) => {
          snapshot = { ...snapshot, ...patch };
          for (const listener of listeners) listener();
        };
        const setValue = (id, value) => {
          /* Tag the value with its source so a late answer for a previously
             selected source can never be rendered under another source's name. */
          publish({ values: { ...snapshot.values, [id]: { ...value, sourceId: id } } });
        };

        const inflight = new Map();
        const attempts = new Map();
        let started = false;

        /**
         * Read one source, sharing an in-flight request and a 30s result.
         * @param id - source id.
         * @param force - bypass the result reuse.
         * @returns settled value.
         */
        const ensure = (id, force) => {
          if (inflight.has(id)) return inflight.get(id);
          const source = snapshot.sources.find((candidate) => candidate.id === id);
          if (source === undefined) return Promise.resolve(undefined);
          const known = snapshot.values[id];
          const last = attempts.get(id) ?? 0;
          if (!force && known !== undefined && known.phase !== 'loading' && Date.now() - last < STALE_MS) {
            return Promise.resolve(known);
          }
          if (source.supported === false) {
            const value = { phase: 'unsupported', note: source.note };
            setValue(id, value);
            return Promise.resolve(value);
          }
          setValue(id, { phase: 'loading' });
          const request = (source.kind === 'account' ? fetchAccount() : fetchKey(id, force === true))
            .then((value) => {
              attempts.set(id, Date.now());
              setValue(id, value);
              return value;
            })
            .catch((error) => {
              console.error('[api-balance] balance read failed', error);
              attempts.set(id, Date.now());
              const value = { phase: 'failed' };
              setValue(id, value);
              return value;
            })
            .finally(() => {
              inflight.delete(id);
            });
          inflight.set(id, request);
          return request;
        };

        /** Read every source whose value is missing or stale. */
        const ensureAll = () => {
          for (const source of snapshot.sources) {
            const last = attempts.get(source.id) ?? 0;
            if (Date.now() - last > STALE_MS) ensure(source.id, false);
          }
        };

        /** Refresh every source from its vendor. */
        const refreshAll = () => {
          for (const source of snapshot.sources) ensure(source.id, true);
        };

        /** The source the current provider maps to, when it is configured. */
        const autoSourceId = () => {
          const mapped = sourceForProvider(snapshot.provider);
          if (mapped === undefined) return undefined;
          return snapshot.sources.some((source) => source.id === mapped) ? mapped : undefined;
        };

        /** Resolve the visible source: an explicit pin wins, else the model's source. */
        const resolveSelection = () => {
          if (snapshot.pinned !== null && snapshot.sources.some((source) => source.id === snapshot.pinned)) {
            return snapshot.pinned;
          }
          const auto = autoSourceId();
          if (auto !== undefined) return auto;
          const preferred = ['deepseek', 'account'].find((id) =>
            snapshot.sources.some((source) => source.id === id),
          );
          return preferred !== undefined ? preferred : snapshot.sources.length > 0 ? snapshot.sources[0].id : null;
        };

        /**
         * Recompute the visible source after the pin, provider or list changed.
         * @param force - re-read the new source instead of reusing a warm value.
         */
        const reselect = (force) => {
          const next = resolveSelection();
          if (next !== snapshot.selectedId) publish({ selectedId: next });
          if (next !== null) ensure(next, force === true);
        };

        /** Pin one source explicitly. */
        const select = (id) => {
          publish({ pinned: id });
          saveStored(id);
          /* Force: a switch must never show the previous wallet's number. */
          reselect(true);
        };

        /** Drop the pin and follow the session's model provider again. */
        const followModel = () => {
          publish({ pinned: null });
          saveStored(null);
          reselect(true);
        };

        /** Record the session's provider; a change re-resolves the visible source. */
        const setProvider = (provider) => {
          if (provider === snapshot.provider) return;
          publish({ provider });
          reselect(false);
        };

        /** Build the current source list: the account first when signed in, then keys. */
        const collectSources = async () => {
          let keys;
          try {
            keys = await readKeySources();
          } catch (error) {
            console.error('[api-balance] source list failed', error);
            return undefined;
          }
          let signedIn = false;
          try {
            signedIn = await readAccountSource();
          } catch {
            signedIn = false;
          }
          return signedIn
            ? [{ id: 'account', label: t('accountLabel'), kind: 'account', supported: true }, ...keys]
            : keys;
        };

        /** Whether two source lists address the same rows. */
        const sameSources = (before, after) =>
          before.length === after.length &&
          before.every(
            (source, index) =>
              source.id === after[index].id &&
              source.label === after[index].label &&
              source.supported === after[index].supported &&
              source.keyHint === after[index].keyHint,
          );

        /**
         * Re-read the source list and refresh whatever is visible.
         *
         * Runs when the panel opens, when the page becomes visible, and on the
         * refresh timer, so signing in or adding a key shows up without a reload.
         */
        const reconcile = async () => {
          if (snapshot.ready === false) return;
          const next = await collectSources();
          if (next === undefined) return;
          if (!sameSources(snapshot.sources, next)) publish({ sources: next });
          reselect(false);
        };

        /** Load the source list once, then read the visible source. */
        const init = async () => {
          if (started) return;
          started = true;
          const sources = (await collectSources()) || [];
          publish({ ready: true, sources });
          publish({ selectedId: resolveSelection() });
          if (snapshot.selectedId !== null) ensure(snapshot.selectedId, false);
        };

        /**
         * Visible text for one source value.
         * @param value - normalized source value, absent while unknown.
         * @returns visible text.
         */
        const valueText = (value) => {
          if (value === undefined || value.phase === 'loading') return t('loading');
          if (value.phase === 'ready') {
            const wallet = (value.wallets || [])[0];
            return wallet === undefined ? '\u2014' : formatBalance(wallet.total, wallet.currency);
          }
          if (value.phase === 'unsupported') return t('unsupported');
          if (value.phase === 'unauthorized') return t('unauthorized');
          if (value.phase === 'no-key') return t('noKey');
          if (value.phase === 'signed-out') return t('noAccount');
          return t('failed');
        };

        /**
         * Tooltip lines for the visible source.
         * @param source - visible source, absent when nothing is configured.
         * @param value - its normalized value.
         * @returns multi-line tooltip text.
         */
        const tooltipFor = (source, value) => {
          if (source === undefined) return t('emptyHint');
          const lines = [source.label];
          if (source.keyHint !== undefined) lines.push(source.keyHint);
          if (value !== undefined && value.phase === 'ready') {
            for (const wallet of value.wallets || []) {
              lines.push(
                t('total') + ' ' + formatBalance(wallet.total, wallet.currency) +
                  '  ' + t('toppedUp') + ' ' + formatBalance(wallet.toppedUp, wallet.currency) +
                  '  ' + t('granted') + ' ' + formatBalance(wallet.granted, wallet.currency),
              );
            }
            if (value.isAvailable === false) lines.push(t('insufficient'));
            lines.push('', t('refreshHint'));
          } else if (value !== undefined && value.phase === 'unsupported') {
            lines.push(value.note || t('unsupported'));
          } else if (source.supported === false) {
            lines.push(source.note || t('unsupported'));
          } else if (value !== undefined && value.phase === 'unauthorized') {
            lines.push(t('unauthorizedHint'));
          } else {
            lines.push(t('failedHint'));
          }
          return lines.join('\n');
        };

        /** Shared state the chip renders; one store per plugin instance. */
        const store = {
          init,
          ensure,
          ensureAll,
          refreshAll,
          reconcile,
          select,
          followModel,
          setProvider,
          subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
          getSnapshot() {
            return snapshot;
          },
        };

        function BalanceChip(props) {
          const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot);
          const [open, setOpen] = React.useState(false);
          const wrapRef = React.useRef(null);
          const sessionId = props === undefined ? undefined : props.sessionId;

          React.useEffect(() => {
            store.init();
          }, []);
          React.useEffect(() => {
            if (sessionId === undefined || sessionId === null) return undefined;
            store.setProvider(readProvider(sessionId));
            return watchProvider(sessionId, (provider) => store.setProvider(provider));
          }, [sessionId]);
          React.useEffect(() => {
            if (!open) return undefined;
            /* Re-read the list on open: a key added or an account signed in
               since the last read must appear here. */
            store.reconcile();
            store.ensureAll();
            const onPointer = (event) => {
              if (wrapRef.current !== null && !wrapRef.current.contains(event.target)) setOpen(false);
            };
            const onKey = (event) => {
              if (event.key === 'Escape') setOpen(false);
            };
            document.addEventListener('pointerdown', onPointer, true);
            document.addEventListener('keydown', onKey);
            return () => {
              document.removeEventListener('pointerdown', onPointer, true);
              document.removeEventListener('keydown', onKey);
            };
          }, [open]);
          React.useEffect(() => {
            const tick = () => {
              if (document.visibilityState === 'visible') store.reconcile();
            };
            const timer = setInterval(tick, REFRESH_MS);
            document.addEventListener('visibilitychange', tick);
            return () => {
              clearInterval(timer);
              document.removeEventListener('visibilitychange', tick);
            };
          }, []);

          const selected = state.sources.find((source) => source.id === state.selectedId);
          const rawValue = state.selectedId === null ? undefined : state.values[state.selectedId];
          /* Only render a value under the source that produced it. */
          const value =
            rawValue !== undefined && rawValue.sourceId !== undefined && rawValue.sourceId !== state.selectedId
              ? undefined
              : rawValue;
          const label = selected === undefined ? t('label') : selected.label;
          const text = state.ready === false ? t('loading') : selected === undefined ? t('noSource') : valueText(value);
          const phase = value === undefined ? 'loading' : value.phase;

          const autoId = (() => {
            const mapped = sourceForProvider(state.provider);
            return mapped !== undefined && state.sources.some((source) => source.id === mapped) ? mapped : undefined;
          })();
          const following = state.pinned === null;
          const followRow = h(
            'button',
            {
              type: 'button',
              className: 'dshBalanceRow',
              'data-selected': String(following),
              title: state.provider === undefined ? t('followUnknown') : String(state.provider),
              onClick: () => {
                store.followModel();
                setOpen(false);
              },
            },
            h(
              'span',
              { className: 'dshBalanceRow-main' },
              h('span', { className: 'dshBalanceRow-label' }, t('followModel')),
              h('span', { className: 'dshBalanceRow-hint' }, state.provider === undefined ? t('followUnknown') : String(state.provider)),
            ),
            h('span', { className: 'dshBalanceRow-value' }, autoId === undefined ? '\u2014' : valueText(state.values[autoId])),
            following ? h(Check, null) : null,
          );

          const rows = state.sources.map((source) => {
            const rowValue = state.values[source.id];
            const interactive = source.supported !== false;
            /* Unsupported vendors show why in the row itself, not only in the
               native tooltip, so "no amount" is explained at a glance. */
            const hint = interactive ? source.keyHint : source.note;
            return h(
              'button',
              {
                key: source.id,
                type: 'button',
                className: 'dshBalanceRow',
                'data-selected': String(source.id === state.selectedId),
                'data-static': String(!interactive),
                disabled: !interactive,
                title: source.note || source.label,
                onClick: interactive
                  ? () => {
                      store.select(source.id);
                      setOpen(false);
                    }
                  : undefined,
              },
              h(
                'span',
                { className: 'dshBalanceRow-main' },
                h('span', { className: 'dshBalanceRow-label' }, source.label),
                hint !== undefined ? h('span', { className: 'dshBalanceRow-hint' }, hint) : null,
              ),
              h('span', { className: 'dshBalanceRow-value' }, valueText(rowValue)),
              source.id === state.selectedId && interactive ? h(Check, null) : null,
            );
          });

          return h(
            'span',
            { className: 'dshBalanceWrap', ref: wrapRef },
            h(
              'button',
              {
                type: 'button',
                className: 'dshApiBalance',
                'data-phase': phase,
                'aria-haspopup': 'dialog',
                'aria-expanded': open,
                'aria-label': label + ' ' + text,
                title: state.sources.length === 0 ? t('emptyHint') : tooltipFor(selected, value),
                onClick: () => setOpen(!open),
              },
              h(Glyph, null),
              h('span', { className: 'dshApiBalance-label' }, label),
              h('span', { className: 'dshApiBalance-value' }, text),
            ),
            open
              ? h(
                  'div',
                  { className: 'dshBalancePanel', role: 'dialog', 'aria-label': t('sourcesTitle') },
                  h('div', { className: 'dshBalancePanel-title' }, t('sourcesTitle')),
                  followRow,
                  state.sources.length === 0 ? h('p', { className: 'dshBalanceEmpty' }, t('emptyHint')) : rows,
                  h(
                    'div',
                    { className: 'dshBalanceFooter' },
                    h('span', { className: 'dshBalanceFooter-hint' }, t('refreshHint')),
                    h(
                      'button',
                      { type: 'button', className: 'dshBalanceRefresh', onClick: () => store.refreshAll() },
                      t('refreshAll'),
                    ),
                  ),
                )
              : null,
          );
        }

        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.composer.dock',
              id: 'api-balance',
              order: 5,
              /* The dock is session-scoped; this hands the component its session
                 so it can follow that session's model provider. */
              inject: (sessionId) => ({ sessionId }),
            },
            BalanceChip,
          ),
        );
      },
    };
  },
});
