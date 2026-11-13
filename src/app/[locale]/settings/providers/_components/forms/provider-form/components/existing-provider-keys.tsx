"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { editProvider, getProviders } from "@/lib/api-client/v1/actions/providers";
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
          key.providerType === provider.providerType
        : key.id === provider.id
    )
    .toSorted((left, right) => left.id - right.id);

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
      {keys.map((key, index) => (
        <div
          key={key.id}
          className="flex items-center justify-between gap-3 rounded-md border p-3"
          data-testid={`existing-provider-key-${key.id}`}
        >
          <div className="min-w-0">
            <p className="text-sm font-medium">{t("entryLabel", { number: index + 1 })}</p>
            <p className="truncate font-mono text-xs text-muted-foreground">{key.maskedKey}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {key.isEnabled ? t("enabled") : t("disabled")}
            </span>
            <Switch
              checked={key.isEnabled}
              onCheckedChange={(enabled) => void toggleKey(key, enabled)}
              disabled={disabled || isLoading || isError || pendingId !== null}
              aria-label={t("enabledLabel", { number: index + 1 })}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
