import { describe, expect, test } from "vitest";
import { groupProvidersByVendor } from "@/lib/provider-vendor-groups";

describe("服务商密钥聚合", () => {
  test("追加的密钥归入同一服务商，保留不同类型及独立开关", () => {
    const providers = [
      { id: 1, providerVendorId: 11, providerType: "codex", isEnabled: true },
      { id: 2, providerVendorId: 11, providerType: "codex", isEnabled: false },
      { id: 3, providerVendorId: 22, providerType: "claude", isEnabled: true },
      { id: 4, providerVendorId: 11, providerType: "claude", isEnabled: true },
    ];
    const groups = groupProvidersByVendor(providers);
    expect(groups).toHaveLength(2);
    expect(groups[0].providers.map((provider) => provider.id)).toEqual([1, 2, 4]);
    expect(groups[0].providers[1].isEnabled).toBe(false);
    expect(groups[1].vendorId).toBe(22);
  });

  test("未知服务商不能被错误合并，空列表不显示条目", () => {
    const groups = groupProvidersByVendor([
      { id: 1, providerVendorId: null },
      { id: 2, providerVendorId: 0 },
      { id: 3, providerVendorId: -1 },
    ]);
    expect(groups.map((group) => group.vendorId)).toEqual([-1, -2, -3]);
    expect(groupProvidersByVendor([])).toEqual([]);
  });

  test("筛选和排序后的服务商顺序沿用列表顺序", () => {
    expect(
      groupProvidersByVendor([
        { id: 3, providerVendorId: 22 },
        { id: 2, providerVendorId: 11 },
        { id: 1, providerVendorId: 11 },
      ]).map((group) => group.vendorId)
    ).toEqual([22, 11]);
  });
});
