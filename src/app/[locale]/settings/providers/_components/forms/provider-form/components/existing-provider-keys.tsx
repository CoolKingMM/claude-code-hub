"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { normalizeAllowedModelRules } from "@/lib/allowed-model-rules";
import { editProvider, getProviders } from "@/lib/api-client/v1/actions/providers";
import { useRequestFilters } from "@/lib/api-client/v1/request-filters/hooks";
import {
  groupProviderKeyConfigurations,
  matchesProviderRequestFilter,
} from "@/lib/provider-key-groups";
import { normalizeProviderGroup } from "@/lib/utils/provider-group";
import type { ProviderDisplay } from "@/types/provider";
import { invalidateProviderQueries } from "../../../invalidate-provider-queries";

export function ExistingProviderKeys({
  provider,
  disabled = false,
}: {
  provider: ProviderDisplay;
  disabled?: boolean;
}) {
  const t = useTranslations("settings.providers.form.key");
  const tList = useTranslations("settings.providers.list");
  const queryClient = useQueryClient();
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  const keys = (providers ?? [provider])
    .filter((key) =>
      provider.providerVendorId
        ? key.providerVendorId === provider.providerVendorId &&
          key.providerType === provider.providerType &&
          normalizeProviderGroup(key.groupTag) === normalizeProviderGroup(provider.groupTag)
        : key.id === provider.id
    )
    .toSorted((left, right) => left.id - right.id);
  const keyGroups = groupProviderKeyConfigurations(keys);
  const filters = useRequestFilters({ enabled: keyGroups.some((group) => group.length > 1) });

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
        if (configurations.length > 1) {
          return (
            <details
              key={key.id}
              className="group rounded-md border"
              data-testid={`existing-provider-key-${key.id}`}
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-3 [&::-webkit-details-marker]:hidden">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{t("entryLabel", { number: index + 1 })}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {key.maskedKey}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("configurationCount", { count: configurations.length })}
                  </p>
                </div>
                <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
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
            <div className="min-w-0">
              <p className="text-sm font-medium">{t("entryLabel", { number: index + 1 })}</p>
              <p className="truncate font-mono text-xs text-muted-foreground">{key.maskedKey}</p>
            </div>
            {renderSwitch(key, t("enabledLabel", { number: index + 1 }))}
          </div>
        );
      })}
    </div>
  );
}
