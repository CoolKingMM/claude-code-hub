"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, Clock, DollarSign, RefreshCw, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/routing";
import { getOverviewData, type OverviewData } from "@/lib/api-client/v1/actions/overview";
import { type CurrencyCode, formatCurrency } from "@/lib/utils/currency";
import { BentoGrid } from "./bento/bento-grid";
import { BentoMetricCard } from "./bento/metric-card";
import { DashboardUsage } from "./dashboard-usage";

export function DashboardOverview({
  isAdmin,
  currencyCode,
  initialOverview,
}: {
  isAdmin: boolean;
  currencyCode: CurrencyCode;
  initialOverview?: OverviewData;
}) {
  const t = useTranslations("customs");
  const tKeys = useTranslations("dashboard.apiKeys");
  const tNav = useTranslations("dashboard.nav");
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{tNav("dashboard")}</h1>
        <Button variant="outline" disabled={isFetching} onClick={() => void refetch()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          {tKeys("refresh")}
        </Button>
      </div>
      {isError && (
        <p role="alert" className="text-sm text-destructive">
          {tKeys("fetchFailed")}
        </p>
      )}
      <BentoGrid>
        <BentoMetricCard
          title={t("metrics.todayRequests")}
          value={data?.todayRequests ?? "-"}
          icon={TrendingUp}
          accentColor="blue"
        />
        <BentoMetricCard
          title={t("metrics.todayCost")}
          value={data ? formatCurrency(data.todayCost, currencyCode) : "-"}
          icon={DollarSign}
          accentColor="amber"
        />
        <BentoMetricCard
          title={t("metrics.avgResponse")}
          value={data ? `${Math.round(data.avgResponseTime)} ms` : "-"}
          icon={Clock}
          accentColor="purple"
        />
        <BentoMetricCard
          title={t("metrics.rpm")}
          value={data?.recentMinuteRequests ?? "-"}
          icon={Activity}
          accentColor="emerald"
        />
      </BentoGrid>
      <DashboardUsage currencyCode={currencyCode} />
      <div className="flex flex-wrap gap-3">
        <Button asChild variant="outline">
          <Link href="/dashboard/logs">{tNav("usageLogs")}</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/dashboard/users">{tNav("apiKeys")}</Link>
        </Button>
        {isAdmin && (
          <Button asChild variant="outline">
            <Link href="/dashboard/providers">{tNav("providers")}</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
