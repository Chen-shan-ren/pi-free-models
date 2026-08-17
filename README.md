# pi-free-models — 免费优先的 OpenRouter 模型扩展（pi）

一个扩展，两个功能，共享同一份模型数据：

1. **Provider 注册**：`/model` 选择器中 openrouter 提供商**只显示免费模型**（不再有几百个付费模型干扰选择）
2. **视觉模型池**：纯文本模型也能"看"图片——上传图片时自动交给视觉池中优先级最高的多模态模型识别

> 本项目由原 `openrouter-free`（免费 provider）与 `vision-pool`（视觉池）合并而来，
> 两者共享一次网络拉取，启动更快、维护更简单。

## ✨ 功能

### 免费 Provider（/model 只显示免费模型）

- 启动时从 OpenRouter 拉取模型目录，把 openrouter provider 替换为**仅免费模型**（定价 0/0）
- 免费列表变化频繁（每周甚至更勤），缓存 6 小时后自动重新拉取；拉取失败自动回退缓存
- `models.json` 中自定义的 openrouter 模型按 id 合并保留
- `/openrouter-free` 手动刷新，`/openrouter-free list` 查看列表

### 视觉模型池（文本模型自动看图）

```
用户上传图片 ──► input 事件拦截
                   │
                   ├─ 当前模型支持图片？──是──► 原样透传
                   │
                   └─ 否（文本模型）──► 调用视觉池中优先级最高的多模态模型
                                        （OpenRouter API，自动复用已配置的 key）
                                        │
                                        ▼
                        识别文字替换原图，文本模型正常处理
```

- 池 = OpenRouter **免费多模态模型**（免费优先）+ 你在 pi 中配置的多模态模型（如 `xiaomi-clean/mimo-v2.5`，走 pi 自身调用层，鉴权零配置）
- 混合刷新策略：懒刷新 TTL + 启动后台刷新 + 手动刷新 + **全部失败自动强制刷新重试**（应对免费模型不定期下架）
- 下架模型标记保留不删除，恢复上架自动解除；手动优先级刷新后保留
- LLM 可调工具：`describe_image`、`mm_pool_info`

## 📦 安装

```bash
# 1. 把整个 pi-free-models 目录复制到 pi 的全局扩展目录
cp -r pi-free-models ~/.pi/agent/extensions/

# 2. 重启 pi（或 /reload）
```

依赖：OpenRouter API key（`/login openrouter` 或环境变量 `OPENROUTER_API_KEY`）。拉取模型列表本身是公开接口，不需要 key。

## 🖱️ 命令

| 命令 | 说明 |
|------|------|
| `/openrouter-free [list]` | 刷新免费模型并重新注册 provider / 查看列表 |
| `/mm-pool [free\|paid\|all\|offline]` | 查看视觉池（按优先级排序） |
| `/mm-refresh` | 强制刷新视觉池 |
| `/mm-priority [数字] [关键字]` | 设置模型优先级（数字越小越优先） |
| `/mm-status` | 当前模型、视觉池、API key 状态 |
| `/mm-config` | 查看视觉池配置 |

示例：

```
/mm-priority 1 xiaomi-clean/mimo-v2.5   # 把自定义模型调到最高优先级
/mm-priority 3 gemini                   # 按关键字设置
/mm-pool free                           # 只看免费模型
/mm-discover                            # AI 自动发现（需先开启 autoDiscover）
```

## 🤖 AI 自动发现（autoDiscover）

默认关闭。开启后，视觉池会读取你 `models.json` 中配置的模型服务商（有 baseUrl + API key 的），
逐个调用它们的 `/models` 接口，用你的模型（`discoverModel` 指定或当前激活模型）分析出多模态模型，
然后**带图片实测验证**（过滤掉图像生成/编辑等假多模态），通过后才加入池。

```json
{ "config": { "autoDiscover": true } }
```

- 首次运行自动做一次全量发现；之后 `/mm-refresh` 时增量发现新模型
- 也可手动 `/mm-discover`（增量）或 `/mm-discover full`（全量）
- 生成的模型走服务商自己的 OpenAI 兼容端点调用（`discovered` 来源）
- 注意：分析会消耗你的模型少量 token（每次发现 1 次调用 + 每模型 1 次验证）

## 🎯 特点

- **一次拉取，两个功能**：共享数据层（内存 + 文件缓存 + 防并发），整个扩展启动只拉取一次网络
- **免费优先**：/model 干净清爽；视觉池默认只保留免费多模态模型（`includePaid` 可放开）
- **全自动看图**：消息进入 LLM 之前拦截，文本模型 + 图片时自动走视觉池
- **容错**：网络失败回退缓存；免费模型下架自动感知；全部失败自动刷新重试
- **静默运行**：不在终端输出任何日志（TUI 下 console 输出会污染屏幕）
- **零依赖**：纯 TypeScript，无 npm 包

## ⚙️ 配置

视觉池配置 `~/.pi/agent/vision-pool.json`（`config` 字段，改后 `/reload` 生效）：

| 配置项 | 默认 | 说明 |
|--------|------|------|
| `ttlHours` | 24 | 池过期时间（小时） |
| `refreshOnStartup` | true | 启动时后台异步刷新 |
| `refreshOnAllFailed` | true | 全部候选失败时强制刷新重试 |
| `freeFirst` | true | 免费模型默认排前面 |
| `includePaid` | false | 池中是否包含付费模型 |
| `includeRegistryModels` | true | 自动纳入 pi 中已配置鉴权的多模态模型 |
| `maxModels` | 200 | 池容量上限 |
| `describeMaxTokens` | 2048 | 识别输出最大 token |
| `forceDescribe` | false | 即使当前模型支持图片也强制走视觉池 |
| `autoDiscover` | false | **AI 自动发现**：读取用户 models.json 配置的服务商，调其 /models 接口，用你的模型分析多模态模型并带图片实测验证后加入池（首次运行全量，之后刷新时增量） |
| `discoverModel` | 空 | 用于分析的模型（`provider/model`，空=用当前激活模型） |
| `discoverFreeOnly` | false | 严格模式：只收录 LLM 判定为免费的新模型（LLM 判断不可靠，默认收全部，免费标记只影响优先级） |
| `openrouterBaseUrl` | `https://openrouter.ai/api/v1` | OpenRouter API 地址 |
| `describePrompt` | （中文描述提示词） | 发给视觉模型的识别提示词 |

## 🗂️ 项目结构

```
pi-free-models/          # 复制整个目录到 ~/.pi/agent/extensions/
├── index.ts             # 入口（协调两个模块）
├── or-free.ts           # 共享数据层 + 免费 provider 注册
└── vision-pool.ts       # 视觉模型池
```

## 📄 License

MIT
