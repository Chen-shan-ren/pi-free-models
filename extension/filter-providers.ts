/**
 * filter-providers.ts — 内置 provider 模型筛选（pi-free-models 扩展模块）
 *
 * 覆盖 nvidia / cloudflare-workers-ai / zai 三个内置 provider，只保留达到
 * DeepSeek-V4-Flash / GLM-5.2 水平的旗舰模型（小模型/老模型从 /model 移除）。
 * 不传 baseUrl/apiKey：自动继承内置 provider 的配置与鉴权。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const NV_MODELS = [
  {
    "id": "minimaxai/minimax-m3",
    "name": "MiniMax-M3",
    "api": "openai-completions",
    "headers": {
      "NVCF-POLL-SECONDS": "3600"
    },
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "cost": {
      "input": 0,
      "output": 0,
      "cacheRead": 0,
      "cacheWrite": 0
    },
    "compat": {
      "supportsStore": false,
      "supportsDeveloperRole": false,
      "supportsReasoningEffort": true,
      "thinkingFormat": "deepseek",
      "maxTokensField": "max_tokens",
      "supportsStrictMode": false,
      "supportsLongCacheRetention": false
    },
    "contextWindow": 1000000,
    "maxTokens": 16384,
    "thinkingLevelMap": {
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": "max"
    }
  },

  {
    "id": "nvidia/nemotron-3-super-120b-a12b",
    "name": "Nemotron 3 Super",
    "api": "openai-completions",
    "headers": {
      "NVCF-POLL-SECONDS": "3600"
    },
    "reasoning": true,
    "input": [
      "text"
    ],
    "cost": {
      "input": 0.2,
      "output": 0.8,
      "cacheRead": 0,
      "cacheWrite": 0
    },
    "compat": {
      "supportsStore": false,
      "supportsDeveloperRole": false,
      "supportsReasoningEffort": true,
      "thinkingFormat": "deepseek",
      "maxTokensField": "max_tokens",
      "supportsStrictMode": false,
      "supportsLongCacheRetention": false
    },
    "contextWindow": 262144,
    "maxTokens": 262144,
    "thinkingLevelMap": {
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": "max"
    }
  },
  {
    "id": "nvidia/nemotron-3-ultra-550b-a55b",
    "name": "Nemotron 3 Ultra 550B A55B",
    "api": "openai-completions",
    "headers": {
      "NVCF-POLL-SECONDS": "3600"
    },
    "reasoning": true,
    "input": [
      "text"
    ],
    "cost": {
      "input": 0.5,
      "output": 2.5,
      "cacheRead": 0.15,
      "cacheWrite": 0
    },
    "compat": {
      "supportsStore": false,
      "supportsDeveloperRole": false,
      "supportsReasoningEffort": true,
      "thinkingFormat": "deepseek",
      "maxTokensField": "max_tokens",
      "supportsStrictMode": false,
      "supportsLongCacheRetention": false
    },
    "contextWindow": 1000000,
    "maxTokens": 65536,
    "thinkingLevelMap": {
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": "max"
    }
  },
  {
    "id": "openai/gpt-oss-120b",
    "name": "GPT-OSS-120B",
    "api": "openai-completions",
    "headers": {
      "NVCF-POLL-SECONDS": "3600"
    },
    "reasoning": true,
    "input": [
      "text"
    ],
    "cost": {
      "input": 0,
      "output": 0,
      "cacheRead": 0,
      "cacheWrite": 0
    },
    "compat": {
      "supportsStore": false,
      "supportsDeveloperRole": false,
      "supportsReasoningEffort": true,
      "thinkingFormat": "deepseek",
      "maxTokensField": "max_tokens",
      "supportsStrictMode": false,
      "supportsLongCacheRetention": false
    },
    "contextWindow": 128000,
    "maxTokens": 8192,
    "thinkingLevelMap": {
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    }
  },
  {
    "id": "stepfun-ai/step-3.7-flash",
    "name": "Step 3.7 Flash",
    "api": "openai-completions",
    "headers": {
      "NVCF-POLL-SECONDS": "3600"
    },
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "cost": {
      "input": 0,
      "output": 0,
      "cacheRead": 0,
      "cacheWrite": 0
    },
    "compat": {
      "supportsStore": false,
      "supportsDeveloperRole": false,
      "supportsReasoningEffort": true,
      "thinkingFormat": "deepseek",
      "maxTokensField": "max_tokens",
      "supportsStrictMode": false,
      "supportsLongCacheRetention": false
    },
    "contextWindow": 256000,
    "maxTokens": 16384,
    "thinkingLevelMap": {
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": "max"
    }
  },
  {
    "id": "z-ai/glm-5.2",
    "name": "GLM-5.2",
    "api": "openai-completions",
    "headers": {
      "NVCF-POLL-SECONDS": "3600"
    },
    "reasoning": true,
    "input": [
      "text"
    ],
    "cost": {
      "input": 0,
      "output": 0,
      "cacheRead": 0,
      "cacheWrite": 0
    },
    "compat": {
      "supportsStore": false,
      "supportsDeveloperRole": false,
      "supportsReasoningEffort": true,
      "thinkingFormat": "deepseek",
      "maxTokensField": "max_tokens",
      "supportsStrictMode": false,
      "supportsLongCacheRetention": false
    },
    "contextWindow": 1000000,
    "maxTokens": 131072,
    "thinkingLevelMap": {
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": "max"
    }
  }
];

const CF_MODELS = [
  {
    "id": "@cf/moonshotai/kimi-k2.6",
    "name": "Kimi K2.6",
    "api": "openai-completions",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "cost": {
      "input": 0.95,
      "output": 4,
      "cacheRead": 0.16,
      "cacheWrite": 0
    },
    "contextWindow": 262144,
    "maxTokens": 256000,
    "compat": {
      "supportsStore": false,
      "supportsDeveloperRole": false,
      "supportsLongCacheRetention": false,
      "sendSessionAffinityHeaders": true
    },
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    }
  },
  {
    "id": "@cf/moonshotai/kimi-k2.7-code",
    "name": "Kimi K2.7 Code",
    "api": "openai-completions",
    "reasoning": true,
    "input": [
      "text",
      "image"
    ],
    "cost": {
      "input": 0.95,
      "output": 4,
      "cacheRead": 0.19,
      "cacheWrite": 0
    },
    "contextWindow": 262144,
    "maxTokens": 262144,
    "compat": {
      "supportsStore": false,
      "supportsDeveloperRole": false,
      "supportsLongCacheRetention": false,
      "sendSessionAffinityHeaders": true
    },
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    }
  },
  {
    "id": "@cf/nvidia/nemotron-3-120b-a12b",
    "name": "Nemotron 3 Super 120B",
    "api": "openai-completions",
    "reasoning": true,
    "input": [
      "text"
    ],
    "cost": {
      "input": 0.5,
      "output": 1.5,
      "cacheRead": 0,
      "cacheWrite": 0
    },
    "contextWindow": 256000,
    "maxTokens": 256000,
    "compat": {
      "supportsStore": false,
      "supportsDeveloperRole": false,
      "supportsLongCacheRetention": false,
      "sendSessionAffinityHeaders": true
    },
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    }
  },
  {
    "id": "@cf/openai/gpt-oss-120b",
    "name": "GPT OSS 120B",
    "api": "openai-completions",
    "reasoning": true,
    "input": [
      "text"
    ],
    "cost": {
      "input": 0.35,
      "output": 0.75,
      "cacheRead": 0,
      "cacheWrite": 0
    },
    "contextWindow": 128000,
    "maxTokens": 16384,
    "compat": {
      "supportsStore": false,
      "supportsDeveloperRole": false,
      "supportsLongCacheRetention": false,
      "sendSessionAffinityHeaders": true
    },
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    }
  },
  {
    "id": "@cf/zai-org/glm-5.2",
    "name": "Glm 5.2",
    "api": "openai-completions",
    "reasoning": true,
    "input": [
      "text"
    ],
    "cost": {
      "input": 1.4,
      "output": 4.4,
      "cacheRead": 0.26,
      "cacheWrite": 0
    },
    "contextWindow": 262144,
    "maxTokens": 256000,
    "compat": {
      "supportsStore": false,
      "supportsDeveloperRole": false,
      "supportsLongCacheRetention": false,
      "sendSessionAffinityHeaders": true
    },
    "thinkingLevelMap": {
      "off": null,
      "minimal": null,
      "low": "low",
      "medium": "medium",
      "high": "high",
      "xhigh": null,
      "max": null
    }
  }
];

const ZAI_MODELS = [
  {
    "id": "glm-5.2",
    "name": "GLM-5.2",
    "api": "openai-completions",
    "reasoning": true,
    "thinkingLevelMap": {
      "minimal": null,
      "low": "high",
      "medium": "high",
      "high": "high",
      "max": "max"
    },
    "input": [
      "text"
    ],
    "cost": {
      "input": 0,
      "output": 0,
      "cacheRead": 0,
      "cacheWrite": 0
    },
    "compat": {
      "supportsStore": false,
      "supportsDeveloperRole": false,
      "supportsReasoningEffort": true,
      "maxTokensField": "max_tokens",
      "thinkingFormat": "zai",
      "zaiToolStream": true
    },
    "contextWindow": 1000000,
    "maxTokens": 131072
  },
  {
    "id": "glm-5.2-highspeed",
    "name": "GLM-5.2 Highspeed",
    "api": "openai-completions",
    "reasoning": true,
    "input": [
      "text"
    ],
    "cost": {
      "input": 0,
      "output": 0,
      "cacheRead": 0,
      "cacheWrite": 0
    },
    "compat": {
      "supportsStore": false,
      "supportsDeveloperRole": false,
      "supportsReasoningEffort": false,
      "maxTokensField": "max_tokens",
      "thinkingFormat": "zai",
      "zaiToolStream": true
    },
    "contextWindow": 1000000,
    "maxTokens": 131072
  },
  {
    "id": "glm-5.3",
    "name": "GLM-5.3",
    "api": "openai-completions",
    "reasoning": true,
    "input": [
      "text"
    ],
    "cost": {
      "input": 0,
      "output": 0,
      "cacheRead": 0,
      "cacheWrite": 0
    },
    "compat": {
      "supportsStore": false,
      "supportsDeveloperRole": false,
      "supportsReasoningEffort": false,
      "maxTokensField": "max_tokens",
      "thinkingFormat": "zai",
      "zaiToolStream": true
    },
    "contextWindow": 1000000,
    "maxTokens": 131072
  }
];

export function initProviderFilter(pi: ExtensionAPI): void {
  pi.registerProvider("nvidia", { api: "openai-completions", models: NV_MODELS });
  pi.registerProvider("cloudflare-workers-ai", { api: "openai-completions", models: CF_MODELS });
  pi.registerProvider("zai", { api: "openai-completions", models: ZAI_MODELS });
}
