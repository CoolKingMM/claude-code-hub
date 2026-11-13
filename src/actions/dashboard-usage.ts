"use server";

import { getSession } from "@/lib/auth";
import { TTLMap } from "@/lib/cache/ttl-map";
import { getCachedSystemSettings } from "@/lib/config/system-settings-cache";
import { resolveDashboardUsageRange } from "@/lib/dashboard-usage-range";
import { logger } from "@/lib/logger";
import { resolveSystemTimezone } from "@/lib/utils/timezone";
import { DashboardUsageQuerySchema } from "@/lib/validation/dashboard-usage";
import { findDashboardUsage } from "@/repository/dashboard-usage";
import type { DashboardUsageData, DashboardUsageQuery } from "@/types/dashboard-usage";
import type { ActionResult } from "./types";

const cache = new TTLMap<string, DashboardUsageData>({ ttlMs: 30_000, maxSize: 64 });
const pending = new Map<string, Promise<DashboardUsageData>>();

export async function getDashboardUsage(
  query: DashboardUsageQuery
): Promise<ActionResult<DashboardUsageData>> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Unauthorized", errorCode: "UNAUTHORIZED" };
  const parsed = DashboardUsageQuerySchema.safeParse(query);
  if (!parsed.success)
    return { ok: false, error: "Invalid usage query", errorCode: "INVALID_FORMAT" };
  try {
    const [timezone, settings] = await Promise.all([
      resolveSystemTimezone(),
      getCachedSystemSettings(),
    ]);
    // Regular keys always see their owner's costs; only administrators can inspect global data.
    const userId = session.user.role === "admin" ? undefined : session.user.id;
    const now = new Date();
    const range = resolveDashboardUsageRange(parsed.data, timezone, now);
    const cacheKey = JSON.stringify([
      userId ?? "admin",
      parsed.data,
      timezone,
      settings.billingModelSource,
      parsed.data.period === "last24h" ? Math.floor(now.getTime() / 30_000) : range,
    ]);
    const cached = cache.get(cacheKey);
    if (cached) return { ok: true, data: cached };
    let work = pending.get(cacheKey);
    if (!work) {
      work = findDashboardUsage(parsed.data, range, timezone, userId, settings.billingModelSource)
        .then((data) => {
          const result = {
            ...data,
            page: parsed.data.page,
            pageSize: parsed.data.pageSize,
            startTime: range.startTime.toISOString(),
            endTime: range.endTime.toISOString(),
            timezone,
            generatedAt: now.toISOString(),
          };
          cache.set(cacheKey, result);
          return result;
        })
        .finally(() => pending.delete(cacheKey));
      pending.set(cacheKey, work);
    }
    return { ok: true, data: await work };
  } catch (error) {
    logger.error("Failed to load dashboard usage", { error });
    return { ok: false, error: "Failed to load usage", errorCode: "OPERATION_FAILED" };
  }
}
