"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Fragment, useState } from "react";
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
      {data.items.map((item) => (
        <Fragment key={item.id}>
          <TableRow>
            <TableCell className="max-w-72">
              {onExpand ? (
                <Button
                  variant="ghost"
                  className="h-auto max-w-full justify-start gap-2 px-0 text-left"
                  onClick={() => onExpand(item.id)}
                  aria-expanded={expanded === item.id}
                  aria-label={t("expand", { name: label(item) })}
                >
                  {expanded === item.id ? (
                    <ChevronDown className="h-4 w-4 shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0" />
                  )}
                  <span className="truncate">{label(item)}</span>
                </Button>
              ) : (
                <span className="break-all">
                  {query.scope === "providerKey"
                    ? t("credential", { id: item.id.replace("provider:", "") })
                    : label(item)}
                </span>
              )}
              {item.providerType && query.scope === "channel" && (
                <span className="ml-2 text-xs text-muted-foreground">{item.providerType}</span>
              )}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatCurrency(item.cost, currencyCode)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {data.summary.cost > 0
                ? `${((item.cost / data.summary.cost) * 100).toFixed(1)}%`
                : "0%"}
            </TableCell>
            <TableCell className="text-right tabular-nums" title={t("cacheHitRateDescription")}>
              {cacheHitRate(item)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {item.requests.toLocaleString()}
            </TableCell>
            {tokenFields.map((field) => (
              <TableCell key={field} className="text-right tabular-nums">
                {item[field].toLocaleString()}
              </TableCell>
            ))}
          </TableRow>
          {expanded === item.id && (
            <TableRow>
              <TableCell colSpan={9} className="bg-muted/30 p-4">
                <ChannelUsage
                  query={{ ...query, scope: "providerKey", channelId: item.id, page: 1 }}
                  currencyCode={currencyCode}
                />
              </TableCell>
            </TableRow>
          )}
        </Fragment>
      ))}
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
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t(`scopes.${query.scope}`)}</TableHead>
          {(["cost", "share", "cacheHitRate", "requests", ...tokenFields] as const).map((field) => (
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
            <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
              {t("empty")}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
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
    <section aria-label={t("title")} className="rounded-xl border bg-card p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{t("title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Button
          variant="outline"
          disabled={!enabled || isFetching}
          onClick={() => {
            setExpanded(null);
            void refetch();
          }}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          {t("refresh")}
        </Button>
      </div>
      <div className="flex flex-wrap gap-2" aria-label={t("period")}>
        {USAGE_PERIODS.map((value) => (
          <Button
            key={value}
            size="sm"
            variant={period === value ? "secondary" : "outline"}
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
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-7">
            {(["cost", "cacheHitRate", "requests", ...tokenFields] as const).map((field) => (
              <div
                key={field}
                className="rounded-lg bg-muted/40 p-3"
                title={field === "cacheHitRate" ? t("cacheHitRateDescription") : undefined}
              >
                <p className="text-xs text-muted-foreground">{t(field)}</p>
                <p className="mt-1 font-semibold tabular-nums">
                  {field === "cacheHitRate"
                    ? cacheHitRate(data.summary)
                    : field === "cost"
                      ? formatCurrency(data.summary.cost, currencyCode)
                      : data.summary[field].toLocaleString()}
                </p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2" aria-label={t("groupBy")}>
            {scopes.map((scope) => (
              <Button
                key={scope}
                size="sm"
                variant={view.scope === scope ? "secondary" : "ghost"}
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
