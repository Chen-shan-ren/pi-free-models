/**
 * image-gen.ts — 图像生成池（pi-wanchuan 万川扩展模块）
 *
 * 从 OpenRouter 全量目录中筛选"图像生成模型"（architecture.output_modalities 含 image），
 * 组成图像生成池，按优先级调用生成图片并保存到本地。
 *
 * 命令：
 *   /img-pool [free|all]        查看图像生成池
 *   /img-refresh                强制刷新池
 *   /img-priority [n] [关键字]  设置优先级
 *   /img-generate <提示词>      生成图片并保存
 *
 * 工具：
 *   generate_image              生成图片（LLM 可调用）
 *
 * 注意：OpenRouter 当前没有免费的图像生成模型（池内均为付费模型，调用按量计费）。
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { join } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getOpenRouterCatalog, isFreeModel, type RawORModel } from "./or-free.ts";

interface ImgPoolModel {
  id: string;
  name: string;
  free: boolean;
  priority: number;
  userSet?: boolean;
  offline?: boolean;
}

interface ImgPoolConfig {
  ttlHours: number;
  size: string; // 生成尺寸：1024x1024 / 512x512 等
  outputDir: string; // 输出目录（空=自动选择）
  maxModels: number;
}

interface ImgPoolState {
  updatedAt: number;
  models: ImgPoolModel[];
  config: ImgPoolConfig;
}

const IMG_POOL_FILE = join(getAgentDir(), "image-pool.json");
const DEFAULT_IMG_CONFIG: ImgPoolConfig = {
  ttlHours: 24,
  size: "1024x1024",
  outputDir: "",
  maxModels: 50,
};

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function loadImgPool(): Promise<ImgPoolState> {
  try {
    const raw = await readFile(IMG_POOL_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<ImgPoolState>;
    if (parsed && Array.isArray(parsed.models)) {
      return {
        updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
        models: parsed.models.filter((m) => m && typeof m.id === "string"),
        config: { ...DEFAULT_IMG_CONFIG, ...(parsed.config ?? {}) },
      };
    }
  } catch {
    // 首次运行
  }
  return { updatedAt: 0, models: [], config: { ...DEFAULT_IMG_CONFIG } };
}

async function saveImgPool(pool: ImgPoolState): Promise<void> {
  try {
    await mkdir(join(getAgentDir()), { recursive: true });
    await writeFile(IMG_POOL_FILE, JSON.stringify(pool, null, 2), "utf8");
  } catch (err) {
    throw new Error(`无法写入池文件 ${IMG_POOL_FILE}: ${errMsg(err)}`);
  }
}

function imgPoolFresh(pool: ImgPoolState): boolean {
  return pool.models.length > 0 && Date.now() - pool.updatedAt < pool.config.ttlHours * 3_600_000;
}

function sortImgModels(models: ImgPoolModel[]): ImgPoolModel[] {
  return [...models].sort(
    (a, b) =>
      Number(!!a.offline) - Number(!!b.offline) || a.priority - b.priority || a.id.localeCompare(b.id),
  );
}

/** 从 OpenRouter 目录构建图像生成池（output 含 image，排除路由别名）。 */
function buildImgPool(current: ImgPoolState, raw: RawORModel[]): ImgPoolState {
  const prevById = new Map(current.models.map((m) => [m.id, m]));
  const rawIds = new Set(raw.map((r) => r.id));
  const models: ImgPoolModel[] = [];
  for (const r of raw) {
    const out = (r.architecture?.output_modalities ?? []).map((s) => String(s).toLowerCase());
    if (!out.includes("image")) continue;
    if (r.id.startsWith("openrouter/")) continue; // 路由别名（auto 等），非特定生成模型
    const free = isFreeModel(r);
    const prev = prevById.get(r.id);
    models.push({
      id: r.id,
      name: r.name ?? r.id,
      free,
      priority: prev?.priority ?? (free ? 1 + models.filter((m) => m.free).length : 1000 + models.filter((m) => !m.free).length),
      userSet: prev?.userSet,
      offline: false,
    });
  }
  // 下架保留
  const offlineModels: ImgPoolModel[] = [];
  for (const prev of current.models) {
    if (!models.some((m) => m.id === prev.id)) {
      if (rawIds.has(prev.id)) continue; // 被排除（如路由别名）
      offlineModels.push({ ...prev, offline: true });
    }
  }
  let all = sortImgModels([...models, ...offlineModels]);
  if (current.config.maxModels > 0 && all.length > current.config.maxModels) {
    const keep = all.filter((m) => m.userSet);
    for (const m of all) {
      if (keep.length >= current.config.maxModels) break;
      if (!keep.includes(m)) keep.push(m);
    }
    all = keep;
  }
  return { ...current, updatedAt: Date.now(), models: all };
}

