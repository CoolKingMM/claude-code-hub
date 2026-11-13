import { z } from "@hono/zod-openapi";

export { DashboardUsageQuerySchema } from "@/lib/validation/dashboard-usage";

const UsageMetricsSchema = z.object({
  requests: z.number().describe("Billable request count."),
  cost: z.number().describe("Recorded cost in USD, without repricing historical usage."),
  inputTokens: z.number().describe("Input tokens."),
  outputTokens: z.number().describe("Output tokens."),
  cacheCreationTokens: z.number().describe("Cache creation tokens."),
  cacheReadTokens: z.number().describe("Cache read tokens."),
});

export const DashboardUsageResponseSchema = z.object({
  summary: UsageMetricsSchema.describe("Metrics for the complete selected range."),
  items: z
    .array(
      UsageMetricsSchema.extend({
        id: z.string().describe("Grouping identifier; never a credential."),
        name: z.string().nullable().describe("Display name; null for a removed entity."),
        providerType: z.string().nullable().describe("Channel protocol type."),
      })
    )
    .describe("Selected grouping page."),
  totalCount: z.number().describe("Total grouped rows."),
  page: z.number().describe("Current page."),
  pageSize: z.number().describe("Maximum page size."),
  startTime: z.string().describe("Inclusive range start."),
  endTime: z.string().describe("Exclusive range end."),
  timezone: z.string().describe("System timezone used for calendar dates."),
  generatedAt: z.string().describe("Time of the cached aggregation."),
});

export const DashboardTimeRangeSchema = z
  .enum(["today", "7days", "30days", "thisMonth"])
  .describe("Dashboard statistics time range.");

export const DashboardStatisticsQuerySchema = z.object({
  timeRange: DashboardTimeRangeSchema.default("today").describe("Statistics time range."),
});

export const DashboardRateLimitStatsQuerySchema = z.object({
  userId: z.coerce.number().int().positive().optional().describe("Optional user id filter."),
  providerId: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .describe("Optional provider id filter."),
  keyId: z.coerce.number().int().positive().optional().describe("Optional key id filter."),
  limitType: z
    .enum([
      "rpm",
      "usd_5h",
      "usd_weekly",
      "usd_monthly",
      "usd_total",
      "concurrent_sessions",
      "daily_quota",
    ])
    .optional()
    .describe("Optional rate limit type filter."),
  startTime: z.string().datetime({ offset: true }).optional().describe("Optional start time."),
  endTime: z.string().datetime({ offset: true }).optional().describe("Optional end time."),
});

export const DashboardConcurrentSessionsResponseSchema = z.object({
  count: z.number().int().min(0).describe("Current concurrent session count."),
});

export const DashboardOverviewResponseSchema = z.object({
  concurrentSessions: z.number().int().min(0).describe("Concurrent sessions."),
  todayRequests: z.number().int().min(0).describe("Today's request count."),
  todayCost: z.number().min(0).describe("Today's cost."),
  avgResponseTime: z.number().min(0).describe("Average response time in milliseconds."),
  todayErrorRate: z.number().min(0).describe("Today's error rate percentage."),
  yesterdaySamePeriodRequests: z.number().int().min(0).describe("Yesterday same-period requests."),
  yesterdaySamePeriodCost: z.number().min(0).describe("Yesterday same-period cost."),
  yesterdaySamePeriodAvgResponseTime: z
    .number()
    .min(0)
    .describe("Yesterday same-period average response time."),
  recentMinuteRequests: z.number().int().min(0).describe("Recent one-minute request count."),
});

export const DashboardGenericObjectSchema = z
  .record(z.string(), z.unknown())
  .describe("Dashboard response object.");

export const DashboardArrayResponseSchema = z.object({
  items: z.array(z.unknown()).describe("Dashboard response items."),
});

export const DispatchSimulatorInputSchema = z
  .object({
    clientFormat: z.enum(["claude", "openai", "response", "gemini"]).describe("Client format."),
    modelName: z.string().trim().max(255).default("").describe("Requested model name."),
    groupTags: z
      .array(z.string().trim().min(1).max(255))
      .max(20)
      .default([])
      .describe("Group tags."),
  })
  .strict();

export type DashboardStatisticsQuery = z.infer<typeof DashboardStatisticsQuerySchema>;
export type DashboardRateLimitStatsQuery = z.infer<typeof DashboardRateLimitStatsQuerySchema>;
export type DispatchSimulatorInput = z.infer<typeof DispatchSimulatorInputSchema>;
