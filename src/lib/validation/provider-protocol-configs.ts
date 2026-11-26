import { z } from "zod";
import { CODEX_IMAGE_GENERATION_PREFERENCE_VALUES } from "@/lib/constants/provider.constants";
import { PROVIDER_ALLOWED_MODEL_RULE_INPUT_LIST_SCHEMA } from "@/lib/provider-allowed-model-schema";
import { PROVIDER_MODEL_REDIRECT_RULE_LIST_SCHEMA } from "@/lib/provider-model-redirect-schema";

const USER_FACING_PROTOCOL_ENUM = z.enum(["claude", "codex", "openai-compatible", "gemini"]);

const ANTHROPIC_ADAPTIVE_THINKING_SCHEMA = z
  .object({
    effort: z.enum(["low", "medium", "high", "xhigh", "max"]),
    modelMatchMode: z.enum(["specific", "all"]),
    models: z.array(z.string().min(1)),
  })
  .nullable()
  .optional();

export const PROVIDER_PROTOCOL_CONFIG_SCHEMA = z.object({
  provider_type: USER_FACING_PROTOCOL_ENUM,
  allowed_models: PROVIDER_ALLOWED_MODEL_RULE_INPUT_LIST_SCHEMA.nullable().optional(),
  model_redirects: PROVIDER_MODEL_REDIRECT_RULE_LIST_SCHEMA.nullable().optional(),
  cache_ttl_preference: z.enum(["inherit", "5m", "1h"]).nullable().optional(),
  swap_cache_ttl_billing: z.boolean().optional(),
  context_1m_preference: z.enum(["inherit", "force_enable", "disabled"]).nullable().optional(),
  anthropic_max_tokens_preference: z.string().nullable().optional(),
  anthropic_thinking_budget_preference: z.string().nullable().optional(),
  anthropic_adaptive_thinking: ANTHROPIC_ADAPTIVE_THINKING_SCHEMA,
  codex_reasoning_effort_preference: z
    .enum(["inherit", "none", "minimal", "low", "medium", "high", "xhigh", "max"])
    .nullable()
    .optional(),
  codex_reasoning_summary_preference: z.enum(["inherit", "auto", "detailed"]).nullable().optional(),
  codex_text_verbosity_preference: z
    .enum(["inherit", "low", "medium", "high"])
    .nullable()
    .optional(),
  codex_parallel_tool_calls_preference: z.enum(["inherit", "true", "false"]).nullable().optional(),
  codex_image_generation_preference: z
    .enum(CODEX_IMAGE_GENERATION_PREFERENCE_VALUES)
    .nullable()
    .optional(),
  codex_service_tier_preference: z
    .enum(["inherit", "auto", "default", "flex", "priority"])
    .nullable()
    .optional(),
  gemini_google_search_preference: z.enum(["inherit", "enabled", "disabled"]).nullable().optional(),
  adopt_provider_ids: z.array(z.number().int().positive()).max(100).optional(),
});

export const PROVIDER_PROTOCOL_CONFIGS_SCHEMA = z
  .array(PROVIDER_PROTOCOL_CONFIG_SCHEMA)
  .min(1, "至少需要选择一个协议")
  .max(4, "最多支持四个协议")
  .superRefine((configs, ctx) => {
    const seen = new Set<string>();
    for (let index = 0; index < configs.length; index++) {
      const type = configs[index].provider_type;
      if (seen.has(type)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "provider_type"],
          message: `协议类型重复: ${type}`,
        });
      }
      seen.add(type);
    }
  })
  .optional();
