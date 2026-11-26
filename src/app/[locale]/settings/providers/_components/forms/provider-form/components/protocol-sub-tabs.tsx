"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { getProviderTypeConfig } from "@/lib/provider-type-utils";
import { cn } from "@/lib/utils";
import type { ProviderType } from "@/types/provider";
import { useProviderForm } from "../provider-form-context";

interface ProtocolSubTabsProps {
  className?: string;
  showRuleCounts?: boolean;
}

export function ProtocolSubTabs({ className, showRuleCounts = false }: ProtocolSubTabsProps) {
  const t = useTranslations("settings.providers.form");
  const { state, dispatch, mode } = useProviderForm();
  const selectedProtocols = state.routing.selectedProtocols ?? [state.routing.providerType];
  const activeProtocol = state.routing.activeProtocol ?? state.routing.providerType;
  const protocolConfigs = state.routing.protocolConfigs ?? {};

  if (mode === "batch" || selectedProtocols.length < 2) {
    return null;
  }

  const renderProtocolLabel = (type: ProviderType) => {
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

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5 rounded-lg border border-border/60 bg-muted/40 p-1.5",
        className
      )}
      role="tablist"
      aria-label={t("sections.routing.multiProtocol.subTabsLabel")}
    >
      <span className="px-2 text-xs font-medium text-muted-foreground">
        {t("sections.routing.multiProtocol.editingProtocol")}:
      </span>
      {selectedProtocols.map((protocol) => {
        const config = getProviderTypeConfig(protocol);
        const Icon = config.icon;
        const isActive = protocol === activeProtocol;
        const protoState = protocolConfigs[protocol];
        const ruleCount = protoState
          ? protoState.allowedModels.length + protoState.modelRedirects.length
          : 0;
        const adoptedCount = protoState?.adoptProviderIds.length ?? 0;

        return (
          <button
            key={protocol}
            type="button"
            role="tab"
            aria-selected={isActive}
            disabled={state.ui.isPending}
            onClick={() => dispatch({ type: "SET_ACTIVE_PROTOCOL", payload: protocol })}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all",
              isActive
                ? "bg-background text-foreground shadow-sm ring-1 ring-border"
                : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
            )}
          >
            <span
              className={cn(
                "inline-flex h-4 w-4 items-center justify-center rounded",
                config.bgColor
              )}
            >
              <Icon className={cn("h-3 w-3", config.iconColor)} />
            </span>
            <span>{renderProtocolLabel(protocol)}</span>
            {showRuleCounts && ruleCount > 0 && (
              <Badge variant="secondary" className="h-4 px-1 text-[10px] font-normal">
                {ruleCount}
              </Badge>
            )}
            {adoptedCount > 0 && (
              <Badge
                variant="outline"
                className="h-4 border-emerald-500/40 bg-emerald-500/10 px-1 text-[10px] font-normal text-emerald-600 dark:text-emerald-400"
              >
                {t("sections.routing.multiProtocol.adoptedBadge")}
              </Badge>
            )}
          </button>
        );
      })}
    </div>
  );
}
