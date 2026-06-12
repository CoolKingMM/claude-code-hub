"use client";

import { ChevronDown, ShieldAlert, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { saveSystemSettings } from "@/lib/api-client/v1/actions/system-config";
import {
  DEFAULT_PROVIDER_OUTPUT_SAFETY_FILTER_RULES,
  validateProviderOutputSafetyFilterRule,
} from "@/lib/provider-output-safety-rules";
import { cn } from "@/lib/utils";
import type { ProviderDisplay } from "@/types/provider";
import type { SystemSettings } from "@/types/system-config";

type SpecialHandlingProvider = Pick<
  ProviderDisplay,
  "id" | "name" | "groupTag" | "providerType" | "isEnabled"
>;

type SpecialHandlingFormProps = {
  initialSettings: Pick<
    SystemSettings,
    | "fakeStreamingProviderIds"
    | "enableProviderOutputSafetyFilter"
    | "providerOutputSafetyFilterRules"
  >;
  providers: SpecialHandlingProvider[];
  labels: SpecialHandlingFormLabels;
};

const DEFAULT_PROVIDER_OUTPUT_SAFETY_FILTER_RULES_TEXT =
  DEFAULT_PROVIDER_OUTPUT_SAFETY_FILTER_RULES.join("\n");

export type SpecialHandlingFormLabels = {
  fakeStreaming: {
    title: string;
    description: string;
    emptyState: string;
    providerLabel: string;
    selectedCount: string;
    selectAll: string;
    clearAll: string;
    noProviders: string;
    providerIdLabel: string;
    groupLabel: string;
    defaultGroup: string;
    enabledStatus: string;
    disabledStatus: string;
  };
  providerOutputSafety: {
    title: string;
    description: string;
    editRules: string;
    rulesLabel: string;
    rulesHint: string;
    invalidRule: string;
    resetToDefault: string;
  };
  saveSettings: string;
  saving: string;
  saveFailed: string;
  configUpdated: string;
};

function formatProviderOutputSafetyFilterRules(rules: readonly string[]): string {
  return rules.join("\n");
}

function parseProviderOutputSafetyFilterRules(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function sanitizeProviderIds(providerIds: readonly number[]): number[] {
  const seen = new Set<number>();
  const result: number[] = [];
  for (const providerId of providerIds) {
    if (!Number.isSafeInteger(providerId) || providerId <= 0 || seen.has(providerId)) continue;
    seen.add(providerId);
    result.push(providerId);
  }
  return result;
}

function formatGroupTag(groupTag: string | null, defaultGroup: string): string {
  const trimmed = groupTag?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : defaultGroup;
}

function selectedCountLabel(template: string, count: number): string {
  return template.replace("{count}", String(count));
}

export function SpecialHandlingForm({
  initialSettings,
  providers,
  labels,
}: SpecialHandlingFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedProviderIds, setSelectedProviderIds] = useState<number[]>(() =>
    sanitizeProviderIds(initialSettings.fakeStreamingProviderIds ?? [])
  );
  const [enableProviderOutputSafetyFilter, setEnableProviderOutputSafetyFilter] = useState(
    initialSettings.enableProviderOutputSafetyFilter
  );
  const [providerOutputSafetyFilterRulesText, setProviderOutputSafetyFilterRulesText] =
    useState<string>(
      formatProviderOutputSafetyFilterRules(initialSettings.providerOutputSafetyFilterRules)
    );
  const [providerOutputSafetyFilterOpen, setProviderOutputSafetyFilterOpen] = useState(false);

  const selectedProviderIdSet = new Set(selectedProviderIds);
  const inputClassName =
    "bg-muted/50 border border-border rounded-lg focus:border-primary focus:ring-1 focus:ring-primary";

  const toggleProvider = (providerId: number) => {
    setSelectedProviderIds((current) => {
      if (current.includes(providerId)) {
        return current.filter((id) => id !== providerId);
      }
      return sanitizeProviderIds([...current, providerId]);
    });
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const providerOutputSafetyFilterRulesToSave = parseProviderOutputSafetyFilterRules(
      providerOutputSafetyFilterRulesText
    );
    for (let index = 0; index < providerOutputSafetyFilterRulesToSave.length; index += 1) {
      const error = validateProviderOutputSafetyFilterRule(
        providerOutputSafetyFilterRulesToSave[index]
      );
      if (error) {
        toast.error(
          labels.providerOutputSafety.invalidRule
            .replace("{line}", String(index + 1))
            .replace("{message}", error)
        );
        return;
      }
    }

    const fakeStreamingProviderIds = sanitizeProviderIds(selectedProviderIds);

    startTransition(async () => {
      const result = await saveSystemSettings({
        fakeStreamingProviderIds,
        enableProviderOutputSafetyFilter,
        providerOutputSafetyFilterRules: providerOutputSafetyFilterRulesToSave,
      });

      if (!result.ok) {
        toast.error(result.error || labels.saveFailed);
        return;
      }

      if (result.data) {
        setSelectedProviderIds(sanitizeProviderIds(result.data.fakeStreamingProviderIds ?? []));
        setEnableProviderOutputSafetyFilter(result.data.enableProviderOutputSafetyFilter);
        setProviderOutputSafetyFilterRulesText(
          formatProviderOutputSafetyFilterRules(result.data.providerOutputSafetyFilterRules)
        );
      }

      toast.success(labels.configUpdated);
      router.refresh();
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 space-y-4 hover:bg-white/[0.04] transition-colors">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-orange-500/10 text-orange-400 shrink-0">
            <Zap className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{labels.fakeStreaming.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {labels.fakeStreaming.description}
            </p>
          </div>
        </div>

        <div className="space-y-3 pl-0 md:pl-11">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                {labels.fakeStreaming.providerLabel}
              </Label>
              <p className="text-xs text-muted-foreground">
                {selectedProviderIds.length === 0
                  ? labels.fakeStreaming.emptyState
                  : selectedCountLabel(
                      labels.fakeStreaming.selectedCount,
                      selectedProviderIds.length
                    )}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelectedProviderIds(providers.map((provider) => provider.id))}
                disabled={isPending || providers.length === 0}
              >
                {labels.fakeStreaming.selectAll}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelectedProviderIds([])}
                disabled={isPending || selectedProviderIds.length === 0}
              >
                {labels.fakeStreaming.clearAll}
              </Button>
            </div>
          </div>

          {providers.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              {labels.fakeStreaming.noProviders}
            </p>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {providers.map((provider) => {
                const selected = selectedProviderIdSet.has(provider.id);
                return (
                  <label
                    key={provider.id}
                    data-testid={`fake-streaming-provider-${provider.id}`}
                    className={cn(
                      "flex min-h-[92px] w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                      isPending
                        ? "cursor-not-allowed opacity-70"
                        : "cursor-pointer bg-muted/20 hover:bg-muted/35",
                      selected
                        ? "border-primary/60 bg-primary/10"
                        : "border-white/5 hover:border-white/10"
                    )}
                  >
                    <Checkbox
                      checked={selected}
                      onCheckedChange={() => toggleProvider(provider.id)}
                      disabled={isPending}
                      aria-label={`${labels.fakeStreaming.providerLabel}: ${provider.name}`}
                      className="mt-0.5"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-foreground">
                          {provider.name}
                        </span>
                        <Badge variant="secondary" className="text-[11px]">
                          {provider.providerType}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[11px]",
                            provider.isEnabled
                              ? "border-emerald-500/30 text-emerald-400"
                              : "border-muted-foreground/30 text-muted-foreground"
                          )}
                        >
                          {provider.isEnabled
                            ? labels.fakeStreaming.enabledStatus
                            : labels.fakeStreaming.disabledStatus}
                        </Badge>
                      </span>
                      <span className="mt-2 block text-xs text-muted-foreground">
                        {labels.fakeStreaming.providerIdLabel}: {provider.id}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {labels.fakeStreaming.groupLabel}:{" "}
                        {formatGroupTag(provider.groupTag, labels.fakeStreaming.defaultGroup)}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-colors">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-red-500/10 text-red-400 shrink-0">
              <ShieldAlert className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {labels.providerOutputSafety.title}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {labels.providerOutputSafety.description}
              </p>
            </div>
          </div>
          <Switch
            id="enable-provider-output-safety-filter"
            checked={enableProviderOutputSafetyFilter}
            onCheckedChange={(checked) => setEnableProviderOutputSafetyFilter(checked)}
            disabled={isPending}
          />
        </div>

        <Collapsible
          open={providerOutputSafetyFilterOpen}
          onOpenChange={setProviderOutputSafetyFilterOpen}
        >
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1.5 mt-3 ml-11 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${providerOutputSafetyFilterOpen ? "" : "-rotate-90"}`}
              />
              {labels.providerOutputSafety.editRules}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-3 space-y-2 pl-11">
              <Label
                htmlFor="provider-output-safety-filter-rules"
                className="text-sm font-medium text-foreground"
              >
                {labels.providerOutputSafety.rulesLabel}
              </Label>
              <Textarea
                id="provider-output-safety-filter-rules"
                value={providerOutputSafetyFilterRulesText}
                onChange={(event) => setProviderOutputSafetyFilterRulesText(event.target.value)}
                placeholder={DEFAULT_PROVIDER_OUTPUT_SAFETY_FILTER_RULES_TEXT}
                disabled={isPending}
                rows={8}
                spellCheck={false}
                className={`${inputClassName} font-mono text-xs`}
              />
              <p className="text-xs text-muted-foreground">
                {labels.providerOutputSafety.rulesHint}
              </p>
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setProviderOutputSafetyFilterRulesText(
                      DEFAULT_PROVIDER_OUTPUT_SAFETY_FILTER_RULES_TEXT
                    )
                  }
                  disabled={isPending}
                >
                  {labels.providerOutputSafety.resetToDefault}
                </Button>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending}>
          {isPending ? labels.saving : labels.saveSettings}
        </Button>
      </div>
    </form>
  );
}
