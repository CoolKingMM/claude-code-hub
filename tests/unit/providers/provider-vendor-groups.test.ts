import { describe, expect, test } from "vitest";
import { groupProvidersByChannel, groupProvidersByVendor } from "@/lib/provider-vendor-groups";
import type { ProviderDisplay } from "@/types/provider";

describe("服务商密钥聚合", () => {
  test("Haiku 独立显示，同用途的多个密钥仍聚合为一行", () => {
    const base = { id: 3, providerVendorId: 112, providerType: "claude", groupTag: "claude" };
    const haiku = {
      ...base,
      id: 107,
      allowedModels: [{ matchType: "exact" as const, pattern: "claude-haiku-4-5-20251001" }],
      anthropicThinkingBudgetPreference: "10240",
    };
    const groups = groupProvidersByChannel([
      base,
      haiku,
      { ...haiku, id: 108 },
      { ...base, id: 4 },
    ]);
    expect(groups.map((group) => group.providers.map((provider) => provider.id))).toEqual([
      [3, 4],
      [107, 108],
    ]);
  });

  test("等价模型配置不受规则顺序、旧格式及 inherit 表示影响", () => {
    const base = { id: 1, providerVendorId: 11, providerType: "claude" };
    expect(
      groupProvidersByChannel([
        {
          ...base,
          allowedModels: [" b ", "a"],
          modelRedirects: { a: "b" } as unknown as ProviderDisplay["modelRedirects"],
          anthropicThinkingBudgetPreference: "inherit",
        },
        {
          ...base,
          id: 2,
          allowedModels: [
            { matchType: "exact" as const, pattern: "a" },
            { matchType: "exact" as const, pattern: "b" },
          ],
          modelRedirects: [{ matchType: "exact" as const, source: "a", target: "b" }],
          anthropicThinkingBudgetPreference: null,
        },
      ])
    ).toHaveLength(1);
    expect(
      groupProvidersByChannel([{ ...base, allowedModels: [], modelRedirects: [] }, base])
    ).toHaveLength(1);
  });

  test("相同接口的不同分组和思考参数独立显示", () => {
    const base = { id: 1, providerVendorId: 11, providerType: "claude" };
    expect(
      groupProvidersByChannel([
        base,
        { ...base, id: 2, groupTag: "glm" },
        { ...base, id: 3, anthropicThinkingBudgetPreference: "10240" },
        {
          ...base,
          id: 4,
          anthropicAdaptiveThinking: {
            modelMatchMode: "all" as const,
            models: [],
            effort: "high" as const,
          },
        },
      ])
    ).toHaveLength(4);
  });
  test("列表按渠道类型聚合密钥，不合并不同类型或没有供应商的渠道", () => {
    const keys = [
      { id: 1, providerVendorId: 11, providerType: "codex" },
      { id: 2, providerVendorId: 11, providerType: "codex" },
      { id: 3, providerVendorId: 11, providerType: "claude" },
      { id: 4, providerVendorId: null, providerType: "codex" },
      { id: 5, providerVendorId: 0, providerType: "codex" },
    ];
    const groups = groupProvidersByChannel(keys);
    expect(groups).toHaveLength(4);
    expect(groups[0].providers.map((key) => key.id)).toEqual([1, 2]);
    expect(groups[1].channelId).toBe("11:claude");
    expect(groups[2].channelId).toBe("provider:4");
    expect(groups[3].channelId).toBe("provider:5");
    expect(groupProvidersByChannel([])).toEqual([]);
  });
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
