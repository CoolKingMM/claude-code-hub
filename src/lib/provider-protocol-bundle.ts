import type {
  ProviderDisplay,
  ProviderProtocolConfigInput,
  ProviderType,
  UpdateProviderData,
  UserFacingProviderType,
} from "@/types/provider";
import { normalizeAllowedModelRules } from "./allowed-model-rules";
import { normalizeProviderModelRedirectRules } from "./provider-model-redirects";
import { groupProvidersByChannel } from "./provider-vendor-groups";

export const USER_FACING_PROTOCOL_TYPES: readonly UserFacingProviderType[] = [
  "claude",
  "codex",
  "openai-compatible",
  "gemini",
] as const;

const USER_FACING_PROTOCOL_SET: ReadonlySet<string> = new Set(USER_FACING_PROTOCOL_TYPES);

const PROTOCOL_DISPLAY_ORDER: Record<string, number> = {
  claude: 0,
  "claude-auth": 1,
  codex: 2,
  "openai-compatible": 3,
  gemini: 4,
  "gemini-cli": 5,
};

export function isUserFacingProtocolType(type: string): type is UserFacingProviderType {
  return USER_FACING_PROTOCOL_SET.has(type);
}

/** 按稳定展示顺序排序并去重协议类型列表。 */
export function sortProtocolsByDisplayOrder(protocols: readonly ProviderType[]): ProviderType[] {
  return Array.from(new Set(protocols)).toSorted(
    (left, right) => (PROTOCOL_DISPLAY_ORDER[left] ?? 99) - (PROTOCOL_DISPLAY_ORDER[right] ?? 99)
  );
}

/** 按稳定展示顺序返回渠道内去重后的协议类型列表。 */
export function getChannelProtocolTypes(
  providers: readonly Pick<ProviderDisplay, "providerType">[]
): ProviderType[] {
  return sortProtocolsByDisplayOrder(providers.map((provider) => provider.providerType));
}

export function isMultiProtocolChannel(
  providers: readonly Pick<ProviderDisplay, "providerType" | "protocolGroupId">[]
): boolean {
  if (providers.some((provider) => Boolean(provider.protocolGroupId))) {
    return true;
  }
  return getChannelProtocolTypes(providers).length > 1;
}

/**
 * 去除所有协议专属字段，仅保留可在多协议逻辑渠道内同步的共享字段。
 * 绝不跨协议同步 allowed_models / model_redirects 与各协议专属参数覆写，防止模型串污染。
 */
export function stripProtocolSpecificFields<T extends Partial<UpdateProviderData>>(
  data: T
): Omit<
  T,
  | "provider_type"
  | "allowed_models"
  | "model_redirects"
  | "cache_ttl_preference"
  | "swap_cache_ttl_billing"
  | "context_1m_preference"
  | "anthropic_max_tokens_preference"
  | "anthropic_thinking_budget_preference"
  | "anthropic_adaptive_thinking"
  | "codex_reasoning_effort_preference"
  | "codex_reasoning_summary_preference"
  | "codex_text_verbosity_preference"
  | "codex_parallel_tool_calls_preference"
  | "codex_image_generation_preference"
  | "codex_service_tier_preference"
  | "gemini_google_search_preference"
> {
  const {
    provider_type: _providerType,
    allowed_models: _allowedModels,
    model_redirects: _modelRedirects,
    cache_ttl_preference: _cacheTtl,
    swap_cache_ttl_billing: _swapCacheTtl,
    context_1m_preference: _context1m,
    anthropic_max_tokens_preference: _anthropicMaxTokens,
    anthropic_thinking_budget_preference: _anthropicThinkingBudget,
    anthropic_adaptive_thinking: _anthropicAdaptiveThinking,
    codex_reasoning_effort_preference: _codexReasoningEffort,
    codex_reasoning_summary_preference: _codexReasoningSummary,
    codex_text_verbosity_preference: _codexTextVerbosity,
    codex_parallel_tool_calls_preference: _codexParallelToolCalls,
    codex_image_generation_preference: _codexImageGeneration,
    codex_service_tier_preference: _codexServiceTier,
    gemini_google_search_preference: _geminiGoogleSearch,
    ...shared
  } = data;

  return shared;
}

/**
 * 仅提取属于目标协议的合法专属字段，确保跨协议之间完全隔离。
 */
export function extractProtocolSpecificUpdate(
  config: ProviderProtocolConfigInput
): Partial<UpdateProviderData> {
  const base: Partial<UpdateProviderData> = {
    provider_type: config.provider_type,
    allowed_models:
      config.allowed_models !== undefined
        ? normalizeAllowedModelRules(config.allowed_models)
        : null,
    model_redirects:
      config.model_redirects !== undefined
        ? normalizeProviderModelRedirectRules(config.model_redirects)
        : null,
  };

  if (config.provider_type === "claude") {
    return {
      ...base,
      cache_ttl_preference: config.cache_ttl_preference ?? "inherit",
      swap_cache_ttl_billing: config.swap_cache_ttl_billing ?? false,
      context_1m_preference: config.context_1m_preference ?? "inherit",
      anthropic_max_tokens_preference: config.anthropic_max_tokens_preference ?? "inherit",
      anthropic_thinking_budget_preference:
        config.anthropic_thinking_budget_preference ?? "inherit",
      anthropic_adaptive_thinking: config.anthropic_adaptive_thinking ?? null,
    };
  }

  if (config.provider_type === "codex") {
    return {
      ...base,
      codex_reasoning_effort_preference: config.codex_reasoning_effort_preference ?? "inherit",
      codex_reasoning_summary_preference: config.codex_reasoning_summary_preference ?? "inherit",
      codex_text_verbosity_preference: config.codex_text_verbosity_preference ?? "inherit",
      codex_parallel_tool_calls_preference:
        config.codex_parallel_tool_calls_preference ?? "inherit",
      codex_image_generation_preference: config.codex_image_generation_preference ?? "inherit",
      codex_service_tier_preference: config.codex_service_tier_preference ?? "inherit",
    };
  }

  if (config.provider_type === "gemini") {
    return {
      ...base,
      gemini_google_search_preference: config.gemini_google_search_preference ?? "inherit",
    };
  }

  // openai-compatible 无额外协议覆写字段
  return base;
}

