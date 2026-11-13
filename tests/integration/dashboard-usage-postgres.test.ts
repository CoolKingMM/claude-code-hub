import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import * as schema from "@/drizzle/schema";
import type { DashboardUsageQuery } from "@/types/dashboard-usage";
vi.mock("@/drizzle/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/drizzle/db")>();
  return {
    ...actual,
    db: new Proxy(actual.db, {
      get(target, property) {
        if (property === "execute") {
          return (query: Parameters<typeof actual.db.execute>[0]) => testDb.execute(query);
        }
        return Reflect.get(target, property);
      },
    }),
  };
});
import { findDashboardUsage } from "@/repository/dashboard-usage";
let client: ReturnType<typeof postgres>;
let testDb: PostgresJsDatabase<typeof schema>;
const range = {
  startTime: new Date("2026-03-07T16:00:00Z"),
  endTime: new Date("2026-03-09T16:00:00Z"),
};
async function read(
  scope: DashboardUsageQuery["scope"],
  extra: Partial<DashboardUsageQuery> = {},
  owner: number | undefined = 1,
  source: "original" | "redirected" = "original"
) {
  return findDashboardUsage(
    { period: "custom", scope, ...extra },
    range,
    "Asia/Shanghai",
    owner,
    source
  );
}
describe.skipIf(!process.env.DSN)("dashboard usage real PostgreSQL", () => {
  beforeAll(async () => {
    const dsn = process.env.DSN!;
    if (!new URL(dsn).pathname.toLowerCase().includes("test"))
      throw new Error("Dashboard integration requires a dedicated test database");
    client = postgres(dsn, { max: 1 });
    testDb = drizzle(client, { schema });
    // Temporary tables isolate fixtures from all existing data and disappear on disconnect.
    for (const table of ["usage_ledger", "keys", "providers"])
      await client.unsafe(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS)`);
    await testDb.insert(schema.providers).values([
      {
        id: 11,
        name: "Agentrouter",
        url: "https://example.test",
        key: "upstream-a",
        providerVendorId: 8,
        providerType: "codex",
      },
      {
        id: 12,
        name: "Agentrouter-2",
        url: "https://example.test",
        key: "upstream-b",
        providerVendorId: 8,
        providerType: "codex",
      },
      {
        id: 13,
        name: "Claude",
        url: "https://example.test",
        key: "upstream-c",
        providerVendorId: 8,
        providerType: "claude",
      },
    ]);
    await testDb
      .insert(schema.keys)
      .values({ id: 1, userId: 1, name: "Main API key", key: "client-a" });
    const rows = [
      { provider: 11, key: "client-a", cost: "1.25", date: "2026-03-07T16:00:00Z" },
      { provider: 12, key: "client-a", cost: "2.75", date: "2026-03-08T16:00:00Z" },
      { provider: 13, key: "deleted-secret", cost: "3", date: "2026-03-09T15:59:59Z" },
      { provider: 99, key: "gone-secret", cost: "4", date: "2026-03-08T12:00:00Z" },
      { provider: 11, key: "other-owner", cost: "20", date: "2026-03-08T12:00:00Z", userId: 2 },
      { provider: 11, key: "out-of-range", cost: "100", date: "2026-03-09T16:00:00Z" },
      { provider: 11, key: "replay", cost: "100", date: "2026-03-08T12:00:00Z", isReplay: true },
      {
        provider: 11,
        key: "blocked",
        cost: "100",
        date: "2026-03-08T12:00:00Z",
        blockedBy: "rate_limit",
      },
      {
        provider: 11,
        key: "non-billing",
        cost: "100",
        date: "2026-03-08T12:00:00Z",
        endpoint: "/v1/messages/count_tokens",
      },
    ];
    await testDb.insert(schema.usageLedger).values(
      rows.map((r, i) => ({
        requestId: i + 1,
        userId: r.userId ?? 1,
        key: r.key,
        providerId: r.provider,
        finalProviderId: r.provider,
        model: "redirected-model",
        originalModel: "original-model",
        costUsd: r.cost,
        inputTokens: 100,
        outputTokens: 20,
        cacheCreationInputTokens: 30,
        cacheReadInputTokens: 40,
        endpoint: r.endpoint ?? "/v1/responses",
        isReplay: r.isReplay ?? false,
        blockedBy: r.blockedBy ?? null,
        createdAt: new Date(r.date),
      }))
    );
  });
  afterAll(async () => {
    if (client) await client.end({ timeout: 5 });
  });
  test("groups vendor plus protocol, preserves removed providers and full totals across pages", async () => {
    const result = await read("channel", { pageSize: 1 });
    expect(result.summary).toEqual({
      cost: 11,
      requests: 4,
      inputTokens: 400,
      outputTokens: 80,
      cacheCreationTokens: 120,
      cacheReadTokens: 160,
    });
    expect(result.totalCount).toBe(3);
    expect(result.items).toHaveLength(1);
    const all = await read("channel");
    expect(all.items.find((r) => r.id === "8:codex")).toMatchObject({
      name: "Agentrouter",
      cost: 4,
      requests: 2,
    });
    expect(all.items.find((r) => r.id === "8:claude")?.cost).toBe(3);
    expect(all.items.find((r) => r.id === "provider:99")?.name).toBeNull();
    expect((await read("channel", { page: 2, pageSize: 1 })).summary).toEqual(result.summary);
    expect((await read("channel", { page: 100 })).items).toEqual([]);
  });
  test("channel expansion contains only its upstream credentials", async () => {
    const result = await read("providerKey", { channelId: "8:codex" });
    expect(result.summary.cost).toBe(4);
    expect(result.items.map((r) => r.id)).toEqual(["provider:12", "provider:11"]);
    expect((await read("providerKey", { channelId: "provider:99" })).summary.cost).toBe(4);
  });
  test("models use configured billing names without changing recorded prices", async () => {
    expect((await read("model")).items[0]).toMatchObject({ id: "original-model", cost: 11 });
    expect((await read("model", {}, 1, "redirected")).items[0]).toMatchObject({
      id: "redirected-model",
      cost: 11,
    });
  });
  test("key and day grouping include deleted keys and timezone boundaries", async () => {
    const keys = await read("key");
    expect(keys.items.find((r) => r.id === "key:1")).toMatchObject({
      name: "Main API key",
      cost: 4,
    });
    expect(JSON.stringify(keys)).not.toContain("secret");
    expect(JSON.stringify(keys)).not.toContain("client-a");
    const days = await read("day");
    expect(days.items.map((r) => [r.id, r.cost])).toEqual([
      ["2026-03-09", 5.75],
      ["2026-03-08", 5.25],
    ]);
  });
  test("global totals and empty-owner results remain correct", async () => {
    const global = await findDashboardUsage(
      { period: "today", scope: "model" },
      range,
      "UTC",
      undefined,
      "original"
    );
    expect(global.summary.cost).toBe(31);
    const empty = await read("key", {}, 999);
    expect(empty.summary.cost).toBe(0);
    expect(empty.summary.requests).toBe(0);
    expect(empty.totalCount).toBe(0);
    expect(empty.items).toEqual([]);
  });
});
