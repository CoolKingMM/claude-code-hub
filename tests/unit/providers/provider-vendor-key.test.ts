import { describe, expect, test } from "vitest";
import { scopeProviderVendorKey } from "@/lib/provider-vendor-key";
import { computeVendorKey } from "@/repository/provider-endpoints";
import { getThinkingEffortBadgeClassName } from "@/components/customs/thinking-effort-badge";
import { providerChannelName } from "@/repository/_shared/provider-channel-name";
import { CasingCache } from "drizzle-orm/casing";

describe("group-first vendor identity", () => {
  test("same URLs in different groups are separate, tag order is irrelevant", async () => {
    const claude = await computeVendorKey({
      providerUrl: "https://same.example/v1",
      groupTag: "claude",
    });
    const glm = await computeVendorKey({ providerUrl: "https://same.example/v1", groupTag: "glm" });
    expect(claude).not.toBe(glm);
    expect(
      await computeVendorKey({
        providerUrl: "https://same.example/v1",
        groupTag: " codex，vip,codex ",
      })
    ).toBe(
      await computeVendorKey({ providerUrl: "https://same.example/v1", groupTag: "vip,codex" })
    );
    expect(await computeVendorKey({ providerUrl: "https://[", groupTag: "claude" })).toBeNull();
  });
  test("empty and default groups stay equivalent and long keys fit the database", () => {
    expect(scopeProviderVendorKey("example:443", null)).toBe("example:443");
    expect(scopeProviderVendorKey("example:443", "default")).toBe("example:443");
    expect(scopeProviderVendorKey("x".repeat(255), "claude").length).toBeLessThanOrEqual(255);
    expect(scopeProviderVendorKey("other.example", "claude")).not.toBe(
      scopeProviderVendorKey("example", "claude")
    );
  });
  test("usage names resolve by vendor and protocol, keeping the credential record intact", () => {
    const query = providerChannelName.toQuery({
      casing: new CasingCache(),
      escapeName: (n) => `"${n}"`,
      escapeParam: (n) => `$${n + 1}`,
      escapeString: (n) => `'${n}'`,
    });
    expect(query.sql).toContain("channel_provider.provider_vendor_id");
    expect(query.sql).toContain("channel_provider.provider_type");
    expect(query.sql).toContain("channel_provider.deleted_at IS NULL");
    expect(query.sql).toContain("ORDER BY channel_provider.id LIMIT 1");
  });
  test.each(["high", "xhigh", "max"])("%s uses purple colors instead of red", (effort) => {
    expect(getThinkingEffortBadgeClassName(effort)).toMatch(/(?:violet|purple)/);
    expect(getThinkingEffortBadgeClassName(effort)).not.toMatch(/(?:red|rose)-/);
  });
});
