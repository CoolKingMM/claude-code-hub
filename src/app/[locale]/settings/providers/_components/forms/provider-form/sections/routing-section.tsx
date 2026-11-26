"use client";

import { motion } from "framer-motion";
import { Check, GitMerge, Info, Layers, Route, Scale } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { RuleTesterDialogTrigger } from "@/app/[locale]/settings/providers/_components/rule-tester-dialog-trigger";
import { ClientRestrictionsEditor } from "@/components/form/client-restrictions-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { TagInput } from "@/components/ui/tag-input";
import {
  findAdoptableProtocolCandidates,
  isUserFacingProtocolType,
} from "@/lib/provider-protocol-bundle";
import { getProviderTypeConfig } from "@/lib/provider-type-utils";
import { cn } from "@/lib/utils";
import type { ProviderDisplay, ProviderType } from "@/types/provider";
import { AllowedModelRuleEditor } from "../../../allowed-model-rule-editor";
import { AllowedModelTester } from "../../../allowed-model-tester";
import { MixedValueIndicator } from "../../../batch-edit/mixed-value-indicator";
import { ModelRedirectEditor } from "../../../model-redirect-editor";
import { ModelRedirectTester } from "../../../model-redirect-tester";
import { ProtocolSubTabs } from "../components/protocol-sub-tabs";
import { FieldGroup, SectionCard, SmartInputWrapper, ToggleRow } from "../components/section-card";
import { useProviderForm } from "../provider-form-context";

const GROUP_TAG_MAX_TOTAL_LENGTH = 255;

interface RoutingSectionProps {
  subSectionRefs?: {
    scheduling?: (el: HTMLDivElement | null) => void;
  };
}

