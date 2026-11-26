import { describe, expect, test } from "vitest";
import {
  createInitialState,
  providerFormReducer,
} from "@/app/[locale]/settings/providers/_components/forms/provider-form/provider-form-context";
import { buildProviderKeyGroupIds } from "@/lib/provider-key-groups";
import {
  extractProtocolSpecificUpdate,
  findAdoptableProtocolCandidates,
  getChannelProtocolTypes,
  isMultiProtocolChannel,
  isUserFacingProtocolType,
  normalizeProtocolConfigs,
  sortProtocolsByDisplayOrder,
  stripProtocolSpecificFields,
} from "@/lib/provider-protocol-bundle";
import {
  extractProtocolGroupIdFromScope,
  getProviderQuotaScopeId,
  isValidProviderQuotaScopeId,
} from "@/lib/provider-quota-scope";
import { groupProvidersByChannel } from "@/lib/provider-vendor-groups";
import { PROVIDER_PROTOCOL_CONFIGS_SCHEMA } from "@/lib/validation/provider-protocol-configs";
import type { ProviderDisplay } from "@/types/provider";

function makeProvider(overrides: Partial<ProviderDisplay> = {}): ProviderDisplay {
  return {
    id: 1,
    name: "AnyRouter",
    url: "https://anyrouter.top",
    maskedKey: "sk-****1234",
    isEnabled: true,
    weight: 1,
    priority: 0,
    groupPriorities: null,
    costMultiplier: 1,
    groupTag: null,
    providerType: "claude",
    providerVendorId: 10,
    protocolGroupId: null,
    preserveClientIp: false,
    disableSessionReuse: false,
    modelRedirects: null,
    activeTimeStart: null,
    activeTimeEnd: null,
    allowedModels: null,
    allowedClients: [],
    blockedClients: [],
    mcpPassthroughType: "none",
    mcpPassthroughUrl: null,
    limit5hUsd: null,
    limit5hResetMode: "rolling",
    limitDailyUsd: null,
    dailyResetMode: "fixed",
    dailyResetTime: "00:00",
    limitWeeklyUsd: null,
    limitMonthlyUsd: null,
    limitTotalUsd: null,
    totalCostResetAt: null,
    limitConcurrentSessions: 0,
    maxRetryAttempts: null,
    circuitBreakerFailureThreshold: 5,
    circuitBreakerOpenDuration: 1800000,
    circuitBreakerHalfOpenSuccessThreshold: 2,
    proxyUrl: null,
    proxyFallbackToDirect: false,
    customHeaders: null,
    firstByteTimeoutStreamingMs: 0,
    streamingIdleTimeoutMs: 0,
    requestTimeoutNonStreamingMs: 0,
    websiteUrl: "https://anyrouter.top",
    faviconUrl: null,
    cacheTtlPreference: "inherit",
    swapCacheTtlBilling: false,
    context1mPreference: "inherit",
    codexReasoningEffortPreference: "inherit",
    codexReasoningSummaryPreference: "inherit",
    codexTextVerbosityPreference: "inherit",
    codexParallelToolCallsPreference: "inherit",
    codexImageGenerationPreference: "inherit",
    codexServiceTierPreference: "inherit",
    anthropicMaxTokensPreference: "inherit",
    anthropicThinkingBudgetPreference: "inherit",
    anthropicAdaptiveThinking: null,
    geminiGoogleSearchPreference: "inherit",
    todayTotalCostUsd: "0",
    todayCallCount: 0,
    lastCallTime: null,
    lastCallModel: null,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...overrides,
  };
}

