import { describe, expect, test } from "vitest";
import {
  buildProviderKeyGroupIds,
  groupProviderKeyConfigurations,
  matchesProviderRequestFilter,
  type ProviderRequestFilterSummary,
} from "@/lib/provider-key-groups";

const base = {
  id: 3,
  providerVendorId: 112,
  providerType: "claude" as const,
  groupTag: "claude",
  key: "same-credential",
};

describe("同一密钥的独立配置", () => {
  test("通用与 Haiku 配置共享标识，真实密钥不同的记录保持独立", () => {
    const ids = buildProviderKeyGroupIds([
      { ...base, id: 107 },
      { ...base, id: 108, key: "different-credential" },
      base,
    ]);
    expect(Array.from(ids.entries())).toEqual([
      [3, 3],
      [107, 3],
      [108, 108],
    ]);
    expect(JSON.stringify(Array.from(ids))).not.toContain(base.key);
    expect(
      groupProviderKeyConfigurations([
        { ...base, id: 107, keyGroupId: 3 },
        { ...base, id: 108, keyGroupId: 108 },
        { ...base, keyGroupId: 3 },
      ]).map((group) => group.map((configuration) => configuration.id))
    ).toEqual([[3, 107], [108]]);
  });

  test("分组、接口类型、供应商不同，即使凭证相同也保持独立", () => {
    const rows = [
      base,
      { ...base, id: 4, groupTag: "glm" },
      { ...base, id: 5, providerType: "codex" as const },
      { ...base, id: 6, providerVendorId: 113 },
      { ...base, id: 7, providerVendorId: null },
      { ...base, id: 8, providerVendorId: null },
    ];
    const ids = buildProviderKeyGroupIds(rows);
    expect(new Set(ids.values()).size).toBe(rows.length);
    expect(
      groupProviderKeyConfigurations(rows.map((row) => ({ ...row, keyGroupId: 3 })))
    ).toHaveLength(rows.length);
  });

  test("标签顺序与空默认组等价；空凭证和缺失标识不按掩码合并", () => {
    expect(
      buildProviderKeyGroupIds([
        { ...base, groupTag: "claude,vip" },
        { ...base, id: 4, groupTag: "vip,claude" },
      ]).get(4)
    ).toBe(3);
    expect(
      buildProviderKeyGroupIds([
        { ...base, groupTag: null },
        { ...base, id: 4, groupTag: "default" },
      ]).get(4)
    ).toBe(3);
    expect(
      new Set(
        buildProviderKeyGroupIds([
          { ...base, key: "" },
          { ...base, id: 4, key: "" },
        ]).values()
      ).size
    ).toBe(2);
    expect(groupProviderKeyConfigurations([base, { ...base, id: 4 }])).toHaveLength(2);
  });

  test("过滤说明按照实际 Provider ID、分组和全局绑定匹配，禁用状态留给界面展示", () => {
    const filter: ProviderRequestFilterSummary = {
      id: 6,
      name: "haiku_1m_thinking",
      target: "anthropic-beta",
      isEnabled: true,
      bindingType: "providers",
      providerIds: [107],
      groupTags: null,
    };
    expect(matchesProviderRequestFilter(filter, base)).toBe(false);
    expect(matchesProviderRequestFilter(filter, { ...base, id: 107 })).toBe(true);
    expect(matchesProviderRequestFilter({ ...filter, providerIds: null }, base)).toBe(false);
    expect(
      matchesProviderRequestFilter({ ...filter, bindingType: "global", isEnabled: false }, base)
    ).toBe(true);
    expect(
      matchesProviderRequestFilter(
        { ...filter, bindingType: "groups", groupTags: ["claude"] },
        base
      )
    ).toBe(true);
    expect(
      matchesProviderRequestFilter({ ...filter, bindingType: "groups", groupTags: ["glm"] }, base)
    ).toBe(false);
    expect(
      matchesProviderRequestFilter({ ...filter, bindingType: "groups", groupTags: null }, base)
    ).toBe(false);
    expect(
      matchesProviderRequestFilter(
        { ...filter, bindingType: "groups", groupTags: ["default"] },
        { ...base, groupTag: null }
      )
    ).toBe(true);
    expect(matchesProviderRequestFilter({ ...filter, bindingType: "unknown" }, base)).toBe(false);
  });
});
