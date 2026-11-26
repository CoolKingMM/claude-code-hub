"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Clock,
  DollarSign,
  KeyRound,
  Layers,
  RefreshCw,
  ScrollText,
  Server,
  TrendingUp,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/routing";
import { getOverviewData, type OverviewData } from "@/lib/api-client/v1/actions/overview";
import { cn, formatTokenAmount } from "@/lib/utils";
import { type CurrencyCode, formatCurrency } from "@/lib/utils/currency";
import { BentoGrid } from "./bento/bento-grid";
import { BentoMetricCard } from "./bento/metric-card";
import { DashboardUsage } from "./dashboard-usage";

function calcComparison(current: number, previous: number, label: string) {
  if (previous <= 0) return undefined;
  return [{ value: Math.round(((current - previous) / previous) * 100), label }];
}

function formatAvgLatency(ms: number): string {
  const rounded = Math.round(ms);
  return rounded >= 1000 ? `${(rounded / 1000).toFixed(2)} s` : `${rounded} ms`;
}

export function DashboardOverview({
  isAdmin,
  currencyCode,
  initialOverview,
  modelBreakdown,
}: {
  isAdmin: boolean;
  currencyCode: CurrencyCode;
  initialOverview?: OverviewData;
  modelBreakdown?: ReactNode;
}) {
  const t = useTranslations("customs");
  const tKeys = useTranslations("dashboard.apiKeys");
  const tNav = useTranslations("dashboard.nav");
  const tDesc = useTranslations("dashboard.description");
  const { data, isError, isFetching, refetch } = useQuery({
    queryKey: ["personal-dashboard-overview", isAdmin],
    queryFn: async () => {
      const result = await getOverviewData();
      if (!result.ok || !result.data) throw new Error("Failed to fetch overview");
      return result.data;
    },
    initialData: initialOverview,
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  const vsYesterday = t("metrics.vsYesterday");
  const requestsComparisons = data
    ? calcComparison(data.todayRequests, data.yesterdaySamePeriodRequests, vsYesterday)
    : undefined;
  const costComparisons = data
    ? calcComparison(data.todayCost, data.yesterdaySamePeriodCost, vsYesterday)
    : undefined;
  const latencyComparisons = data
    ? calcComparison(data.avgResponseTime, data.yesterdaySamePeriodAvgResponseTime, vsYesterday)
    : undefined;
  const tokensComparisons = data
    ? calcComparison(data.todayTokens ?? 0, data.yesterdaySamePeriodTokens ?? 0, vsYesterday)
    : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{tNav("dashboard")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{tDesc("dashboard")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm" className="gap-1.5 rounded-lg">
            <Link href="/dashboard/logs">
              <ScrollText className="h-3.5 w-3.5" />
              {tNav("usageLogs")}
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="gap-1.5 rounded-lg">
            <Link href="/dashboard/users">
              <KeyRound className="h-3.5 w-3.5" />
              {tNav("apiKeys")}
            </Link>
          </Button>
          {isAdmin && (
            <Button asChild variant="outline" size="sm" className="gap-1.5 rounded-lg">
              <Link href="/dashboard/providers">
                <Server className="h-3.5 w-3.5" />
                {tNav("providers")}
              </Link>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="rounded-lg"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            <RefreshCw className={cn("mr-2 h-3.5 w-3.5", isFetching && "animate-spin")} />
            {tKeys("refresh")}
          </Button>
        </div>
      </div>
      {isError && (
        <p role="alert" className="text-sm text-destructive">
          {tKeys("fetchFailed")}
        </p>
      )}
      <BentoGrid>
        <BentoMetricCard
          title={t("metrics.todayRequests")}
          value={data ? formatTokenAmount(data.todayRequests) : "-"}
          valueTitle={data ? data.todayRequests.toLocaleString() : undefined}
          comparisons={requestsComparisons}
          subtitle={
            data && data.todayErrorRate > 0
              ? `${t("sessions.status.error")}: ${data.todayErrorRate.toFixed(1)}%`
              : undefined
          }
          icon={TrendingUp}
          accentColor="blue"
        />
        <BentoMetricCard
          title={t("metrics.todayCost")}
          value={data ? formatCurrency(data.todayCost, currencyCode) : "-"}
          comparisons={costComparisons}
          icon={DollarSign}
          accentColor="amber"
        />
        <BentoMetricCard
          title={t("metrics.avgResponse")}
          value={data ? formatAvgLatency(data.avgResponseTime) : "-"}
          comparisons={latencyComparisons}
          icon={Clock}
          accentColor="purple"
        />
        <BentoMetricCard
          title={t("metrics.todayTokens")}
          value={data ? formatTokenAmount(data.todayTokens ?? 0) : "-"}
          valueTitle={data ? (data.todayTokens ?? 0).toLocaleString() : undefined}
          comparisons={tokensComparisons}
          subtitle={
            data && isAdmin
              ? `${t("metrics.concurrent")}: ${data.concurrentSessions.toLocaleString()}`
              : undefined
          }
          icon={Layers}
          accentColor="emerald"
        />
      </BentoGrid>
      {modelBreakdown}
      <DashboardUsage currencyCode={currencyCode} />
    </div>
  );
}
