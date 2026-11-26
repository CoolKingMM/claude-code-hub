import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import {
  type ProviderBatchApplyLedgerResult,
  type ProviderBatchApplyStoredPreimage,
  providerBatchApplyOperations,
  providerEndpoints,
  providers,
} from "@/drizzle/schema";
import { normalizeAllowedModelRules } from "@/lib/allowed-model-rules";
import { getCachedProviders } from "@/lib/cache/provider-cache";
import { PROVIDER_TIMEOUT_DEFAULTS } from "@/lib/constants/provider.constants";
import { resetEndpointCircuit } from "@/lib/endpoint-circuit-breaker";
import { logger } from "@/lib/logger";
import { SENSITIVE_PROVIDER_BATCH_UNDO_KEYS } from "@/lib/provider-batch-patch-error-codes";
import { getSharedProviderUpdate } from "@/lib/provider-channel-update";
import { type ProviderKeyEntry, validateProviderKeys } from "@/lib/provider-key-batch";
import { buildAdditionalProviderData } from "@/lib/provider-key-clone";
import { normalizeProviderModelRedirectRules } from "@/lib/provider-model-redirects";
import {
  extractProtocolSpecificUpdate,
  normalizeProtocolConfigs,
  stripProtocolSpecificFields,
} from "@/lib/provider-protocol-bundle";
import { groupProvidersByChannel } from "@/lib/provider-vendor-groups";
import { parseProviderGroups } from "@/lib/utils/provider-group";
import { resolveSystemTimezone } from "@/lib/utils/timezone";
import type {
  AllowedModelRuleInput,
  AnthropicAdaptiveThinkingConfig,
  CreateProviderData,
  Provider,
  ProviderModelRedirectRule,
  ProviderProtocolConfigInput,
  UpdateProviderData,
} from "@/types/provider";
import { toProvider } from "./_shared/transformers";
import {
  copyProviderEndpointPool,
  ensureProviderEndpointExistsForUrl,
  getOrCreateProviderVendorIdFromUrls,
  syncProviderEndpointOnProviderEdit,
  syncProviderVendorsForGroupChange,
  tryDeleteProviderVendorIfEmpty,
} from "./provider-endpoints";

type ProviderTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const PROVIDER_RESTORE_MAX_AGE_MS = 60_000;
const ENDPOINT_RESTORE_TIME_TOLERANCE_MS = 1_000;

function normalizeProviderRuntimeFields<
  T extends {
    modelRedirects: ProviderModelRedirectRule[] | Record<string, string> | null;
    allowedModels: AllowedModelRuleInput[] | null;
  },
>(
  provider: T
): Omit<T, "modelRedirects" | "allowedModels"> &
  Pick<Provider, "modelRedirects" | "allowedModels"> {
  return {
    ...provider,
    modelRedirects: normalizeProviderModelRedirectRules(provider.modelRedirects),
    allowedModels: normalizeAllowedModelRules(provider.allowedModels),
  };
}

interface ProviderRestoreCandidate {
  id: number;
  providerVendorId: number | null;
  providerType: Provider["providerType"];
  url: string;
  deletedAt: Date | null;
}

async function restoreSoftDeletedEndpointForProvider(
  tx: ProviderTransaction,
  provider: ProviderRestoreCandidate,
  now: Date
): Promise<void> {
  if (provider.providerVendorId == null || !provider.url || !provider.deletedAt) {
    return;
  }

  const trimmedUrl = provider.url.trim();
  if (!trimmedUrl) {
    return;
  }

  const [activeReference] = await tx
    .select({ id: providers.id })
    .from(providers)
    .where(
      and(
        eq(providers.providerVendorId, provider.providerVendorId),
        eq(providers.providerType, provider.providerType),
        eq(providers.url, trimmedUrl),
        eq(providers.isEnabled, true),
        isNull(providers.deletedAt),
        ne(providers.id, provider.id)
      )
    )
    .limit(1);

  if (activeReference) {
    return;
  }

  const [activeEndpoint] = await tx
    .select({ id: providerEndpoints.id })
    .from(providerEndpoints)
    .where(
      and(
        eq(providerEndpoints.vendorId, provider.providerVendorId),
        eq(providerEndpoints.providerType, provider.providerType),
        eq(providerEndpoints.url, trimmedUrl),
        isNull(providerEndpoints.deletedAt)
      )
    )
    .limit(1);

  if (activeEndpoint) {
    return;
  }

  const lowerIso = new Date(
    provider.deletedAt.getTime() - ENDPOINT_RESTORE_TIME_TOLERANCE_MS
  ).toISOString();
  const upperIso = new Date(
    provider.deletedAt.getTime() + ENDPOINT_RESTORE_TIME_TOLERANCE_MS
  ).toISOString();

  const [endpointToRestore] = await tx
    .select({ id: providerEndpoints.id })
    .from(providerEndpoints)
    .where(
      and(
        eq(providerEndpoints.vendorId, provider.providerVendorId),
        eq(providerEndpoints.providerType, provider.providerType),
        eq(providerEndpoints.url, trimmedUrl),
        isNotNull(providerEndpoints.deletedAt),
        sql`${providerEndpoints.deletedAt} >= ${lowerIso}::timestamptz`,
        sql`${providerEndpoints.deletedAt} <= ${upperIso}::timestamptz`
      )
    )
    .orderBy(desc(providerEndpoints.deletedAt), desc(providerEndpoints.id))
    .limit(1);

  if (!endpointToRestore) {
    return;
  }

  await tx
    .update(providerEndpoints)
    .set({
      deletedAt: null,
      isEnabled: true,
      updatedAt: now,
    })
    .where(
      and(eq(providerEndpoints.id, endpointToRestore.id), isNotNull(providerEndpoints.deletedAt))
    );
}

async function restoreProviderInTransaction(
  tx: ProviderTransaction,
  providerId: number,
  now: Date
): Promise<boolean> {
  const [candidate] = await tx
    .select({
      id: providers.id,
      providerVendorId: providers.providerVendorId,
      providerType: providers.providerType,
      url: providers.url,
      deletedAt: providers.deletedAt,
    })
    .from(providers)
    .where(and(eq(providers.id, providerId), isNotNull(providers.deletedAt)))
    .limit(1);

  if (!candidate?.deletedAt) {
    return false;
  }

  if (now.getTime() - candidate.deletedAt.getTime() > PROVIDER_RESTORE_MAX_AGE_MS) {
    return false;
  }

  const restored = await tx
    .update(providers)
    .set({ deletedAt: null, updatedAt: now })
    .where(
      and(
        eq(providers.id, providerId),
        isNotNull(providers.deletedAt),
        eq(providers.deletedAt, candidate.deletedAt)
      )
    )
    .returning({ id: providers.id });

  if (restored.length === 0) {
    return false;
  }

  await restoreSoftDeletedEndpointForProvider(tx, candidate, now);

  return true;
}

type ProviderCreateTransaction = ProviderTransaction;

export async function createProviders(providerData: CreateProviderData[]): Promise<Provider[]> {
  return db.transaction(async (tx) => {
    const created: Provider[] = [];
    for (const data of providerData) {
      created.push(await createProvider(data, { tx }));
    }
    return created;
  });
}

export async function createProvider(
  providerData: CreateProviderData,
  options?: { tx?: ProviderCreateTransaction; providerVendorId?: number | null }
): Promise<Provider> {
  const dbData = {
    name: providerData.name,
    url: providerData.url,
    key: providerData.key,
    newApiAccessToken: providerData.new_api_access_token ?? null,
    newApiUserId: providerData.new_api_user_id ?? null,
    protocolGroupId: providerData.protocol_group_id ?? null,
    isEnabled: providerData.is_enabled,
    weight: providerData.weight,
    priority: providerData.priority,
    groupPriorities: providerData.group_priorities ?? null,
    costMultiplier:
      providerData.cost_multiplier != null ? providerData.cost_multiplier.toString() : "1.0",
    groupTag: providerData.group_tag,
    providerType: providerData.provider_type,
    preserveClientIp: providerData.preserve_client_ip ?? false,
    disableSessionReuse: providerData.disable_session_reuse ?? false,
    modelRedirects: normalizeProviderModelRedirectRules(providerData.model_redirects),
    allowedModels: normalizeAllowedModelRules(providerData.allowed_models),
    allowedClients: providerData.allowed_clients ?? [],
    blockedClients: providerData.blocked_clients ?? [],
    activeTimeStart: providerData.active_time_start ?? null,
    activeTimeEnd: providerData.active_time_end ?? null,
    mcpPassthroughType: providerData.mcp_passthrough_type ?? "none",
    mcpPassthroughUrl: providerData.mcp_passthrough_url ?? null,
    limit5hUsd: providerData.limit_5h_usd != null ? providerData.limit_5h_usd.toString() : null,
    limit5hResetMode: providerData.limit_5h_reset_mode ?? "rolling",
    limitDailyUsd:
      providerData.limit_daily_usd != null ? providerData.limit_daily_usd.toString() : null,
    dailyResetMode: providerData.daily_reset_mode ?? "fixed",
    dailyResetTime: providerData.daily_reset_time ?? "00:00",
    limitWeeklyUsd:
      providerData.limit_weekly_usd != null ? providerData.limit_weekly_usd.toString() : null,
    limitMonthlyUsd:
      providerData.limit_monthly_usd != null ? providerData.limit_monthly_usd.toString() : null,
    limitTotalUsd:
      providerData.limit_total_usd != null ? providerData.limit_total_usd.toString() : null,
    limitConcurrentSessions: providerData.limit_concurrent_sessions,
    maxRetryAttempts: providerData.max_retry_attempts ?? null,
    circuitBreakerFailureThreshold: providerData.circuit_breaker_failure_threshold ?? 5,
    circuitBreakerOpenDuration: providerData.circuit_breaker_open_duration ?? 1800000,
    circuitBreakerHalfOpenSuccessThreshold:
      providerData.circuit_breaker_half_open_success_threshold ?? 2,
    proxyUrl: providerData.proxy_url ?? null,
    proxyFallbackToDirect: providerData.proxy_fallback_to_direct ?? false,
    customHeaders: providerData.custom_headers ?? null,
    firstByteTimeoutStreamingMs:
      providerData.first_byte_timeout_streaming_ms ??
      PROVIDER_TIMEOUT_DEFAULTS.FIRST_BYTE_TIMEOUT_STREAMING_MS,
    streamingIdleTimeoutMs:
      providerData.streaming_idle_timeout_ms ?? PROVIDER_TIMEOUT_DEFAULTS.STREAMING_IDLE_TIMEOUT_MS,
    requestTimeoutNonStreamingMs:
      providerData.request_timeout_non_streaming_ms ??
      PROVIDER_TIMEOUT_DEFAULTS.REQUEST_TIMEOUT_NON_STREAMING_MS,
    websiteUrl: providerData.website_url ?? null,
    faviconUrl: providerData.favicon_url ?? null,
    cacheTtlPreference: providerData.cache_ttl_preference ?? null,
    swapCacheTtlBilling: providerData.swap_cache_ttl_billing ?? false,
    context1mPreference: providerData.context_1m_preference ?? null,
    codexReasoningEffortPreference: providerData.codex_reasoning_effort_preference ?? null,
    codexReasoningSummaryPreference: providerData.codex_reasoning_summary_preference ?? null,
    codexTextVerbosityPreference: providerData.codex_text_verbosity_preference ?? null,
    codexParallelToolCallsPreference: providerData.codex_parallel_tool_calls_preference ?? null,
    codexImageGenerationPreference: providerData.codex_image_generation_preference ?? null,
    codexServiceTierPreference: providerData.codex_service_tier_preference ?? null,
    anthropicMaxTokensPreference: providerData.anthropic_max_tokens_preference ?? null,
    anthropicThinkingBudgetPreference: providerData.anthropic_thinking_budget_preference ?? null,
    anthropicAdaptiveThinking: providerData.anthropic_adaptive_thinking ?? null,
    geminiGoogleSearchPreference: providerData.gemini_google_search_preference ?? null,
    tpm: providerData.tpm,
    rpm: providerData.rpm,
    rpd: providerData.rpd,
    cc: providerData.cc,
  };

  const createInTransaction = async (tx: ProviderCreateTransaction): Promise<Provider> => {
    const providerVendorId =
      options?.providerVendorId ??
      (await getOrCreateProviderVendorIdFromUrls(
        {
          providerUrl: providerData.url,
          websiteUrl: providerData.website_url ?? null,
          faviconUrl: providerData.favicon_url ?? null,
          displayName: providerData.name,
          groupTag: providerData.group_tag,
        },
        { tx }
      ));

    const [provider] = await tx
      .insert(providers)
      .values({
        ...dbData,
        providerVendorId,
      })
      .returning({
        id: providers.id,
        name: providers.name,
        url: providers.url,
        key: providers.key,
        newApiAccessToken: providers.newApiAccessToken,
        newApiUserId: providers.newApiUserId,
        providerVendorId: providers.providerVendorId,
        protocolGroupId: providers.protocolGroupId,
        isEnabled: providers.isEnabled,
        weight: providers.weight,
        priority: providers.priority,
        costMultiplier: providers.costMultiplier,
        groupTag: providers.groupTag,
        providerType: providers.providerType,
        preserveClientIp: providers.preserveClientIp,
        disableSessionReuse: providers.disableSessionReuse,
        modelRedirects: providers.modelRedirects,
        allowedModels: providers.allowedModels,
        allowedClients: providers.allowedClients,
        blockedClients: providers.blockedClients,
        activeTimeStart: providers.activeTimeStart,
        activeTimeEnd: providers.activeTimeEnd,
        mcpPassthroughType: providers.mcpPassthroughType,
        mcpPassthroughUrl: providers.mcpPassthroughUrl,
        limit5hUsd: providers.limit5hUsd,
        limit5hResetMode: providers.limit5hResetMode,
        limitDailyUsd: providers.limitDailyUsd,
        dailyResetMode: providers.dailyResetMode,
        dailyResetTime: providers.dailyResetTime,
        limitWeeklyUsd: providers.limitWeeklyUsd,
        limitMonthlyUsd: providers.limitMonthlyUsd,
        limitTotalUsd: providers.limitTotalUsd,
        totalCostResetAt: providers.totalCostResetAt,
        limitConcurrentSessions: providers.limitConcurrentSessions,
        maxRetryAttempts: providers.maxRetryAttempts,
        circuitBreakerFailureThreshold: providers.circuitBreakerFailureThreshold,
        circuitBreakerOpenDuration: providers.circuitBreakerOpenDuration,
        circuitBreakerHalfOpenSuccessThreshold: providers.circuitBreakerHalfOpenSuccessThreshold,
        proxyUrl: providers.proxyUrl,
        proxyFallbackToDirect: providers.proxyFallbackToDirect,
        customHeaders: providers.customHeaders,
        firstByteTimeoutStreamingMs: providers.firstByteTimeoutStreamingMs,
        streamingIdleTimeoutMs: providers.streamingIdleTimeoutMs,
        requestTimeoutNonStreamingMs: providers.requestTimeoutNonStreamingMs,
        websiteUrl: providers.websiteUrl,
        faviconUrl: providers.faviconUrl,
        cacheTtlPreference: providers.cacheTtlPreference,
        swapCacheTtlBilling: providers.swapCacheTtlBilling,
        context1mPreference: providers.context1mPreference,
        codexReasoningEffortPreference: providers.codexReasoningEffortPreference,
        codexReasoningSummaryPreference: providers.codexReasoningSummaryPreference,
        codexTextVerbosityPreference: providers.codexTextVerbosityPreference,
        codexParallelToolCallsPreference: providers.codexParallelToolCallsPreference,
        codexImageGenerationPreference: providers.codexImageGenerationPreference,
        codexServiceTierPreference: providers.codexServiceTierPreference,
        anthropicMaxTokensPreference: providers.anthropicMaxTokensPreference,
        anthropicThinkingBudgetPreference: providers.anthropicThinkingBudgetPreference,
        anthropicAdaptiveThinking: providers.anthropicAdaptiveThinking,
        geminiGoogleSearchPreference: providers.geminiGoogleSearchPreference,
        tpm: providers.tpm,
        rpm: providers.rpm,
        rpd: providers.rpd,
        cc: providers.cc,
        createdAt: providers.createdAt,
        updatedAt: providers.updatedAt,
        deletedAt: providers.deletedAt,
      });

    const created = normalizeProviderRuntimeFields(toProvider(provider));

    if (created.providerVendorId) {
      await ensureProviderEndpointExistsForUrl(
        {
          vendorId: created.providerVendorId,
          providerType: created.providerType,
          url: created.url,
        },
        { tx }
      );
    }

    return created;
  };
  return options?.tx ? createInTransaction(options.tx) : db.transaction(createInTransaction);
}

