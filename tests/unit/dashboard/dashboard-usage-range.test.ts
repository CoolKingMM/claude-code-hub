import { describe, expect, test } from "vitest";
import { resolveDashboardUsageRange } from "@/lib/dashboard-usage-range";
import { DashboardUsageQuerySchema } from "@/lib/validation/dashboard-usage";

describe("dashboard usage windows", () => {
  const now = new Date("2026-03-09T01:30:00Z");
  test.each([
    ["today", "2026-03-08T05:00:00Z", "2026-03-09T04:00:00Z"],
    ["yesterday", "2026-03-07T05:00:00Z", "2026-03-08T05:00:00Z"],
    ["7days", "2026-03-02T05:00:00Z", "2026-03-09T04:00:00Z"],
    ["30days", "2026-02-07T05:00:00Z", "2026-03-09T04:00:00Z"],
    ["last24h", "2026-03-08T01:30:00Z", "2026-03-09T01:30:00Z"],
  ] as const)("%s respects the system timezone and daylight saving", (period, start, end) => {
    const range = resolveDashboardUsageRange({ period, scope: "day" }, "America/New_York", now);
    expect(range).toEqual({ startTime: new Date(start), endTime: new Date(end) });
  });
  test("custom dates include the entire end day through a DST transition", () => {
    const range = resolveDashboardUsageRange(
      { period: "custom", scope: "model", startDate: "2026-03-08", endDate: "2026-03-08" },
      "America/New_York",
      now
    );
    expect(range).toEqual({
      startTime: new Date("2026-03-08T05:00:00Z"),
      endTime: new Date("2026-03-09T04:00:00Z"),
    });
  });
  test.each([
    { period: "custom" },
    { period: "custom", startDate: "2026-02-30", endDate: "2026-03-01" },
    { period: "custom", startDate: "2026-03-02", endDate: "2026-03-01" },
    { scope: "providerKey" },
    { scope: "channel", channelId: "1:codex" },
    { pageSize: 101 },
    { channelId: "1'; SELECT 1", scope: "providerKey" },
  ])("rejects invalid query %j", (query) => {
    expect(DashboardUsageQuerySchema.safeParse(query).success).toBe(false);
  });
  test("validates channel expansion and fills pagination defaults", () => {
    expect(
      DashboardUsageQuerySchema.parse({ scope: "providerKey", channelId: "42:codex" })
    ).toMatchObject({ period: "today", page: 1, pageSize: 20 });
  });
});