let imgRefreshing: Promise<ImgPoolState> | null = null;

async function refreshImgPool(ctx: ExtensionContext, force: boolean): Promise<ImgPoolState> {
  if (!force && imgRefreshing) return imgRefreshing;
  const task = (async () => {
    const current = await loadImgPool();
    if (!force && imgPoolFresh(current)) return current;
    const raw = await getOpenRouterCatalog(force);
    const pool = buildImgPool(current, raw);
    await saveImgPool(pool);
    return pool;
  })();
  imgRefreshing = task;
  try {
    return await task;
  } finally {
    imgRefreshing = null;
  }
}

async function ensureImgPool(ctx: ExtensionContext): Promise<ImgPoolState> {
  const pool = await loadImgPool();
  if (imgPoolFresh(pool)) return pool;
  try {
    return await refreshImgPool(ctx, false);
  } catch {
    return pool;
  }
}

/** 生成图片：按优先级尝试池中模型，成功返回 { path, modelId }。 */
async function generateImage(
  ctx: ExtensionContext,
  prompt: string,
  signal?: AbortSignal,
): Promise<{ path: string; modelId: string }> {
  const pool = await ensureImgPool(ctx);
  const config = pool.config;
  const apiKey = await (async () => {
    try {
      const k = await ctx.modelRegistry.getApiKeyForProvider("openrouter");
      if (k) return k;
    } catch {
      // 环境变量兜底
    }
    return process.env.OPENROUTER_API_KEY;
  })();
  if (!apiKey) {
    throw new Error("未找到 OpenRouter API key（/login openrouter 或 OPENROUTER_API_KEY）");
  }
  const baseUrl = "https://openrouter.ai/api/v1";
  const tried = new Set<string>();
  const errors: string[] = [];
  const timeout = signal ?? AbortSignal.timeout(180_000);

  const attempt = async (candidates: ImgPoolModel[]) => {
    for (const m of candidates) {
      if (m.offline || tried.has(m.id)) continue;
      tried.add(m.id);
      try {
        const res = await fetch(`${baseUrl}/images/generations`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: m.id,
            prompt,
            n: 1,
            size: config.size,
          }),
          signal: timeout,
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status} ${body.slice(0, 150)}`);
        }
        const j = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
        const item = j?.data?.[0];
        if (!item) throw new Error("空响应");
        let imageData: string;
        let ext = "png";
        if (item.b64_json) {
          imageData = item.b64_json;
        } else if (item.url) {
          const imgRes = await fetch(item.url, { signal: timeout });
          const buf = Buffer.from(await imgRes.arrayBuffer());
          imageData = buf.toString("base64");
          ext = imgRes.headers.get("content-type")?.includes("jpeg") ? "jpg" : "png";
        } else {
          throw new Error("响应中没有图片数据");
        }
        // 保存文件
        const outDir =
          config.outputDir || join(process.env.USERPROFILE ?? process.env.HOME ?? ".", "Downloads");
        await mkdir(outDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const file = join(outDir, `wanchuan-${stamp}.${ext}`);
        await writeFile(file, Buffer.from(imageData, "base64"));
        return { path: file, modelId: m.id };
      } catch (err) {
        errors.push(`${m.id}: ${errMsg(err)}`);
      }
    }
    return undefined;
  };

  let result = await attempt(pool.models);
  if (!result && pool.config.ttlHours > 0) {
    try {
      const fresh = await refreshImgPool(ctx, true);
      result = await attempt(fresh.models);
    } catch (err) {
      errors.push(`刷新池失败: ${errMsg(err)}`);
    }
  }
  if (!result) throw new Error(`图像池所有模型均失败：${errors.join("；")}`);
  return result;
}

export function initImageGen(pi: ExtensionAPI): void {
  // ---- 命令 ----
  pi.registerCommand("img-pool", {
    description: "查看图像生成池（按优先级排序）。可选参数：free / all / offline",
    handler: async (args, ctx) => {
      const filter = (args || "").trim().toLowerCase();
      const pool = await ensureImgPool(ctx);
      if (pool.models.length === 0) {
        ctx.ui.notify("图像池为空，请先运行 /img-refresh", "warning");
        return;
      }
      const online = pool.models.filter((m) => !m.offline);
      const list = sortImgModels(pool.models).filter((m) => {
        if (filter === "free") return !m.offline && m.free;
        if (filter === "offline") return m.offline;
        if (filter === "all") return true;
        return !m.offline;
      });
      const lines = [
        `图像生成池：在线 ${online.length} 个（免费 ${online.filter((m) => m.free).length}），` +
          `下架 ${pool.models.length - online.length} 个，更新于 ${new Date(pool.updatedAt).toLocaleString()}`,
        `用法：/img-generate <提示词> · /img-priority [数字] [关键字]`,
        ``,
        ...list.map(
          (m, i) =>
            `${String(i + 1).padStart(3)}. [${String(m.priority).padStart(5)}] ` +
            `${m.offline ? "⚠下架" : m.free ? "FREE" : "paid"} ${m.id}` +
            `${m.userSet ? "  [自定义优先级]" : ""}`,
        ),
      ];
      if (ctx.mode === "tui") {
        await ctx.ui.editor("图像生成池", lines.join("\n"));
        ctx.ui.notify(`图像池：在线 ${online.length} 个，已打开列表`, "info");
      } else {
        ctx.ui.notify(lines.slice(0, 2).join(" | "), "info");
      }
    },
  });

  pi.registerCommand("img-refresh", {
    description: "强制刷新图像生成池",
    handler: async (_args, ctx) => {
      try {
        const pool = await refreshImgPool(ctx, true);
        ctx.ui.notify(
          `图像池已刷新：在线 ${pool.models.filter((m) => !m.offline).length} 个图像生成模型` +
            `（免费 ${pool.models.filter((m) => m.free && !m.offline).length}）`,
          "info",
        );
      } catch (err) {
        ctx.ui.notify(`刷新失败：${errMsg(err)}`, "error");
      }
    },
  });

  pi.registerCommand("img-priority", {
    description: "设置图像池模型优先级（数字越小越优先）。用法：/img-priority [数字] [关键字]",
    handler: async (args, ctx) => {
      const pool = await loadImgPool();
      const online = pool.models.filter((m) => !m.offline);
      if (online.length === 0) {
        ctx.ui.notify("图像池为空，请先运行 /img-refresh", "warning");
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
        ? online.filter((mm) => mm.id.toLowerCase().includes(keyword) || mm.name.toLowerCase().includes(keyword))
        : online;
      if (matches.length === 0) {
        ctx.ui.notify(`没有找到匹配“${keyword}”的模型`, "warning");
        return;
      }
      let target: ImgPoolModel | undefined;
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
      await saveImgPool(pool);
      ctx.ui.notify(`已设置 ${target!.id} 的优先级为 ${priority}`, "info");
    },
  });

  pi.registerCommand("img-generate", {
    description: "生成图片并保存到本地。用法：/img-generate <提示词>",
    handler: async (args, ctx) => {
      const prompt = args.trim();
      if (!prompt) {
        ctx.ui.notify("用法：/img-generate <提示词>", "warning");
        return;
      }
      ctx.ui.notify(`正在生成图片（${prompt.slice(0, 40)}…）`, "info");
      try {
        const result = await generateImage(ctx, prompt);
        ctx.ui.notify(`✅ 图片已保存：${result.path}（由 ${result.modelId} 生成）`, "info");
      } catch (err) {
        ctx.ui.notify(`生成失败：${errMsg(err)}`, "error");
      }
    },
  });

  // ---- 工具 ----
  pi.registerTool({
    name: "generate_image",
    label: "Generate Image",
    description:
      "通过图像生成池生成一张图片并保存到本地。prompt 为图片描述；outputPath 可选（默认 Downloads 目录）。返回保存路径。注意：图像生成模型需要付费额度。",
      promptSnippet: "生成图片（AI 绘图）",
      promptGuidelines: ["当用户要求画图、生成图片、绘图、制作插画/海报/logo 等图像生成需求时，使用 generate_image 工具（提示词要详细：主体、风格、构图、细节）。生成会消耗付费额度。"],
    parameters: Type.Object({
      prompt: Type.String({ description: "图片内容描述" }),
      outputPath: Type.Optional(Type.String({ description: "保存路径（默认 Downloads）" })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const config = (await loadImgPool()).config;
      const result = await generateImage(ctx, params.prompt, signal);
      let finalPath = result.path;
      if (params.outputPath) {
        const target = join(ctx.cwd, params.outputPath);
        await mkdir(join(target, ".."), { recursive: true }).catch(() => {});
        await writeFile(target, Buffer.from(await readFile(result.path)));
        finalPath = target;
      }
      return {
        content: [
          {
            type: "text",
            text: `图片已生成并保存：${finalPath}\n生成模型：${result.modelId}\n提示词：${params.prompt}`,
          },
        ],
        details: { path: finalPath, modelId: result.modelId },
      };
    },
  });
}
