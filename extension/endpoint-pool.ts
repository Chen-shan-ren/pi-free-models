/**
 * endpoint-pool.ts — 端点池（嵌入 / TTS / ASR）· pi-wanchuan 万川扩展模块
 *
 * OpenRouter 目前没有嵌入/TTS/ASR 模型，因此这三个池从【用户配置的服务商】
 * （models.json 中有 baseUrl + API key 的）发现模型：拉 /models 列表 → 关键词
 * 启发式候选 → 对候选逐个【实测端点验证】→ 通过者入池。
 *
 * 验证即真相：发对应端点最小请求，200 即入池（LLM 不参与，零幻觉）。
 *
 * 命令（kind = embed | tts | asr）：
 *   /<kind>-pool             查看池
 *   /<kind>-discover         从用户服务商发现模型（端点验证）
 *   /<kind>-priority [n] [k] 设置优先级
 *   /embed <文本>            文本 → 向量（显示维度/前几维）
 *   /tts <文本>              文本 → 语音文件（保存到本地）
 *   /asr <音频路径>          音频 → 文本
 *
 * 工具：embed_text / text_to_speech / transcribe_audio
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { join } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// 池种类定义
// ---------------------------------------------------------------------------

type PoolKind = "embed" | "tts" | "asr";

interface KindSpec {
  label: string;
  /** 候选模型 id 关键词（启发式） */
  keywords: RegExp;
  /** 端点路径 */
  endpoint: string;
  /** 验证请求构造：返回 { body, contentType? }，contentType 缺省为 json */
  verifyBody: (modelId: string) => { body: unknown; formData?: boolean };
  /** 验证是否通过（状态码 200 且满足条件） */
  verifyOk: (status: number, bodyText: string) => boolean;
}

const KIND_SPECS: Record<PoolKind, KindSpec> = {
  embed: {
    label: "嵌入",
    keywords: /embed|bge|m3e|retriev|e5-|gte-/i,
    endpoint: "embeddings",
    verifyBody: (modelId) => ({ body: { model: modelId, input: "hi" } }),
    verifyOk: (status, body) => status === 200 && body.includes('"embedding"'),
  },
  tts: {
    label: "TTS",
    keywords: /tts|speech|voice|audio|kokoro|cartesia|eleven/i,
    endpoint: "audio/speech",
    verifyBody: (modelId) => ({
      body: { model: modelId, input: "hi", voice: "alloy" },
    }),
    // TTS 返回音频字节（200 + 非 JSON），有些模型返回 JSON 错误时剔除
    verifyOk: (status, body) => status === 200 && !body.startsWith("{"),
  },
  asr: {
    label: "ASR",
    keywords: /whisper|transcrib|asr|audio|parakeet|seamless|mms/i,
    endpoint: "audio/transcriptions",
    verifyBody: (modelId) => ({
      body: { model: modelId },
      formData: true,
    }),
    verifyOk: (status, _body) => status === 200,
  },
};

// ---------------------------------------------------------------------------
// 池状态
// ---------------------------------------------------------------------------

interface EPPoolModel {
  id: string;
  provider: string;
  baseUrl: string;
  apiKeyRef?: string;
  priority: number;
  userSet?: boolean;
}

interface EPPoolState {
  updatedAt: number;
  models: EPPoolModel[];
}