/** 校验并按固定顺序规范化协议配置数组，拒绝空列表或重复协议。 */
export function normalizeProtocolConfigs(
  configs: readonly ProviderProtocolConfigInput[]
): ProviderProtocolConfigInput[] {
  if (configs.length === 0) {
    throw new Error("至少需要启用一个协议");
  }

  const seen = new Set<UserFacingProviderType>();
  const normalized: ProviderProtocolConfigInput[] = [];

  for (const config of configs) {
    if (!isUserFacingProtocolType(config.provider_type)) {
      throw new Error(`不支持的多协议类型: ${String(config.provider_type)}`);
    }
    if (seen.has(config.provider_type)) {
      throw new Error(`协议类型重复: ${config.provider_type}`);
    }
    seen.add(config.provider_type);
    normalized.push({
      ...config,
      adopt_provider_ids: config.adopt_provider_ids
        ? Array.from(
            new Set(config.adopt_provider_ids.filter((id) => Number.isInteger(id) && id > 0))
          )
        : undefined,
    });
  }

  return normalized.toSorted(
    (left, right) =>
      (PROTOCOL_DISPLAY_ORDER[left.provider_type] ?? 99) -
      (PROTOCOL_DISPLAY_ORDER[right.provider_type] ?? 99)
  );
}

export function extractNormalizedUrlOrigin(rawUrl?: string | null): string | null {
  const trimmed = rawUrl?.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch {
    return null;
  }
}

export interface AdoptableProtocolCandidate {
  channelId: string;
  primaryProvider: ProviderDisplay;
  providers: ProviderDisplay[];
  providerIds: number[];
  providerType: UserFacingProviderType;
  allowedModelsCount: number;
  modelRedirectsCount: number;
  keyCount: number;
}

/**
 * 查找同站点下可直接并入当前逻辑渠道的独立单协议渠道候选。
 *
 * 边界保障：
 * - 排除当前编辑渠道本身已包含的记录；
 * - 排除已经归属其他多协议组的记录（protocolGroupId 非空），防止误拆其他多协议渠道；
 * - 仅匹配目标 providerType 且同 vendor 或同 URL origin 的独立渠道。
 */
export function findAdoptableProtocolCandidates(
  allProviders: readonly ProviderDisplay[],
  context: {
    targetProtocol: UserFacingProviderType;
    excludeProviderIds?: readonly number[];
    currentProtocolGroupId?: string | null;
    providerVendorId?: number | null;
    url?: string | null;
  }
): AdoptableProtocolCandidate[] {
  const excludedIds = new Set(context.excludeProviderIds ?? []);
  const targetOrigin = extractNormalizedUrlOrigin(context.url);
  const targetVendorId =
    context.providerVendorId && context.providerVendorId > 0 ? context.providerVendorId : null;

  if (!targetVendorId && !targetOrigin) {
    return [];
  }

  const eligible = allProviders.filter((candidate) => {
    if (excludedIds.has(candidate.id)) return false;
    if (candidate.providerType !== context.targetProtocol) return false;
    // 已经归属任意多协议组的记录不作为独立渠道候选，避免误拆其他逻辑渠道
    if (candidate.protocolGroupId) return false;
    if (
      context.currentProtocolGroupId &&
      candidate.protocolGroupId === context.currentProtocolGroupId
    ) {
      return false;
    }

    const sameVendor =
      targetVendorId !== null &&
      candidate.providerVendorId !== null &&
      candidate.providerVendorId === targetVendorId;
    const sameOrigin =
      targetOrigin !== null && extractNormalizedUrlOrigin(candidate.url) === targetOrigin;

    return sameVendor || sameOrigin;
  });

  return groupProvidersByChannel(eligible).map(({ channelId, providers }) => {
    const sorted = providers.toSorted((left, right) => left.id - right.id);
    const primary = sorted[0];
    const allowedModels = normalizeAllowedModelRules(primary.allowedModels) ?? [];
    const modelRedirects = normalizeProviderModelRedirectRules(primary.modelRedirects) ?? [];
    return {
      channelId,
      primaryProvider: primary,
      providers: sorted,
      providerIds: sorted.map((item) => item.id),
      providerType: context.targetProtocol,
      allowedModelsCount: allowedModels.length,
      modelRedirectsCount: modelRedirects.length,
      keyCount: sorted.length,
    };
  });
}
