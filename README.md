# pi-free-vision — 免费优先的视觉模型池扩展（pi）

让纯文本模型也能"看"图片：上传图片时自动交给多模态模型识别，识别结果以文字注入对话。

## 特点

- **全自动**：消息进入 LLM 之前拦截（pi 的 `input` 事件），文本模型 + 图片时自动走视觉池，无需手动干预
- **混合刷新策略**：懒刷新 TTL + 启动后台刷新 + 手动刷新 + 全部失败自动强制刷新重试，兼顾新鲜度与启动速度
- **免费优先**：默认只保留 OpenRouter 免费多模态模型，按上下文能力排序；付费模型可选择性纳入
- **自定义模型支持**：自动纳入你在 pi 中配置的多模态模型（如 mimo-v2.5），走 pi 自身调用层，鉴权零配置
- **下架感知**：下架模型标记保留不删除，恢复上架自动解除；被配置排除的模型直接移除不误报
- **优先级持久化**：手动设置的优先级在每次刷新后保留
- **零依赖**：纯 TypeScript 单文件，无 npm 包

## 工作原理

```
用户上传图片 ──► input 事件拦截
                   │
                   ├─ 当前模型支持图片？──是──► 原样透传（多模态模型直接看）
                   │
                   └─ 否（文本模型）──► 调用视觉池中优先级最高的多模态模型
                                          （OpenRouter API，自动复用已配置的 key）
                                        │
                                        ▼
                        识别文字替换原图，文本模型正常处理
```

拦截发生在消息进入 LLM **之前**（pi 扩展的 `input` 事件），完全自动，不需要模型或用户配合。

## 安装

把 `vision-pool.ts` 放到 `~/.pi/agent/extensions/`（全局）或 `.pi/extensions/`（项目），重启 pi 或 `/reload` 即可。

依赖：OpenRouter API key（`/login openrouter` 或环境变量 `OPENROUTER_API_KEY`）。拉取模型列表本身是公开接口，不需要 key。

## 命令

| 命令 | 说明 |
|------|------|
| `/mm-pool [free\|paid\|all\|offline]` | 查看视觉池（按优先级排序，TUI 下打开编辑器展示完整列表） |
| `/mm-refresh` | 强制从 OpenRouter 刷新视觉池（免费模型不定期上架/下架） |
| `/mm-priority [数字] [关键字]` | 设置模型优先级（数字越小越优先；无参数时交互选择） |
| `/mm-status` | 当前模型是否支持图片、视觉池状态、API key 状态 |
| `/mm-config` | 查看扩展配置 |

示例：

```
/mm-priority 3 gemini        # 把 id/名称含 gemini 的模型设为优先级 3
/mm-priority 5 qwen          # 若匹配多个会弹出选择
/mm-pool free                # 只看免费模型
```

## 工具（LLM 可调用）

- `describe_image` — 显式描述图片（本地路径 / data URL / 裸 base64）
- `mm_pool_info` — 查询视觉池信息

## 刷新策略（为什么混合式）

OpenRouter 免费模型会不定期上架/下架，池必须刷新。三种方案对比：

| 方案 | 优点 | 缺点 |
|------|------|------|
| 每次启动刷新 | 池永远新 | 启动变慢、依赖网络、离线不可用 |
| 用时才刷新 | 启动快、离线可用 | 首次用图慢；过期池里的模型可能已下架导致首次调用失败 |
| **混合式（本扩展）** | 兼顾两者 | — |

本扩展采用：
1. **懒刷新 + TTL**：池过期（默认 24h）后，第一次真正需要视觉能力时先刷新再用；
2. **启动后台刷新**：pi 启动时若池过期，后台异步刷新（不阻塞启动，失败不影响）；
3. **手动刷新**：`/mm-refresh`；
4. **失败触发**：池中所有候选模型都失败（典型：免费模型被下架）时，自动强制刷新一次并重试。

## 优先级规则

- 数字越小越优先（1 = 最高）；
- 默认：免费模型排 1..N（按上下文长度降序，即能力更强的免费模型优先），付费模型排 10000+；
- 手动设置过的优先级（`/mm-priority`）在每次刷新时**保留**；
- 下架的模型不删除，标记 `⚠下架` 并跳过调用；恢复上架后自动解除标记。

## 配置

配置文件 `~/.pi/agent/vision-pool.json`（`models` 字段为池数据，`config` 字段为配置，改后 `/reload` 生效）：

| 配置项 | 默认 | 说明 |
|--------|------|------|
| `ttlHours` | 24 | 池过期时间（小时） |
| `refreshOnStartup` | true | 启动时后台异步刷新 |
| `refreshOnAllFailed` | true | 全部候选失败时强制刷新重试 |
| `freeFirst` | true | 免费模型默认排前面 |
| `includePaid` | false | 池中是否包含付费模型（默认只保留免费模型） |
| `includeRegistryModels` | true | 自动把 pi 中已配置鉴权的多模态模型（如自定义的 mimo-v2.5）纳入池 |
| `maxModels` | 200 | 池容量上限 |
| `describeMaxTokens` | 2048 | 识别输出最大 token |
| `forceDescribe` | false | 即使当前模型支持图片也强制走视觉池 |
| `openrouterBaseUrl` | `https://openrouter.ai/api/v1` | OpenRouter API 地址 |
| `describePrompt` | （中文描述提示词） | 发给视觉模型的识别提示词 |

## 与 openrouter-free.ts 的关系

`openrouter-free.ts`（已有扩展）在启动时把 OpenRouter provider 注册为**仅免费模型**，并把模型的 `input` 字段按真实能力标记——本扩展正是读取该字段判断"当前模型是否支持图片"，两者互补、无冲突。视觉池默认也只保留**免费**多模态模型（`includePaid: false`），被配置排除的付费模型会直接从池中移除（不会误标为下架）；若想纳入付费模型，改 `includePaid: true` 后 `/mm-refresh` 即可。

## 自定义模型（如 mimo-v2.5）如何进池

视觉池除了 OpenRouter 免费模型，还会自动纳入**你在 pi 中配置的多模态模型**（`includeRegistryModels: true`）：只要模型在 `models.json` 里配置（或通过 `/login` 登录）且 `input` 含 `image`、有可用鉴权，就会自动出现在池中（标记为 `自定义`，默认优先级 100+，排在免费模型之后），例如 `xiaomi-clean/mimo-v2.5`、`sensenova/sensenova-6.8-flash-lite`。调用时直接走 pi 自身的模型调用层，鉴权/协议自动处理。用 `/mm-priority` 可把自定义模型调到更前（如 `/mm-priority 1 xiaomi-clean/mimo-v2.5`）。

## 📄 License

MIT
