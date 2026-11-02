# API Wallet (`dsh-plugin-api-wallet`)

在 DeepSeek Harness 的输入框下方状态行里显示余额：**默认跟随当前会话所用的模型服务商**，也可以点开面板固定看某一个（账号钱包 / 任意一把已导入的 API Key）。

## 显示什么

状态行里是一段带钱包图标的文字，例如 `Moonshot (Kimi) ¥675.13`，前面是来源名，后面是余额。

点击它会向上弹出「余额来源」面板：

```
余额来源
跟随当前模型  moonshotai-cn   ✓
DeepSeek 账号     ¥19.91
DeepSeek          ¥908.46
  …7ade
Moonshot (Kimi)   ¥675.13
  …vBmI
OpenAI            无余额接口
────────────────────────    点击切换余额来源   刷新
```

- **跟随当前模型**（默认）：会话切到 Kimi，徽标就显示 Moonshot 的余额；切回 DeepSeek 就显示 DeepSeek 的余额。
- 点某一行就是**固定**那个来源，固定期间不随模型变化；再点「跟随当前模型」恢复跟随。
- 固定项存在浏览器 `localStorage` 里，刷新/重开页面都记得。
- 悬停徽标可看明细：总余额 / 充值余额 / 赠送余额，以及 Key 尾号。
- 「刷新」绕过 Host 的 60 秒缓存重新取数。

## 支持的来源

| 来源 | 凭据名 | 读取方式 |
| --- | --- | --- |
| DeepSeek 账号 | —（登录态） | 账号 Remote `account.getBalance` |
| DeepSeek | `DEEPSEEK_API_KEY` | `api.deepseek.com/user/balance` |
| Moonshot (Kimi) | `MOONSHOTAI_CN_API_KEY` / `MOONSHOTAI_API_KEY` / `MOONSHOT_API_KEY` | `api.moonshot.cn/v1/users/me/balance` |
| OpenRouter | `OPENROUTER_API_KEY` | `api/v1/credits`（总额 − 已用，美元） |
| SiliconFlow | `SILICONFLOW_API_KEY` | `api.siliconflow.cn/v1/user/info` |
| 智谱 GLM（国内编码套餐） | `ZAI_CODING_CN_API_KEY` | 无 API Key 余额接口（见下） |
| Z.ai (GLM) | `ZAI_API_KEY` | 无 API Key 余额接口（见下） |
| OpenAI / Anthropic / 智谱 GLM | `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `ZHIPU_API_KEY` | 无公开余额接口 → 列表标注「无余额接口」 |

### 为什么 z.ai / 智谱没有金额

2026-11 用本机 `ZAI_CODING_CN_API_KEY` 实测（`open.bigmodel.cn`）：

| 请求 | 结果 |
| --- | --- |
| `GET /api/paas/v4/models` | **200**（说明 key 有效） |
| `GET /api/paas/v4/balance`、`/user/balance`、`/users/me/balance`、`/wallet`、`/quota` … | 全部 **404** |
| `GET /api/biz/customer/account/balance/v2` | 不带认证 → `1001 未收到 Authorization`；带 API Key → **403「请求地址不允许访问」** |

结论：智谱/Z.ai 的余额接口存在，但**只认网页登录态**（控制台 Cookie），不对 API Key 开放。所以插件无法用你的 key 取到金额，只能明确显示「无余额接口」并指路控制台——这比之前悄悄回退去显示 DeepSeek 的余额更不容易误导。

**配了哪把就出现哪一项**，没有的不占位。想加别家：在 Loader 行的 `config.providers` 里追加一项，`adapter` 选 `deepseek` / `openrouter` / `moonshot` / `siliconflow`，或用 `endpoint` 覆盖地址。

```yaml
- id: dsh-api-balance
  config:
    providers:
      - id: my-proxy
        label: 我的中转
        keyEnvs: [MY_PROXY_KEY]
        adapter: deepseek
        endpoint: https://proxy.example.com/user/balance
```

## 状态

| 状态 | 显示 |
| --- | --- |
| 读取中 | `DeepSeek …` |
| 正常 | `DeepSeek ¥908.46` |
| 被拒绝 | `DeepSeek Key 无效`（401/403） |
| 无接口 | `OpenAI 无余额接口` |
| 读取失败 | `DeepSeek 读取失败` |
| 一个来源都没有 | `余额 未配置`，悬停给出配置指引 |

## 实现

**Host 半边** [index.js](index.js)

- 两个同源精确路由：
  - `GET /plugins-api/api-balance/sources` → 已配置的来源（含 Key 尾号、是否支持）
  - `GET /plugins-api/api-balance?source=<id>[&refresh=1]` → 该来源的钱包
- 凭据用 `ctx.get('credentials').resolve(name)` 读取（Cordis 的可选服务必须这样取），读不到再退回启动环境变量。一个服务商可用 `keyEnvs` 列出多个候选凭据名。
- Key 只留在 Host 进程：不进响应、不进日志。非 GET/HEAD 返回 405，跨站请求返回 403。
- 成功结果按来源缓存 60 秒，并发请求合并成一次。

**Client 半边** [client.js](client.js)

- 账号来源走 `ctx.get('remote.account')`；Key 来源走上面的路由。
- 用槽位的 `inject: (sessionId) => ({ sessionId })` 拿到会话，再读 `modelSelection` 投影得到当前服务商，映射到对应来源（`moonshotai-*` → moonshot，`deepseek-*` → deepseek/account，…）。
- 面板打开、页面回到前台、每 5 分钟都会重读来源列表，所以新加的 Key 或新登录的账号会自己出现。
- 切换来源时强制重新取值，并给每个结果打上来源标记，绝不让上一个来源的数字留在新来源名下。

## 安装

在 DeepSeek Harness 的侧边栏 **Plugins → 添加插件** 里填本仓库地址：

```
https://github.com/kaishaoshao/dsh-plugin-api-wallet
```

或者克隆下来后填本地目录的绝对路径。命令行也可以：

```powershell
dsh plugin --profile desktop add https://github.com/kaishaoshao/dsh-plugin-api-wallet.git
```

**改了 `index.js` 需要重启应用**；只改 `client.js` 刷新页面即可。

## 验证

```powershell
node test/check-api-balance.mjs
```

离线断言：跟随模型 / 固定来源 / 固定期间忽略模型变化 / 恢复跟随 / 持久化、账号行随登录出现、各家 Key 识别（含 `MOONSHOTAI_CN_API_KEY`、`ZAI_CODING_CN_API_KEY`）、Host 两个路由的凭据解析与守卫、Key 不外泄、60 秒缓存与 `refresh=1`、401 与未知来源。
真实接口：`api.deepseek.com` 与 `api.moonshot.cn` 都用本机凭据实测返回过余额；`open.bigmodel.cn` 实测确认**不对 API Key 提供余额接口**。

## 卸载

**Plugins → 已安装** 里移除 `dsh-plugin-api-wallet`。

## License

MIT