describe("provider-quota-scope", () => {
  test("独立渠道返回 provider.id，多协议渠道返回共享 pg_ 作用域", () => {
    expect(getProviderQuotaScopeId({ id: 7, protocolGroupId: null })).toBe(7);
    expect(getProviderQuotaScopeId({ id: 8, protocolGroupId: "" })).toBe(8);
    expect(getProviderQuotaScopeId({ id: 9, protocolGroupId: "grp-123" })).toBe("pg_grp-123");
    expect(getProviderQuotaScopeId({ id: 10, protocolGroupId: "  grp-123  " })).toBe("pg_grp-123");
  });

  test("正确提取 protocolGroupId 并校验合法作用域 ID", () => {
    expect(extractProtocolGroupIdFromScope("pg_abc-123")).toBe("abc-123");
    expect(extractProtocolGroupIdFromScope("pg_")).toBeNull();
    expect(extractProtocolGroupIdFromScope(42)).toBeNull();
    expect(extractProtocolGroupIdFromScope("other_123")).toBeNull();

    expect(isValidProviderQuotaScopeId(1)).toBe(true);
    expect(isValidProviderQuotaScopeId(0)).toBe(false);
    expect(isValidProviderQuotaScopeId(-1)).toBe(false);
    expect(isValidProviderQuotaScopeId("pg_uuid-1234")).toBe(true);
    expect(isValidProviderQuotaScopeId("pg_invalid space")).toBe(false);
    expect(isValidProviderQuotaScopeId("bad")).toBe(false);
  });
});

