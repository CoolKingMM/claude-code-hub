"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Cpu, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getDashboardUsage } from "@/lib/api-client/v1/actions/dashboard-usage";
import { cn, formatTokenAmount } from "@/lib/utils";
import { type CurrencyCode, formatCurrency } from "@/lib/utils/currency";
import type { DashboardUsageQuery, UsageItem, UsageMetrics } from "@/types/dashboard-usage";
import { cacheHitRate } from "./dashboard-usage";

const QUICK_PERIODS = ["today", "yesterday", "last24h", "7days", "30days"] as const;
type QuickPeriod = (typeof QUICK_PERIODS)[number];

const MODEL_PALETTE = [
  { dot: "bg-amber-500", bar: "from-amber-500 to-orange-400", segment: "bg-amber-500" },
  { dot: "bg-blue-500", bar: "from-blue-500 to-cyan-400", segment: "bg-blue-500" },
  { dot: "bg-emerald-500", bar: "from-emerald-500 to-teal-400", segment: "bg-emerald-500" },
  { dot: "bg-violet-500", bar: "from-violet-500 to-purple-400", segment: "bg-violet-500" },
  { dot: "bg-rose-500", bar: "from-rose-500 to-pink-400", segment: "bg-rose-500" },
  { dot: "bg-sky-500", bar: "from-sky-500 to-indigo-400", segment: "bg-sky-500" },
  { dot: "bg-lime-500", bar: "from-lime-500 to-emerald-400", segment: "bg-lime-500" },
  { dot: "bg-fuchsia-500", bar: "from-fuchsia-500 to-purple-400", segment: "bg-fuchsia-500" },
] as const;

export function getModelColorStyle(modelName: string | null | undefined, index: number) {
  const lower = (modelName ?? "").toLowerCase();
  if (lower.includes("claude")) return MODEL_PALETTE[0];
  if (lower.includes("gemini")) return MODEL_PALETTE[1];
  if (
    lower.includes("gpt") ||
    lower.includes("codex") ||
    lower.startsWith("o1") ||
    lower.startsWith("o3") ||
    lower.startsWith("o4")
  ) {
    return MODEL_PALETTE[2];
  }
  if (lower.includes("deepseek")) return MODEL_PALETTE[5];
  if (lower.includes("qwen") || lower.includes("glm")) return MODEL_PALETTE[3];
  return MODEL_PALETTE[index % MODEL_PALETTE.length];
}

export function getTotalTokens(metrics: UsageMetrics): number {
  return (
    metrics.inputTokens +
    metrics.outputTokens +
    metrics.cacheCreationTokens +
    metrics.cacheReadTokens
  );
}

const DEFAULT_VISIBLE_MODELS = 6;

