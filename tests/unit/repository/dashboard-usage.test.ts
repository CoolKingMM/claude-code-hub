import { CasingCache } from "drizzle-orm/casing";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { DashboardUsageQuery } from "@/types/dashboard-usage";

const execute = vi.hoisted(() => vi.fn());
vi.mock("@/drizzle/db", () => ({ db: { execute } }));
vi.mock("server-only", () => ({}));
import { findDashboardUsage } from "@/repository/dashboard-usage";

const range = {
  startTime: new Date("2026-01-01T00:00:00Z"),
  endTime: new Date("2026-01-03T00:00:00Z"),
};
function sqlQuery() {
  return (execute.mock.calls[0][0] as SQL).toQuery({
    escapeName: (name) => `"${name}"`,
    escapeParam: (index) => `$${index + 1}`,
    escapeString: (value) => `'${value}'`,
    casing: new CasingCache(),
  });
}
beforeEach(() => {
  execute.mockReset();
  execute.mockResolvedValue([
    {
      summary: { cost: "1.5", requests: "2", inputTokens: "900719" },
      items: [
        { id: "8:codex", name: "Provider", providerType: "codex", cost: "1.5", requests: "2" },
      ],
      total_count: "1",
    },
  ]);
});
describe("dashboard ledger aggregations", () => {
  test.each(["channel", "providerKey", "key", "model", "day"] as const)(
    "%s uses one bounded ledger aggregation",
    async (scope) => {
      const query: DashboardUsageQuery = {
        period: "custom",
        scope,
        page: 2,
        pageSize: 10,
        ...(scope === "providerKey" ? { channelId: "8:codex" } : {}),
      };
      const data = await findDashboardUsage(query, range, "Asia/Shanghai", 5, "original");
      expect(execute).toHaveBeenCalledOnce();
      expect(data).toMatchObject({
        summary: { cost: 1.5, requests: 2, inputTokens: 900719 },
        totalCount: 1,
        items: [{ cost: 1.5 }],
      });
      const sql = sqlQuery();
      expect(sql.sql).toContain('"usage_ledger"');
      expect(sql.sql).toContain("GROUPING SETS ((dimension_id), ())");
      expect(sql.sql).toContain('"is_replay" = false');
      expect(sql.sql).toContain('"blocked_by" IS NULL');
      expect(sql.sql).toContain("NOT IN");
      expect(sql.sql).not.toContain("message_request");
      expect(sql.params).toContain("2026-01-03T00:00:00.000Z");
      expect(sql.params).toContain(5);
      expect(sql.params.slice(-2)).toEqual([10, 10]);
      if (scope === "providerKey") expect(sql.params).toContain("8:codex");
      if (scope === "channel") expect(sql.sql).toContain('"provider_vendor_id"');
      if (scope === "key") expect(sql.sql).toContain("deleted-key:");
      if (scope === "day") expect(sql.params).toContain("Asia/Shanghai");
    }
  );
  test("redirected models and global scope preserve the recorded numeric cost", async () => {
    await findDashboardUsage(
      { period: "today", scope: "model" },
      range,
      "UTC",
      undefined,
      "redirected"
    );
    const sql = sqlQuery();
    expect(sql.sql).toContain('COALESCE("usage_ledger"."model", "usage_ledger"."original_model"');
    expect(sql.sql).not.toContain('"user_id" =');
    expect(sql.sql).not.toContain("cost_multiplier");
    expect(sql.params.slice(-2)).toEqual([20, 0]);
  });
  test("empty aggregates return zeros and retain removed labels", async () => {
    execute.mockResolvedValue([
      {
        summary: {},
        items: [{ id: "provider:9", name: null, providerType: null }],
        total_count: 1,
      },
    ]);
    const data = await findDashboardUsage(
      { period: "today", scope: "channel" },
      range,
      "UTC",
      undefined,
      "original"
    );
    expect(data.summary).toEqual({
      cost: 0,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    });
    expect(data.items[0]).toMatchObject({ name: null, providerType: null });
  });
});
