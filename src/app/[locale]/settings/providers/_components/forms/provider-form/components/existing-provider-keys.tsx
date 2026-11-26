"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, ChevronDown, Copy, Eye, EyeOff, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { normalizeAllowedModelRules } from "@/lib/allowed-model-rules";
import {
  editProvider,
  getProviders,
  getUnmaskedProviderKey,
} from "@/lib/api-client/v1/actions/providers";
import { useRequestFilters } from "@/lib/api-client/v1/request-filters/hooks";
import {
  groupProviderKeyConfigurations,
  matchesProviderRequestFilter,
} from "@/lib/provider-key-groups";
import { copyToClipboard } from "@/lib/utils/clipboard";
import { normalizeProviderGroup } from "@/lib/utils/provider-group";
import type { ProviderDisplay, ProviderType } from "@/types/provider";
import { invalidateProviderQueries } from "../../../invalidate-provider-queries";

export function ExistingProviderKeys({
  provider,
  activeProtocol: _activeProtocol,
  disabled = false,
}: {
  provider: ProviderDisplay;
  activeProtocol?: ProviderType;
  disabled?: boolean;
}) {
  const t = useTranslations("settings.providers.form.key");
  const tList = useTranslations("settings.providers.list");
  const queryClient = useQueryClient();
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealedKeys, setRevealedKeys] = useState<Record<number, string>>({});
  const [loadingRevealId, setLoadingRevealId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const {
    data: providers,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["providers"],
    queryFn: getProviders,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const sourceProviders = providers ?? [provider];
  const keys = (() => {
    // 多协议逻辑渠道：纳入同 protocolGroupId 下的全部记录，groupProviderKeyConfigurations 会按 keyGroupId 去重合并，
    // 既能一次查看全部不同密钥（含并入的不同密钥），又可展开管理每条协议配置的独立开关。
    if (provider.protocolGroupId) {
      return sourceProviders
        .filter((item) => item.protocolGroupId === provider.protocolGroupId)
        .toSorted((left, right) => left.id - right.id);
    }
    return sourceProviders
      .filter((key) =>
        provider.providerVendorId
          ? key.providerVendorId === provider.providerVendorId &&
            key.providerType === provider.providerType &&
            normalizeProviderGroup(key.groupTag) === normalizeProviderGroup(provider.groupTag)
          : key.id === provider.id
      )
      .toSorted((left, right) => left.id - right.id);
  })();
  const keyGroups = groupProviderKeyConfigurations(keys);
  const filters = useRequestFilters({ enabled: keyGroups.some((group) => group.length > 1) });

  const resolvePlainKey = async (keyId: number): Promise<string | null> => {
    if (revealedKeys[keyId]) return revealedKeys[keyId];
    setLoadingRevealId(keyId);
    try {
      const res = await getUnmaskedProviderKey(keyId);
      if (!res.ok) {
        toast.error(tList("getKeyFailed"), {
          description: res.error || tList("unknownError"),
        });
        return null;
      }
      return res.data.key;
    } catch {
      toast.error(tList("getKeyFailed"), { description: tList("unknownError") });
      return null;
    } finally {
      setLoadingRevealId((curr) => (curr === keyId ? null : curr));
    }
  };

  const handleToggleReveal = async (keyId: number) => {
    if (revealedKeys[keyId]) {
      setRevealedKeys((prev) => {
        const next = { ...prev };
        delete next[keyId];
        return next;
      });
      return;
    }
    const plainKey = await resolvePlainKey(keyId);
    if (plainKey) {
      setRevealedKeys((prev) => ({ ...prev, [keyId]: plainKey }));
    }
  };

  const handleCopyPlainKey = async (keyId: number) => {
    const plainKey = await resolvePlainKey(keyId);
    if (!plainKey) return;
    const ok = await copyToClipboard(plainKey);
    if (ok) {
      setCopiedId(keyId);
      toast.success(tList("keyCopied"));
      setTimeout(() => setCopiedId((curr) => (curr === keyId ? null : curr)), 2500);
    } else {
      toast.error(tList("copyFailed"));
    }
  };

  const renderKeyActions = (keyId: number) => {
    const isRevealed = Boolean(revealedKeys[keyId]);
    const isLoadingThis = loadingRevealId === keyId;
    return (
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          disabled={disabled || isLoadingThis}
          aria-label={isRevealed ? t("hideFullKey") : t("showFullKey")}
          title={isRevealed ? t("hideFullKey") : t("showFullKey")}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void handleToggleReveal(keyId);
          }}
        >
          {isLoadingThis ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : isRevealed ? (
            <EyeOff className="h-3.5 w-3.5" />
          ) : (
            <Eye className="h-3.5 w-3.5" />
          )}
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          disabled={disabled || isLoadingThis}
          aria-label={t("copyFullKey")}
          title={t("copyFullKey")}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void handleCopyPlainKey(keyId);
          }}
        >
          {copiedId === keyId ? (
            <CheckCircle className="h-3.5 w-3.5 text-green-600" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    );
  };

  const toggleKey = async (key: ProviderDisplay, enabled: boolean) => {
    setPendingId(key.id);
    setError(null);
    try {
      const result = await editProvider(key.id, { is_enabled: enabled });
      if (!result.ok) throw new Error(result.error || tList("toggleFailed"));
      queryClient.setQueryData<ProviderDisplay[]>(["providers"], (current) =>
        current?.map((item) => (item.id === key.id ? { ...item, isEnabled: enabled } : item))
      );
      await invalidateProviderQueries(queryClient);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : tList("toggleFailed");
      setError(message);
      toast.error(message);
    } finally {
      setPendingId(null);
    }
  };

  const renderSwitch = (configuration: ProviderDisplay, label: string) => (
    <div className="flex shrink-0 items-center gap-2">
      <span className="text-xs text-muted-foreground">
        {configuration.isEnabled ? t("enabled") : t("disabled")}
      </span>
      <Switch
        checked={configuration.isEnabled}
        onCheckedChange={(enabled) => void toggleKey(configuration, enabled)}
        disabled={disabled || isLoading || isError || pendingId !== null}
        aria-label={label}
      />
    </div>
  );

  const renderConfiguration = (configuration: ProviderDisplay) => {
    const models = normalizeAllowedModelRules(configuration.allowedModels) ?? [];
    const title =
      models.length === 0
        ? t("generalConfiguration")
        : models.every((model) => model.pattern.toLowerCase().includes("haiku"))
          ? t("haikuConfiguration")
          : t("modelConfiguration");
    const budget = configuration.anthropicThinkingBudgetPreference;
    const matchingFilters = (filters.data?.items ?? []).filter((filter) =>
      matchesProviderRequestFilter(filter, configuration)
    );
    return (
      <div
        key={configuration.id}
        className="space-y-2 rounded-md bg-muted/30 p-3"
        data-testid={`provider-key-configuration-${configuration.id}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{title}</p>
            <p className="break-all text-xs text-muted-foreground">{configuration.name}</p>
            {configuration.id === provider.id && (
              <p className="text-xs text-muted-foreground">{t("currentConfiguration")}</p>
            )}
          </div>
          {renderSwitch(
            configuration,
            t("configurationEnabledLabel", { name: configuration.name })
          )}
        </div>
        <dl className="space-y-1 text-xs">
          <div>
            <dt className="inline text-muted-foreground">{t("configurationModels")}: </dt>
            <dd className="inline break-all">
              {models.length === 0
                ? t("allModels")
                : models
                    .map((model) => `${model.pattern} (${t(`matchTypes.${model.matchType}`)})`)
                    .join(", ")}
            </dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">{t("configurationPriority")}: </dt>
            <dd className="inline">{configuration.priority}</dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">{t("configurationThinking")}: </dt>
            <dd className="inline">
              {budget && budget !== "inherit"
                ? t("thinkingTokens", { tokens: budget })
                : t("inheritThinking")}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("configurationFilters")}: </dt>
            <dd>
              {filters.isError ? (
                <span role="alert">{t("filtersLoadFailed")}</span>
              ) : filters.isPending ? (
                t("filtersLoading")
              ) : matchingFilters.length === 0 ? (
                t("noFilters")
              ) : (
                <ul className="space-y-1">
                  {matchingFilters.map((filter) => (
                    <li key={filter.id} className="break-all">
                      {filter.name} · {filter.target} ·{" "}
                      {filter.isEnabled ? t("enabled") : t("disabled")}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
        </dl>
      </div>
    );
  };

  return (
    <div className="space-y-3" data-testid="existing-provider-keys">
      <p className="text-sm font-medium">{t("existingTitle")}</p>
      <p className="text-xs text-muted-foreground">{t("existingDesc")}</p>
      <p className="text-xs text-muted-foreground">{t("channelSettingsDesc")}</p>
      {isLoading && <p className="text-xs text-muted-foreground">{tList("keyLoading")}</p>}
      {isError && (
        <p role="alert" className="text-xs text-destructive">
          {t("loadFailed")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {keyGroups.map((configurations, index) => {
        const key = configurations[0];
        const plainKey = revealedKeys[key.id];
        if (configurations.length > 1) {
          return (
            <details
              key={key.id}
              className="group rounded-md border"
              data-testid={`existing-provider-key-${key.id}`}
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-3 [&::-webkit-details-marker]:hidden">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{t("entryLabel", { number: index + 1 })}</p>
                  <p
                    className={
                      plainKey
                        ? "break-all font-mono text-xs text-foreground"
                        : "truncate font-mono text-xs text-muted-foreground"
                    }
                  >
                    {plainKey ?? key.maskedKey}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("configurationCount", { count: configurations.length })}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {renderKeyActions(key.id)}
                  <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
                </div>
              </summary>
              <div className="space-y-2 border-t p-3">
                <p className="text-xs text-muted-foreground">{t("configurationDesc")}</p>
                {configurations.map(renderConfiguration)}
              </div>
            </details>
          );
        }
        return (
          <div
            key={key.id}
            className="flex items-center justify-between gap-3 rounded-md border p-3"
            data-testid={`existing-provider-key-${key.id}`}
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{t("entryLabel", { number: index + 1 })}</p>
              <p
                className={
                  plainKey
                    ? "break-all font-mono text-xs text-foreground"
                    : "truncate font-mono text-xs text-muted-foreground"
                }
              >
                {plainKey ?? key.maskedKey}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {renderKeyActions(key.id)}
              {renderSwitch(key, t("enabledLabel", { number: index + 1 }))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