export function DashboardModelBreakdown({ currencyCode }: { currencyCode: CurrencyCode }) {
  const t = useTranslations("dashboard.usage");
  const [period, setPeriod] = useState<QuickPeriod>("today");
  const [expandedAll, setExpandedAll] = useState(false);

  const query: DashboardUsageQuery = {
    period,
    scope: "model",
    page: 1,
    pageSize: 20,
  };

  const { data, isPending, isError, isFetching, refetch } = useQuery({
    queryKey: ["dashboard-model-breakdown", query],
    queryFn: ({ signal }) => getDashboardUsage(query, signal),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const items: UsageItem[] = data?.items ?? [];
  const summaryTotalTokens = data ? getTotalTokens(data.summary) : 0;
  const useCostBasis = (data?.summary.cost ?? 0) > 0;
  const visibleItems = expandedAll ? items : items.slice(0, DEFAULT_VISIBLE_MODELS);

  const getItemShare = (item: UsageItem): number => {
    if (!data) return 0;
    if (useCostBasis && data.summary.cost > 0) {
      return (item.cost / data.summary.cost) * 100;
    }
    const itemTokens = getTotalTokens(item);
    return summaryTotalTokens > 0 ? (itemTokens / summaryTotalTokens) * 100 : 0;
  };

  const topSegments = items.slice(0, 6).map((item, idx) => ({
    id: item.id,
    name: item.name ?? t("unknownModel"),
    share: getItemShare(item),
    cost: item.cost,
    tokens: getTotalTokens(item),
    color: getModelColorStyle(item.name, idx),
  }));
  const shownShareTotal = topSegments.reduce((acc, seg) => acc + seg.share, 0);
  const remainingShare = Math.max(0, 100 - shownShareTotal);

  return (
    <section
      aria-label={t("modelBreakdownTitle")}
      className={cn(
        "relative overflow-hidden rounded-2xl p-5 md:p-6 space-y-5",
        "bg-card/60 dark:bg-[rgba(20,20,23,0.5)] backdrop-blur-lg",
        "border border-border/50 dark:border-white/[0.08] shadow-sm"
      )}
    >
      <div className="pointer-events-none absolute -right-12 -top-16 h-44 w-44 rounded-full bg-primary/10 blur-[60px] opacity-60" />

      {/* Header */}
      <div className="relative z-10 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Cpu className="h-4.5 w-4.5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">{t("modelBreakdownTitle")}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{t("modelBreakdownDesc")}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-muted/50 p-1"
            role="group"
            aria-label={t("period")}
          >
            {QUICK_PERIODS.map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={period === value ? "secondary" : "ghost"}
                className={cn("h-7 px-2.5 text-xs", period === value && "shadow-xs font-medium")}
                aria-pressed={period === value}
                onClick={() => {
                  setPeriod(value);
                  setExpandedAll(false);
                }}
              >
                {t(`periods.${value}`)}
              </Button>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
            {t("refresh")}
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="relative z-10 space-y-4">
        {isError ? (
          <p role="alert" className="text-sm text-destructive">
            {t("error")}
          </p>
        ) : isPending ? (
          <div role="status" className="space-y-3 py-2">
            <p className="sr-only">{t("loading")}</p>
            <div className="h-3 w-full animate-pulse rounded-full bg-muted/60" />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {[0, 1, 2, 3].map((slot) => (
                <div key={slot} className="h-20 animate-pulse rounded-xl bg-muted/40" />
              ))}
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 py-10 text-center text-sm text-muted-foreground">
            {t("empty")}
          </div>
        ) : (
          <>
            {/* Summary strip + stacked distribution bar */}
            <div className="rounded-xl border border-border/50 bg-background/40 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  <div>
                    <span className="text-xs text-muted-foreground mr-1.5">{t("cost")}</span>
                    <span className="font-semibold tabular-nums">
                      {formatCurrency(data.summary.cost, currencyCode)}
                    </span>
                  </div>
                  <div title={summaryTotalTokens.toLocaleString()}>
                    <span className="text-xs text-muted-foreground mr-1.5">{t("totalTokens")}</span>
                    <span className="font-semibold tabular-nums">
                      {formatTokenAmount(summaryTotalTokens)}
                    </span>
                  </div>
                  <div title={data.summary.requests.toLocaleString()}>
                    <span className="text-xs text-muted-foreground mr-1.5">{t("requests")}</span>
                    <span className="font-semibold tabular-nums">
                      {formatTokenAmount(data.summary.requests)}
                    </span>
                  </div>
                  <div title={t("cacheHitRateDescription")}>
                    <span className="text-xs text-muted-foreground mr-1.5">
                      {t("cacheHitRate")}
                    </span>
                    <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                      {cacheHitRate(data.summary)}
                    </span>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {t("modelCount", { count: data.totalCount })}
                </span>
              </div>

              {/* Segmented distribution bar */}
              <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted/60 gap-0.5">
                {topSegments.map((seg) =>
                  seg.share > 0 ? (
                    <div
                      key={seg.id || seg.name}
                      className={cn(
                        "h-full transition-all duration-500 first:rounded-l-full last:rounded-r-full",
                        seg.color.segment
                      )}
                      style={{ width: `${Math.max(seg.share, 1.5)}%` }}
                      title={`${seg.name}: ${formatCurrency(seg.cost, currencyCode)} (${seg.share.toFixed(1)}%) · ${formatTokenAmount(seg.tokens)} tokens`}
                    />
                  ) : null
                )}
                {remainingShare > 0.5 && (
                  <div
                    className="h-full bg-muted-foreground/30 last:rounded-r-full"
                    style={{ width: `${remainingShare}%` }}
                    title={`${t("otherModels")}: ${remainingShare.toFixed(1)}%`}
                  />
                )}
              </div>
            </div>

            {/* Model cards grid */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {visibleItems.map((item, idx) => {
                const name = item.name ?? t("unknownModel");
                const share = getItemShare(item);
                const total = getTotalTokens(item);
                const color = getModelColorStyle(item.name, idx);
                return (
                  <div
                    key={item.id || `model-${idx}`}
                    data-testid={`model-consumption-card-${idx}`}
                    className={cn(
                      "rounded-xl border border-border/50 bg-background/40 p-3.5 space-y-2.5",
                      "transition-colors hover:border-primary/30 hover:bg-background/70"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={cn("h-2.5 w-2.5 shrink-0 rounded-full", color.dot)}
                          aria-hidden
                        />
                        <span
                          className="truncate font-mono text-sm font-medium text-foreground"
                          title={name}
                        >
                          {name}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-baseline gap-2 tabular-nums">
                        <span className="text-sm font-semibold text-foreground">
                          {formatCurrency(item.cost, currencyCode)}
                        </span>
                        <span className="text-xs font-medium text-muted-foreground">
                          {share.toFixed(1)}%
                        </span>
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60">
                      <div
                        className={cn(
                          "h-full rounded-full bg-gradient-to-r transition-all duration-500",
                          color.bar
                        )}
                        style={{ width: `${Math.min(100, Math.max(share, share > 0 ? 2 : 0))}%` }}
                      />
                    </div>

                    {/* Token & request stats */}
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-muted-foreground tabular-nums">
                        <span
                          className="font-medium text-foreground"
                          title={`${t("totalTokens")}: ${total.toLocaleString()}`}
                        >
                          {formatTokenAmount(total)} tok
                        </span>
                        <span title={`${t("inputTokens")}: ${item.inputTokens.toLocaleString()}`}>
                          {t("inputShort")} {formatTokenAmount(item.inputTokens)}
                        </span>
                        <span title={`${t("outputTokens")}: ${item.outputTokens.toLocaleString()}`}>
                          {t("outputShort")} {formatTokenAmount(item.outputTokens)}
                        </span>
                        {item.cacheCreationTokens > 0 && (
                          <span
                            title={`${t("cacheCreationTokens")}: ${item.cacheCreationTokens.toLocaleString()}`}
                          >
                            {t("cacheWriteShort")} {formatTokenAmount(item.cacheCreationTokens)}
                          </span>
                        )}
                        {item.cacheReadTokens > 0 && (
                          <span
                            title={`${t("cacheReadTokens")}: ${item.cacheReadTokens.toLocaleString()}`}
                          >
                            {t("cacheShort")} {formatTokenAmount(item.cacheReadTokens)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 tabular-nums">
                        <Badge
                          variant="secondary"
                          className="h-5 px-1.5 text-[11px] font-normal"
                          title={`${t("requests")}: ${item.requests.toLocaleString()}`}
                        >
                          {formatTokenAmount(item.requests)} {t("requestsShort")}
                        </Badge>
                        {item.cacheReadTokens > 0 && (
                          <Badge
                            variant="outline"
                            className="h-5 px-1.5 text-[11px] font-normal text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                            title={t("cacheHitRateDescription")}
                          >
                            {cacheHitRate(item)}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {items.length > DEFAULT_VISIBLE_MODELS && (
              <div className="flex justify-center pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setExpandedAll((prev) => !prev)}
                >
                  {expandedAll ? (
                    <>
                      <ChevronUp className="h-3.5 w-3.5" />
                      {t("collapseModels")}
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-3.5 w-3.5" />
                      {t("showAllModels", { count: items.length })}
                    </>
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