describe("provider-protocol-bundle", () => {
  test("协议排序、用户可见协议识别与多协议判定", () => {
    expect(isUserFacingProtocolType("claude")).toBe(true);
    expect(isUserFacingProtocolType("gemini")).toBe(true);
    expect(isUserFacingProtocolType("claude-auth")).toBe(false);
    expect(sortProtocolsByDisplayOrder(["gemini", "claude", "codex", "claude"])).toEqual([
      "claude",
      "codex",
      "gemini",
    ]);

    const grouped = [
      makeProvider({ id: 1, providerType: "gemini", protocolGroupId: "g1" }),
      makeProvider({ id: 2, providerType: "claude", protocolGroupId: "g1" }),
    ];
    expect(getChannelProtocolTypes(grouped)).toEqual(["claude", "gemini"]);
    expect(isMultiProtocolChannel(grouped)).toBe(true);
    expect(isMultiProtocolChannel([makeProvider({ id: 3, providerType: "claude" })])).toBe(false);
  });

  test("stripProtocolSpecificFields 剥离协议专属字段但保留共享字段", () => {
    const stripped = stripProtocolSpecificFields({
      name: "AnyRouter",
      priority: 1,
      limit_daily_usd: 20,
      allowed_models: [{ matchType: "exact", pattern: "claude-sonnet-4-5" }],
      model_redirects: [{ matchType: "exact", source: "a", target: "b" }],
      anthropic_max_tokens_preference: "8192",
      codex_reasoning_effort_preference: "high",
      gemini_google_search_preference: "enabled",
    });

    expect(stripped).toEqual({
      name: "AnyRouter",
      priority: 1,
      limit_daily_usd: 20,
    });
  });

  test("extractProtocolSpecificUpdate 按目标协议隔离专属覆写字段", () => {
    const claudePatch = extractProtocolSpecificUpdate({
      provider_type: "claude",
      allowed_models: [{ matchType: "exact", pattern: "claude-opus-4-6" }],
      anthropic_max_tokens_preference: "16000",
      codex_reasoning_effort_preference: "high",
      gemini_google_search_preference: "enabled",
    });
    expect(claudePatch.allowed_models).toHaveLength(1);
    expect(claudePatch.anthropic_max_tokens_preference).toBe("16000");
    expect(claudePatch.codex_reasoning_effort_preference).toBeUndefined();
    expect(claudePatch.gemini_google_search_preference).toBeUndefined();

    const codexPatch = extractProtocolSpecificUpdate({
      provider_type: "codex",
      codex_reasoning_effort_preference: "high",
      codex_service_tier_preference: "priority",
      anthropic_max_tokens_preference: "8192",
    });
    expect(codexPatch.codex_reasoning_effort_preference).toBe("high");
    expect(codexPatch.codex_service_tier_preference).toBe("priority");
    expect(codexPatch.anthropic_max_tokens_preference).toBeUndefined();

    const geminiPatch = extractProtocolSpecificUpdate({
      provider_type: "gemini",
      gemini_google_search_preference: "enabled",
      codex_reasoning_effort_preference: "high",
    });
    expect(geminiPatch.gemini_google_search_preference).toBe("enabled");
    expect(geminiPatch.codex_reasoning_effort_preference).toBeUndefined();
  });

  test("normalizeProtocolConfigs 校验重复、空列表与协议规范化", () => {
    expect(() => normalizeProtocolConfigs([])).toThrow();
    expect(() =>
      normalizeProtocolConfigs([{ provider_type: "claude" }, { provider_type: "claude" }])
    ).toThrow();

    const normalized = normalizeProtocolConfigs([
      {
        provider_type: "gemini",
        allowed_models: [{ matchType: "exact", pattern: "gemini-4-neon" }],
        adopt_provider_ids: [12, 12, -1],
      },
      {
        provider_type: "claude",
        model_redirects: [{ matchType: "exact", source: "sonnet", target: "claude-sonnet-4-5" }],
      },
    ]);
    expect(normalized.map((item) => item.provider_type)).toEqual(["claude", "gemini"]);
    expect(normalized[1].adopt_provider_ids).toEqual([12]);
  });

  test("PROVIDER_PROTOCOL_CONFIGS_SCHEMA 校验合法与重复协议输入", () => {
    expect(
      PROVIDER_PROTOCOL_CONFIGS_SCHEMA.safeParse([
        { provider_type: "claude" },
        { provider_type: "gemini", gemini_google_search_preference: "enabled" },
      ]).success
    ).toBe(true);

    expect(
      PROVIDER_PROTOCOL_CONFIGS_SCHEMA.safeParse([
        { provider_type: "claude" },
        { provider_type: "claude" },
      ]).success
    ).toBe(false);
  });

  test("findAdoptableProtocolCandidates 仅匹配同站点独立渠道并排除其他多协议组", () => {
    const currentClaude = makeProvider({ id: 1, providerType: "claude", providerVendorId: 10 });
    const standaloneGemini = makeProvider({
      id: 2,
      name: "AnyRouter-Gemini",
      providerType: "gemini",
      providerVendorId: 10,
      allowedModels: [{ matchType: "exact", pattern: "gemini-4-neon" }],
      modelRedirects: [{ matchType: "exact", source: "g4", target: "gemini-4-neon" }],
    });
    const groupedGemini = makeProvider({
      id: 3,
      name: "OtherBundle",
      providerType: "gemini",
      providerVendorId: 10,
      protocolGroupId: "other-group",
    });
    const otherVendorGemini = makeProvider({
      id: 4,
      name: "OtherSite",
      url: "https://other.example.com",
      providerType: "gemini",
      providerVendorId: 99,
    });

    const candidates = findAdoptableProtocolCandidates(
      [currentClaude, standaloneGemini, groupedGemini, otherVendorGemini],
      {
        targetProtocol: "gemini",
        excludeProviderIds: [1],
        providerVendorId: 10,
        url: "https://anyrouter.top",
      }
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].providerIds).toEqual([2]);
    expect(candidates[0].allowedModelsCount).toBe(1);
    expect(candidates[0].modelRedirectsCount).toBe(1);

    // 缺少 vendorId 与 url 时返回空数组
    expect(
      findAdoptableProtocolCandidates([standaloneGemini], { targetProtocol: "gemini" })
    ).toEqual([]);
  });
});

