import { beforeEach, describe, expect, test, vi } from "vitest";

const m = vi.hoisted(() => ({
  session: vi.fn(),
  owners: vi.fn(),
  list: vi.fn(),
  key: vi.fn(),
  models: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getSession: m.session }));
vi.mock("@/repository/personal-keys", () => ({
  findApiKeyOwners: m.owners,
  findPersonalKeysSummary: m.list,
  findKeyModelStats: m.models,
}));
vi.mock("@/repository/key", () => ({ findKeyById: m.key }));
vi.mock("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string) => key,
}));

beforeEach(() => {
  vi.clearAllMocks();
  m.session.mockResolvedValue({ user: { id: 1, role: "user" }, key: { canLoginWebUi: true } });
});
describe("personal key queries", () => {
  test("anonymous sessions cannot read owners, keys or statistics", async () => {
    m.session.mockResolvedValue(null);
    const a = await import("@/actions/personal-keys");
    expect((await a.getPersonalKeyOwners()).ok).toBe(false);
    expect((await a.getPersonalKeyList(1)).ok).toBe(false);
    expect((await a.getPersonalKeyModelStats(1)).ok).toBe(false);
    expect(m.owners).not.toHaveBeenCalled();
    expect(m.list).not.toHaveBeenCalled();
    expect(m.models).not.toHaveBeenCalled();
  });
  test("normal sessions only query their real owner", async () => {
    m.owners.mockResolvedValue([{ id: 1, description: "personal" }]);
    const a = await import("@/actions/personal-keys");
    const result = await a.getPersonalKeyOwners();
    expect(result).toMatchObject({ ok: true, data: [{ id: 1, note: "personal", keys: [] }] });
    expect(m.owners).toHaveBeenCalledWith(1);
    expect((await a.getPersonalKeyList(2)).ok).toBe(false);
    expect(m.list).not.toHaveBeenCalled();
  });
  test("admin-token inventory never treats sentinel -1 as an owner", async () => {
    m.session.mockResolvedValue({ user: { id: -1, role: "admin" }, key: {} });
    m.owners.mockResolvedValue([]);
    const a = await import("@/actions/personal-keys");
    await a.getPersonalKeyOwners();
    expect(m.owners).toHaveBeenCalledWith(undefined);
  });
  test("list masks credentials and preserves monetary limits without model aggregation", async () => {
    m.list.mockResolvedValue([
      {
        key: {
          id: 7,
          key: "sk-secret-credential",
          name: "personal",
          isEnabled: true,
          expiresAt: null,
          createdAt: new Date(0),
          limit5hUsd: 5,
          limitTotalUsd: 100,
          limitDailyUsd: 10,
          limitWeeklyUsd: 20,
          limitMonthlyUsd: 30,
          cacheTtlPreference: "1h",
          costResetAt: null,
        },
        todayCallCount: 4,
        todayUsage: 1,
        todayTokens: 10,
        lastUsedAt: null,
        lastProviderName: null,
      },
    ]);
    const { getPersonalKeyList } = await import("@/actions/personal-keys");
    const result = await getPersonalKeyList(1);
    expect(result).toMatchObject({
      ok: true,
      data: [
        {
          id: 7,
          limitTotalUsd: 100,
          limit5hUsd: 5,
          limitDailyUsd: 10,
          limitWeeklyUsd: 20,
          limitMonthlyUsd: 30,
          cacheTtlPreference: "1h",
          todayCallCount: 4,
          todayUsage: 1,
          modelStats: [],
          canReveal: true,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("sk-secret-credential");
    expect(m.models).not.toHaveBeenCalled();
  });
  test("model statistics reject missing or foreign keys before querying the ledger", async () => {
    const { getPersonalKeyModelStats } = await import("@/actions/personal-keys");
    m.key.mockResolvedValue(null);
    expect(await getPersonalKeyModelStats(7)).toMatchObject({ ok: false, errorCode: "NOT_FOUND" });
    m.key.mockResolvedValue({ userId: 2, key: "foreign" });
    expect(await getPersonalKeyModelStats(7)).toMatchObject({
      ok: false,
      errorCode: "PERMISSION_DENIED",
    });
    expect(m.models).not.toHaveBeenCalled();
  });
  test("model aggregation only occurs when requested for an authorized key", async () => {
    m.key.mockResolvedValue({ userId: 1, key: "owned" });
    m.models.mockResolvedValue([{ model: "m", callCount: 1 }]);
    const { getPersonalKeyModelStats } = await import("@/actions/personal-keys");
    expect(await getPersonalKeyModelStats(7)).toMatchObject({ ok: true, data: [{ model: "m" }] });
    expect(m.models).toHaveBeenCalledWith("owned");
  });
});
