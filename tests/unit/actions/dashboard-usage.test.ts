import { beforeEach, describe, expect, test, vi } from "vitest";

const m = vi.hoisted(() => ({
  session: vi.fn(),
  settings: vi.fn(),
  timezone: vi.fn(),
  find: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getSession: m.session }));
vi.mock("@/lib/config/system-settings-cache", () => ({ getCachedSystemSettings: m.settings }));
vi.mock("@/lib/utils/timezone", () => ({ resolveSystemTimezone: m.timezone }));
vi.mock("@/repository/dashboard-usage", () => ({ findDashboardUsage: m.find }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));

const query = {
  period: "custom",
  scope: "channel",
  startDate: "2026-01-01",
  endDate: "2026-01-02",
} as const;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  m.session.mockResolvedValue({ user: { id: 5, role: "user" } });
  m.settings.mockResolvedValue({ allowGlobalUsageView: true, billingModelSource: "original" });
  m.timezone.mockResolvedValue("Asia/Shanghai");
  m.find.mockResolvedValue({ summary: { cost: 10 }, items: [], totalCount: 0 });
});
describe("dashboard usage access and caching", () => {
  test("anonymous sessions cannot query the ledger", async () => {
    m.session.mockResolvedValue(null);
    const { getDashboardUsage } = await import("@/actions/dashboard-usage");
    expect(await getDashboardUsage(query)).toMatchObject({ ok: false, errorCode: "UNAUTHORIZED" });
    expect(m.find).not.toHaveBeenCalled();
  });
  test("validates dates before database work", async () => {
    const { getDashboardUsage } = await import("@/actions/dashboard-usage");
    expect((await getDashboardUsage({ ...query, startDate: "2026-02-30" })).ok).toBe(false);
    expect(m.find).not.toHaveBeenCalled();
  });
  test("regular keys remain owner-scoped even with global overview access", async () => {
    const { getDashboardUsage } = await import("@/actions/dashboard-usage");
    await getDashboardUsage(query);
    expect(m.find).toHaveBeenCalledWith(
      expect.anything(),
      { startTime: new Date("2025-12-31T16:00:00Z"), endTime: new Date("2026-01-02T16:00:00Z") },
      "Asia/Shanghai",
      5,
      "original"
    );
  });
  test("coalesces simultaneous reads and separates owner cache entries", async () => {
    const result = Promise.withResolvers<{
      summary: { cost: number };
      items: [];
      totalCount: number;
    }>();
    m.find.mockReturnValue(result.promise);
    const { getDashboardUsage } = await import("@/actions/dashboard-usage");
    const a = getDashboardUsage(query);
    const b = getDashboardUsage(query);
    await vi.waitFor(() => expect(m.find).toHaveBeenCalledOnce());
    result.resolve({ summary: { cost: 10 }, items: [], totalCount: 0 });
    await Promise.all([a, b]);
    await getDashboardUsage(query);
    expect(m.find).toHaveBeenCalledOnce();
    m.session.mockResolvedValue({ user: { id: 6, role: "user" } });
    await getDashboardUsage(query);
    expect(m.find).toHaveBeenCalledTimes(2);
  });
  test("admins query global usage and failures can be retried", async () => {
    m.session.mockResolvedValue({ user: { id: -1, role: "admin" } });
    m.find.mockRejectedValueOnce(new Error("db down"));
    const { getDashboardUsage } = await import("@/actions/dashboard-usage");
    expect((await getDashboardUsage(query)).ok).toBe(false);
    expect(m.find).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "Asia/Shanghai",
      undefined,
      "original"
    );
    expect((await getDashboardUsage(query)).ok).toBe(true);
    expect(m.find).toHaveBeenCalledTimes(2);
  });
  test("pagination, model source and rolling windows are cache dimensions", async () => {
    const { getDashboardUsage } = await import("@/actions/dashboard-usage");
    await getDashboardUsage(query);
    await getDashboardUsage({ ...query, page: 2 });
    m.settings.mockResolvedValue({ billingModelSource: "redirected" });
    await getDashboardUsage(query);
    await getDashboardUsage({ period: "last24h", scope: "model" });
    expect(m.find).toHaveBeenCalledTimes(4);
  });
});