export async function findProviderList(
  limit: number = 50,
  offset: number = 0
): Promise<Provider[]> {
  const result = await db
    .select({
      id: providers.id,
      name: providers.name,
      url: providers.url,
      key: providers.key,
      newApiAccessToken: providers.newApiAccessToken,
      newApiUserId: providers.newApiUserId,
      providerVendorId: providers.providerVendorId,
      protocolGroupId: providers.protocolGroupId,
      isEnabled: providers.isEnabled,
      weight: providers.weight,
      priority: providers.priority,
      groupPriorities: providers.groupPriorities,
      costMultiplier: providers.costMultiplier,
      groupTag: providers.groupTag,
      providerType: providers.providerType,
      preserveClientIp: providers.preserveClientIp,
      disableSessionReuse: providers.disableSessionReuse,
      modelRedirects: providers.modelRedirects,
      allowedModels: providers.allowedModels,
      allowedClients: providers.allowedClients,
      blockedClients: providers.blockedClients,
      activeTimeStart: providers.activeTimeStart,
      activeTimeEnd: providers.activeTimeEnd,
      mcpPassthroughType: providers.mcpPassthroughType,
      mcpPassthroughUrl: providers.mcpPassthroughUrl,
      limit5hUsd: providers.limit5hUsd,
      limit5hResetMode: providers.limit5hResetMode,
      limitDailyUsd: providers.limitDailyUsd,
      dailyResetMode: providers.dailyResetMode,
      dailyResetTime: providers.dailyResetTime,
      limitWeeklyUsd: providers.limitWeeklyUsd,
      limitMonthlyUsd: providers.limitMonthlyUsd,
      limitTotalUsd: providers.limitTotalUsd,
      totalCostResetAt: providers.totalCostResetAt,
      limitConcurrentSessions: providers.limitConcurrentSessions,
      maxRetryAttempts: providers.maxRetryAttempts,
      circuitBreakerFailureThreshold: providers.circuitBreakerFailureThreshold,
      circuitBreakerOpenDuration: providers.circuitBreakerOpenDuration,
      circuitBreakerHalfOpenSuccessThreshold: providers.circuitBreakerHalfOpenSuccessThreshold,
      proxyUrl: providers.proxyUrl,
      proxyFallbackToDirect: providers.proxyFallbackToDirect,
      customHeaders: providers.customHeaders,
      firstByteTimeoutStreamingMs: providers.firstByteTimeoutStreamingMs,
      streamingIdleTimeoutMs: providers.streamingIdleTimeoutMs,
      requestTimeoutNonStreamingMs: providers.requestTimeoutNonStreamingMs,
      websiteUrl: providers.websiteUrl,
      faviconUrl: providers.faviconUrl,
      cacheTtlPreference: providers.cacheTtlPreference,
      swapCacheTtlBilling: providers.swapCacheTtlBilling,
      context1mPreference: providers.context1mPreference,
      codexReasoningEffortPreference: providers.codexReasoningEffortPreference,
      codexReasoningSummaryPreference: providers.codexReasoningSummaryPreference,
      codexTextVerbosityPreference: providers.codexTextVerbosityPreference,
      codexParallelToolCallsPreference: providers.codexParallelToolCallsPreference,
      codexImageGenerationPreference: providers.codexImageGenerationPreference,
      codexServiceTierPreference: providers.codexServiceTierPreference,
      anthropicMaxTokensPreference: providers.anthropicMaxTokensPreference,
      anthropicThinkingBudgetPreference: providers.anthropicThinkingBudgetPreference,
      anthropicAdaptiveThinking: providers.anthropicAdaptiveThinking,
      geminiGoogleSearchPreference: providers.geminiGoogleSearchPreference,
      tpm: providers.tpm,
      rpm: providers.rpm,
      rpd: providers.rpd,
      cc: providers.cc,
      createdAt: providers.createdAt,
      updatedAt: providers.updatedAt,
      deletedAt: providers.deletedAt,
    })
    .from(providers)
    .where(isNull(providers.deletedAt))
    .orderBy(desc(providers.createdAt))
    .limit(limit)
    .offset(offset);

  logger.trace("findProviderList:query_result", {
    count: result.length,
    ids: result.map((r) => r.id),
  });

  return result.map((provider) => normalizeProviderRuntimeFields(toProvider(provider)));
}

/**
 * 直接从数据库获取所有供应商（绕过缓存）
 *
 * 用于：
 * - 管理后台需要保证数据新鲜度的场景
 * - 缓存刷新时的数据源
 */
export async function findAllProvidersFresh(): Promise<Provider[]> {
  const result = await db
    .select({
      id: providers.id,
      name: providers.name,
      url: providers.url,
      key: providers.key,
      newApiAccessToken: providers.newApiAccessToken,
      newApiUserId: providers.newApiUserId,
      providerVendorId: providers.providerVendorId,
      protocolGroupId: providers.protocolGroupId,
      isEnabled: providers.isEnabled,
      weight: providers.weight,
      priority: providers.priority,
      groupPriorities: providers.groupPriorities,
      costMultiplier: providers.costMultiplier,
      groupTag: providers.groupTag,
      providerType: providers.providerType,
      preserveClientIp: providers.preserveClientIp,
      disableSessionReuse: providers.disableSessionReuse,
      modelRedirects: providers.modelRedirects,
      allowedModels: providers.allowedModels,
      allowedClients: providers.allowedClients,
      blockedClients: providers.blockedClients,
      activeTimeStart: providers.activeTimeStart,
      activeTimeEnd: providers.activeTimeEnd,
      mcpPassthroughType: providers.mcpPassthroughType,
      mcpPassthroughUrl: providers.mcpPassthroughUrl,
      limit5hUsd: providers.limit5hUsd,
      limit5hResetMode: providers.limit5hResetMode,
      limitDailyUsd: providers.limitDailyUsd,
      dailyResetMode: providers.dailyResetMode,
      dailyResetTime: providers.dailyResetTime,
      limitWeeklyUsd: providers.limitWeeklyUsd,
      limitMonthlyUsd: providers.limitMonthlyUsd,
      limitTotalUsd: providers.limitTotalUsd,
      totalCostResetAt: providers.totalCostResetAt,
      limitConcurrentSessions: providers.limitConcurrentSessions,
      maxRetryAttempts: providers.maxRetryAttempts,
      circuitBreakerFailureThreshold: providers.circuitBreakerFailureThreshold,
      circuitBreakerOpenDuration: providers.circuitBreakerOpenDuration,
      circuitBreakerHalfOpenSuccessThreshold: providers.circuitBreakerHalfOpenSuccessThreshold,
      proxyUrl: providers.proxyUrl,
      proxyFallbackToDirect: providers.proxyFallbackToDirect,
      customHeaders: providers.customHeaders,
      firstByteTimeoutStreamingMs: providers.firstByteTimeoutStreamingMs,
      streamingIdleTimeoutMs: providers.streamingIdleTimeoutMs,
      requestTimeoutNonStreamingMs: providers.requestTimeoutNonStreamingMs,
      websiteUrl: providers.websiteUrl,
      faviconUrl: providers.faviconUrl,
      cacheTtlPreference: providers.cacheTtlPreference,
      swapCacheTtlBilling: providers.swapCacheTtlBilling,
      context1mPreference: providers.context1mPreference,
      codexReasoningEffortPreference: providers.codexReasoningEffortPreference,
      codexReasoningSummaryPreference: providers.codexReasoningSummaryPreference,
      codexTextVerbosityPreference: providers.codexTextVerbosityPreference,
      codexParallelToolCallsPreference: providers.codexParallelToolCallsPreference,
      codexImageGenerationPreference: providers.codexImageGenerationPreference,
      codexServiceTierPreference: providers.codexServiceTierPreference,
      anthropicMaxTokensPreference: providers.anthropicMaxTokensPreference,
      anthropicThinkingBudgetPreference: providers.anthropicThinkingBudgetPreference,
      anthropicAdaptiveThinking: providers.anthropicAdaptiveThinking,
      geminiGoogleSearchPreference: providers.geminiGoogleSearchPreference,
      tpm: providers.tpm,
      rpm: providers.rpm,
      rpd: providers.rpd,
      cc: providers.cc,
      createdAt: providers.createdAt,
      updatedAt: providers.updatedAt,
      deletedAt: providers.deletedAt,
    })
    .from(providers)
    .where(isNull(providers.deletedAt))
    .orderBy(desc(providers.createdAt));

  logger.trace("findAllProvidersFresh:query_result", {
    count: result.length,
    ids: result.map((r) => r.id),
  });

  return result.map(toProvider);
}

/**
 * 获取所有供应商（带缓存）
 *
 * 使用进程级缓存：
 * - 30s TTL 自动过期
 * - Redis Pub/Sub 跨实例即时失效
 *
 * 用于高频读取场景（如供应商选择）
 */
export async function findAllProviders(): Promise<Provider[]> {
  return getCachedProviders(findAllProvidersFresh);
}

export async function findProviderById(id: number): Promise<Provider | null> {
  const [provider] = await db
    .select({
      id: providers.id,
      name: providers.name,
      url: providers.url,
      key: providers.key,
      newApiAccessToken: providers.newApiAccessToken,
      newApiUserId: providers.newApiUserId,
      providerVendorId: providers.providerVendorId,
      protocolGroupId: providers.protocolGroupId,
      isEnabled: providers.isEnabled,
      weight: providers.weight,
      priority: providers.priority,
      groupPriorities: providers.groupPriorities,
      costMultiplier: providers.costMultiplier,
      groupTag: providers.groupTag,
      providerType: providers.providerType,
      preserveClientIp: providers.preserveClientIp,
      disableSessionReuse: providers.disableSessionReuse,
      modelRedirects: providers.modelRedirects,
      allowedModels: providers.allowedModels,
      allowedClients: providers.allowedClients,
      blockedClients: providers.blockedClients,
      activeTimeStart: providers.activeTimeStart,
      activeTimeEnd: providers.activeTimeEnd,
      mcpPassthroughType: providers.mcpPassthroughType,
      mcpPassthroughUrl: providers.mcpPassthroughUrl,
      limit5hUsd: providers.limit5hUsd,
      limit5hResetMode: providers.limit5hResetMode,
      limitDailyUsd: providers.limitDailyUsd,
      dailyResetMode: providers.dailyResetMode,
      dailyResetTime: providers.dailyResetTime,
      limitWeeklyUsd: providers.limitWeeklyUsd,
      limitMonthlyUsd: providers.limitMonthlyUsd,
      limitTotalUsd: providers.limitTotalUsd,
      totalCostResetAt: providers.totalCostResetAt,
      limitConcurrentSessions: providers.limitConcurrentSessions,
      maxRetryAttempts: providers.maxRetryAttempts,
      circuitBreakerFailureThreshold: providers.circuitBreakerFailureThreshold,
      circuitBreakerOpenDuration: providers.circuitBreakerOpenDuration,
      circuitBreakerHalfOpenSuccessThreshold: providers.circuitBreakerHalfOpenSuccessThreshold,
      proxyUrl: providers.proxyUrl,
      proxyFallbackToDirect: providers.proxyFallbackToDirect,
      customHeaders: providers.customHeaders,
      firstByteTimeoutStreamingMs: providers.firstByteTimeoutStreamingMs,
      streamingIdleTimeoutMs: providers.streamingIdleTimeoutMs,
      requestTimeoutNonStreamingMs: providers.requestTimeoutNonStreamingMs,
      websiteUrl: providers.websiteUrl,
      faviconUrl: providers.faviconUrl,
      cacheTtlPreference: providers.cacheTtlPreference,
      swapCacheTtlBilling: providers.swapCacheTtlBilling,
      context1mPreference: providers.context1mPreference,
      codexReasoningEffortPreference: providers.codexReasoningEffortPreference,
      codexReasoningSummaryPreference: providers.codexReasoningSummaryPreference,
      codexTextVerbosityPreference: providers.codexTextVerbosityPreference,
      codexParallelToolCallsPreference: providers.codexParallelToolCallsPreference,
      codexImageGenerationPreference: providers.codexImageGenerationPreference,
      codexServiceTierPreference: providers.codexServiceTierPreference,
      anthropicMaxTokensPreference: providers.anthropicMaxTokensPreference,
      anthropicThinkingBudgetPreference: providers.anthropicThinkingBudgetPreference,
      anthropicAdaptiveThinking: providers.anthropicAdaptiveThinking,
      geminiGoogleSearchPreference: providers.geminiGoogleSearchPreference,
      tpm: providers.tpm,
      rpm: providers.rpm,
      rpd: providers.rpd,
      cc: providers.cc,
      createdAt: providers.createdAt,
      updatedAt: providers.updatedAt,
      deletedAt: providers.deletedAt,
    })
    .from(providers)
    .where(and(eq(providers.id, id), isNull(providers.deletedAt)));

  if (!provider) return null;
  return normalizeProviderRuntimeFields(toProvider(provider));
}

