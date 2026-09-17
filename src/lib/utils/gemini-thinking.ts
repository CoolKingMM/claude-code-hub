import type {
  GeminiThinkingFieldSource,
  GeminiThinkingSpecialSetting,
  SpecialSetting,
} from "@/types/special-settings";

/** 从 Gemini / Gemini-CLI 请求体解析出的思考强度与预算信息。 */
export interface GeminiThinkingExtraction {
  effort: string;
  source: GeminiThinkingFieldSource;
  budget?: number;
}

/** 过滤非字符串及空白值，返回小写标准等级（若为标准档位），保留原值。 */
function normalizeGeminiThinkingLevel(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const lower = trimmed.toLowerCase();
  if (["minimal", "low", "medium", "high", "xhigh", "max"].includes(lower)) {
    return lower;
  }

  return trimmed;
}

/** 解析思考预算数字。 */
function normalizeGeminiThinkingBudget(value: unknown): number | null {
  if (typeof value === "number" && !Number.isNaN(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return null;
}

/**
 * 从 Gemini / Gemini-CLI 请求体中解析思考配置。
 *
 * 兼容标准驼峰命名与蛇形命名：
 * 1. generationConfig.thinkingConfig / generation_config.thinking_config
 * 2. 顶层 thinkingConfig / thinking_config（部分网关/SDK 简写）
 *
 * 判定优先级：
 * - thinkingLevel（明确的强度枚举：low/medium/high 等）优先作为 effort。
 * - thinkingBudget：若为 -1 映射为 "auto"（Gemini 2.5 动态思考）；若为正数直接作为 effort 标签（如 "1024"）。
 * - 若 budget 为 0 则视为禁用思考，返回 null。
 */
export function extractGeminiThinkingFromRequestBody(
  requestBody: unknown
): GeminiThinkingExtraction | null {
  if (!requestBody || typeof requestBody !== "object" || Array.isArray(requestBody)) {
    return null;
  }

  const body = requestBody as Record<string, unknown>;

  // 1. 查找 generationConfig / generation_config 对象或顶层 thinkingConfig
  const genConfig =
    (body.generationConfig as Record<string, unknown> | undefined) ||
    (body.generation_config as Record<string, unknown> | undefined);

  const thinkingConfig =
    (genConfig?.thinkingConfig as Record<string, unknown> | undefined) ||
    (genConfig?.thinking_config as Record<string, unknown> | undefined) ||
    (body.thinkingConfig as Record<string, unknown> | undefined) ||
    (body.thinking_config as Record<string, unknown> | undefined);

  if (!thinkingConfig || typeof thinkingConfig !== "object" || Array.isArray(thinkingConfig)) {
    return null;
  }

  // 2. 提取 thinkingLevel
  const rawLevel =
    thinkingConfig.thinkingLevel !== undefined
      ? { value: thinkingConfig.thinkingLevel, source: "thinkingConfig.thinkingLevel" as const }
      : thinkingConfig.thinking_level !== undefined
        ? {
            value: thinkingConfig.thinking_level,
            source: "thinking_config.thinking_level" as const,
          }
        : null;

  const level = rawLevel ? normalizeGeminiThinkingLevel(rawLevel.value) : null;

  // 3. 提取 thinkingBudget
  const rawBudget =
    thinkingConfig.thinkingBudget !== undefined
      ? { value: thinkingConfig.thinkingBudget, source: "thinkingConfig.thinkingBudget" as const }
      : thinkingConfig.thinking_budget !== undefined
        ? {
            value: thinkingConfig.thinking_budget,
            source: "thinking_config.thinking_budget" as const,
          }
        : null;

  const budget = rawBudget ? normalizeGeminiThinkingBudget(rawBudget.value) : null;

  // budget 为 0 表示明确禁用思考
  if (budget === 0 && !level) {
    return null;
  }

  if (level) {
    return {
      effort: level,
      source: rawLevel?.source ?? "thinkingConfig.thinkingLevel",
      ...(budget !== null ? { budget } : {}),
    };
  }

  if (budget !== null) {
    if (budget === -1) {
      return {
        effort: "auto",
        source: rawBudget?.source ?? "thinkingConfig.thinkingBudget",
        budget,
      };
    }
    if (budget > 0) {
      return {
        effort: String(budget),
        source: rawBudget?.source ?? "thinkingConfig.thinkingBudget",
        budget,
      };
    }
  }

  return null;
}

/** 从使用记录 specialSettings 审计中读取 Gemini 思考强度信息。 */
export function extractGeminiThinkingFromSpecialSettings(
  specialSettings: SpecialSetting[] | null | undefined
): GeminiThinkingExtraction | null {
  if (!Array.isArray(specialSettings)) {
    return null;
  }

  for (const setting of specialSettings) {
    if (setting.type !== "gemini_thinking") {
      continue;
    }
    const geminiSetting = setting as GeminiThinkingSpecialSetting;
    if (typeof geminiSetting.effort !== "string" || geminiSetting.effort.trim().length === 0) {
      continue;
    }
    return {
      effort: geminiSetting.effort,
      source: geminiSetting.source,
      budget: geminiSetting.budget,
    };
  }

  return null;
}
