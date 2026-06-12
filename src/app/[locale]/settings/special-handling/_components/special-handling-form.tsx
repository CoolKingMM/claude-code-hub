"use client";

import { ChevronDown, Plus, ShieldAlert, Trash2, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { saveSystemSettings } from "@/lib/api-client/v1/actions/system-config";
import {
  DEFAULT_PROVIDER_OUTPUT_SAFETY_FILTER_RULES,
  validateProviderOutputSafetyFilterRule,
} from "@/lib/provider-output-safety-rules";
import type { FakeStreamingWhitelistEntry, SystemSettings } from "@/types/system-config";

type SpecialHandlingFormProps = {
  initialSettings: Pick<
    SystemSettings,
    | "fakeStreamingWhitelist"
    | "enableProviderOutputSafetyFilter"
    | "providerOutputSafetyFilterRules"
  >;
  labels: SpecialHandlingFormLabels;
};

const DEFAULT_PROVIDER_OUTPUT_SAFETY_FILTER_RULES_TEXT =
  DEFAULT_PROVIDER_OUTPUT_SAFETY_FILTER_RULES.join("\n");

export type SpecialHandlingFormLabels = {
  fakeStreaming: {
    title: string;
    description: string;
    emptyState: string;
    modelLabel: string;
    modelPlaceholder: string;
    groupsLabel: string;
    allGroupsHint: string;
    addModel: string;
    remove: string;
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

function parseGroupTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag, index, tags) => tag.length > 0 && tags.indexOf(tag) === index);
}

function formatGroupTags(tags: readonly string[]): string {
  return tags.join(", ");
}

function sanitizeFakeStreamingWhitelist(
  entries: FakeStreamingWhitelistEntry[]
): FakeStreamingWhitelistEntry[] {
  const merged = new Map<string, Set<string>>();
  const allGroupsModels = new Set<string>();
  const order: string[] = [];

  for (const entry of entries) {
    const model = entry.model.trim();
    if (!model) continue;

    if (!merged.has(model)) {
      merged.set(model, new Set<string>());
      order.push(model);
    }

    if (entry.groupTags.length === 0) {
      allGroupsModels.add(model);
      continue;
    }

    if (allGroupsModels.has(model)) continue;
    const groups = merged.get(model);
    if (!groups) continue;
    for (const tag of entry.groupTags) {
      const trimmed = tag.trim();
      if (trimmed) groups.add(trimmed);
    }
  }

  return order.map((model) => ({
    model,
    groupTags: allGroupsModels.has(model) ? [] : Array.from(merged.get(model) ?? new Set<string>()),
  }));
}

export function SpecialHandlingForm({ initialSettings, labels }: SpecialHandlingFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [fakeStreamingWhitelist, setFakeStreamingWhitelist] = useState<
    FakeStreamingWhitelistEntry[]
  >(() =>
    (initialSettings.fakeStreamingWhitelist ?? []).map((entry) => ({
      model: entry.model,
      groupTags: [...entry.groupTags],
    }))
  );
  const [enableProviderOutputSafetyFilter, setEnableProviderOutputSafetyFilter] = useState(
    initialSettings.enableProviderOutputSafetyFilter
  );
  const [providerOutputSafetyFilterRulesText, setProviderOutputSafetyFilterRulesText] =
    useState<string>(
      formatProviderOutputSafetyFilterRules(initialSettings.providerOutputSafetyFilterRules)
    );
  const [providerOutputSafetyFilterOpen, setProviderOutputSafetyFilterOpen] = useState(false);

  const inputClassName =
    "bg-muted/50 border border-border rounded-lg focus:border-primary focus:ring-1 focus:ring-primary";

  const updateFakeStreamingEntry = (index: number, patch: Partial<FakeStreamingWhitelistEntry>) => {
    setFakeStreamingWhitelist((current) =>
      current.map((entry, currentIndex) =>
        currentIndex === index ? { ...entry, ...patch } : entry
      )
    );
  };

  const addFakeStreamingEntry = () => {
    setFakeStreamingWhitelist((current) => [...current, { model: "", groupTags: [] }]);
  };

  const removeFakeStreamingEntry = (index: number) => {
    setFakeStreamingWhitelist((current) =>
      current.filter((_, currentIndex) => currentIndex !== index)
    );
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

    const sanitizedFakeStreamingWhitelist = sanitizeFakeStreamingWhitelist(fakeStreamingWhitelist);

    startTransition(async () => {
      const result = await saveSystemSettings({
        fakeStreamingWhitelist: sanitizedFakeStreamingWhitelist,
        enableProviderOutputSafetyFilter,
        providerOutputSafetyFilterRules: providerOutputSafetyFilterRulesToSave,
      });

      if (!result.ok) {
        toast.error(result.error || labels.saveFailed);
        return;
      }

      if (result.data) {
        setFakeStreamingWhitelist(
          (result.data.fakeStreamingWhitelist ?? []).map((entry) => ({
            model: entry.model,
            groupTags: [...entry.groupTags],
          }))
        );
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
          {fakeStreamingWhitelist.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              {labels.fakeStreaming.emptyState}
            </p>
          ) : (
            fakeStreamingWhitelist.map((entry, index) => (
              <div
                key={`${entry.model}-${index}`}
                className="grid gap-2 rounded-lg border border-white/5 bg-muted/20 p-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto]"
              >
                <div className="space-y-1.5">
                  <Label
                    htmlFor={`fake-streaming-model-${index}`}
                    className="text-xs text-muted-foreground"
                  >
                    {labels.fakeStreaming.modelLabel}
                  </Label>
                  <Input
                    id={`fake-streaming-model-${index}`}
                    data-testid={`fake-streaming-model-${index}`}
                    value={entry.model}
                    onChange={(event) =>
                      updateFakeStreamingEntry(index, { model: event.target.value })
                    }
                    placeholder={labels.fakeStreaming.modelPlaceholder}
                    disabled={isPending}
                    className={inputClassName}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor={`fake-streaming-groups-${index}`}
                    className="text-xs text-muted-foreground"
                  >
                    {labels.fakeStreaming.groupsLabel}
                  </Label>
                  <Input
                    id={`fake-streaming-groups-${index}`}
                    data-testid={`fake-streaming-groups-${index}`}
                    value={formatGroupTags(entry.groupTags)}
                    onChange={(event) =>
                      updateFakeStreamingEntry(index, {
                        groupTags: parseGroupTags(event.target.value),
                      })
                    }
                    disabled={isPending}
                    className={inputClassName}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {labels.fakeStreaming.allGroupsHint}
                  </p>
                </div>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    data-testid={`fake-streaming-remove-${index}`}
                    onClick={() => removeFakeStreamingEntry(index)}
                    disabled={isPending}
                    aria-label={labels.fakeStreaming.remove}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="fake-streaming-add"
            onClick={addFakeStreamingEntry}
            disabled={isPending}
          >
            <Plus className="mr-2 h-4 w-4" />
            {labels.fakeStreaming.addModel}
          </Button>
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

      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? labels.saving : labels.saveSettings}
        </Button>
      </div>
    </form>
  );
}
