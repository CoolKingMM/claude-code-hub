"use client";

import { useQuery } from "@tanstack/react-query";
import { BarChart3, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Fragment, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getDashboardUsage } from "@/lib/api-client/v1/actions/dashboard-usage";
import { cn, formatTokenAmount } from "@/lib/utils";
import { type CurrencyCode, formatCurrency } from "@/lib/utils/currency";
import {
  type DashboardUsageData,
  type DashboardUsageQuery,
  USAGE_PERIODS,
  type UsageItem,
  type UsageMetrics,
} from "@/types/dashboard-usage";

const scopes = ["channel", "model", "key", "day"] as const;
const tokenFields = [
  "inputTokens",
  "outputTokens",
  "cacheCreationTokens",
  "cacheReadTokens",
] as const;

export function cacheHitRate(metrics: UsageMetrics): string {
  const totalInput = metrics.inputTokens + metrics.cacheCreationTokens + metrics.cacheReadTokens;
  return `${(totalInput > 0 ? (metrics.cacheReadTokens / totalInput) * 100 : 0).toFixed(1)}%`;
}

export function sumUsageTokens(metrics: UsageMetrics): number {
  return (
    metrics.inputTokens +
    metrics.outputTokens +
    metrics.cacheCreationTokens +
    metrics.cacheReadTokens
  );
}

