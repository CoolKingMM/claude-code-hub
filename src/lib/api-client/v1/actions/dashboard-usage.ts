import type { DashboardUsageData, DashboardUsageQuery } from "@/types/dashboard-usage";
import { apiGet, searchParams } from "./_compat";

export function getDashboardUsage(query: DashboardUsageQuery, signal?: AbortSignal) {
  return apiGet<DashboardUsageData>(`/api/v1/dashboard/usage${searchParams({ ...query })}`, {
    signal,
  });
}