describe("多协议归组与旧独立渠道兼容", () => {
  test("同 protocolGroupId 的不同协议聚合为单行，旧独立渠道保持分离", () => {
    const bundledClaude = makeProvider({
      id: 1,
      providerType: "claude",
      protocolGroupId: "bundle-1",
    });
    const bundledGemini = makeProvider({
      id: 2,
      providerType: "gemini",
      protocolGroupId: "bundle-1",
    });
    const legacyClaude = makeProvider({ id: 3, providerType: "claude", providerVendorId: 20 });
    const legacyGemini = makeProvider({ id: 4, providerType: "gemini", providerVendorId: 20 });

    const groups = groupProvidersByChannel([
      bundledClaude,
      bundledGemini,
      legacyClaude,
      legacyGemini,
    ]);
    expect(groups).toHaveLength(3);
    expect(groups[0].channelId).toBe("bundle:bundle-1");
    expect(groups[0].providers.map((p) => p.id)).toEqual([1, 2]);

    const keyGroupMap = buildProviderKeyGroupIds([
      { ...bundledClaude, key: "sk-shared" },
      { ...bundledGemini, key: "sk-shared" },
    ]);
    expect(keyGroupMap.get(1)).toBe(1);
    expect(keyGroupMap.get(2)).toBe(1);
  });
});

describe("providerFormReducer 多协议状态流转", () => {
  test("勾选多协议时隔离模型规则与协议覆写，支持并入与取消勾选", () => {
    const existingClaude = makeProvider({
      id: 1,
      providerType: "claude",
      allowedModels: [{ matchType: "exact", pattern: "claude-opus-4-6" }],
      anthropicMaxTokensPreference: "16000",
    });
    const adoptableGemini = makeProvider({
      id: 2,
      name: "AnyRouter-Gemini",
      providerType: "gemini",
      allowedModels: [{ matchType: "exact", pattern: "gemini-4-neon" }],
      geminiGoogleSearchPreference: "enabled",
    });

    let state = createInitialState("edit", existingClaude);
    expect(state.routing.selectedProtocols).toEqual(["claude"]);
    expect(state.routing.allowedModels.map((r) => r.pattern)).toEqual(["claude-opus-4-6"]);

    // 勾选 Gemini 协议
    state = providerFormReducer(state, {
      type: "TOGGLE_PROTOCOL",
      payload: { protocol: "gemini" },
    });
    expect(state.routing.selectedProtocols).toEqual(["claude", "gemini"]);
    expect(state.routing.activeProtocol).toBe("gemini");
    expect(state.routing.allowedModels).toEqual([]);

    // 并入已有 Gemini 渠道，自动保留其模型规则与 Google Search 覆写
    state = providerFormReducer(state, {
      type: "SET_ADOPT_PROTOCOL_PROVIDERS",
      payload: { protocol: "gemini", providers: [adoptableGemini] },
    });
    expect(state.routing.allowedModels.map((r) => r.pattern)).toEqual(["gemini-4-neon"]);
    expect(state.routing.geminiGoogleSearchPreference).toBe("enabled");
    expect(state.routing.protocolConfigs.gemini?.adoptProviderIds).toEqual([2]);

    // 切回 Claude，Claude 原有规则与覆写毫发无损
    state = providerFormReducer(state, { type: "SET_ACTIVE_PROTOCOL", payload: "claude" });
    expect(state.routing.allowedModels.map((r) => r.pattern)).toEqual(["claude-opus-4-6"]);
    expect(state.routing.anthropicMaxTokensPreference).toBe("16000");

    // 取消勾选 Gemini
    state = providerFormReducer(state, {
      type: "TOGGLE_PROTOCOL",
      payload: { protocol: "gemini" },
    });
    expect(state.routing.selectedProtocols).toEqual(["claude"]);

    // 仅剩 1 个协议时禁止取消勾选
    const afterAttempt = providerFormReducer(state, {
      type: "TOGGLE_PROTOCOL",
      payload: { protocol: "claude" },
    });
    expect(afterAttempt.routing.selectedProtocols).toEqual(["claude"]);
  });
});
