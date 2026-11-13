import { beforeEach, describe, expect, test, vi } from "vitest";
import { CasingCache } from "drizzle-orm/casing";
import type { SQL } from "drizzle-orm";
import {
  copyProviderEndpointPool,
  syncProviderVendorsForGroupChange,
} from "@/repository/provider-endpoints";

const row = {
  id: 88,
  vendorId: 6,
  providerType: "claude" as const,
  url: "https://wzw.pp.ua",
  websiteUrl: "https://wzw.pp.ua",
  name: "Wong",
  groupTag: "glm",
  faviconUrl: null,
};
function arrange() {
  const query = (rows: unknown[]) => ({
    from: () => ({
      where: () => Object.assign(Promise.resolve(rows), { limit: async () => rows }),
    }),
  });
  const select = vi
    .fn()
    .mockReturnValueOnce(query([row]))
    .mockReturnValueOnce(
      query([{ id: 150, displayName: "Wong", websiteUrl: row.websiteUrl, faviconUrl: null }])
    );
  const updateWhere = vi.fn(async () => []);
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));
  const insertReturning = vi.fn(async () => [{ id: 200 }]);
  const insertValues = vi.fn(() => ({
    onConflictDoNothing: () => ({ returning: insertReturning }),
  }));
  const insert = vi.fn(() => ({ values: insertValues }));
  const execute = vi.fn(async () => []);
  return {
    tx: { select, update, insert, execute, delete: vi.fn() } as never,
    select,
    updateSet,
    insertValues,
    execute,
  };
}
beforeEach(() => vi.clearAllMocks());
describe("group change vendor synchronization", () => {
  test("splits the group, copies the endpoint pool and preserves the credential id", async () => {
    const { tx, execute, updateSet, insertValues } = arrange();
    await syncProviderVendorsForGroupChange([88], tx);
    expect(updateSet).toHaveBeenCalledWith({ providerVendorId: 150, updatedAt: expect.any(Date) });
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ vendorId: 150, providerType: "claude", url: row.url })
    );
    expect(execute).toHaveBeenCalledOnce();
    const q = (execute.mock.calls[0][0] as SQL).toQuery({
      casing: new CasingCache(),
      escapeName: (s) => `"${s}"`,
      escapeParam: (n) => `$${n + 1}`,
      escapeString: (s) => `'${s}'`,
    });
    expect(q.params).toContain(6);
    expect(q.params).toContain(150);
    expect(q.sql).toContain("is_enabled");
    expect(q.sql).toContain("ON CONFLICT");
    expect(q.sql).not.toContain("DELETE");
  });
  test("existing group identity needs no provider or endpoint mutation", async () => {
    const { tx, select, execute, updateSet, insertValues } = arrange();
    select.mockReset();
    const where = () =>
      Object.assign(Promise.resolve([row]), {
        limit: async () => [
          { id: 6, displayName: "Wong", websiteUrl: row.websiteUrl, faviconUrl: null },
        ],
      });
    select.mockReturnValue({ from: () => ({ where }) });
    await syncProviderVendorsForGroupChange([88], tx);
    expect(execute).not.toHaveBeenCalled();
    expect(updateSet).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });
  test("copying a pool to itself is a no-op", async () => {
    const { tx, execute } = arrange();
    await copyProviderEndpointPool(6, 6, "claude", tx);
    expect(execute).not.toHaveBeenCalled();
  });
});
