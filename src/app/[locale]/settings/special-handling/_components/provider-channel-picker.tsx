"use client";

import { ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { resolveProviderGroupsWithDefault } from "@/lib/utils/provider-group";
import type { ProviderDisplay } from "@/types/provider";

export type SpecialHandlingProvider = Pick<
  ProviderDisplay,
  "id" | "name" | "providerType" | "groupTag" | "priority" | "groupPriorities"
>;

export function ProviderChannelPicker({
  providers,
  selectedIds,
  onToggle,
  label,
  toggleLabel,
  testId,
  codexOnly = false,
  disabled = false,
}: {
  providers: SpecialHandlingProvider[];
  selectedIds: readonly number[];
  onToggle: (id: number) => void;
  label: string;
  toggleLabel: string;
  testId: string;
  codexOnly?: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations("settings.config.form.channelPicker");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const selected = new Set(selectedIds);
  const groups = useMemo(
    () =>
      [
        ...new Set(
          providers.flatMap((provider) => resolveProviderGroupsWithDefault(provider.groupTag))
        ),
      ].sort(),
    [providers]
  );
  const visible = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return providers
      .filter((provider) => {
        const tags = resolveProviderGroupsWithDefault(provider.groupTag);
        return (
          (!group || tags.includes(group)) &&
          (!search ||
            `${provider.name} ${provider.id} ${provider.providerType} ${tags.join(" ")}`
              .toLocaleLowerCase()
              .includes(search))
        );
      })
      .toSorted((left, right) => {
        const priority = (provider: SpecialHandlingProvider) =>
          group ? (provider.groupPriorities?.[group] ?? provider.priority) : provider.priority;
        return (
          priority(left) - priority(right) ||
          left.name.localeCompare(right.name) ||
          left.id - right.id
        );
      });
  }, [providers, query, group]);
  const selectedCount = providers.filter(
    (provider) => selected.has(provider.id) && (!codexOnly || provider.providerType === "codex")
  ).length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className="w-full justify-between"
          aria-label={label}
          data-testid={`${testId}-picker`}
        >
          {t("selection", { selected: selectedCount, total: providers.length })}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] space-y-3 p-3"
      >
        <Input
          aria-label={t("search")}
          placeholder={t("search")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={disabled}
        />
        <select
          aria-label={t("group")}
          value={group}
          onChange={(event) => setGroup(event.target.value)}
          disabled={disabled}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">{t("allGroups")}</option>
          {groups.map((tag) => (
            <option key={tag} value={tag}>
              {tag === "default" ? t("defaultGroup") : tag}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {t("results", { count: visible.length, total: providers.length })}
        </p>
        <div
          className="max-h-72 space-y-2 overflow-y-auto overscroll-contain"
          data-testid={`${testId}-list`}
        >
          {visible.length === 0 && (
            <p className="py-3 text-center text-sm text-muted-foreground">{t("noResults")}</p>
          )}
          {visible.map((provider) => {
            const supported = !codexOnly || provider.providerType === "codex";
            return (
              <div
                key={provider.id}
                data-testid={`${testId}-provider-${provider.id}`}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="break-words text-sm font-medium">{provider.name}</p>
                  <p className="break-words text-xs text-muted-foreground">
                    #{provider.id} · {provider.providerType} ·{" "}
                    {resolveProviderGroupsWithDefault(provider.groupTag)
                      .map((tag) => (tag === "default" ? t("defaultGroup") : tag))
                      .join(", ")}
                  </p>
                  {!supported && <p className="text-xs text-muted-foreground">{t("codexOnly")}</p>}
                </div>
                <Switch
                  checked={supported && selected.has(provider.id)}
                  onCheckedChange={() => onToggle(provider.id)}
                  disabled={disabled || !supported}
                  aria-label={toggleLabel.replace("{name}", `${provider.name} (#${provider.id})`)}
                />
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