export async function updateProvider(
  id: number,
  providerData: UpdateProviderData,
  options?: { tx: ProviderTransaction; afterCommit: Array<() => Promise<void>> }
): Promise<Provider | null> {
  if (Object.keys(providerData).length === 0 && !options?.tx) {
    return findProviderById(id);
  }

  const dbData: Partial<typeof providers.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (providerData.name !== undefined) dbData.name = providerData.name;
  if (providerData.url !== undefined) dbData.url = providerData.url;
  if (providerData.key !== undefined) dbData.key = providerData.key;
  if (providerData.new_api_access_token !== undefined)
    dbData.newApiAccessToken = providerData.new_api_access_token;
  if (providerData.new_api_user_id !== undefined)
    dbData.newApiUserId = providerData.new_api_user_id;
  if (providerData.protocol_group_id !== undefined)
    dbData.protocolGroupId = providerData.protocol_group_id;
  if (providerData.is_enabled !== undefined) dbData.isEnabled = providerData.is_enabled;
  if (providerData.weight !== undefined) dbData.weight = providerData.weight;
  if (providerData.priority !== undefined) dbData.priority = providerData.priority;
  if (providerData.group_priorities !== undefined)
    dbData.groupPriorities = providerData.group_priorities ?? null;
  if (providerData.cost_multiplier !== undefined)
    dbData.costMultiplier =
      providerData.cost_multiplier != null ? providerData.cost_multiplier.toString() : "1.0";
  if (providerData.group_tag !== undefined) dbData.groupTag = providerData.group_tag;
  if (providerData.provider_type !== undefined) dbData.providerType = providerData.provider_type;
  if (providerData.preserve_client_ip !== undefined)
    dbData.preserveClientIp = providerData.preserve_client_ip;
  if (providerData.disable_session_reuse !== undefined)
    dbData.disableSessionReuse = providerData.disable_session_reuse;
  if (providerData.model_redirects !== undefined)
    dbData.modelRedirects = normalizeProviderModelRedirectRules(providerData.model_redirects);
  if (providerData.allowed_models !== undefined)
    dbData.allowedModels = normalizeAllowedModelRules(providerData.allowed_models);
  if (providerData.allowed_clients !== undefined)
    dbData.allowedClients = providerData.allowed_clients ?? [];
  if (providerData.blocked_clients !== undefined)
    dbData.blockedClients = providerData.blocked_clients ?? [];
  if (providerData.active_time_start !== undefined)
    dbData.activeTimeStart = providerData.active_time_start ?? null;
  if (providerData.active_time_end !== undefined)
    dbData.activeTimeEnd = providerData.active_time_end ?? null;
  if (providerData.mcp_passthrough_type !== undefined)
    dbData.mcpPassthroughType = providerData.mcp_passthrough_type;
  if (providerData.mcp_passthrough_url !== undefined)
    dbData.mcpPassthroughUrl = providerData.mcp_passthrough_url;
  if (providerData.limit_5h_usd !== undefined)
    dbData.limit5hUsd =
      providerData.limit_5h_usd != null ? providerData.limit_5h_usd.toString() : null;
  if (providerData.limit_5h_reset_mode !== undefined)
    dbData.limit5hResetMode = providerData.limit_5h_reset_mode;
  if (providerData.limit_daily_usd !== undefined)
    dbData.limitDailyUsd =
      providerData.limit_daily_usd != null ? providerData.limit_daily_usd.toString() : null;
  if (providerData.daily_reset_mode !== undefined)
    dbData.dailyResetMode = providerData.daily_reset_mode;
  if (providerData.daily_reset_time !== undefined)
    dbData.dailyResetTime = providerData.daily_reset_time;
  if (providerData.limit_weekly_usd !== undefined)
    dbData.limitWeeklyUsd =
      providerData.limit_weekly_usd != null ? providerData.limit_weekly_usd.toString() : null;
  if (providerData.limit_monthly_usd !== undefined)
    dbData.limitMonthlyUsd =
      providerData.limit_monthly_usd != null ? providerData.limit_monthly_usd.toString() : null;
  if (providerData.limit_total_usd !== undefined)
    dbData.limitTotalUsd =
      providerData.limit_total_usd != null ? providerData.limit_total_usd.toString() : null;
  if (providerData.limit_concurrent_sessions !== undefined)
    dbData.limitConcurrentSessions = providerData.limit_concurrent_sessions;
  if (providerData.max_retry_attempts !== undefined)
    dbData.maxRetryAttempts = providerData.max_retry_attempts;
  if (providerData.circuit_breaker_failure_threshold !== undefined)
    dbData.circuitBreakerFailureThreshold = providerData.circuit_breaker_failure_threshold;
  if (providerData.circuit_breaker_open_duration !== undefined)
    dbData.circuitBreakerOpenDuration = providerData.circuit_breaker_open_duration;
  if (providerData.circuit_breaker_half_open_success_threshold !== undefined)
    dbData.circuitBreakerHalfOpenSuccessThreshold =
      providerData.circuit_breaker_half_open_success_threshold;
  if (providerData.proxy_url !== undefined) dbData.proxyUrl = providerData.proxy_url;
  if (providerData.proxy_fallback_to_direct !== undefined)
    dbData.proxyFallbackToDirect = providerData.proxy_fallback_to_direct;
  if (providerData.custom_headers !== undefined)
    dbData.customHeaders = providerData.custom_headers ?? null;
  if (providerData.first_byte_timeout_streaming_ms !== undefined)
    dbData.firstByteTimeoutStreamingMs = providerData.first_byte_timeout_streaming_ms;
  if (providerData.streaming_idle_timeout_ms !== undefined)
    dbData.streamingIdleTimeoutMs = providerData.streaming_idle_timeout_ms;
  if (providerData.request_timeout_non_streaming_ms !== undefined)
    dbData.requestTimeoutNonStreamingMs = providerData.request_timeout_non_streaming_ms;
  if (providerData.website_url !== undefined) dbData.websiteUrl = providerData.website_url;
  if (providerData.favicon_url !== undefined) dbData.faviconUrl = providerData.favicon_url;
  if (providerData.cache_ttl_preference !== undefined)
    dbData.cacheTtlPreference = providerData.cache_ttl_preference ?? null;
  if (providerData.swap_cache_ttl_billing !== undefined)
    dbData.swapCacheTtlBilling = providerData.swap_cache_ttl_billing;
  if (providerData.context_1m_preference !== undefined)
    dbData.context1mPreference = providerData.context_1m_preference ?? null;
  if (providerData.codex_reasoning_effort_preference !== undefined)
    dbData.codexReasoningEffortPreference = providerData.codex_reasoning_effort_preference ?? null;
  if (providerData.codex_reasoning_summary_preference !== undefined)
    dbData.codexReasoningSummaryPreference =
      providerData.codex_reasoning_summary_preference ?? null;
  if (providerData.codex_text_verbosity_preference !== undefined)
    dbData.codexTextVerbosityPreference = providerData.codex_text_verbosity_preference ?? null;
  if (providerData.codex_parallel_tool_calls_preference !== undefined)
    dbData.codexParallelToolCallsPreference =
      providerData.codex_parallel_tool_calls_preference ?? null;
  if (providerData.codex_image_generation_preference !== undefined)
    dbData.codexImageGenerationPreference = providerData.codex_image_generation_preference ?? null;
  if (providerData.codex_service_tier_preference !== undefined)
    dbData.codexServiceTierPreference = providerData.codex_service_tier_preference ?? null;
  if (providerData.anthropic_max_tokens_preference !== undefined)
    dbData.anthropicMaxTokensPreference = providerData.anthropic_max_tokens_preference ?? null;
  if (providerData.anthropic_thinking_budget_preference !== undefined)
    dbData.anthropicThinkingBudgetPreference =
      providerData.anthropic_thinking_budget_preference ?? null;
  if (providerData.anthropic_adaptive_thinking !== undefined)
    dbData.anthropicAdaptiveThinking = providerData.anthropic_adaptive_thinking ?? null;
  if (providerData.gemini_google_search_preference !== undefined)
    dbData.geminiGoogleSearchPreference = providerData.gemini_google_search_preference ?? null;
  if (providerData.tpm !== undefined) dbData.tpm = providerData.tpm;
  if (providerData.rpm !== undefined) dbData.rpm = providerData.rpm;
  if (providerData.rpd !== undefined) dbData.rpd = providerData.rpd;
  if (providerData.cc !== undefined) dbData.cc = providerData.cc;

  const shouldRefreshVendor =
    providerData.url !== undefined ||
    providerData.website_url !== undefined ||
    providerData.group_tag !== undefined;
  const shouldSyncEndpoint =
    shouldRefreshVendor ||
    providerData.provider_type !== undefined ||
    providerData.is_enabled === true;

  const updateInTransaction = async (tx: ProviderTransaction) => {
    let previousVendorId: number | null = null;
    let previousUrl: string | null = null;
    let previousProviderType: Provider["providerType"] | null = null;
    let previousIsEnabled: boolean | null = null;
    let endpointCircuitResetId: number | null = null;

    if (shouldSyncEndpoint) {
      const [current] = await tx
        .select({
          url: providers.url,
          websiteUrl: providers.websiteUrl,
          faviconUrl: providers.faviconUrl,
          name: providers.name,
          providerVendorId: providers.providerVendorId,
          providerType: providers.providerType,
          isEnabled: providers.isEnabled,
          groupTag: providers.groupTag,
        })
        .from(providers)
        .where(and(eq(providers.id, id), isNull(providers.deletedAt)))
        .limit(1);

      if (current) {
        previousVendorId = current.providerVendorId;
        previousUrl = current.url;
        previousProviderType = current.providerType;
        previousIsEnabled = current.isEnabled;

        if (shouldRefreshVendor) {
          const providerVendorId = await getOrCreateProviderVendorIdFromUrls(
            {
              providerUrl: providerData.url ?? current.url,
              websiteUrl: providerData.website_url ?? current.websiteUrl,
              faviconUrl: providerData.favicon_url ?? current.faviconUrl,
              displayName: providerData.name ?? current.name,
              groupTag:
                providerData.group_tag !== undefined ? providerData.group_tag : current.groupTag,
            },
            { tx }
          );
          dbData.providerVendorId = providerVendorId;
          if (
            providerData.group_tag !== undefined &&
            current.providerVendorId &&
            (providerData.url ?? current.url) === current.url &&
            (providerData.website_url ?? current.websiteUrl) === current.websiteUrl &&
            (providerData.provider_type ?? current.providerType) === current.providerType
          ) {
            await copyProviderEndpointPool(
              current.providerVendorId,
              providerVendorId,
              providerData.provider_type ?? current.providerType,
              tx
            );
          }
        }
      }
    }

    const [provider] = await tx
      .update(providers)
      .set(dbData)
      .where(and(eq(providers.id, id), isNull(providers.deletedAt)))
      .returning({
        id: providers.id,
        name: providers.name,
        url: providers.url,
        key: providers.key,
        newApiAccessToken: providers.newApiAccessToken,
        newApiUserId: providers.newApiUserId,
        providerVendorId: providers.providerVendorId,
        protocolGroupId: providers.protocolGroupId,
        isEnabled: providers.isEnabled,
        weight: providers.weight,
        priority: providers.priority,
        groupPriorities: providers.groupPriorities,
        costMultiplier: providers.costMultiplier,
        groupTag: providers.groupTag,
        providerType: providers.providerType,
        preserveClientIp: providers.preserveClientIp,
        disableSessionReuse: providers.disableSessionReuse,
        modelRedirects: providers.modelRedirects,
        allowedModels: providers.allowedModels,
        allowedClients: providers.allowedClients,
        blockedClients: providers.blockedClients,
        activeTimeStart: providers.activeTimeStart,
        activeTimeEnd: providers.activeTimeEnd,
        mcpPassthroughType: providers.mcpPassthroughType,
        mcpPassthroughUrl: providers.mcpPassthroughUrl,
        limit5hUsd: providers.limit5hUsd,
        limit5hResetMode: providers.limit5hResetMode,
        limitDailyUsd: providers.limitDailyUsd,
        dailyResetMode: providers.dailyResetMode,
        dailyResetTime: providers.dailyResetTime,
        limitWeeklyUsd: providers.limitWeeklyUsd,
        limitMonthlyUsd: providers.limitMonthlyUsd,
        limitTotalUsd: providers.limitTotalUsd,
        totalCostResetAt: providers.totalCostResetAt,
        limitConcurrentSessions: providers.limitConcurrentSessions,
        maxRetryAttempts: providers.maxRetryAttempts,
        circuitBreakerFailureThreshold: providers.circuitBreakerFailureThreshold,
        circuitBreakerOpenDuration: providers.circuitBreakerOpenDuration,
        circuitBreakerHalfOpenSuccessThreshold: providers.circuitBreakerHalfOpenSuccessThreshold,
        proxyUrl: providers.proxyUrl,
        proxyFallbackToDirect: providers.proxyFallbackToDirect,
        customHeaders: providers.customHeaders,
        firstByteTimeoutStreamingMs: providers.firstByteTimeoutStreamingMs,
        streamingIdleTimeoutMs: providers.streamingIdleTimeoutMs,
        requestTimeoutNonStreamingMs: providers.requestTimeoutNonStreamingMs,
        websiteUrl: providers.websiteUrl,
        faviconUrl: providers.faviconUrl,
        cacheTtlPreference: providers.cacheTtlPreference,
        swapCacheTtlBilling: providers.swapCacheTtlBilling,
        context1mPreference: providers.context1mPreference,
        codexReasoningEffortPreference: providers.codexReasoningEffortPreference,
        codexReasoningSummaryPreference: providers.codexReasoningSummaryPreference,
        codexTextVerbosityPreference: providers.codexTextVerbosityPreference,
        codexParallelToolCallsPreference: providers.codexParallelToolCallsPreference,
        codexImageGenerationPreference: providers.codexImageGenerationPreference,
        codexServiceTierPreference: providers.codexServiceTierPreference,
        anthropicMaxTokensPreference: providers.anthropicMaxTokensPreference,
        anthropicThinkingBudgetPreference: providers.anthropicThinkingBudgetPreference,
        anthropicAdaptiveThinking: providers.anthropicAdaptiveThinking,
        geminiGoogleSearchPreference: providers.geminiGoogleSearchPreference,
        tpm: providers.tpm,
        rpm: providers.rpm,
        rpd: providers.rpd,
        cc: providers.cc,
        createdAt: providers.createdAt,
        updatedAt: providers.updatedAt,
        deletedAt: providers.deletedAt,
      });

    if (!provider) return null;
    const transformed = normalizeProviderRuntimeFields(toProvider(provider));

    if (shouldSyncEndpoint && transformed.providerVendorId) {
      // 注意：即使 provider 当前处于禁用态，只要 vendor/type/url 发生变化也同步 endpoint pool：
      // - 避免旧 URL 残留为 orphan endpoints（#781）
      // - 保证后续启用/其它同 vendor/type 的 provider 能直接复用端点池
      if (
        previousUrl &&
        previousProviderType &&
        (previousUrl !== transformed.url ||
          previousProviderType !== transformed.providerType ||
          (previousVendorId != null && previousVendorId !== transformed.providerVendorId))
      ) {
        const syncResult = await syncProviderEndpointOnProviderEdit(
          {
            providerId: transformed.id,
            vendorId: transformed.providerVendorId,
            providerType: transformed.providerType,
            previousVendorId,
            previousProviderType,
            previousUrl,
            nextUrl: transformed.url,
            keepPreviousWhenReferenced: true,
          },
          { tx }
        );

        endpointCircuitResetId = syncResult.resetCircuitEndpointId ?? null;
      } else if (previousIsEnabled === false && transformed.isEnabled === true) {
        await ensureProviderEndpointExistsForUrl(
          {
            vendorId: transformed.providerVendorId,
            providerType: transformed.providerType,
            url: transformed.url,
          },
          { tx }
        );
      }
    }

    return {
      provider: transformed,
      previousVendorIdToCleanup:
        previousVendorId && transformed.providerVendorId !== previousVendorId
          ? previousVendorId
          : null,
      endpointCircuitResetId,
    };
  };
  const updateResult = options?.tx
    ? await updateInTransaction(options.tx)
    : await db.transaction(updateInTransaction);

  if (!updateResult) {
    return null;
  }

  const afterCommit = async () => {
    if (updateResult.endpointCircuitResetId != null) {
      try {
        await resetEndpointCircuit(updateResult.endpointCircuitResetId);
      } catch (error) {
        logger.warn("updateProvider:reset_endpoint_circuit_failed", {
          providerId: updateResult.provider.id,
          endpointId: updateResult.endpointCircuitResetId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (updateResult.previousVendorIdToCleanup) {
      try {
        await tryDeleteProviderVendorIfEmpty(updateResult.previousVendorIdToCleanup);
      } catch (error) {
        logger.warn("updateProvider:vendor_cleanup_failed", {
          providerId: updateResult.provider.id,
          previousVendorId: updateResult.previousVendorIdToCleanup,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };
  if (options) options.afterCommit.push(afterCommit);
  else await afterCommit();

  return updateResult.provider;
}

export class ProviderKeyAppendError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ProviderKeyAppendError";
  }
}

export class ProviderChannelEditError extends Error {
  constructor() {
    super("provider.channel_changed");
    this.name = "ProviderChannelEditError";
  }
}

export async function updateProviderWithKeys(
  id: number,
  data: UpdateProviderData,
  entries: ProviderKeyEntry[]
): Promise<{ provider: Provider; addedProviders: Provider[] } | null> {
  const afterCommit: Array<() => Promise<void>> = [];
  const result = await db.transaction(async (tx) => {
    const provider = await updateProvider(id, data, { tx, afterCommit });
    if (!provider) return null;
    const keyError = validateProviderKeys([
      { key: provider.key, is_enabled: provider.isEnabled },
      ...entries,
    ]);
    if (keyError) throw new ProviderKeyAppendError(keyError);
    const addedProviders: Provider[] = [];
    for (const input of buildAdditionalProviderData(provider, entries)) {
      addedProviders.push(
        await createProvider(input, { tx, providerVendorId: provider.providerVendorId })
      );
    }
    return { provider, addedProviders };
  });
  for (const callback of afterCommit) await callback();
  return result;
}

/** Save one channel's common settings and optional new keys atomically. */
export async function updateProviderChannel(
  id: number,
  providerIds: number[],
  data: UpdateProviderData,
  entries: ProviderKeyEntry[] = []
): Promise<{
  provider: Provider;
  updatedProviders: Provider[];
  previousProviders: Provider[];
  addedProviders: Provider[];
}> {
  const afterCommit: Array<() => Promise<void>> = [];
  const result = await db.transaction(async (tx) => {
    // Lock in ID order so edits to different keys cannot partially update a channel.
    const rows = await tx
      .select()
      .from(providers)
      .where(and(inArray(providers.id, providerIds), isNull(providers.deletedAt)))
      .orderBy(providers.id)
      .for("update");
    const previousProviders = rows.map((row) => normalizeProviderRuntimeFields(toProvider(row)));
    const channel = groupProvidersByChannel(previousProviders).find((group) =>
      group.providers.some((provider) => provider.id === id)
    );
    if (!channel || channel.providers.length !== new Set(providerIds).size) {
      throw new ProviderChannelEditError();
    }
    const shared = getSharedProviderUpdate(data);
    const crossProtocolShared = stripProtocolSpecificFields(shared);
    const anchorProvider = previousProviders.find((item) => item.id === id);
    const updatedProviders: Provider[] = [];
    for (const previous of previousProviders) {
      const nextPatch =
        previous.id === id
          ? data
          : anchorProvider && previous.providerType !== anchorProvider.providerType
            ? crossProtocolShared
            : shared;
      if (Object.keys(nextPatch).length === 0) {
        updatedProviders.push(previous);
        continue;
      }
      const updated = await updateProvider(previous.id, nextPatch, {
        tx,
        afterCommit,
      });
      if (!updated) throw new ProviderChannelEditError();
      updatedProviders.push(updated);
    }
    const provider = updatedProviders.find((item) => item.id === id)!;
    const addedProviders: Provider[] = [];
    if (entries.length > 0) {
      const keyError = validateProviderKeys([
        { key: provider.key, is_enabled: provider.isEnabled },
        ...entries,
      ]);
      if (keyError) throw new ProviderKeyAppendError(keyError);
      for (const input of buildAdditionalProviderData(provider, entries)) {
        addedProviders.push(
          await createProvider(input, { tx, providerVendorId: provider.providerVendorId })
        );
      }
    }
    return { provider, updatedProviders, previousProviders, addedProviders };
  });
  for (const callback of afterCommit) await callback();
  return result;
}

export class ProviderProtocolBundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderProtocolBundleError";
  }
}

function buildKeySlotName(baseName: string, slotIndex: number): string {
  const trimmed = baseName.trim() || "Provider";
  if (slotIndex <= 0) {
    return trimmed.slice(0, 64);
  }
  const suffix = `-${slotIndex + 1}`;
  return `${trimmed.slice(0, Math.max(1, 64 - suffix.length))}${suffix}`;
}

function buildCreateInputFromTemplate(
  template: Provider,
  overrides: Partial<CreateProviderData>
): CreateProviderData {
  return {
    name: template.name,
    url: template.url,
    key: template.key,
    new_api_access_token: template.newApiAccessToken,
    new_api_user_id: template.newApiUserId,
    protocol_group_id: template.protocolGroupId ?? null,
    is_enabled: template.isEnabled,
    weight: template.weight,
    priority: template.priority,
    group_priorities: template.groupPriorities,
    cost_multiplier: template.costMultiplier,
    group_tag: template.groupTag,
    provider_type: template.providerType,
    preserve_client_ip: template.preserveClientIp,
    disable_session_reuse: template.disableSessionReuse,
    // 默认清空协议专属规则，交由调用方按目标协议显式覆盖，绝不继承旧协议白名单
    model_redirects: null,
    allowed_models: null,
    allowed_clients: template.allowedClients,
    blocked_clients: template.blockedClients,
    active_time_start: template.activeTimeStart,
    active_time_end: template.activeTimeEnd,
    mcp_passthrough_type: template.mcpPassthroughType,
    mcp_passthrough_url: template.mcpPassthroughUrl,
    limit_5h_usd: template.limit5hUsd,
    limit_5h_reset_mode: template.limit5hResetMode,
    limit_daily_usd: template.limitDailyUsd,
    daily_reset_mode: template.dailyResetMode,
    daily_reset_time: template.dailyResetTime,
    limit_weekly_usd: template.limitWeeklyUsd,
    limit_monthly_usd: template.limitMonthlyUsd,
    limit_total_usd: template.limitTotalUsd,
    limit_concurrent_sessions: template.limitConcurrentSessions,
    max_retry_attempts: template.maxRetryAttempts,
    circuit_breaker_failure_threshold: template.circuitBreakerFailureThreshold,
    circuit_breaker_open_duration: template.circuitBreakerOpenDuration,
    circuit_breaker_half_open_success_threshold: template.circuitBreakerHalfOpenSuccessThreshold,
    proxy_url: template.proxyUrl,
    proxy_fallback_to_direct: template.proxyFallbackToDirect,
    custom_headers: template.customHeaders,
    first_byte_timeout_streaming_ms: template.firstByteTimeoutStreamingMs,
    streaming_idle_timeout_ms: template.streamingIdleTimeoutMs,
    request_timeout_non_streaming_ms: template.requestTimeoutNonStreamingMs,
    website_url: template.websiteUrl,
    favicon_url: template.faviconUrl,
    cache_ttl_preference: "inherit",
    swap_cache_ttl_billing: false,
    context_1m_preference: "inherit",
    codex_reasoning_effort_preference: "inherit",
    codex_reasoning_summary_preference: "inherit",
    codex_text_verbosity_preference: "inherit",
    codex_parallel_tool_calls_preference: "inherit",
    codex_image_generation_preference: "inherit",
    codex_service_tier_preference: "inherit",
    anthropic_max_tokens_preference: "inherit",
    anthropic_thinking_budget_preference: "inherit",
    anthropic_adaptive_thinking: null,
    gemini_google_search_preference: "inherit",
    tpm: template.tpm,
    rpm: template.rpm,
    rpd: template.rpd,
    cc: template.cc,
    ...overrides,
  };
}

export interface CreateProviderProtocolBundleResult {
  primaryProvider: Provider;
  createdProviders: Provider[];
  adoptedProviders: Provider[];
  protocolGroupId: string | null;
}

/**
 * 原子创建多协议逻辑渠道（支持多 Key 矩阵及并入同站点已有独立协议渠道）。
 */
export async function createProviderProtocolBundle(
  baseData: CreateProviderData,
  rawProtocolConfigs: readonly ProviderProtocolConfigInput[],
  additionalKeys: readonly ProviderKeyEntry[] = []
): Promise<CreateProviderProtocolBundleResult> {
  const protocolConfigs = normalizeProtocolConfigs(rawProtocolConfigs);
  const allAdoptIds = Array.from(
    new Set(protocolConfigs.flatMap((config) => config.adopt_provider_ids ?? []))
  ).toSorted((a, b) => a - b);

  const keyEntries: Array<{ key: string; isEnabled: boolean }> = [
    { key: baseData.key.trim(), isEnabled: baseData.is_enabled ?? true },
    ...additionalKeys.map((entry) => ({
      key: entry.key.trim(),
      isEnabled: entry.is_enabled ?? true,
    })),
  ];
  const keyError = validateProviderKeys(
    keyEntries.map((entry) => ({ key: entry.key, is_enabled: entry.isEnabled }))
  );
  if (keyError) {
    throw new ProviderKeyAppendError(keyError);
  }

  const shouldAssignBundle = protocolConfigs.length > 1 || allAdoptIds.length > 0;
  const protocolGroupId = shouldAssignBundle ? randomUUID() : null;
  const sharedBase = stripProtocolSpecificFields(baseData);

  const afterCommit: Array<() => Promise<void>> = [];
  const result = await db.transaction(async (tx) => {
    const adoptedRowsById = new Map<number, Provider>();
    if (allAdoptIds.length > 0) {
      const lockedAdopted = await tx
        .select()
        .from(providers)
        .where(and(inArray(providers.id, allAdoptIds), isNull(providers.deletedAt)))
        .orderBy(providers.id)
        .for("update");
      for (const row of lockedAdopted) {
        const mapped = normalizeProviderRuntimeFields(toProvider(row));
        if (mapped.protocolGroupId) {
          throw new ProviderProtocolBundleError(
            `渠道「${mapped.name}」已归属其他多协议渠道，无法直接并入`
          );
        }
        adoptedRowsById.set(mapped.id, mapped);
      }
      if (adoptedRowsById.size !== allAdoptIds.length) {
        throw new ProviderProtocolBundleError("待并入的已有渠道不存在或已被删除");
      }
    }

    const providerVendorId = await getOrCreateProviderVendorIdFromUrls(
      {
        providerUrl: baseData.url,
        websiteUrl: baseData.website_url ?? null,
        faviconUrl: baseData.favicon_url ?? null,
        displayName: baseData.name,
      },
      { tx }
    );

    const createdProviders: Provider[] = [];
    const adoptedProviders: Provider[] = [];

    for (const config of protocolConfigs) {
      const protocolPatch = extractProtocolSpecificUpdate(config);
      const adoptIds = config.adopt_provider_ids ?? [];
      const adoptedKeysForProtocol = new Set<string>();

      for (const adoptId of adoptIds) {
        const target = adoptedRowsById.get(adoptId);
        if (!target || target.providerType !== config.provider_type) {
          throw new ProviderProtocolBundleError(
            `待并入渠道 #${adoptId} 的协议类型与 ${config.provider_type} 不匹配`
          );
        }
        const matchedSlotIndex = keyEntries.findIndex((slot) => slot.key === target.key);
        const updated = await updateProvider(
          target.id,
          {
            ...sharedBase,
            ...protocolPatch,
            protocol_group_id: protocolGroupId,
            name: buildKeySlotName(baseData.name, Math.max(matchedSlotIndex, 0)),
            key: matchedSlotIndex >= 0 ? keyEntries[matchedSlotIndex].key : target.key,
          },
          { tx, afterCommit }
        );
        if (!updated) {
          throw new ProviderProtocolBundleError(`并入渠道 #${adoptId} 失败`);
        }
        adoptedProviders.push(updated);
        adoptedKeysForProtocol.add(updated.key);
      }

      for (let slotIndex = 0; slotIndex < keyEntries.length; slotIndex++) {
        const slot = keyEntries[slotIndex];
        if (adoptedKeysForProtocol.has(slot.key)) continue;
        const created = await createProvider(
          {
            ...sharedBase,
            ...protocolPatch,
            name: buildKeySlotName(baseData.name, slotIndex),
            key: slot.key,
            is_enabled: slot.isEnabled,
            protocol_group_id: protocolGroupId,
            tpm: baseData.tpm ?? null,
            rpm: baseData.rpm ?? null,
            rpd: baseData.rpd ?? null,
            cc: baseData.cc ?? null,
          } as CreateProviderData,
          { tx, providerVendorId }
        );
        createdProviders.push(created);
      }
    }

    const primaryProvider = createdProviders[0] ?? adoptedProviders[0];
    if (!primaryProvider) {
      throw new ProviderProtocolBundleError("创建多协议渠道失败：未生成有效记录");
    }

    return { primaryProvider, createdProviders, adoptedProviders, protocolGroupId };
  });

  for (const callback of afterCommit) await callback();
  return result;
}

export interface SyncProviderProtocolBundleResult {
  primaryProvider: Provider;
  updatedProviders: Provider[];
  previousProviders: Provider[];
  addedProviders: Provider[];
  adoptedProviders: Provider[];
  removedProviders: Provider[];
  protocolGroupId: string | null;
}

/**
 * 原子同步编辑多协议逻辑渠道：
 * - 支持在旧单协议渠道上勾选新协议并自动升级为多协议逻辑渠道；
 * - 支持并入同站点已有独立协议渠道（保留其模型配置）；
 * - 维持多协议 × 多 Key 矩阵对齐；
 * - 取消勾选的旧协议记录软删除（保留 protocol_group_id 以便当期共享预算回源准确）。
 */
export async function syncProviderProtocolBundle(
  anchorProviderId: number,
  data: UpdateProviderData,
  rawProtocolConfigs: readonly ProviderProtocolConfigInput[],
  additionalKeys: readonly ProviderKeyEntry[] = []
): Promise<SyncProviderProtocolBundleResult | null> {
  const protocolConfigs = normalizeProtocolConfigs(rawProtocolConfigs);
  const afterCommit: Array<() => Promise<void>> = [];

  const result = await db.transaction(async (tx) => {
    const [anchorRow] = await tx
      .select()
      .from(providers)
      .where(and(eq(providers.id, anchorProviderId), isNull(providers.deletedAt)))
      .limit(1);

    if (!anchorRow) {
      return null;
    }

    const anchorInitial = normalizeProviderRuntimeFields(toProvider(anchorRow));

    // 查找当前逻辑渠道的所有活跃记录 ID
    let currentGroupIds: number[];
    if (anchorInitial.protocolGroupId) {
      const siblingRows = await tx
        .select({ id: providers.id })
        .from(providers)
        .where(
          and(
            eq(providers.protocolGroupId, anchorInitial.protocolGroupId),
            isNull(providers.deletedAt)
          )
        );
      currentGroupIds = siblingRows.map((row) => row.id);
    } else if (anchorInitial.providerVendorId) {
      const vendorRows = await tx
        .select()
        .from(providers)
        .where(
          and(
            eq(providers.providerVendorId, anchorInitial.providerVendorId),
            isNull(providers.deletedAt)
          )
        );
      const vendorProviders = vendorRows.map((row) =>
        normalizeProviderRuntimeFields(toProvider(row))
      );
      const matchedChannel = groupProvidersByChannel(vendorProviders).find((group) =>
        group.providers.some((item) => item.id === anchorProviderId)
      );
      currentGroupIds = matchedChannel
        ? matchedChannel.providers.map((item) => item.id)
        : [anchorProviderId];
    } else {
      currentGroupIds = [anchorProviderId];
    }

    const currentGroupIdSet = new Set(currentGroupIds);
    const requestedAdoptIds = Array.from(
      new Set(
        protocolConfigs
          .flatMap((config) => config.adopt_provider_ids ?? [])
          .filter((id) => !currentGroupIdSet.has(id))
      )
    );

    // 统一按 ID 升序加行锁，防止并发编辑死锁或部分更新
    const allLockIds = Array.from(new Set([...currentGroupIds, ...requestedAdoptIds])).toSorted(
      (a, b) => a - b
    );
    const lockedRows = await tx
      .select()
      .from(providers)
      .where(and(inArray(providers.id, allLockIds), isNull(providers.deletedAt)))
      .orderBy(providers.id)
      .for("update");

    const lockedById = new Map<number, Provider>();
    for (const row of lockedRows) {
      const mapped = normalizeProviderRuntimeFields(toProvider(row));
      lockedById.set(mapped.id, mapped);
    }

    const previousProviders = currentGroupIds
      .map((id) => lockedById.get(id))
      .filter((item): item is Provider => item !== undefined);
    const anchor = lockedById.get(anchorProviderId);
    if (!anchor || previousProviders.length !== currentGroupIds.length) {
      throw new ProviderChannelEditError();
    }

    const adoptedInputById = new Map<number, Provider>();
    for (const adoptId of requestedAdoptIds) {
      const target = lockedById.get(adoptId);
      if (!target) {
        throw new ProviderProtocolBundleError("待并入的已有渠道不存在或已被删除");
      }
      if (target.protocolGroupId) {
        throw new ProviderProtocolBundleError(
          `渠道「${target.name}」已归属其他多协议渠道，无法直接并入`
        );
      }
      adoptedInputById.set(adoptId, target);
    }

    // 一旦渠道拥有 protocolGroupId 即永久保留，确保多协议共享限额账本不断裂
    const targetProtocolGroupId =
      anchor.protocolGroupId ??
      (protocolConfigs.length > 1 || requestedAdoptIds.length > 0 ? randomUUID() : null);

    // 构建去重后的 Key 槽位（按最早记录顺序排列，主槽位为锚点 Key）
    const keySlots: Array<{ originalKey: string; nextKey: string; isEnabled: boolean }> = [];
    const seenKeys = new Set<string>();
    const orderedExisting = [anchor, ...previousProviders.filter((item) => item.id !== anchor.id)];
    for (const item of orderedExisting) {
      if (seenKeys.has(item.key)) continue;
      seenKeys.add(item.key);
      const isPrimarySlot = item.key === anchor.key;
      keySlots.push({
        originalKey: item.key,
        nextKey: isPrimarySlot && data.key?.trim() ? data.key.trim() : item.key,
        isEnabled:
          isPrimarySlot && data.is_enabled !== undefined ? data.is_enabled : item.isEnabled,
      });
    }

    if (additionalKeys.length > 0) {
      const validationError = validateProviderKeys([
        ...keySlots.map((slot) => ({ key: slot.nextKey, is_enabled: slot.isEnabled })),
        ...additionalKeys,
      ]);
      if (validationError) {
        throw new ProviderKeyAppendError(validationError);
      }
      for (const entry of additionalKeys) {
        const trimmedKey = entry.key.trim();
        keySlots.push({
          originalKey: trimmedKey,
          nextKey: trimmedKey,
          isEnabled: entry.is_enabled ?? true,
        });
      }
    }

    const sharedUpdateBase = stripProtocolSpecificFields(getSharedProviderUpdate(data));
    const baseName = data.name?.trim() || anchor.name;

    const updatedProviders: Provider[] = [];
    const addedProviders: Provider[] = [];
    const adoptedProviders: Provider[] = [];
    const keptProviderIds = new Set<number>();
    const targetProtocolSet = new Set<ProviderType>(
      protocolConfigs.map((config) => config.provider_type)
    );

    // 先算出同步后的目标 vendorId（当 URL/name/website 更新时保持组内 vendor 一致）
    let resolvedVendorId: number | null = anchor.providerVendorId;
    if (data.url !== undefined || data.website_url !== undefined) {
      resolvedVendorId = await getOrCreateProviderVendorIdFromUrls(
        {
          providerUrl: data.url ?? anchor.url,
          websiteUrl: data.website_url !== undefined ? data.website_url : anchor.websiteUrl,
          faviconUrl: data.favicon_url !== undefined ? data.favicon_url : anchor.faviconUrl,
          displayName: baseName,
        },
        { tx }
      );
    }

    for (const config of protocolConfigs) {
      const protocolPatch = extractProtocolSpecificUpdate(config);
      const existingForProtocol = previousProviders.filter(
        (item) => item.providerType === config.provider_type
      );

      // 校验本协议请求并入的独立渠道
      const adoptForProtocol: Provider[] = [];
      for (const adoptId of config.adopt_provider_ids ?? []) {
        if (currentGroupIdSet.has(adoptId)) continue;
        const target = adoptedInputById.get(adoptId);
        if (!target || target.providerType !== config.provider_type) {
          throw new ProviderProtocolBundleError(
            `待并入渠道 #${adoptId} 的协议类型与 ${config.provider_type} 不匹配`
          );
        }
        adoptForProtocol.push(target);
      }

      const existingByOriginalKey = new Map<string, Provider>();
      for (const record of existingForProtocol) {
        if (!existingByOriginalKey.has(record.key)) {
          existingByOriginalKey.set(record.key, record);
        }
      }

      const coveredSlotKeys = new Set<string>();

      // 1. 更新当前组内本协议已有记录
      for (const record of existingForProtocol) {
        const slotIndex = keySlots.findIndex((slot) => slot.originalKey === record.key);
        const slot = slotIndex >= 0 ? keySlots[slotIndex] : null;
        const nextRecordPatch: UpdateProviderData = {
          ...sharedUpdateBase,
          ...protocolPatch,
          protocol_group_id: targetProtocolGroupId,
          ...(data.name !== undefined && slotIndex >= 0
            ? { name: buildKeySlotName(baseName, slotIndex) }
            : {}),
          ...(slot && slot.nextKey !== record.key ? { key: slot.nextKey } : {}),
          ...(slotIndex === 0 && data.is_enabled !== undefined
            ? { is_enabled: data.is_enabled }
            : {}),
        };
        const updated = await updateProvider(record.id, nextRecordPatch, { tx, afterCommit });
        if (!updated) throw new ProviderChannelEditError();
        updatedProviders.push(updated);
        keptProviderIds.add(updated.id);
        if (slot) coveredSlotKeys.add(slot.nextKey);
      }

      // 2. 并入独立同协议渠道（写入同一 protocol_group_id，同步共享配置并应用本协议 Tab 规则）
      for (const adopted of adoptForProtocol) {
        const slotIndex = keySlots.findIndex(
          (slot) => slot.originalKey === adopted.key || slot.nextKey === adopted.key
        );
        const targetSlotIndex = Math.max(slotIndex, 0);
        const targetSlot = keySlots[targetSlotIndex];
        const nextAdoptPatch: UpdateProviderData = {
          ...sharedUpdateBase,
          ...protocolPatch,
          url: data.url ?? anchor.url,
          website_url: data.website_url !== undefined ? data.website_url : anchor.websiteUrl,
          favicon_url: data.favicon_url !== undefined ? data.favicon_url : anchor.faviconUrl,
          group_tag: data.group_tag !== undefined ? data.group_tag : anchor.groupTag,
          priority: data.priority ?? anchor.priority,
          group_priorities:
            data.group_priorities !== undefined ? data.group_priorities : anchor.groupPriorities,
          weight: data.weight ?? anchor.weight,
          cost_multiplier: data.cost_multiplier ?? anchor.costMultiplier,
          limit_5h_usd: data.limit_5h_usd !== undefined ? data.limit_5h_usd : anchor.limit5hUsd,
          limit_5h_reset_mode: data.limit_5h_reset_mode ?? anchor.limit5hResetMode,
          limit_daily_usd:
            data.limit_daily_usd !== undefined ? data.limit_daily_usd : anchor.limitDailyUsd,
          daily_reset_mode: data.daily_reset_mode ?? anchor.dailyResetMode,
          daily_reset_time: data.daily_reset_time ?? anchor.dailyResetTime,
          limit_weekly_usd:
            data.limit_weekly_usd !== undefined ? data.limit_weekly_usd : anchor.limitWeeklyUsd,
          limit_monthly_usd:
            data.limit_monthly_usd !== undefined ? data.limit_monthly_usd : anchor.limitMonthlyUsd,
          limit_total_usd:
            data.limit_total_usd !== undefined ? data.limit_total_usd : anchor.limitTotalUsd,
          limit_concurrent_sessions:
            data.limit_concurrent_sessions ?? anchor.limitConcurrentSessions,
          proxy_url: data.proxy_url !== undefined ? data.proxy_url : anchor.proxyUrl,
          proxy_fallback_to_direct: data.proxy_fallback_to_direct ?? anchor.proxyFallbackToDirect,
          custom_headers:
            data.custom_headers !== undefined ? data.custom_headers : anchor.customHeaders,
          new_api_access_token:
            data.new_api_access_token !== undefined
              ? data.new_api_access_token
              : anchor.newApiAccessToken,
          new_api_user_id:
            data.new_api_user_id !== undefined ? data.new_api_user_id : anchor.newApiUserId,
          protocol_group_id: targetProtocolGroupId,
          name: buildKeySlotName(baseName, targetSlotIndex),
          // 统一使用逻辑渠道共享密钥（若该被并入记录本来就与某槽位 key 一致则无变化）
          key: targetSlot ? targetSlot.nextKey : adopted.key,
        };
        const updated = await updateProvider(adopted.id, nextAdoptPatch, { tx, afterCommit });
        if (!updated) {
          throw new ProviderProtocolBundleError(`并入渠道 #${adopted.id} 失败`);
        }
        adoptedProviders.push(updated);
        updatedProviders.push(updated);
        keptProviderIds.add(updated.id);
        if (targetSlot) coveredSlotKeys.add(targetSlot.nextKey);
      }

      // 3. 补齐本协议缺失的 Key 槽位（例如新勾选协议或新增 additional_keys）
      const templateProvider = updatedProviders[0] ?? anchor;
      for (let slotIndex = 0; slotIndex < keySlots.length; slotIndex++) {
        const slot = keySlots[slotIndex];
        if (coveredSlotKeys.has(slot.nextKey)) continue;
        const createInput = buildCreateInputFromTemplate(templateProvider, {
          ...sharedUpdateBase,
          ...protocolPatch,
          name: buildKeySlotName(baseName, slotIndex),
          key: slot.nextKey,
          is_enabled: slot.isEnabled,
          protocol_group_id: targetProtocolGroupId,
        });
        const created = await createProvider(createInput, {
          tx,
          providerVendorId: resolvedVendorId ?? templateProvider.providerVendorId,
        });
        addedProviders.push(created);
        keptProviderIds.add(created.id);
      }
    }

    // 4. 取消勾选的旧协议：软删除并保留 protocol_group_id（保持共享预算历史完整）
    const removedProviders: Provider[] = [];
    const now = new Date();
    for (const previous of previousProviders) {
      if (targetProtocolSet.has(previous.providerType) || keptProviderIds.has(previous.id)) {
        continue;
      }
      await tx
        .update(providers)
        .set({
          deletedAt: now,
          isEnabled: false,
          protocolGroupId: targetProtocolGroupId,
          updatedAt: now,
        })
        .where(and(eq(providers.id, previous.id), isNull(providers.deletedAt)));
      removedProviders.push(previous);
    }

    // 5. 同步组内 totalCostResetAt 保持一致（以锚点为准）
    if (targetProtocolGroupId && anchor.totalCostResetAt) {
      const activeIds = [
        ...updatedProviders.map((item) => item.id),
        ...addedProviders.map((item) => item.id),
      ];
      if (activeIds.length > 0) {
        await tx
          .update(providers)
          .set({ totalCostResetAt: anchor.totalCostResetAt })
          .where(and(inArray(providers.id, activeIds), isNull(providers.deletedAt)));
      }
    }

    const primaryProvider =
      updatedProviders.find((item) => item.id === anchorProviderId) ??
      updatedProviders[0] ??
      addedProviders[0];
    if (!primaryProvider) {
      throw new ProviderProtocolBundleError("同步多协议渠道失败：至少需要保留一个协议");
    }

    return {
      primaryProvider,
      updatedProviders,
      previousProviders,
      addedProviders,
      adoptedProviders,
      removedProviders,
      protocolGroupId: targetProtocolGroupId,
    };
  });

  for (const callback of afterCommit) await callback();
  return result;
}

export async function updateProviderPrioritiesBatch(
  updates: Array<{ id: number; priority: number }>
): Promise<number> {
  if (updates.length === 0) {
    return 0;
  }

  // Deduplicate ids: last one wins
  const updateMap = new Map<number, number>();
  for (const update of updates) {
    updateMap.set(update.id, update.priority);
  }

  const ids = Array.from(updateMap.keys());
  const priorityCol = sql.identifier("priority");
  const updatedAtCol = sql.identifier("updated_at");
  const cases = ids.map((id) => sql`WHEN ${id} THEN ${updateMap.get(id)!}`);

  const idList = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `
  );

  const query = sql`
    UPDATE providers
    SET
      ${priorityCol} = CASE id ${sql.join(cases, sql` `)} ELSE ${priorityCol} END,
      ${updatedAtCol} = NOW()
    WHERE id IN (${idList}) AND deleted_at IS NULL
    RETURNING id
  `;

  const result = await db.execute(query);
  return Array.from(result).length;
}

export async function deleteProvider(id: number): Promise<boolean> {
  const now = new Date();

  const deleted = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        providerVendorId: providers.providerVendorId,
        providerType: providers.providerType,
        url: providers.url,
      })
      .from(providers)
      .where(and(eq(providers.id, id), isNull(providers.deletedAt)))
      .limit(1);

    if (!current) {
      return false;
    }

    const result = await tx
      .update(providers)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(providers.id, id), isNull(providers.deletedAt)))
      .returning({ id: providers.id });

    if (result.length === 0) {
      return false;
    }

    if (current.providerVendorId != null && current.url) {
      const [activeReference] = await tx
        .select({ id: providers.id })
        .from(providers)
        .where(
          and(
            eq(providers.providerVendorId, current.providerVendorId),
            eq(providers.providerType, current.providerType),
            eq(providers.url, current.url),
            eq(providers.isEnabled, true),
            isNull(providers.deletedAt)
          )
        )
        .limit(1);

      if (!activeReference) {
        await tx
          .update(providerEndpoints)
          .set({
            deletedAt: now,
            isEnabled: false,
            updatedAt: now,
          })
          .where(
            and(
              eq(providerEndpoints.vendorId, current.providerVendorId),
              eq(providerEndpoints.providerType, current.providerType),
              eq(providerEndpoints.url, current.url),
              isNull(providerEndpoints.deletedAt)
            )
          );
      }
    }

    return true;
  });

  return deleted;
}

/**
 * 恢复单个软删除供应商及其关联端点。
 *
 * 安全策略：仅允许恢复 60 秒内删除的供应商。
 */
export async function restoreProvider(id: number): Promise<boolean> {
  const now = new Date();

  const restored = await db.transaction(async (tx) => restoreProviderInTransaction(tx, id, now));

  return restored;
}

export interface BatchProviderUpdates {
  isEnabled?: boolean;
  priority?: number;
  weight?: number;
  costMultiplier?: string;
  groupTag?: string | null;
  modelRedirects?: ProviderModelRedirectRule[] | null;
  allowedModels?: AllowedModelRuleInput[] | null;
  allowedClients?: string[] | null;
  blockedClients?: string[] | null;
  anthropicThinkingBudgetPreference?: string | null;
  anthropicAdaptiveThinking?: AnthropicAdaptiveThinkingConfig | null;
  // Routing
  preserveClientIp?: boolean;
  disableSessionReuse?: boolean;
  activeTimeStart?: string | null;
  activeTimeEnd?: string | null;
  groupPriorities?: Record<string, number> | null;
  cacheTtlPreference?: string | null;
  swapCacheTtlBilling?: boolean;
  context1mPreference?: string | null;
  codexReasoningEffortPreference?: string | null;
  codexReasoningSummaryPreference?: string | null;
  codexTextVerbosityPreference?: string | null;
  codexParallelToolCallsPreference?: string | null;
  codexImageGenerationPreference?: string | null;
  codexServiceTierPreference?: string | null;
  anthropicMaxTokensPreference?: string | null;
  geminiGoogleSearchPreference?: string | null;
  // Rate Limit
  limit5hUsd?: string | null;
  limit5hResetMode?: string;
  limitDailyUsd?: string | null;
  dailyResetMode?: string;
  dailyResetTime?: string;
  limitWeeklyUsd?: string | null;
  limitMonthlyUsd?: string | null;
  limitTotalUsd?: string | null;
  limitConcurrentSessions?: number;
  // Circuit Breaker
  circuitBreakerFailureThreshold?: number;
  circuitBreakerOpenDuration?: number;
  circuitBreakerHalfOpenSuccessThreshold?: number;
  maxRetryAttempts?: number | null;
  // Network
  proxyUrl?: string | null;
  proxyFallbackToDirect?: boolean;
  firstByteTimeoutStreamingMs?: number;
  streamingIdleTimeoutMs?: number;
  requestTimeoutNonStreamingMs?: number;
  // MCP
  mcpPassthroughType?: string;
  mcpPassthroughUrl?: string | null;
  // 余额查询凭证（单个编辑撤销时恢复）
  newApiAccessToken?: string | null;
  newApiUserId?: number | null;
  protocolGroupId?: string | null;
}

type ProviderBatchUpdatedRow = {
  id: number;
  providerVendorId: number | null;
  providerType: Provider["providerType"];
  url: string;
};

async function ensureEnabledProviderEndpoints(
  result: ProviderBatchUpdatedRow[],
  now: Date
): Promise<void> {
  const endpointKeys = new Map<
    string,
    { vendorId: number; providerType: Provider["providerType"]; url: string }
  >();

  for (const row of result) {
    if (row.providerVendorId == null || typeof row.url !== "string") {
      continue;
    }

    const trimmedUrl = row.url.trim();
    if (!trimmedUrl) {
      continue;
    }

    try {
      // eslint-disable-next-line no-new
      new URL(trimmedUrl);
    } catch {
      logger.warn("updateProvidersBatch:skip_invalid_url", {
        providerId: row.id,
        vendorId: row.providerVendorId,
        providerType: row.providerType,
        url: trimmedUrl,
      });
      continue;
    }

    const key = `${row.providerVendorId}::${row.providerType}::${trimmedUrl}`;
    if (endpointKeys.has(key)) continue;

    endpointKeys.set(key, {
      vendorId: row.providerVendorId,
      providerType: row.providerType,
      url: trimmedUrl,
    });
  }

  if (endpointKeys.size === 0) {
    return;
  }

  try {
    const inserted = await db
      .insert(providerEndpoints)
      .values(
        Array.from(endpointKeys.values()).map((endpoint) => ({
          vendorId: endpoint.vendorId,
          providerType: endpoint.providerType,
          url: endpoint.url,
          label: null,
          updatedAt: now,
        }))
      )
      .onConflictDoNothing({
        target: [providerEndpoints.vendorId, providerEndpoints.providerType, providerEndpoints.url],
        where: sql`${providerEndpoints.deletedAt} IS NULL`,
      })
      .returning({ id: providerEndpoints.id });

    logger.debug("updateProvidersBatch:ensured_provider_endpoints", {
      updatedProviders: result.length,
      candidateEndpoints: endpointKeys.size,
      insertedEndpoints: inserted.length,
    });
  } catch (error) {
    logger.warn("updateProvidersBatch:ensure_provider_endpoints_failed", {
      updatedProviders: result.length,
      candidateEndpoints: endpointKeys.size,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function updateProvidersBatch(
  ids: number[],
  updates: BatchProviderUpdates
): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }

  const uniqueIds = [...new Set(ids)];
  const now = new Date();
  const setClauses: Record<string, unknown> = { updatedAt: now };

  if (updates.isEnabled !== undefined) {
    setClauses.isEnabled = updates.isEnabled;
  }
  if (updates.priority !== undefined) {
    setClauses.priority = updates.priority;
  }
  if (updates.weight !== undefined) {
    setClauses.weight = updates.weight;
  }
  if (updates.costMultiplier !== undefined) {
    setClauses.costMultiplier = updates.costMultiplier;
  }
  if (updates.groupTag !== undefined) {
    setClauses.groupTag = updates.groupTag;
  }
  if (updates.modelRedirects !== undefined) {
    setClauses.modelRedirects = updates.modelRedirects;
  }
  if (updates.allowedModels !== undefined) {
    setClauses.allowedModels = updates.allowedModels;
  }
  if (updates.allowedClients !== undefined) {
    setClauses.allowedClients = updates.allowedClients;
  }
  if (updates.blockedClients !== undefined) {
    setClauses.blockedClients = updates.blockedClients;
  }
  if (updates.anthropicThinkingBudgetPreference !== undefined) {
    setClauses.anthropicThinkingBudgetPreference = updates.anthropicThinkingBudgetPreference;
  }
  if (updates.anthropicAdaptiveThinking !== undefined) {
    setClauses.anthropicAdaptiveThinking = updates.anthropicAdaptiveThinking;
  }
  // Routing
  if (updates.preserveClientIp !== undefined) {
    setClauses.preserveClientIp = updates.preserveClientIp;
  }
  if (updates.disableSessionReuse !== undefined) {
    setClauses.disableSessionReuse = updates.disableSessionReuse;
  }
  if (updates.activeTimeStart !== undefined) {
    setClauses.activeTimeStart = updates.activeTimeStart;
  }
  if (updates.activeTimeEnd !== undefined) {
    setClauses.activeTimeEnd = updates.activeTimeEnd;
  }
  if (updates.groupPriorities !== undefined) {
    setClauses.groupPriorities = updates.groupPriorities;
  }
  if (updates.cacheTtlPreference !== undefined) {
    setClauses.cacheTtlPreference = updates.cacheTtlPreference;
  }
  if (updates.swapCacheTtlBilling !== undefined) {
    setClauses.swapCacheTtlBilling = updates.swapCacheTtlBilling;
  }
  if (updates.context1mPreference !== undefined) {
    setClauses.context1mPreference = updates.context1mPreference;
  }
  if (updates.codexReasoningEffortPreference !== undefined) {
    setClauses.codexReasoningEffortPreference = updates.codexReasoningEffortPreference;
  }
  if (updates.codexReasoningSummaryPreference !== undefined) {
    setClauses.codexReasoningSummaryPreference = updates.codexReasoningSummaryPreference;
  }
  if (updates.codexTextVerbosityPreference !== undefined) {
    setClauses.codexTextVerbosityPreference = updates.codexTextVerbosityPreference;
  }
  if (updates.codexParallelToolCallsPreference !== undefined) {
    setClauses.codexParallelToolCallsPreference = updates.codexParallelToolCallsPreference;
  }
  if (updates.codexImageGenerationPreference !== undefined) {
    setClauses.codexImageGenerationPreference = updates.codexImageGenerationPreference;
  }
  if (updates.codexServiceTierPreference !== undefined) {
    setClauses.codexServiceTierPreference = updates.codexServiceTierPreference;
  }
  if (updates.anthropicMaxTokensPreference !== undefined) {
    setClauses.anthropicMaxTokensPreference = updates.anthropicMaxTokensPreference;
  }
  if (updates.geminiGoogleSearchPreference !== undefined) {
    setClauses.geminiGoogleSearchPreference = updates.geminiGoogleSearchPreference;
  }
  // Rate Limit
  if (updates.limit5hUsd !== undefined) {
    setClauses.limit5hUsd = updates.limit5hUsd;
  }
  if (updates.limit5hResetMode !== undefined) {
    setClauses.limit5hResetMode = updates.limit5hResetMode;
  }
  if (updates.limitDailyUsd !== undefined) {
    setClauses.limitDailyUsd = updates.limitDailyUsd;
  }
  if (updates.dailyResetMode !== undefined) {
    setClauses.dailyResetMode = updates.dailyResetMode;
  }
  if (updates.dailyResetTime !== undefined) {
    setClauses.dailyResetTime = updates.dailyResetTime;
  }
  if (updates.limitWeeklyUsd !== undefined) {
    setClauses.limitWeeklyUsd = updates.limitWeeklyUsd;
  }
  if (updates.limitMonthlyUsd !== undefined) {
    setClauses.limitMonthlyUsd = updates.limitMonthlyUsd;
  }
  if (updates.limitTotalUsd !== undefined) {
    setClauses.limitTotalUsd = updates.limitTotalUsd;
  }
  if (updates.limitConcurrentSessions !== undefined) {
    setClauses.limitConcurrentSessions = updates.limitConcurrentSessions;
  }
  // Circuit Breaker
  if (updates.circuitBreakerFailureThreshold !== undefined) {
    setClauses.circuitBreakerFailureThreshold = updates.circuitBreakerFailureThreshold;
  }
  if (updates.circuitBreakerOpenDuration !== undefined) {
    setClauses.circuitBreakerOpenDuration = updates.circuitBreakerOpenDuration;
  }
  if (updates.circuitBreakerHalfOpenSuccessThreshold !== undefined) {
    setClauses.circuitBreakerHalfOpenSuccessThreshold =
      updates.circuitBreakerHalfOpenSuccessThreshold;
  }
  if (updates.maxRetryAttempts !== undefined) {
    setClauses.maxRetryAttempts = updates.maxRetryAttempts;
  }
  // Network
  if (updates.proxyUrl !== undefined) {
    setClauses.proxyUrl = updates.proxyUrl;
  }
  if (updates.proxyFallbackToDirect !== undefined) {
    setClauses.proxyFallbackToDirect = updates.proxyFallbackToDirect;
  }
  if (updates.firstByteTimeoutStreamingMs !== undefined) {
    setClauses.firstByteTimeoutStreamingMs = updates.firstByteTimeoutStreamingMs;
  }
  if (updates.streamingIdleTimeoutMs !== undefined) {
    setClauses.streamingIdleTimeoutMs = updates.streamingIdleTimeoutMs;
  }
  if (updates.requestTimeoutNonStreamingMs !== undefined) {
    setClauses.requestTimeoutNonStreamingMs = updates.requestTimeoutNonStreamingMs;
  }
  // MCP
  if (updates.mcpPassthroughType !== undefined) {
    setClauses.mcpPassthroughType = updates.mcpPassthroughType;
  }
  if (updates.mcpPassthroughUrl !== undefined) {
    setClauses.mcpPassthroughUrl = updates.mcpPassthroughUrl;
  }
  if (updates.newApiAccessToken !== undefined) {
    setClauses.newApiAccessToken = updates.newApiAccessToken;
  }
  if (updates.newApiUserId !== undefined) {
    setClauses.newApiUserId = updates.newApiUserId;
  }
  if (updates.protocolGroupId !== undefined) {
    setClauses.protocolGroupId = updates.protocolGroupId;
  }

  if (Object.keys(setClauses).length === 1) {
    return 0;
  }

  const executor = async (
    tx: Pick<ProviderTransaction, "select" | "insert" | "update" | "delete" | "execute">
  ) => {
    const result = await tx
      .update(providers)
      .set(setClauses)
      .where(and(inArray(providers.id, uniqueIds), isNull(providers.deletedAt)))
      .returning({
        id: providers.id,
        providerVendorId: providers.providerVendorId,
        providerType: providers.providerType,
        url: providers.url,
      });
    if (updates.groupTag !== undefined) {
      await syncProviderVendorsForGroupChange(uniqueIds, tx);
      return tx
        .select({
          id: providers.id,
          providerVendorId: providers.providerVendorId,
          providerType: providers.providerType,
          url: providers.url,
        })
        .from(providers)
        .where(and(inArray(providers.id, uniqueIds), isNull(providers.deletedAt)));
    }
    return result;
  };
  const result =
    updates.groupTag !== undefined ? await db.transaction(executor) : await executor(db);

  // #779/#781：批量启用供应商时，best-effort 确保 endpoint pool 中存在对应 URL（避免历史/竞态导致启用后严格端点被阻断）。
  if (updates.isEnabled === true && result.length > 0) {
    await ensureEnabledProviderEndpoints(result, now);
  }

  logger.debug("updateProvidersBatch:completed", {
    requestedIds: uniqueIds.length,
    updatedCount: result.length,
    fields: Object.keys(setClauses).filter((k) => k !== "updatedAt"),
  });

  return result.length;
}

export interface ProviderBatchUpdateGroup {
  ids: number[];
  updates: BatchProviderUpdates;
}

export interface ProviderBatchExpectedPreimage {
  providerId: number;
  providerType: Provider["providerType"];
  values: Partial<Record<keyof Provider, unknown>>;
}

export type ProviderBatchConditionalUpdateResult =
  | { status: "updated"; updatedCount: number }
  | { status: "stale" };

class ProviderBatchPreimageMismatchError extends Error {}

function buildProviderBatchSetClauses(
  updates: BatchProviderUpdates,
  now: Date
): Record<string, unknown> {
  const setClauses: Record<string, unknown> = { updatedAt: now };
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      setClauses[key] = value;
    }
  }
  return setClauses;
}

function isProviderBatchPreimageValueEqual(current: unknown, expected: unknown): boolean {
  if (Object.is(current, expected)) {
    return true;
  }
  if (
    current !== null &&
    expected !== null &&
    typeof current === "object" &&
    typeof expected === "object"
  ) {
    if (Array.isArray(current) || Array.isArray(expected)) {
      return (
        Array.isArray(current) &&
        Array.isArray(expected) &&
        current.length === expected.length &&
        current.every((value, index) => isProviderBatchPreimageValueEqual(value, expected[index]))
      );
    }
    const currentRecord = current as Record<string, unknown>;
    const expectedRecord = expected as Record<string, unknown>;
    const currentKeys = Object.keys(currentRecord);
    const expectedKeys = Object.keys(expectedRecord);
    return (
      currentKeys.length === expectedKeys.length &&
      currentKeys.every(
        (key) =>
          Object.hasOwn(expectedRecord, key) &&
          isProviderBatchPreimageValueEqual(currentRecord[key], expectedRecord[key])
      )
    );
  }
  return false;
}

type ProviderBatchApplyLedgerRow = typeof providerBatchApplyOperations.$inferSelect;
const PROVIDER_BATCH_APPLY_LEDGER_TTL_MS = 24 * 60 * 60 * 1000;

export type ProviderBatchApplyOperationLookupResult =
  | { status: "replay"; result: ProviderBatchApplyLedgerResult; undoAvailable: boolean }
  | { status: "idempotency_conflict" }
  | { status: "preview_consumed" }
  | { status: "not_found" };

export interface FindProviderBatchApplyOperationInput {
  claimKey: string;
  previewToken: string;
  payloadFingerprint: string;
}

export interface ApplyProviderBatchOperationIfUnchangedInput
  extends FindProviderBatchApplyOperationInput {
  groups: ProviderBatchUpdateGroup[];
  /** Complete provider set captured by the preview, including excluded providers. */
  expectedPreimages: ProviderBatchExpectedPreimage[];
  /** Providers left after applying the caller's exclusion list. */
  effectiveProviderIds: number[];
  /** Exact provider-keyed values needed to rebuild the undo snapshot. */
  undoPreimage: Record<number, Record<string, unknown>>;
  undoRestorable: boolean;
  postCommitEffects: ProviderBatchApplyLedgerResult["postCommitEffects"];
  operationId: string;
  undoToken: string;
  undoTtlSeconds: number;
}

export type ApplyProviderBatchOperationIfUnchangedResult =
  | { status: "applied"; result: ProviderBatchApplyLedgerResult; undoAvailable: boolean }
  | { status: "replay"; result: ProviderBatchApplyLedgerResult; undoAvailable: boolean }
  | { status: "stale" }
  | { status: "idempotency_conflict" }
  | { status: "preview_consumed" };

function resolveProviderBatchApplyOperation(
  rows: ProviderBatchApplyLedgerRow[],
  input: FindProviderBatchApplyOperationInput,
  now: Date
): ProviderBatchApplyOperationLookupResult {
  const claimOperation = rows.find((row) => row.claimKey === input.claimKey);
  if (claimOperation) {
    if (
      claimOperation.previewToken !== input.previewToken ||
      claimOperation.payloadFingerprint !== input.payloadFingerprint
    ) {
      return { status: "idempotency_conflict" };
    }

    if (claimOperation.status === "applied" && claimOperation.result) {
      return {
        status: "replay",
        result: claimOperation.result,
        undoAvailable:
          claimOperation.result.undoRestorable &&
          claimOperation.undoConsumedAt === null &&
          claimOperation.undoExpiresAt !== null &&
          claimOperation.undoExpiresAt > now,
      };
    }

    // An "applying" row must never be committed by this repository. Refuse to
    // reuse its preview if one is present because its state requires operator repair.
    return { status: "preview_consumed" };
  }

  if (rows.some((row) => row.previewToken === input.previewToken)) {
    return { status: "preview_consumed" };
  }

  return { status: "not_found" };
}

async function ensureEnabledProviderEndpointsForIds(providerIds: number[]): Promise<void> {
  const uniqueIds = [...new Set(providerIds)].sort((a, b) => a - b);
  if (uniqueIds.length === 0) {
    return;
  }

  try {
    const enabledRows = await db
      .select({
        id: providers.id,
        providerVendorId: providers.providerVendorId,
        providerType: providers.providerType,
        url: providers.url,
      })
      .from(providers)
      .where(
        and(
          inArray(providers.id, uniqueIds),
          eq(providers.isEnabled, true),
          isNull(providers.deletedAt)
        )
      );

    if (enabledRows.length > 0) {
      await ensureEnabledProviderEndpoints(enabledRows, new Date());
    }
  } catch (error) {
    logger.warn("providerBatchApply:ensure_enabled_endpoints_failed", {
      providerIds: uniqueIds,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Reads the durable result before consulting the expiring Redis preview.
 * This is intentionally side-effect tolerant: replay also re-runs endpoint
 * reconciliation so a prior post-commit failure can heal on retry.
 */
export async function findProviderBatchApplyOperation(
  input: FindProviderBatchApplyOperationInput
): Promise<ProviderBatchApplyOperationLookupResult> {
  const now = new Date();
  const rows = await db
    .select()
    .from(providerBatchApplyOperations)
    .where(
      and(
        gt(providerBatchApplyOperations.expiresAt, now),
        or(
          eq(providerBatchApplyOperations.claimKey, input.claimKey),
          eq(providerBatchApplyOperations.previewToken, input.previewToken)
        )
      )
    );

  const resolved = resolveProviderBatchApplyOperation(rows, input, now);
  if (resolved.status === "replay") {
    await ensureEnabledProviderEndpointsForIds(resolved.result.effectiveProviderIds);
  }
  return resolved;
}

/**
 * Atomically claims a preview, validates its complete provider preimage,
 * applies the effective subset and persists the replay/undo result.
 */
export async function applyProviderBatchOperationIfUnchanged(
  input: ApplyProviderBatchOperationIfUnchangedInput
): Promise<ApplyProviderBatchOperationIfUnchangedResult> {
  if (!/^[a-f0-9]{64}$/i.test(input.payloadFingerprint)) {
    throw new Error("provider batch payload fingerprint must be a 64-character hex digest");
  }
  if (!Number.isInteger(input.undoTtlSeconds) || input.undoTtlSeconds < 1) {
    throw new Error("provider batch undo TTL must be a positive integer");
  }

  const expectedById = new Map(input.expectedPreimages.map((entry) => [entry.providerId, entry]));
  if (expectedById.size !== input.expectedPreimages.length || expectedById.size === 0) {
    return { status: "stale" };
  }

  const previewProviderIds = [...expectedById.keys()].sort((a, b) => a - b);
  const effectiveProviderIds = [...new Set(input.effectiveProviderIds)].sort((a, b) => a - b);
  if (
    effectiveProviderIds.length === 0 ||
    effectiveProviderIds.some((providerId) => !expectedById.has(providerId))
  ) {
    return { status: "stale" };
  }

  const effectiveIdSet = new Set(effectiveProviderIds);
  const groupProviderIds = new Set<number>();
  for (const group of input.groups) {
    for (const providerId of new Set(group.ids)) {
      if (groupProviderIds.has(providerId)) {
        throw new Error(`provider ${providerId} appears in multiple batch update groups`);
      }
      if (!effectiveIdSet.has(providerId) || !expectedById.has(providerId)) {
        return { status: "stale" };
      }
      groupProviderIds.add(providerId);
    }
  }

  const storedPreimages: ProviderBatchApplyStoredPreimage[] = [];
  for (const providerId of effectiveProviderIds) {
    const expected = expectedById.get(providerId);
    const isEnabled = expected?.values.isEnabled;
    const undoValues = input.undoPreimage[providerId];
    if (!expected || typeof isEnabled !== "boolean" || !undoValues) {
      return { status: "stale" };
    }
    if (Object.keys(undoValues).some((key) => SENSITIVE_PROVIDER_BATCH_UNDO_KEYS.has(key))) {
      throw new Error("provider batch durable undo preimage contains a sensitive field");
    }
    storedPreimages.push({
      providerId,
      providerType: expected.providerType,
      isEnabled,
      values: { ...undoValues },
    });
  }

  const claimStartedAt = new Date();
  const ledgerExpiresAt = new Date(claimStartedAt.getTime() + PROVIDER_BATCH_APPLY_LEDGER_TTL_MS);

  // Keep retention cleanup outside the provider-locking transaction so a large
  // expired backlog cannot extend the critical write section.
  await db
    .delete(providerBatchApplyOperations)
    .where(lt(providerBatchApplyOperations.expiresAt, claimStartedAt));

  try {
    const transactionResult = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(providerBatchApplyOperations)
        .values({
          claimKey: input.claimKey,
          previewToken: input.previewToken,
          payloadFingerprint: input.payloadFingerprint,
          operationId: input.operationId,
          undoToken: input.undoToken,
          undoExpiresAt: null,
          undoConsumedAt: null,
          status: "applying",
          result: null,
          expiresAt: ledgerExpiresAt,
          createdAt: claimStartedAt,
          updatedAt: claimStartedAt,
        })
        .onConflictDoNothing()
        .returning({ claimKey: providerBatchApplyOperations.claimKey });

      if (inserted.length === 0) {
        const existingRows = await tx
          .select()
          .from(providerBatchApplyOperations)
          .where(
            or(
              eq(providerBatchApplyOperations.claimKey, input.claimKey),
              eq(providerBatchApplyOperations.previewToken, input.previewToken)
            )
          );
        const resolved = resolveProviderBatchApplyOperation(existingRows, input, new Date());
        if (resolved.status === "not_found") {
          throw new Error("provider batch ledger conflict row disappeared");
        }
        return resolved;
      }

      const lockedRows = await tx
        .select()
        .from(providers)
        .where(and(inArray(providers.id, previewProviderIds), isNull(providers.deletedAt)))
        .orderBy(providers.id)
        .for("update");

      if (lockedRows.length !== previewProviderIds.length) {
        throw new ProviderBatchPreimageMismatchError();
      }

      for (const row of lockedRows) {
        const current = toProvider(row);
        const expected = expectedById.get(current.id);
        const expectedIsEnabled = expected?.values.isEnabled;
        if (
          !expected ||
          current.providerType !== expected.providerType ||
          typeof expectedIsEnabled !== "boolean" ||
          current.isEnabled !== expectedIsEnabled
        ) {
          throw new ProviderBatchPreimageMismatchError();
        }

        for (const [key, expectedValue] of Object.entries(expected.values)) {
          const providerKey = key as keyof Provider;
          if (!isProviderBatchPreimageValueEqual(current[providerKey], expectedValue)) {
            throw new ProviderBatchPreimageMismatchError();
          }
        }
      }

      const updateStartedAt = new Date();
      let updatedCount = 0;
      for (const group of input.groups) {
        const ids = [...new Set(group.ids)].sort((a, b) => a - b);
        const setClauses = buildProviderBatchSetClauses(group.updates, updateStartedAt);
        if (ids.length === 0 || Object.keys(setClauses).length === 1) {
          continue;
        }

        const updatedRows = await tx
          .update(providers)
          .set(setClauses)
          .where(and(inArray(providers.id, ids), isNull(providers.deletedAt)))
          .returning({ id: providers.id });

        if (updatedRows.length !== ids.length) {
          throw new ProviderBatchPreimageMismatchError();
        }
        if (group.updates.groupTag !== undefined) await syncProviderVendorsForGroupChange(ids, tx);
        updatedCount += updatedRows.length;
      }

      const appliedAt = new Date();
      const undoExpiresAt = new Date(appliedAt.getTime() + input.undoTtlSeconds * 1000);

      const result: ProviderBatchApplyLedgerResult = {
        applyResult: {
          operationId: input.operationId,
          appliedAt: appliedAt.toISOString(),
          updatedCount,
          undoToken: input.undoToken,
          undoExpiresAt: undoExpiresAt.toISOString(),
        },
        previewProviderIds,
        effectiveProviderIds,
        preimages: storedPreimages,
        undoRestorable: input.undoRestorable,
        postCommitEffects: input.postCommitEffects,
      };

      const completed = await tx
        .update(providerBatchApplyOperations)
        .set({
          status: "applied",
          result,
          undoExpiresAt,
          updatedAt: appliedAt,
        })
        .where(
          and(
            eq(providerBatchApplyOperations.claimKey, input.claimKey),
            eq(providerBatchApplyOperations.previewToken, input.previewToken),
            eq(providerBatchApplyOperations.payloadFingerprint, input.payloadFingerprint),
            eq(providerBatchApplyOperations.status, "applying")
          )
        )
        .returning({ claimKey: providerBatchApplyOperations.claimKey });

      if (completed.length !== 1) {
        throw new Error("provider batch ledger completion invariant failed");
      }

      return { status: "applied" as const, result, undoAvailable: true };
    });

    if (transactionResult.status === "applied" || transactionResult.status === "replay") {
      await ensureEnabledProviderEndpointsForIds(transactionResult.result.effectiveProviderIds);
    }

    return transactionResult;
  } catch (error) {
    if (error instanceof ProviderBatchPreimageMismatchError) {
      return { status: "stale" };
    }
    throw error;
  }
}

export type ConsumeProviderBatchUndoResult =
  | { status: "consumed" }
  | { status: "conflict" }
  | { status: "expired" };

export type FindProviderBatchUndoOperationResult =
  | { status: "available"; result: ProviderBatchApplyLedgerResult }
  | { status: "conflict" }
  | { status: "expired" };

export async function findProviderBatchUndoOperation(input: {
  undoToken: string;
  operationId: string;
  now: Date;
}): Promise<FindProviderBatchUndoOperationResult> {
  const [operation] = await db
    .select({
      operationId: providerBatchApplyOperations.operationId,
      undoExpiresAt: providerBatchApplyOperations.undoExpiresAt,
      undoConsumedAt: providerBatchApplyOperations.undoConsumedAt,
      status: providerBatchApplyOperations.status,
      result: providerBatchApplyOperations.result,
    })
    .from(providerBatchApplyOperations)
    .where(eq(providerBatchApplyOperations.undoToken, input.undoToken))
    .limit(1);

  if (operation && operation.operationId !== input.operationId) {
    return { status: "conflict" };
  }
  if (
    operation?.status !== "applied" ||
    operation.undoConsumedAt !== null ||
    operation.undoExpiresAt === null ||
    operation.undoExpiresAt <= input.now ||
    !operation.result ||
    !operation.result.undoRestorable
  ) {
    return { status: "expired" };
  }
  return { status: "available", result: operation.result };
}

export async function consumeProviderBatchUndo(input: {
  undoToken: string;
  operationId: string;
  consumedAt: Date;
}): Promise<ConsumeProviderBatchUndoResult> {
  const consumed = await db
    .update(providerBatchApplyOperations)
    .set({ undoConsumedAt: input.consumedAt, updatedAt: input.consumedAt })
    .where(
      and(
        eq(providerBatchApplyOperations.undoToken, input.undoToken),
        eq(providerBatchApplyOperations.operationId, input.operationId),
        eq(providerBatchApplyOperations.status, "applied"),
        isNull(providerBatchApplyOperations.undoConsumedAt),
        gt(providerBatchApplyOperations.undoExpiresAt, input.consumedAt)
      )
    )
    .returning({ claimKey: providerBatchApplyOperations.claimKey });

  if (consumed.length === 1) {
    return { status: "consumed" };
  }

  const [existing] = await db
    .select({
      operationId: providerBatchApplyOperations.operationId,
      undoExpiresAt: providerBatchApplyOperations.undoExpiresAt,
      undoConsumedAt: providerBatchApplyOperations.undoConsumedAt,
    })
    .from(providerBatchApplyOperations)
    .where(eq(providerBatchApplyOperations.undoToken, input.undoToken))
    .limit(1);

  if (existing && existing.operationId !== input.operationId) {
    return { status: "conflict" };
  }
  return { status: "expired" };
}

export type UndoProviderBatchOperationResult =
  | { status: "reverted"; revertedCount: number }
  | { status: "conflict" }
  | { status: "mismatch" }
  | { status: "expired" };

export async function undoProviderBatchOperation(input: {
  undoToken: string;
  operationId: string;
  groups: ProviderBatchUpdateGroup[];
  revertedAt: Date;
}): Promise<UndoProviderBatchOperationResult> {
  try {
    const result = await db.transaction(async (tx): Promise<UndoProviderBatchOperationResult> => {
      const [operation] = await tx
        .select({
          operationId: providerBatchApplyOperations.operationId,
          undoExpiresAt: providerBatchApplyOperations.undoExpiresAt,
          undoConsumedAt: providerBatchApplyOperations.undoConsumedAt,
          status: providerBatchApplyOperations.status,
        })
        .from(providerBatchApplyOperations)
        .where(eq(providerBatchApplyOperations.undoToken, input.undoToken))
        .for("update")
        .limit(1);

      if (operation && operation.operationId !== input.operationId) {
        return { status: "conflict" };
      }
      if (
        operation?.status !== "applied" ||
        operation.undoConsumedAt !== null ||
        operation.undoExpiresAt === null ||
        operation.undoExpiresAt <= input.revertedAt
      ) {
        return { status: "expired" };
      }

      let revertedCount = 0;
      for (const group of input.groups) {
        const ids = [...new Set(group.ids)].sort((a, b) => a - b);
        if (ids.length === 0) continue;
        const updated = await tx
          .update(providers)
          .set(buildProviderBatchSetClauses(group.updates, input.revertedAt))
          .where(and(inArray(providers.id, ids), isNull(providers.deletedAt)))
          .returning({ id: providers.id });
        if (updated.length !== ids.length) {
          throw new ProviderBatchPreimageMismatchError();
        }
        if (group.updates.groupTag !== undefined) await syncProviderVendorsForGroupChange(ids, tx);
        revertedCount += updated.length;
      }

      await tx
        .update(providerBatchApplyOperations)
        .set({ undoConsumedAt: input.revertedAt, updatedAt: input.revertedAt })
        .where(eq(providerBatchApplyOperations.undoToken, input.undoToken));

      return { status: "reverted", revertedCount };
    });

    if (result.status === "reverted") {
      await ensureEnabledProviderEndpointsForIds(
        input.groups.flatMap((group) => (group.updates.isEnabled === true ? group.ids : []))
      );
    }

    return result;
  } catch (error) {
    if (error instanceof ProviderBatchPreimageMismatchError) {
      return { status: "mismatch" };
    }
    throw error;
  }
}

export async function updateProviderBatchGroupsIfUnchanged(
  groups: ProviderBatchUpdateGroup[],
  expectedPreimages: ProviderBatchExpectedPreimage[]
): Promise<ProviderBatchConditionalUpdateResult> {
  const seenIds = new Set<number>();
  for (const group of groups) {
    for (const id of new Set(group.ids)) {
      if (seenIds.has(id)) {
        throw new Error(`provider ${id} appears in multiple batch update groups`);
      }
      seenIds.add(id);
    }
  }

  const expectedById = new Map(expectedPreimages.map((entry) => [entry.providerId, entry]));
  if (expectedById.size !== expectedPreimages.length) {
    return { status: "stale" };
  }

  const requestedIds = [...expectedById.keys()].sort((a, b) => a - b);
  if (requestedIds.length === 0) {
    return { status: "updated", updatedCount: 0 };
  }

  if ([...seenIds].some((id) => !expectedById.has(id))) {
    return { status: "stale" };
  }

  const now = new Date();

  try {
    const transactionResult = await db.transaction(async (tx) => {
      const lockedRows = await tx
        .select()
        .from(providers)
        .where(and(inArray(providers.id, requestedIds), isNull(providers.deletedAt)))
        .orderBy(providers.id)
        .for("update");

      if (lockedRows.length !== requestedIds.length) {
        throw new ProviderBatchPreimageMismatchError();
      }

      for (const row of lockedRows) {
        const current = toProvider(row);
        const expected = expectedById.get(current.id);
        if (!expected || current.providerType !== expected.providerType) {
          throw new ProviderBatchPreimageMismatchError();
        }

        for (const [key, expectedValue] of Object.entries(expected.values)) {
          const providerKey = key as keyof Provider;
          if (!isProviderBatchPreimageValueEqual(current[providerKey], expectedValue)) {
            throw new ProviderBatchPreimageMismatchError();
          }
        }
      }

      let updatedCount = 0;
      const enabledRows: ProviderBatchUpdatedRow[] = [];
      for (const group of groups) {
        const ids = [...new Set(group.ids)].sort((a, b) => a - b);
        const setClauses = buildProviderBatchSetClauses(group.updates, now);
        if (Object.keys(setClauses).length === 1) {
          continue;
        }

        const updatedRows = await tx
          .update(providers)
          .set(setClauses)
          .where(and(inArray(providers.id, ids), isNull(providers.deletedAt)))
          .returning({
            id: providers.id,
            providerVendorId: providers.providerVendorId,
            providerType: providers.providerType,
            url: providers.url,
          });

        if (updatedRows.length !== ids.length) {
          throw new ProviderBatchPreimageMismatchError();
        }

        updatedCount += updatedRows.length;
        if (group.updates.groupTag !== undefined) await syncProviderVendorsForGroupChange(ids, tx);
        if (group.updates.isEnabled === true) {
          enabledRows.push(...updatedRows);
        }
      }

      return { updatedCount, enabledRows };
    });

    if (transactionResult.enabledRows.length > 0) {
      await ensureEnabledProviderEndpoints(transactionResult.enabledRows, now);
    }

    logger.debug("updateProviderBatchGroupsIfUnchanged:completed", {
      requestedIds: requestedIds.length,
      updatedCount: transactionResult.updatedCount,
      groupCount: groups.length,
    });

    return { status: "updated", updatedCount: transactionResult.updatedCount };
  } catch (error) {
    if (error instanceof ProviderBatchPreimageMismatchError) {
      return { status: "stale" };
    }
    throw error;
  }
}

export async function deleteProvidersBatch(ids: number[]): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }

  const uniqueIds = [...new Set(ids)];
  const now = new Date();

  const deletedCount = await db.transaction(async (tx) => {
    const result = await tx
      .update(providers)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(inArray(providers.id, uniqueIds), isNull(providers.deletedAt)))
      .returning({
        id: providers.id,
        providerVendorId: providers.providerVendorId,
        providerType: providers.providerType,
        url: providers.url,
      });

    if (result.length === 0) {
      return 0;
    }

    const endpointKeys = new Map<
      string,
      { vendorId: number; providerType: Provider["providerType"]; url: string }
    >();

    for (const candidate of result) {
      if (candidate.providerVendorId == null || !candidate.url) {
        continue;
      }

      const key = `${candidate.providerVendorId}::${candidate.providerType}::${candidate.url}`;
      if (endpointKeys.has(key)) {
        continue;
      }

      endpointKeys.set(key, {
        vendorId: candidate.providerVendorId,
        providerType: candidate.providerType,
        url: candidate.url,
      });
    }

    const endpoints = Array.from(endpointKeys.values());
    if (endpoints.length === 0) {
      return result.length;
    }

    const chunkSize = 200;

    for (let i = 0; i < endpoints.length; i += chunkSize) {
      const chunk = endpoints.slice(i, i + chunkSize);
      const tupleList = sql.join(
        chunk.map(
          (endpoint) => sql`(${endpoint.vendorId}, ${endpoint.providerType}, ${endpoint.url})`
        ),
        sql`, `
      );

      await tx
        .update(providerEndpoints)
        .set({
          deletedAt: now,
          isEnabled: false,
          updatedAt: now,
        })
        .where(
          and(
            isNull(providerEndpoints.deletedAt),
            sql`(${providerEndpoints.vendorId}, ${providerEndpoints.providerType}, ${providerEndpoints.url}) IN (${tupleList})`,
            sql`NOT EXISTS (
              SELECT 1
              FROM providers p
              WHERE p.is_enabled = true
                AND p.deleted_at IS NULL
                AND p.provider_vendor_id = ${providerEndpoints.vendorId}
                AND p.provider_type = ${providerEndpoints.providerType}
                AND p.url = ${providerEndpoints.url}
            )`
          )
        );
    }

    return result.length;
  });

  logger.debug("deleteProvidersBatch:completed", {
    requestedIds: uniqueIds.length,
    deletedCount,
  });

  return deletedCount;
}

/**
 * 批量恢复软删除供应商及其关联端点（事务内逐个恢复）。
 *
 * 安全策略：仅允许恢复 60 秒内删除的供应商。
 */
export async function restoreProvidersBatch(ids: number[]): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }

  const uniqueIds = [...new Set(ids)];
  const now = new Date();

  const restoredCount = await db.transaction(async (tx) => {
    let restored = 0;

    for (const id of uniqueIds) {
      if (await restoreProviderInTransaction(tx, id, now)) {
        restored += 1;
      }
    }

    return restored;
  });

  logger.debug("restoreProvidersBatch:completed", {
    requestedIds: uniqueIds.length,
    restoredCount,
  });

  return restoredCount;
}

/**
 * 手动重置供应商"总消费"统计起点
 *
 * 说明：
 * - 不删除 message_request 历史记录，仅通过 resetAt 作为聚合下限实现“从 0 重新累计”。
 */
export async function resetProviderTotalCostResetAt(
  providerId: number,
  resetAt: Date
): Promise<boolean> {
  const [target] = await db
    .select({ id: providers.id, protocolGroupId: providers.protocolGroupId })
    .from(providers)
    .where(and(eq(providers.id, providerId), isNull(providers.deletedAt)))
    .limit(1);

  if (!target) {
    return false;
  }

  const scopeCondition = target.protocolGroupId
    ? eq(providers.protocolGroupId, target.protocolGroupId)
    : eq(providers.id, providerId);

  const result = await db
    .update(providers)
    .set({ totalCostResetAt: resetAt, updatedAt: new Date() })
    .where(and(scopeCondition, isNull(providers.deletedAt)))
    .returning({ id: providers.id });

  return result.length > 0;
}

/**
 * 获取所有不同的供应商分组标签
 * 用于用户表单中的供应商分组选择建议
 *
 * 注意：groupTag 字段以逗号分隔存储多个标签（如 "cli,chat"），
 * 此函数会拆分并去重，返回单个标签的数组（如 ["chat", "cli"]）
 */
export async function getDistinctProviderGroups(): Promise<string[]> {
  const result = await db
    .selectDistinct({ groupTag: providers.groupTag })
    .from(providers)
    .where(
      and(
        isNull(providers.deletedAt),
        and(isNotNull(providers.groupTag), ne(providers.groupTag, ""))
      )
    )
    .orderBy(providers.groupTag);

  // 拆分逗号分隔的标签并去重
  const allTags = result
    .map((r) => r.groupTag)
    .filter((tag): tag is string => tag !== null)
    .flatMap((tag) => parseProviderGroups(tag));

  return [...new Set(allTags)].sort();
}

/**
 * 获取所有供应商的统计信息
 * 包括：今天的总金额、今天的调用次数、最近一次调用时间和模型
 *
 * 性能优化：
 * - provider_stats: 先按最终供应商聚合，再与 providers 做 LEFT JOIN，避免 providers × usage_ledger 的笛卡尔积
 * - bounds: 用“按时区计算的时间范围”过滤 created_at，便于命中 created_at 索引
 * - DST 兼容：对“本地日界/近 7 日”先在 timestamp 上做 +interval，再 AT TIME ZONE 回到 timestamptz，避免夏令时跨日偏移
 * - latest_call: 限制近 7 天范围，避免扫描历史数据
 */
export type ProviderStatisticsRow = {
  id: number;
  today_cost: string;
  today_calls: number;
  last_call_time: Date | null;
  last_call_model: string | null;
};

// 轻量内存缓存：降低后台轮询/重复加载导致的重复扫描
const PROVIDER_STATISTICS_CACHE_TTL_MS = 10 * 1000; // 10 秒
let providerStatisticsCache: {
  timezone: string;
  expiresAt: number;
  data: ProviderStatisticsRow[];
} | null = null;

// in-flight 去重：避免缓存过期瞬间并发触发多次相同查询（thundering herd）
let providerStatisticsInFlight: {
  timezone: string;
  promise: Promise<ProviderStatisticsRow[]>;
} | null = null;

export async function getProviderStatistics(): Promise<ProviderStatisticsRow[]> {
  try {
    // 统一的时区处理：使用 PostgreSQL AT TIME ZONE + 系统时区配置
    // 参考 getUserStatisticsFromDB 的实现，避免 Node.js Date 带来的时区偏移
    const timezone = await resolveSystemTimezone();
    const now = Date.now();
    if (
      providerStatisticsCache &&
      providerStatisticsCache.expiresAt > now &&
      providerStatisticsCache.timezone === timezone
    ) {
      return providerStatisticsCache.data;
    }

    if (providerStatisticsInFlight && providerStatisticsInFlight.timezone === timezone) {
      return await providerStatisticsInFlight.promise;
    }

    const promise: Promise<ProviderStatisticsRow[]> = (async () => {
      const query = sql`
         WITH bounds AS (
           SELECT
             (DATE_TRUNC('day', CURRENT_TIMESTAMP AT TIME ZONE ${timezone}) AT TIME ZONE ${timezone}) AS today_start,
             ((DATE_TRUNC('day', CURRENT_TIMESTAMP AT TIME ZONE ${timezone}) + INTERVAL '1 day') AT TIME ZONE ${timezone}) AS tomorrow_start,
             ((DATE_TRUNC('day', CURRENT_TIMESTAMP AT TIME ZONE ${timezone}) - INTERVAL '7 days') AT TIME ZONE ${timezone}) AS last7_start
         ),
         provider_stats AS (
           -- 先按最终供应商聚合，再与 providers 做 LEFT JOIN，避免 providers × 今日请求 的笛卡尔积
           SELECT
            final_provider_id,
            COALESCE(SUM(cost_usd), 0) AS today_cost,
            COUNT(*)::integer AS today_calls
          FROM usage_ledger
          WHERE blocked_by IS NULL
            AND is_replay = false
            AND created_at >= (SELECT today_start FROM bounds)
            AND created_at < (SELECT tomorrow_start FROM bounds)
          GROUP BY final_provider_id
        ),
        latest_call AS (
          SELECT DISTINCT ON (final_provider_id)
            final_provider_id,
            created_at AS last_call_time,
            model AS last_call_model
          FROM usage_ledger
          WHERE blocked_by IS NULL
            AND is_replay = false
            AND created_at >= (SELECT last7_start FROM bounds)
          -- 性能优化：添加 7 天时间范围限制（避免扫描历史数据）
          ORDER BY final_provider_id, created_at DESC, id DESC
        )
        SELECT
          p.id,
          COALESCE(ps.today_cost, 0) AS today_cost,
          COALESCE(ps.today_calls, 0) AS today_calls,
          lc.last_call_time,
          lc.last_call_model
        FROM providers p
        LEFT JOIN provider_stats ps ON p.id = ps.final_provider_id
        LEFT JOIN latest_call lc ON p.id = lc.final_provider_id
        WHERE p.deleted_at IS NULL
        ORDER BY p.id ASC
      `;

      logger.trace("getProviderStatistics:executing_query");

      const result = await db.execute(query);
      const data = Array.from(result) as ProviderStatisticsRow[];

      logger.trace("getProviderStatistics:result", {
        count: data.length,
      });

      // 注意：返回结果中的 today_cost 为 numeric，使用字符串表示；
      // last_call_time 由数据库返回为时间戳（UTC）。
      // 这里保持原样，交由上层进行展示格式化。
      providerStatisticsCache = {
        timezone,
        expiresAt: Date.now() + PROVIDER_STATISTICS_CACHE_TTL_MS,
        data,
      };

      return data;
    })();

    // Set in-flight BEFORE awaiting to prevent concurrent callers from starting duplicate queries
    providerStatisticsInFlight = { timezone, promise };

    try {
      return await promise;
    } finally {
      if (providerStatisticsInFlight?.promise === promise) {
        providerStatisticsInFlight = null;
      }
    }
  } catch (error) {
    logger.trace("getProviderStatistics:error", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}