function poolFile(kind: PoolKind): string {
  return join(getAgentDir(), `${kind}-pool.json`);
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function loadPool(kind: PoolKind): Promise<EPPoolState> {
  try {
    const raw = await readFile(poolFile(kind), "utf8");
    const parsed = JSON.parse(raw) as Partial<EPPoolState>;
    if (parsed && Array.isArray(parsed.models)) {
      return {
        updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
        models: parsed.models.filter((m) => m && typeof m.id === "string"),
      };
    }
  } catch {
    // 首次运行
  }
  return { updatedAt: 0, models: [] };
}

async function savePool(kind: PoolKind, pool: EPPoolState): Promise<void> {
  await mkdir(join(getAgentDir()), { recursive: true });
  await writeFile(poolFile(kind), JSON.stringify(pool, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// 环境变量与用户服务商
// ---------------------------------------------------------------------------

function getEnvValue(name: string): string | undefined {
  const v = process.env[name];
  if (v) return v;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    const out = execSync(`reg query \\"HKCU\\\\\\\\Environment\\" /v ${name}`, {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
    });
    const m = out.match(/REG_SZ\s+(\S.*)/);
    return m ? m[1].trim() : undefined;
  } catch {
    return undefined;
  }
}

function resolveApiKey(config: unknown): string | undefined {
  if (typeof config !== "string" || !config) return undefined;
  const m = config.match(/^\$(.+)$/);
  return m ? getEnvValue(m[1]) : config;
}

interface UserProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  apiKeyRef?: string;
}

function readUserProviders(): UserProvider[] {
  const out: UserProvider[] = [];
  try {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const raw = readFileSync(join(getAgentDir(), "models.json"), "utf8");
    const cfg = JSON.parse(raw) as {
      providers?: Record<string, { name?: string; baseUrl?: string; apiKey?: string }>;
    };
    for (const [id, def] of Object.entries(cfg.providers ?? {})) {
      if (id === "openrouter") continue;
      if (!def?.baseUrl) continue;
      const apiKey = resolveApiKey(def.apiKey);
      if (!apiKey) continue;
      out.push({
        id,
        name: def.name ?? id,
        baseUrl: def.baseUrl.endsWith("/") ? def.baseUrl.slice(0, -1) : def.baseUrl,
        apiKey,
        apiKeyRef: typeof def.apiKey === "string" && def.apiKey.startsWith("$") ? def.apiKey : undefined,
      });
    }
  } catch {
    // 无 models.json
  }
  return out;
}

// ---------------------------------------------------------------------------
// 发现：关键词候选 + 端点实测验证
// ---------------------------------------------------------------------------

/** 发送端点请求（验证或真实调用共用）。 */
async function sendEndpointRequest(
  baseUrl: string,
  apiKey: string,
  kind: PoolKind,
  modelId: string,
  payload: unknown,
  signal: AbortSignal,
  formData?: boolean,
): Promise<{ status: number; text: string; buffer?: Buffer }> {
  const spec = KIND_SPECS[kind];
  let res: Response;
  if (formData) {
    const fd = new FormData();
    fd.append("model", modelId);
    // 用一个 1 秒静音 wav 作为验证音频
    const wav = Buffer.from(
      "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=",
      "base64",
    );
    fd.append(
      "file",
      new Blob([wav], { type: "audio/wav" }),
      "silence.wav",
    );
    res = await fetch(`${baseUrl}/${spec.endpoint}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: fd,
      signal,
    });
  } else {
    res = await fetch(`${baseUrl}/${spec.endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
      signal,
    });
  }
  const text = await res.text().catch(() => "");
  const buffer = res.ok ? Buffer.from(await res.arrayBuffer().catch(() => Buffer.from(""))) : undefined;
  return { status: res.status, text, buffer };
}

/** 从用户服务商发现某类池的模型（关键词候选 + 端点验证）。返回新增数量。 */
async function discoverKind(ctx: ExtensionContext, kind: PoolKind): Promise<number> {
  const spec = KIND_SPECS[kind];
  const pool = await loadPool(kind);
  const providers = readUserProviders();
  let added = 0;
  for (const p of providers) {
    let modelList: string[] = [];
    try {
      const res = await fetch(`${p.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${p.apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) continue;
      const j = (await res.json()) as { data?: { id?: string }[] };
      modelList = Array.isArray(j?.data) ? j.data.map((m) => m.id).filter((x): x is string => !!x) : [];
    } catch {
      continue;
    }
    // 关键词候选（无候选时取列表前 20 个兜底，靠端点验证分辨）
    const candidates = modelList.filter((id) => spec.keywords.test(id));
    const poolIds = new Set(pool.models.map((m) => m.id));
    for (const id of candidates) {
      if (poolIds.has(id)) continue;
      try {
        const { body, formData } = spec.verifyBody(id);
        const r = await sendEndpointRequest(p.baseUrl, p.apiKey, kind, id, body, AbortSignal.timeout(20_000), formData);
        if (!spec.verifyOk(r.status, r.text)) continue;
        const maxP = Math.max(0, ...pool.models.map((m) => m.priority));
        pool.models.push({
          id,
          provider: p.id,
          baseUrl: p.baseUrl,
          apiKeyRef: p.apiKeyRef,
          priority: maxP + 1,
        });
        poolIds.add(id);
        added++;
      } catch {
        // 跳过失败候选
      }
    }
  }
  if (added > 0) {
    pool.updatedAt = Date.now();
    await savePool(kind, pool);
  }
  return added;
}

// ---------------------------------------------------------------------------
// 调用
// ---------------------------------------------------------------------------

function findModel(pool: EPPoolState, modelId?: string): EPPoolModel | undefined {
  const online = pool.models.slice().sort((a, b) => a.priority - b.priority);
  if (modelId) return online.find((m) => m.id.includes(modelId)) ?? online[0];
  return online[0];
}

/** 嵌入：文本 → 向量 JSON（截断展示）。 */
async function embedText(ctx: ExtensionContext, text: string, signal?: AbortSignal): Promise<{ model: string; dim: number; vector: number[] }> {
  const pool = await loadPool("embed");
  const m = findModel(pool);
  if (!m) throw new Error("嵌入池为空，请先运行 /embed-discover");
  const key = m.apiKeyRef?.startsWith("$") ? getEnvValue(m.apiKeyRef.slice(1)) : undefined;
  const r = await sendEndpointRequest(m.baseUrl, key ?? "", "embed", m.id, { model: m.id, input: text }, signal ?? AbortSignal.timeout(60_000));
  if (r.status !== 200) throw new Error(`HTTP ${r.status} ${r.text.slice(0, 150)}`);
  const j = JSON.parse(r.text) as { data?: Array<{ embedding?: number[] }> };
  const vec = j.data?.[0]?.embedding;
  if (!vec) throw new Error("响应中没有 embedding");
  return { model: m.id, dim: vec.length, vector: vec.slice(0, 8) };
}

/** TTS：文本 → 音频文件路径。 */
async function synthesizeSpeech(
  ctx: ExtensionContext,
  text: string,
  signal?: AbortSignal,
): Promise<{ path: string; model: string }> {
  const pool = await loadPool("tts");
  const m = findModel(pool);
  if (!m) throw new Error("TTS 池为空，请先运行 /tts-discover");
  const key = m.apiKeyRef?.startsWith("$") ? getEnvValue(m.apiKeyRef.slice(1)) : undefined;
  const r = await sendEndpointRequest(
    m.baseUrl,
    key ?? "",
    "tts",
    m.id,
    { model: m.id, input: text, voice: "alloy", response_format: "mp3" },
    signal ?? AbortSignal.timeout(120_000),
  );
  if (r.status !== 200 || !r.buffer || r.buffer.length === 0) {
    throw new Error(`HTTP ${r.status} ${r.text.slice(0, 150)}`);
  }
  const outDir = join(process.env.USERPROFILE ?? process.env.HOME ?? ".", "Downloads");
  await mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = join(outDir, `wanchuan-tts-${stamp}.mp3`);
  await writeFile(file, r.buffer);
  return { path: file, model: m.id };
}

/** ASR：音频文件 → 文本。 */
async function transcribeAudio(
  ctx: ExtensionContext,
  audioPath: string,
  signal?: AbortSignal,
): Promise<{ text: string; model: string }> {
  const pool = await loadPool("asr");
  const m = findModel(pool);
  if (!m) throw new Error("ASR 池为空，请先运行 /asr-discover");
  const key = m.apiKeyRef?.startsWith("$") ? getEnvValue(m.apiKeyRef.slice(1)) : undefined;
  const buf = await readFile(audioPath);
  const fd = new FormData();
  fd.append("model", m.id);
  fd.append(
    "file",
    new Blob([buf], { type: "audio/wav" }),
    audioPath.split("/").pop() ?? audioPath.split("\\").pop() ?? "audio.wav",
  );
  const res = await fetch(`${m.baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key ?? ""}` },
    body: fd,
    signal: signal ?? AbortSignal.timeout(120_000),
  });
  const text = await res.text().catch(() => "");
  if (res.status !== 200) throw new Error(`HTTP ${res.status} ${text.slice(0, 150)}`);
  const j = JSON.parse(text) as { text?: string };
  return { text: j.text ?? text, model: m.id };
}

// ---------------------------------------------------------------------------
// 命令与工具注册
// ---------------------------------------------------------------------------

function registerKindCommands(pi: ExtensionAPI, kind: PoolKind): void {
  const spec = KIND_SPECS[kind];
  const prefix = kind;

  pi.registerCommand(`${prefix}-pool`, {
    description: `查看${spec.label}池（按优先级排序）。可选参数：all`,
    handler: async (args, ctx) => {
      const pool = await loadPool(kind);
      if (pool.models.length === 0) {
        ctx.ui.notify(`${spec.label}池为空，请先运行 /${prefix}-discover`, "warning");
        return;
      }
      const list = pool.models
        .slice()
        .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
        .filter((m) => args.trim() !== "all" || true);
      const lines = [
        `${spec.label}池：${list.length} 个模型，更新于 ${pool.updatedAt ? new Date(pool.updatedAt).toLocaleString() : "从未"}`,
        `用法：/${prefix}-discover 发现新模型 · /${prefix}-priority 设置优先级`,
        ``,
        ...list.map(
          (m, i) =>
            `${String(i + 1).padStart(3)}. [${String(m.priority).padStart(3)}] ${m.provider}/${m.id}` +
            `${m.userSet ? "  [自定义优先级]" : ""}`,
        ),
      ];
      if (ctx.mode === "tui") {
        await ctx.ui.editor(`${spec.label}池`, lines.join("\n"));
      } else {
        ctx.ui.notify(lines.slice(0, 2).join(" | "), "info");
      }
    },
  });

  pi.registerCommand(`${prefix}-discover`, {
    description: `从用户配置的模型服务商发现${spec.label}模型（关键词候选 + 端点实测验证）`,
    handler: async (_args, ctx) => {
      ctx.ui.notify(`正在从用户服务商发现${spec.label}模型…`, "info");
      try {
        const n = await discoverKind(ctx, kind);
        ctx.ui.notify(
          n > 0
            ? `${spec.label}池：新增 ${n} 个模型（端点验证通过）`
            : `${spec.label}池：没有发现新的可用模型`,
          n > 0 ? "info" : "warning",
        );
      } catch (err) {
        ctx.ui.notify(`发现失败：${errMsg(err)}`, "error");
      }
    },
  });

  pi.registerCommand(`${prefix}-priority`, {
    description: `设置${spec.label}池模型优先级。用法：/${prefix}-priority [数字] [关键字]`,
    handler: async (args, ctx) => {
      const pool = await loadPool(kind);
      if (pool.models.length === 0) {
        ctx.ui.notify(`${spec.label}池为空`, "warning");
        return;
      }
      const trimmed = (args || "").trim();
      let priority: number | undefined;
      let keyword = "";
      const m = trimmed.match(/^(\d{1,5})\s+(.+)$/);
      if (m) {
        priority = parseInt(m[1], 10);
        keyword = m[2].toLowerCase();
      } else if (/^\d{1,5}$/.test(trimmed)) {
        priority = parseInt(trimmed, 10);
      } else {
        keyword = trimmed.toLowerCase();
      }
      const matches = keyword
        ? pool.models.filter((mm) => mm.id.toLowerCase().includes(keyword))
        : pool.models;
      if (matches.length === 0) {
        ctx.ui.notify(`没有找到匹配“${keyword}”的模型`, "warning");
        return;
      }
      let target: EPPoolModel | undefined;
      if (matches.length === 1) {
        target = matches[0];
      } else {
        const picked = await ctx.ui.select(
          `选择模型（${matches.length} 个匹配）：`,
          matches.map((mm) => `[${mm.priority}] ${mm.id}`),
        );
        target = matches.find((mm) => `[${mm.priority}] ${mm.id}` === picked);
      }
      if (!target) return;
      if (priority === undefined) {
        const input = await ctx.ui.input("优先级（数字越小越优先）", String(target.priority));
        if (input === undefined || input.trim() === "") return;
        priority = parseInt(input.trim(), 10);
        if (Number.isNaN(priority)) {
          ctx.ui.notify("优先级必须是数字", "warning");
          return;
        }
      }
      pool.models = pool.models.map((mm) =>
        mm.id === target!.id ? { ...mm, priority, userSet: true } : mm,
      );
      await savePool(kind, pool);
      ctx.ui.notify(`已设置 ${target!.id} 的优先级为 ${priority}`, "info");
    },
  });
}

export function initEndpointPools(pi: ExtensionAPI): void {
  for (const kind of ["embed", "tts", "asr"] as PoolKind[]) {
    registerKindCommands(pi, kind);
  }

  // ---- 工具 ----
  pi.registerTool({
    name: "embed_text",
    label: "Embed Text",
    description:
      "通过嵌入池把文本转为向量（返回维度与前几维）。嵌入池需先 /embed-discover 发现可用模型。可用于相似度/检索场景。",
    parameters: Type.Object({
      text: Type.String({ description: "要嵌入的文本" }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const r = await embedText(ctx, params.text, signal);
      return {
        content: [
          {
            type: "text",
            text: `模型：${r.model}\n维度：${r.dim}\n前 8 维：${JSON.stringify(r.vector)}`,
          },
        ],
        details: { model: r.model, dim: r.dim },
      };
    },
  });

  pi.registerTool({
    name: "text_to_speech",
    label: "Text to Speech",
    description: "通过 TTS 池把文本合成为语音文件（mp3，保存到 Downloads）。需先 /tts-discover。",
    parameters: Type.Object({
      text: Type.String({ description: "要朗读的文本" }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const r = await synthesizeSpeech(ctx, params.text, signal);
      return {
        content: [{ type: "text", text: `语音已保存：${r.path}（模型：${r.model}）` }],
        details: { path: r.path, model: r.model },
      };
    },
  });

  pi.registerTool({
    name: "transcribe_audio",
    label: "Transcribe Audio",
    description: "通过 ASR 池把音频文件转为文本。需先 /asr-discover。",
    parameters: Type.Object({
      audioPath: Type.String({ description: "音频文件路径（wav/mp3 等）" }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const r = await transcribeAudio(ctx, params.audioPath, signal);
      return {
        content: [{ type: "text", text: `转录结果（${r.model}）：\n${r.text}` }],
        details: { model: r.model },
      };
    },
  });

  // ---- 便捷命令 ----
  pi.registerCommand("embed", {
    description: "文本 → 向量（嵌入池）。用法：/embed <文本>",
    handler: async (args, ctx) => {
      if (!args.trim()) {
        ctx.ui.notify("用法：/embed <文本>", "warning");
        return;
      }
      try {
        const r = await embedText(ctx, args.trim());
        ctx.ui.notify(`嵌入（${r.model}）：维度 ${r.dim}，前 8 维 ${JSON.stringify(r.vector)}`, "info");
      } catch (err) {
        ctx.ui.notify(`嵌入失败：${errMsg(err)}`, "error");
      }
    },
  });

  pi.registerCommand("tts", {
    description: "文本 → 语音文件（TTS 池）。用法：/tts <文本>",
    handler: async (args, ctx) => {
      if (!args.trim()) {
        ctx.ui.notify("用法：/tts <文本>", "warning");
        return;
      }
      ctx.ui.notify("正在合成语音…", "info");
      try {
        const r = await synthesizeSpeech(ctx, args.trim());
        ctx.ui.notify(`✅ 语音已保存：${r.path}（${r.model}）`, "info");
      } catch (err) {
        ctx.ui.notify(`合成失败：${errMsg(err)}`, "error");
      }
    },
  });

  pi.registerCommand("asr", {
    description: "音频 → 文本（ASR 池）。用法：/asr <音频文件路径>",
    handler: async (args, ctx) => {
      const path = args.trim();
      if (!path) {
        ctx.ui.notify("用法：/asr <音频文件路径>", "warning");
        return;
      }
      ctx.ui.notify("正在转录…", "info");
      try {
        const r = await transcribeAudio(ctx, path);
        ctx.ui.notify(`转录结果（${r.model}）：${r.text.slice(0, 200)}`, "info");
      } catch (err) {
        ctx.ui.notify(`转录失败：${errMsg(err)}`, "error");
      }
    },
  });
}