export function RoutingSection({ subSectionRefs }: RoutingSectionProps) {
  const t = useTranslations("settings.providers.form");
  const tTester = useTranslations("settings.providers.form.matchTester");
  const tUI = useTranslations("ui.tagInput");
  const {
    state,
    dispatch,
    mode,
    provider,
    bundleProviders,
    allProviders,
    allowedProviderTypes,
    initialProtocols,
    enableMultiProviderTypes,
    groupSuggestions,
    batchAnalysis,
  } = useProviderForm();
  const isEdit = mode === "edit";
  const isBatch = mode === "batch";

  const renderProviderTypeLabel = (type: ProviderType) => {
    switch (type) {
      case "claude":
        return t("providerTypes.claude");
      case "claude-auth":
        return t("providerTypes.claudeAuth");
      case "codex":
        return t("providerTypes.codex");
      case "gemini":
        return t("providerTypes.gemini");
      case "gemini-cli":
        return t("providerTypes.geminiCli");
      case "openai-compatible":
        return t("providerTypes.openaiCompatible");
      default:
        return type;
    }
  };

  const handleGroupTagChange = (nextTags: string[]) => {
    const serialized = nextTags.join(",");
    if (serialized.length > GROUP_TAG_MAX_TOTAL_LENGTH) {
      toast.error(t("errors.groupTagTooLong", { max: GROUP_TAG_MAX_TOTAL_LENGTH }));
      return;
    }
    dispatch({ type: "SET_GROUP_TAG", payload: nextTags });
  };

  const selectedProtocols = useMemo(
    () => state.routing.selectedProtocols ?? [state.routing.providerType],
    [state.routing.selectedProtocols, state.routing.providerType]
  );
  const activeProtocol = state.routing.activeProtocol ?? state.routing.providerType;
  const protocolConfigs = state.routing.protocolConfigs ?? {};

  const providerTypes = useMemo<ProviderType[]>(() => {
    const base: ProviderType[] =
      allowedProviderTypes && allowedProviderTypes.length > 0
        ? [...allowedProviderTypes]
        : ["claude", "codex", "gemini", "openai-compatible"];
    for (const selected of selectedProtocols) {
      if (!base.includes(selected)) {
        base.push(selected);
      }
    }
    return base;
  }, [allowedProviderTypes, selectedProtocols]);

  const currentBundleIds = useMemo(() => {
    const ids = new Set<number>();
    if (provider) ids.add(provider.id);
    for (const item of bundleProviders ?? []) {
      ids.add(item.id);
    }
    return ids;
  }, [provider, bundleProviders]);

  // 检测同供应商（编辑模式用 vendorId，新建模式用 URL origin）下可并入的独立协议渠道
  const adoptableByProtocol = useMemo(() => {
    const result = new Map<ProviderType, ProviderDisplay[]>();
    if (!allProviders || allProviders.length === 0 || isBatch) {
      return result;
    }

    const excludeProviderIds = Array.from(currentBundleIds);
    const effectiveUrl = state.basic.url.trim() || provider?.url || null;

    for (const protocol of selectedProtocols) {
      // 编辑模式下原本就在当前组里的协议无需再提示并入
      if (isEdit && initialProtocols.includes(protocol)) {
        continue;
      }
      if (!isUserFacingProtocolType(protocol)) {
        continue;
      }
      const candidates = findAdoptableProtocolCandidates(allProviders, {
        targetProtocol: protocol,
        excludeProviderIds,
        currentProtocolGroupId: provider?.protocolGroupId ?? null,
        providerVendorId: provider?.providerVendorId ?? null,
        url: effectiveUrl,
      });
      const candidateProviders = candidates.flatMap((candidate) => candidate.providers);
      if (candidateProviders.length > 0) {
        result.set(protocol, candidateProviders);
      }
    }

    return result;
  }, [
    allProviders,
    isBatch,
    provider?.providerVendorId,
    provider?.protocolGroupId,
    provider?.url,
    state.basic.url,
    selectedProtocols,
    isEdit,
    initialProtocols,
    currentBundleIds,
  ]);

  const activeProtocolProviderId = useMemo(() => {
    const matched = (bundleProviders ?? []).find((item) => item.providerType === activeProtocol);
    return matched?.id ?? provider?.id;
  }, [bundleProviders, provider?.id, activeProtocol]);
  const allowedClients = state.routing.allowedClients;
  const blockedClients = state.routing.blockedClients;
  const hasAnyClientRestrictions = allowedClients.length > 0 || blockedClients.length > 0;
  const [clientRestrictionsEnabled, setClientRestrictionsEnabled] = useState(
    () => hasAnyClientRestrictions
  );

  useEffect(() => {
    if (!hasAnyClientRestrictions) return;
    setClientRestrictionsEnabled(true);
  }, [hasAnyClientRestrictions]);

  const handleClientRestrictionsEnabledChange = (enabled: boolean) => {
    setClientRestrictionsEnabled(enabled);
    if (!enabled) {
      dispatch({ type: "SET_ALLOWED_CLIENTS", payload: [] });
      dispatch({ type: "SET_BLOCKED_CLIENTS", payload: [] });
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.2 }}
      className="space-y-6"
    >
      {/* Provider Type & Group - hidden in batch mode */}
      {!isBatch && (
        <SectionCard
          title={t("sections.routing.providerType.label")}
          description={t("sections.routing.providerTypeDesc")}
          icon={Route}
          variant="highlight"
        >
          <div className="space-y-4">
            <SmartInputWrapper
              label={t("sections.routing.providerType.label")}
              description={t("sections.routing.multiProtocol.selectDesc")}
            >
              <div
                id={isEdit ? "edit-provider-type" : "provider-type"}
                className="grid grid-cols-1 gap-2 sm:grid-cols-2"
                role="group"
                aria-label={t("sections.routing.providerType.label")}
              >
                {providerTypes.map((type) => {
                  const typeConfig = getProviderTypeConfig(type);
                  const TypeIcon = typeConfig.icon;
                  const label = renderProviderTypeLabel(type);
                  const isSelected = selectedProtocols.includes(type);
                  const isOnlySelected = isSelected && selectedProtocols.length === 1;
                  const isRemovedExisting =
                    isEdit && initialProtocols.includes(type) && !isSelected;

                  return (
                    <button
                      key={type}
                      type="button"
                      aria-pressed={isSelected}
                      disabled={state.ui.isPending || isOnlySelected}
                      onClick={() =>
                        dispatch({
                          type: "TOGGLE_PROTOCOL",
                          payload: { protocol: type },
                        })
                      }
                      className={cn(
                        "flex items-center justify-between gap-2 rounded-lg border p-2.5 text-left transition-all",
                        isSelected
                          ? "border-primary/60 bg-primary/5 shadow-xs"
                          : isRemovedExisting
                            ? "border-destructive/40 bg-destructive/5 text-muted-foreground"
                            : "border-border/70 bg-card/40 hover:border-border hover:bg-muted/30",
                        isOnlySelected && "cursor-not-allowed opacity-90"
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className={cn(
                            "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
                            typeConfig.bgColor
                          )}
                        >
                          <TypeIcon className={cn("h-3.5 w-3.5", typeConfig.iconColor)} />
                        </span>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{label}</div>
                          {isRemovedExisting && (
                            <div className="text-[11px] text-destructive">
                              {t("sections.routing.multiProtocol.willSoftDelete")}
                            </div>
                          )}
                        </div>
                      </div>
                      <span
                        className={cn(
                          "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                          isSelected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-muted-foreground/40 bg-background"
                        )}
                      >
                        {isSelected && <Check className="h-3 w-3" />}
                      </span>
                    </button>
                  );
                })}
              </div>

              {selectedProtocols.length > 1 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("sections.routing.multiProtocol.selectedSummary", {
                    count: selectedProtocols.length,
                  })}
                </p>
              )}

              {/* 同供应商独立协议渠道检测与一键并入提示 */}
              {adoptableByProtocol.size > 0 && (
                <div className="mt-3 space-y-2">
                  {Array.from(adoptableByProtocol.entries()).map(([protocol, candidates]) => {
                    const currentAdoptIds = protocolConfigs[protocol]?.adoptProviderIds ?? [];
                    const isAdopted =
                      currentAdoptIds.length > 0 &&
                      candidates.every((item) => currentAdoptIds.includes(item.id));
                    const candidateNames = candidates.map((item) => item.name).join(", ");
                    const totalRulesCount = candidates.reduce(
                      (sum, item) =>
                        sum +
                        (item.allowedModels?.length ?? 0) +
                        (item.modelRedirects?.length ?? 0),
                      0
                    );

                    return (
                      <div
                        key={protocol}
                        className={cn(
                          "flex flex-col gap-2 rounded-lg border p-3 text-xs sm:flex-row sm:items-center sm:justify-between",
                          isAdopted
                            ? "border-emerald-500/40 bg-emerald-500/5"
                            : "border-amber-500/40 bg-amber-500/5"
                        )}
                      >
                        <div className="flex items-start gap-2 min-w-0">
                          <GitMerge
                            className={cn(
                              "mt-0.5 h-4 w-4 shrink-0",
                              isAdopted
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-amber-600 dark:text-amber-400"
                            )}
                          />
                          <div className="space-y-0.5 min-w-0">
                            <div className="font-medium text-foreground">
                              {isAdopted
                                ? t("sections.routing.multiProtocol.adoptActiveTitle", {
                                    protocol: renderProviderTypeLabel(protocol),
                                    count: candidates.length,
                                  })
                                : t("sections.routing.multiProtocol.adoptAvailableTitle", {
                                    protocol: renderProviderTypeLabel(protocol),
                                    count: candidates.length,
                                  })}
                            </div>
                            <p className="break-all text-muted-foreground">
                              {t("sections.routing.multiProtocol.adoptAvailableDesc", {
                                names: candidateNames,
                                rulesCount: totalRulesCount,
                              })}
                            </p>
                          </div>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant={isAdopted ? "outline" : "secondary"}
                          disabled={state.ui.isPending}
                          onClick={() =>
                            dispatch({
                              type: "SET_ADOPT_PROTOCOL_PROVIDERS",
                              payload: {
                                protocol,
                                providers: isAdopted ? [] : candidates,
                              },
                            })
                          }
                          className="shrink-0 h-7 text-xs"
                        >
                          {isAdopted
                            ? t("sections.routing.multiProtocol.cancelAdopt")
                            : t("sections.routing.multiProtocol.confirmAdopt")}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}

              {!enableMultiProviderTypes && selectedProtocols.includes("openai-compatible") && (
                <p className="text-xs text-amber-600">
                  {t("sections.routing.providerTypeDisabledNote")}
                </p>
              )}
            </SmartInputWrapper>

            <SmartInputWrapper
              label={t("sections.routing.scheduleParams.group.label")}
              description={t("sections.routing.scheduleParams.group.desc")}
            >
              <TagInput
                id={isEdit ? "edit-group" : "group"}
                value={state.routing.groupTag}
                onChange={handleGroupTagChange}
                placeholder={t("sections.routing.scheduleParams.group.placeholder")}
                disabled={state.ui.isPending}
                maxTagLength={50}
                suggestions={groupSuggestions}
                validateTag={() => true}
                onInvalidTag={(_tag, reason) => {
                  const messages: Record<string, string> = {
                    empty: tUI("emptyTag"),
                    duplicate: tUI("duplicateTag"),
                    too_long: tUI("tooLong", { max: 50 }),
                    invalid_format: tUI("invalidFormat"),
                    max_tags: tUI("maxTags"),
                  };
                  toast.error(messages[reason] || tUI("unknownError"));
                }}
              />
            </SmartInputWrapper>
          </div>
        </SectionCard>
      )}

      {/* Model Configuration */}
      <SectionCard
        title={t("sections.routing.modelWhitelist.title")}
        description={t("sections.routing.modelWhitelist.desc")}
        icon={Layers}
      >
        <div className="space-y-3">
          <ProtocolSubTabs showRuleCounts />
          {/* Model Redirects */}
          <FieldGroup
            label={t("sections.routing.modelRedirects.label")}
            badge={
              state.routing.modelRedirects.length > 0 ? (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal">
                  {state.routing.modelRedirects.length}
                </Badge>
              ) : null
            }
          >
            <div className="space-y-2">
              <ModelRedirectEditor
                value={state.routing.modelRedirects}
                onChange={(value) => dispatch({ type: "SET_MODEL_REDIRECTS", payload: value })}
                disabled={state.ui.isPending}
              />
              <div className="flex justify-end">
                <RuleTesterDialogTrigger
                  title={tTester("redirectTitle")}
                  description={tTester("redirectDescription")}
                  label={t("sections.routing.testRule")}
                  tooltip={tTester("redirectDescription")}
                >
                  <ModelRedirectTester rules={state.routing.modelRedirects} />
                </RuleTesterDialogTrigger>
              </div>
              {isBatch && batchAnalysis?.routing.modelRedirects.status === "mixed" && (
                <MixedValueIndicator values={batchAnalysis.routing.modelRedirects.values} />
              )}
            </div>
          </FieldGroup>

          <div className="border-t border-border/30" />

          {/* Allowed Models */}
          <FieldGroup
            label={t("sections.routing.modelWhitelist.label")}
            badge={
              state.routing.allowedModels.length > 0 ? (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal">
                  {state.routing.allowedModels.length}
                </Badge>
              ) : null
            }
          >
            <div className="space-y-2">
              <AllowedModelRuleEditor
                providerType={state.routing.providerType}
                value={state.routing.allowedModels}
                onChange={(value) => dispatch({ type: "SET_ALLOWED_MODELS", payload: value })}
                disabled={state.ui.isPending}
                providerId={activeProtocolProviderId}
                providerUrl={state.basic.url ?? provider?.url}
                apiKey={state.basic.key}
                proxyUrl={state.network.proxyUrl}
                proxyFallbackToDirect={state.network.proxyFallbackToDirect}
              />
              <div className="flex justify-end">
                <RuleTesterDialogTrigger
                  title={tTester("allowedTitle")}
                  description={tTester("allowedDescription")}
                  label={t("sections.routing.testRule")}
                  tooltip={tTester("allowedDescription")}
                >
                  <AllowedModelTester rules={state.routing.allowedModels} />
                </RuleTesterDialogTrigger>
              </div>
            </div>
          </FieldGroup>

          <ToggleRow
            icon={Info}
            label={t("sections.routing.clientRestrictions.toggleLabel")}
            description={t("sections.routing.clientRestrictions.toggleDesc")}
          >
            <Switch
              checked={clientRestrictionsEnabled}
              onCheckedChange={handleClientRestrictionsEnabledChange}
              disabled={state.ui.isPending}
            />
          </ToggleRow>

          {clientRestrictionsEnabled && (
            <div className="space-y-3">
              <div className="rounded-md border border-border/40 bg-muted/20 px-3 py-2">
                <p className="text-xs text-muted-foreground">
                  {t("sections.routing.clientRestrictions.priorityNote")}
                </p>
              </div>

              <ClientRestrictionsEditor
                allowed={allowedClients}
                blocked={blockedClients}
                onAllowedChange={(next) => dispatch({ type: "SET_ALLOWED_CLIENTS", payload: next })}
                onBlockedChange={(next) => dispatch({ type: "SET_BLOCKED_CLIENTS", payload: next })}
                disabled={state.ui.isPending}
                translations={{
                  allowAction: t("sections.routing.clientRestrictions.allowAction"),
                  blockAction: t("sections.routing.clientRestrictions.blockAction"),
                  customAllowedLabel: t("sections.routing.clientRestrictions.customAllowedLabel"),
                  customAllowedPlaceholder: t(
                    "sections.routing.clientRestrictions.customAllowedPlaceholder"
                  ),
                  customBlockedLabel: t("sections.routing.clientRestrictions.customBlockedLabel"),
                  customBlockedPlaceholder: t(
                    "sections.routing.clientRestrictions.customBlockedPlaceholder"
                  ),
                  customHelp: t("sections.routing.clientRestrictions.customHelp"),
                  presetClients: {
                    "claude-code": t(
                      "sections.routing.clientRestrictions.presetClients.claude-code"
                    ),
                    "gemini-cli": t("sections.routing.clientRestrictions.presetClients.gemini-cli"),
                    "factory-cli": t(
                      "sections.routing.clientRestrictions.presetClients.factory-cli"
                    ),
                    "codex-cli": t("sections.routing.clientRestrictions.presetClients.codex-cli"),
                  },
                  subClients: {
                    all: t("sections.routing.clientRestrictions.subClients.all"),
                    cli: t("sections.routing.clientRestrictions.subClients.cli"),
                    vscode: t("sections.routing.clientRestrictions.subClients.vscode"),
                    "sdk-ts": t("sections.routing.clientRestrictions.subClients.sdk-ts"),
                    "sdk-py": t("sections.routing.clientRestrictions.subClients.sdk-py"),
                    "cli-sdk": t("sections.routing.clientRestrictions.subClients.cli-sdk"),
                    "gh-action": t("sections.routing.clientRestrictions.subClients.gh-action"),
                    "codex-cli-core": t(
                      "sections.routing.clientRestrictions.subClients.codex-cli-core"
                    ),
                    desktop: t("sections.routing.clientRestrictions.subClients.desktop"),
                    exec: t("sections.routing.clientRestrictions.subClients.exec"),
                  },
                  nSelected: t("sections.routing.clientRestrictions.nSelected", {
                    count: "{count}",
                  }),
                }}
                onInvalidTag={(_tag, reason) => {
                  const messages: Record<string, string> = {
                    empty: tUI("emptyTag"),
                    duplicate: tUI("duplicateTag"),
                    too_long: tUI("tooLong", { max: 64 }),
                    invalid_format: tUI("invalidFormat"),
                    max_tags: tUI("maxTags"),
                  };
                  toast.error(messages[reason] || tUI("unknownError"));
                }}
              />
            </div>
          )}
        </div>
      </SectionCard>

      {/* Scheduling Parameters */}
      <div ref={subSectionRefs?.scheduling}>
        <SectionCard
          title={t("sections.routing.scheduleParams.title")}
          description={t("sections.routing.scheduleParams.priority.desc")}
          icon={Scale}
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <SmartInputWrapper
              label={t("sections.routing.scheduleParams.priority.label")}
              description={t("sections.routing.scheduleParams.priority.desc")}
            >
              <div className="space-y-2">
                <Input
                  id={isEdit ? "edit-priority" : "priority"}
                  type="number"
                  value={state.routing.priority}
                  onChange={(e) =>
                    dispatch({ type: "SET_PRIORITY", payload: parseInt(e.target.value, 10) || 0 })
                  }
                  placeholder={t("sections.routing.scheduleParams.priority.placeholder")}
                  disabled={state.ui.isPending}
                  min="0"
                  step="1"
                />
                {isBatch && batchAnalysis?.routing.priority.status === "mixed" && (
                  <MixedValueIndicator values={batchAnalysis.routing.priority.values} />
                )}
              </div>
            </SmartInputWrapper>

            <SmartInputWrapper
              label={t("sections.routing.scheduleParams.weight.label")}
              description={t("sections.routing.scheduleParams.weight.desc")}
            >
              <div className="space-y-2">
                <Input
                  id={isEdit ? "edit-weight" : "weight"}
                  type="number"
                  value={state.routing.weight}
                  onChange={(e) =>
                    dispatch({ type: "SET_WEIGHT", payload: parseInt(e.target.value, 10) || 1 })
                  }
                  placeholder={t("sections.routing.scheduleParams.weight.placeholder")}
                  disabled={state.ui.isPending}
                  min="1"
                  step="1"
                />
                {isBatch && batchAnalysis?.routing.weight.status === "mixed" && (
                  <MixedValueIndicator values={batchAnalysis.routing.weight.values} />
                )}
              </div>
            </SmartInputWrapper>

            <SmartInputWrapper
              label={t("sections.routing.scheduleParams.costMultiplier.label")}
              description={t("sections.routing.scheduleParams.costMultiplier.desc")}
            >
              <div className="space-y-2">
                <Input
                  id={isEdit ? "edit-cost" : "cost"}
                  type="number"
                  value={state.routing.costMultiplier}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === "") {
                      dispatch({ type: "SET_COST_MULTIPLIER", payload: 1.0 });
                      return;
                    }
                    const num = parseFloat(value);
                    dispatch({
                      type: "SET_COST_MULTIPLIER",
                      payload: Number.isNaN(num) ? 1.0 : num,
                    });
                  }}
                  onFocus={(e) => e.target.select()}
                  placeholder={t("sections.routing.scheduleParams.costMultiplier.placeholder")}
                  disabled={state.ui.isPending}
                  min="0"
                  step="0.0001"
                />
                {isBatch && batchAnalysis?.routing.costMultiplier.status === "mixed" && (
                  <MixedValueIndicator values={batchAnalysis.routing.costMultiplier.values} />
                )}
              </div>
            </SmartInputWrapper>
          </div>

          {/* Per-Group Priority Override */}
          {state.routing.groupTag.length > 0 && (
            <div className="mt-4 space-y-3">
              <div className="text-sm font-medium">
                {t("sections.routing.scheduleParams.groupPriorities.label")}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("sections.routing.scheduleParams.groupPriorities.desc")}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {state.routing.groupTag.map((group) => (
                  <div key={group} className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono text-xs shrink-0">
                      {group}
                    </Badge>
                    <Input
                      type="number"
                      value={state.routing.groupPriorities[group] ?? ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        const next = { ...state.routing.groupPriorities };
                        if (val === "") {
                          delete next[group];
                        } else {
                          next[group] = parseInt(val, 10) || 0;
                        }
                        dispatch({ type: "SET_GROUP_PRIORITIES", payload: next });
                      }}
                      placeholder={t("sections.routing.scheduleParams.groupPriorities.placeholder")}
                      disabled={state.ui.isPending}
                      min="0"
                      step="1"
                      className="h-8 text-sm"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </SectionCard>
      </div>
    </motion.div>
  );
}
