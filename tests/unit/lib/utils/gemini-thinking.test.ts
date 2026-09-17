import { describe, expect, test } from "vitest";
import {
  extractGeminiThinkingFromRequestBody,
  extractGeminiThinkingFromSpecialSettings,
} from "@/lib/utils/gemini-thinking";
import { extractThinkingEffortInfo } from "@/lib/utils/thinking-effort";
import type { SpecialSetting } from "@/types/special-settings";

describe("extractGeminiThinkingFromRequestBody", () => {
  test("从 generationConfig.thinkingConfig.thinkingLevel 读取强度等级", () => {
    const result = extractGeminiThinkingFromRequestBody({
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
      generationConfig: {
        thinkingConfig: {
          thinkingLevel: "HIGH",
        },
      },
    });

    expect(result).toEqual({
      effort: "high",
      source: "thinkingConfig.thinkingLevel",
    });
  });

  test("从 generationConfig.thinkingConfig.thinkingBudget 读取正整数预算", () => {
    const result = extractGeminiThinkingFromRequestBody({
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
      generationConfig: {
        thinkingConfig: {
          thinkingBudget: 2048,
        },
      },
    });

    expect(result).toEqual({
      effort: "2048",
      source: "thinkingConfig.thinkingBudget",
      budget: 2048,
    });
  });

  test("thinkingBudget 为 -1 时映射为自适应思考 (auto)", () => {
    const result = extractGeminiThinkingFromRequestBody({
      generationConfig: {
        thinkingConfig: {
          thinkingBudget: -1,
        },
      },
    });

    expect(result).toEqual({
      effort: "auto",
      source: "thinkingConfig.thinkingBudget",
      budget: -1,
    });
  });

  test("thinkingBudget 为 0 且无 level 时判定为禁用思考并返回 null", () => {
    const result = extractGeminiThinkingFromRequestBody({
      generationConfig: {
        thinkingConfig: {
          thinkingBudget: 0,
        },
      },
    });

    expect(result).toBeNull();
  });

  test("同时提供 thinkingLevel 与 thinkingBudget 时 level 优先，并携带 budget", () => {
    const result = extractGeminiThinkingFromRequestBody({
      generationConfig: {
        thinkingConfig: {
          thinkingLevel: "low",
          thinkingBudget: 1024,
        },
      },
    });

    expect(result).toEqual({
      effort: "low",
      source: "thinkingConfig.thinkingLevel",
      budget: 1024,
    });
  });

  test("支持蛇形命名 generation_config.thinking_config", () => {
    const result = extractGeminiThinkingFromRequestBody({
      generation_config: {
        thinking_config: {
          thinking_level: "MEDIUM",
          thinking_budget: 4096,
        },
      },
    });

    expect(result).toEqual({
      effort: "medium",
      source: "thinking_config.thinking_level",
      budget: 4096,
    });
  });

  test("支持顶层简写 thinkingConfig", () => {
    const result = extractGeminiThinkingFromRequestBody({
      thinkingConfig: {
        thinkingLevel: "minimal",
      },
    });

    expect(result).toEqual({
      effort: "minimal",
      source: "thinkingConfig.thinkingLevel",
    });
  });

  test("非法入参和空配置返回 null", () => {
    expect(extractGeminiThinkingFromRequestBody(null)).toBeNull();
    expect(extractGeminiThinkingFromRequestBody("invalid")).toBeNull();
    expect(extractGeminiThinkingFromRequestBody([])).toBeNull();
    expect(extractGeminiThinkingFromRequestBody({})).toBeNull();
    expect(
      extractGeminiThinkingFromRequestBody({
        generationConfig: {},
      })
    ).toBeNull();
  });
});

describe("extractGeminiThinkingFromSpecialSettings", () => {
  test("正确解析 specialSettings 中的 gemini_thinking 设置", () => {
    const settings: SpecialSetting[] = [
      {
        type: "gemini_thinking",
        scope: "request",
        hit: true,
        effort: "high",
        source: "thinkingConfig.thinkingLevel",
        budget: 2048,
      },
    ];

    const result = extractGeminiThinkingFromSpecialSettings(settings);
    expect(result).toEqual({
      effort: "high",
      source: "thinkingConfig.thinkingLevel",
      budget: 2048,
    });
  });

  test("无 gemini_thinking 设置时返回 null", () => {
    expect(extractGeminiThinkingFromSpecialSettings(null)).toBeNull();
    expect(extractGeminiThinkingFromSpecialSettings([])).toBeNull();
    expect(
      extractGeminiThinkingFromSpecialSettings([
        {
          type: "codex_reasoning_effort",
          scope: "request",
          hit: true,
          effort: "high",
        },
      ])
    ).toBeNull();
  });
});

describe("extractThinkingEffortInfo (Gemini 集成)", () => {
  test("统一提取器正确识别并返回 source: gemini", () => {
    const settings: SpecialSetting[] = [
      {
        type: "gemini_thinking",
        scope: "request",
        hit: true,
        effort: "high",
        source: "thinkingConfig.thinkingLevel",
      },
    ];

    const result = extractThinkingEffortInfo(settings);
    expect(result).toEqual({
      source: "gemini",
      requestedEffort: "high",
      effectiveEffort: "high",
      isOverridden: false,
    });
  });
});
