import { formatInTimeZone } from "date-fns-tz";
import type { DashboardUsageQuery } from "@/types/dashboard-usage";
import { parseDateRangeToTimestamps } from "./utils/date-range";

export function resolveDashboardUsageRange(
  query: DashboardUsageQuery,
  timezone: string,
  now = new Date()
): { startTime: Date; endTime: Date } {
  if (query.period === "last24h") {
    return { startTime: new Date(now.getTime() - 24 * 60 * 60 * 1000), endTime: now };
  }
  let startDate = query.startDate;
  let endDate = query.endDate;
  if (query.period !== "custom") {
    endDate = formatInTimeZone(now, timezone, "yyyy-MM-dd");
    const date = new Date(`${endDate}T00:00:00Z`);
    if (query.period === "yesterday") {
      date.setUTCDate(date.getUTCDate() - 1);
      endDate = date.toISOString().slice(0, 10);
    } else if (query.period === "7days" || query.period === "30days") {
      date.setUTCDate(date.getUTCDate() - (query.period === "7days" ? 6 : 29));
    }
    startDate = date.toISOString().slice(0, 10);
  }
  const range = parseDateRangeToTimestamps(startDate, endDate, timezone);
  return { startTime: new Date(range.startTime!), endTime: new Date(range.endTime!) };
}
