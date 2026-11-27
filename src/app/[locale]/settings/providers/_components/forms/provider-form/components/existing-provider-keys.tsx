"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import {
  batchUpdateProviders,
  editProvider,
  getProviders,
} from "@/lib/api-client/v1/actions/providers";
import { groupProviderKeyConfigurations } from "@/lib/provider-key-groups";
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

  const toggleKeyGroup = async (configurations: ProviderDisplay[], enabled: boolean) => {
    const primary = configurations[0];
    const targetIds = configurations.map((item) => item.id);
    const targetIdSet = new Set(targetIds);

    setPendingId(primary.id);
    setError(null);
    try {
      const result =
        targetIds.length > 1
          ? await batchUpdateProviders({
              providerIds: targetIds,
              updates: { is_enabled: enabled },
            })
          : await editProvider(primary.id, { is_enabled: enabled });
      if (!result.ok) throw new Error(result.error || tList("toggleFailed"));
      queryClient.setQueryData<ProviderDisplay[]>(["providers"], (current) =>
        current?.map((item) => (targetIdSet.has(item.id) ? { ...item, isEnabled: enabled } : item))
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
        const isGroupEnabled = configurations.some((item) => item.isEnabled);
        return (
          <div
            key={key.id}
            className="flex items-center justify-between gap-3 rounded-md border p-3"
            data-testid={`existing-provider-key-${key.id}`}
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{t("entryLabel", { number: index + 1 })}</p>
              <p className="truncate font-mono text-xs text-muted-foreground">{key.maskedKey}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {isGroupEnabled ? t("enabled") : t("disabled")}
              </span>
              <Switch
                checked={isGroupEnabled}
                onCheckedChange={(enabled) => void toggleKeyGroup(configurations, enabled)}
                disabled={disabled || isLoading || isError || pendingId !== null}
                aria-label={t("enabledLabel", { number: index + 1 })}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