function useUsage(query: DashboardUsageQuery, enabled = true) {
  return useQuery({
    queryKey: ["dashboard-usage", query],
    queryFn: ({ signal }) => getDashboardUsage(query, signal),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

function UsageRows({
  data,
  query,
  currencyCode,
  expanded,
  onExpand,
}: {
  data: DashboardUsageData;
  query: DashboardUsageQuery;
  currencyCode: CurrencyCode;
  expanded?: string | null;
  onExpand?: (id: string) => void;
}) {
  const t = useTranslations("dashboard.usage");
  const label = (item: UsageItem) =>
    item.name ?? t(query.scope === "model" ? "unknownModel" : "removedEntity");
  return (
    <>
      {data.items.map((item) => {
        const sharePct = data.summary.cost > 0 ? (item.cost / data.summary.cost) * 100 : 0;
        const totalTokens = sumUsageTokens(item);
        return (
          <Fragment key={item.id}>
            <TableRow className="transition-colors hover:bg-muted/30">
              <TableCell className="max-w-72 font-medium">
                <div className="flex items-center gap-1.5 min-w-0">
                  {onExpand ? (
                    <Button
                      variant="ghost"
                      className="h-auto max-w-full justify-start gap-2 px-0 text-left font-medium hover:bg-transparent"
                      onClick={() => onExpand(item.id)}
                      aria-expanded={expanded === item.id}
                      aria-label={t("expand", { name: label(item) })}
                    >
                      {expanded === item.id ? (
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate">{label(item)}</span>
                    </Button>
                  ) : (
                    <span
                      className={cn(
                        "break-all",
                        query.scope === "model" && "font-mono text-xs sm:text-sm"
                      )}
                    >
                      {query.scope === "providerKey"
                        ? t("credential", { id: item.id.replace("provider:", "") })
                        : label(item)}
                    </span>
                  )}
                  {item.providerType && query.scope === "channel" && (
                    <Badge
                      variant="secondary"
                      className="h-5 shrink-0 px-1.5 text-[10px] font-normal"
                    >
                      {item.providerType}
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums whitespace-nowrap">
                {formatCurrency(item.cost, currencyCode)}
              </TableCell>
              <TableCell className="text-right tabular-nums whitespace-nowrap">
                <div className="inline-flex items-center justify-end gap-2">
                  <div className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-muted sm:block">
                    <div
                      className="h-full rounded-full bg-primary/70"
                      style={{ width: `${Math.min(100, sharePct)}%` }}
                    />
                  </div>
                  <span className="min-w-[3rem] text-right text-muted-foreground">
                    {data.summary.cost > 0 ? `${sharePct.toFixed(1)}%` : "0%"}
                  </span>
                </div>
              </TableCell>
              <TableCell
                className="text-right tabular-nums whitespace-nowrap text-emerald-600 dark:text-emerald-400"
                title={t("cacheHitRateDescription")}
              >
                {cacheHitRate(item)}
              </TableCell>
              <TableCell
                className="text-right tabular-nums whitespace-nowrap"
                title={item.requests.toLocaleString()}
              >
                {formatTokenAmount(item.requests)}
              </TableCell>
              <TableCell
                className="text-right font-medium tabular-nums whitespace-nowrap"
                title={totalTokens.toLocaleString()}
              >
                {formatTokenAmount(totalTokens)}
              </TableCell>
              {tokenFields.map((field) => (
                <TableCell
                  key={field}
                  className="text-right tabular-nums whitespace-nowrap text-muted-foreground"
                  title={item[field].toLocaleString()}
                >
                  {formatTokenAmount(item[field])}
                </TableCell>
              ))}
            </TableRow>
            {expanded === item.id && (
              <TableRow>
                <TableCell colSpan={10} className="bg-muted/20 p-4">
                  <ChannelUsage
                    query={{ ...query, scope: "providerKey", channelId: item.id, page: 1 }}
                    currencyCode={currencyCode}
                  />
                </TableCell>
              </TableRow>
            )}
          </Fragment>
        );
      })}
    </>
  );
}

function UsageTable({
  data,
  query,
  currencyCode,
  expanded,
  onExpand,
}: Parameters<typeof UsageRows>[0]) {
  const t = useTranslations("dashboard.usage");
  return (
    <div className="overflow-x-auto rounded-xl border border-border/50 bg-background/40">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30 hover:bg-muted/30">
            <TableHead>{t(`scopes.${query.scope}`)}</TableHead>
            {(
              ["cost", "share", "cacheHitRate", "requests", "totalTokens", ...tokenFields] as const
            ).map((field) => (
              <TableHead key={field} className="text-right whitespace-nowrap">
                {t(field)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.items.length ? (
            <UsageRows {...{ data, query, currencyCode, expanded, onExpand }} />
          ) : (
            <TableRow>
              <TableCell colSpan={10} className="py-10 text-center text-muted-foreground">
                {t("empty")}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function Pagination({
  data,
  onPage,
}: {
  data: DashboardUsageData;
  onPage: (page: number) => void;
}) {
  const t = useTranslations("dashboard.usage");
  const pages = Math.max(1, Math.ceil(data.totalCount / data.pageSize));
  return (
    <div className="flex items-center justify-end gap-3 pt-3 text-sm">
      <span className="text-muted-foreground">
        {t("page", { current: data.page, total: pages, count: data.totalCount })}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={data.page <= 1}
        onClick={() => onPage(data.page - 1)}
      >
        {t("previous")}
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={data.page >= pages}
        onClick={() => onPage(data.page + 1)}
      >
        {t("next")}
      </Button>
    </div>
  );
}

function ChannelUsage({
  query,
  currencyCode,
}: {
  query: DashboardUsageQuery;
  currencyCode: CurrencyCode;
}) {
  const [page, setPage] = useState(1);
  const selected = { ...query, page };
  const { data, isError, isPending } = useUsage(selected);
  const t = useTranslations("dashboard.usage");
  if (isError) return <p role="alert">{t("error")}</p>;
  if (isPending) return <p role="status">{t("loading")}</p>;
  return (
    <>
      <UsageTable data={data} query={selected} currencyCode={currencyCode} />
      <Pagination data={data} onPage={setPage} />
    </>
  );
}

export function DashboardUsage({ currencyCode }: { currencyCode: CurrencyCode }) {
  const t = useTranslations("dashboard.usage");
  const [period, setPeriod] = useState<DashboardUsageQuery["period"]>("today");
  const [dates, setDates] = useState({ startDate: "", endDate: "" });
  const [appliedDates, setAppliedDates] = useState<typeof dates | null>(null);
  const [view, setView] = useState<{ scope: DashboardUsageQuery["scope"]; page: number }>({
    scope: "channel",
    page: 1,
  });
  const [expanded, setExpanded] = useState<string | null>(null);
  const query: DashboardUsageQuery = {
    period,
    ...view,
    ...(period === "custom" ? (appliedDates ?? {}) : {}),
  };
  const enabled = period !== "custom" || appliedDates !== null;
  const { data, isError, isPending, isFetching, refetch } = useUsage(query, enabled);
  const reset = () => {
    setView((prev) => ({ ...prev, page: 1 }));
    setExpanded(null);
  };

  return (
    <section
      aria-label={t("title")}
      className={cn(
        "relative overflow-hidden rounded-2xl p-5 md:p-6 space-y-5",
        "bg-card/60 dark:bg-[rgba(20,20,23,0.5)] backdrop-blur-lg",
        "border border-border/50 dark:border-white/[0.08] shadow-sm"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
            <BarChart3 className="h-4.5 w-4.5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">{t("title")}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("description")}</p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 rounded-lg"
          disabled={!enabled || isFetching}
          onClick={() => {
            setExpanded(null);
            void refetch();
          }}
        >
          <RefreshCw className={cn("mr-2 h-3.5 w-3.5", isFetching && "animate-spin")} />
          {t("refresh")}
        </Button>
      </div>
      <div
        className="inline-flex flex-wrap gap-1 rounded-lg bg-muted/50 p-1"
        aria-label={t("period")}
      >
        {USAGE_PERIODS.map((value) => (
          <Button
            key={value}
            size="sm"
            variant={period === value ? "secondary" : "ghost"}
            className={cn("h-7 px-2.5 text-xs", period === value && "shadow-xs font-medium")}
            aria-pressed={period === value}
            onClick={() => {
              setPeriod(value);
              reset();
            }}
          >
            {t(`periods.${value}`)}
          </Button>
        ))}
      </div>
      {period === "custom" && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            setAppliedDates(dates);
            reset();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="usage-start-date">{t("startDate")}</Label>
            <Input
              id="usage-start-date"
              type="date"
              required
              value={dates.startDate}
              max={dates.endDate || undefined}
              onChange={(event) => setDates((prev) => ({ ...prev, startDate: event.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="usage-end-date">{t("endDate")}</Label>
            <Input
              id="usage-end-date"
              type="date"
              required
              value={dates.endDate}
              min={dates.startDate || undefined}
              onChange={(event) => setDates((prev) => ({ ...prev, endDate: event.target.value }))}
            />
          </div>
          <Button
            type="submit"
            disabled={!dates.startDate || !dates.endDate || dates.startDate > dates.endDate}
          >
            {t("apply")}
          </Button>
        </form>
      )}
      {!enabled ? (
        <p className="text-sm text-muted-foreground">{t("selectDates")}</p>
      ) : isError ? (
        <p role="alert" className="text-destructive">
          {t("error")}
        </p>
      ) : isPending ? (
        <p role="status">{t("loading")}</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {t("timezone", { timezone: data.timezone })}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3.5">
              <p className="text-xs text-muted-foreground">{t("cost")}</p>
              <p className="mt-1 text-lg font-bold tracking-tight tabular-nums">
                {formatCurrency(data.summary.cost, currencyCode)}
              </p>
            </div>
            <div
              className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3.5"
              title={sumUsageTokens(data.summary).toLocaleString()}
            >
              <p className="text-xs text-muted-foreground">{t("totalTokens")}</p>
              <p className="mt-1 text-lg font-bold tracking-tight tabular-nums">
                {formatTokenAmount(sumUsageTokens(data.summary))}
              </p>
            </div>
            <div
              className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3.5"
              title={t("cacheHitRateDescription")}
            >
              <p className="text-xs text-muted-foreground">{t("cacheHitRate")}</p>
              <p className="mt-1 text-lg font-bold tracking-tight tabular-nums text-emerald-600 dark:text-emerald-400">
                {cacheHitRate(data.summary)}
              </p>
            </div>
            <div
              className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-3.5"
              title={data.summary.requests.toLocaleString()}
            >
              <p className="text-xs text-muted-foreground">{t("requests")}</p>
              <p className="mt-1 text-lg font-bold tracking-tight tabular-nums">
                {formatTokenAmount(data.summary.requests)}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {tokenFields.map((field) => (
              <div
                key={field}
                className="rounded-xl border border-border/50 bg-background/40 px-3.5 py-2.5"
                title={data.summary[field].toLocaleString()}
              >
                <p className="text-[11px] text-muted-foreground">{t(field)}</p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums">
                  {formatTokenAmount(data.summary[field])}
                </p>
              </div>
            ))}
          </div>
          <div
            className="inline-flex flex-wrap gap-1 rounded-lg bg-muted/50 p-1"
            aria-label={t("groupBy")}
          >
            {scopes.map((scope) => (
              <Button
                key={scope}
                size="sm"
                variant={view.scope === scope ? "secondary" : "ghost"}
                className={cn("h-7 px-3 text-xs", view.scope === scope && "shadow-xs font-medium")}
                aria-pressed={view.scope === scope}
                onClick={() => {
                  setView({ scope, page: 1 });
                  setExpanded(null);
                }}
              >
                {t(`scopes.${scope}`)}
              </Button>
            ))}
          </div>
          <div aria-busy={isFetching}>
            <UsageTable
              data={data}
              query={query}
              currencyCode={currencyCode}
              expanded={expanded}
              onExpand={
                view.scope === "channel"
                  ? (id) => setExpanded(expanded === id ? null : id)
                  : undefined
              }
            />
          </div>
          <Pagination
            data={data}
            onPage={(page) => {
              setView((prev) => ({ ...prev, page }));
              setExpanded(null);
            }}
          />
        </>
      )}
    </section>
  );
}
