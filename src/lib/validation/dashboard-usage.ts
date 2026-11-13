import { z } from "@hono/zod-openapi";
import { USAGE_PERIODS, USAGE_SCOPES } from "@/types/dashboard-usage";

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Invalid calendar date.");

export const DashboardUsageQuerySchema = z
  .object({
    period: z.enum(USAGE_PERIODS).default("today").describe("Usage window in the system timezone."),
    scope: z.enum(USAGE_SCOPES).default("channel").describe("Usage grouping."),
    startDate: date.optional().describe("Inclusive start date, required for a custom window."),
    endDate: date.optional().describe("Inclusive end date, required for a custom window."),
    channelId: z
      .string()
      .regex(/^(?:[1-9]\d*:[a-z-]+|provider:[1-9]\d*)$/)
      .optional()
      .describe("Channel to expand into individual provider credentials."),
    page: z.coerce.number().int().min(1).max(100000).default(1).describe("Result page."),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe("Maximum rows per page."),
  })
  .superRefine((value, ctx) => {
    if (
      value.period === "custom" &&
      (!value.startDate || !value.endDate || value.startDate > value.endDate)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["startDate"],
        message: "A valid custom date range is required.",
      });
    }
    if (value.scope === "providerKey" ? !value.channelId : value.channelId !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["channelId"],
        message: "channelId is required only for providerKey grouping.",
      });
    }
  });
