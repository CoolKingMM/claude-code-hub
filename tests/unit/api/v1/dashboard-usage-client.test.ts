import { expect, test, vi } from "vitest";
const get = vi.hoisted(() => vi.fn(async () => ({ summary: { cost: 2 } })));
vi.mock("@/lib/api-client/v1/client", () => ({ apiClient: { get } }));
import { getDashboardUsage } from "@/lib/api-client/v1/actions/dashboard-usage";
test("usage client encodes query fields and forwards cancellation", async () => {
  const controller = new AbortController();
  await expect(
    getDashboardUsage(
      {
        period: "custom",
        scope: "providerKey",
        channelId: "8:codex",
        startDate: "2026-01-01",
        endDate: "2026-01-02",
        page: 2,
      },
      controller.signal
    )
  ).resolves.toMatchObject({ summary: { cost: 2 } });
  const [path, options] = get.mock.calls[0] as unknown as [string, { signal: AbortSignal }];
  const url = new URL(path, "https://example.test");
  expect(url.pathname).toBe("/api/v1/dashboard/usage");
  expect(url.searchParams.get("channelId")).toBe("8:codex");
  expect(url.searchParams.get("page")).toBe("2");
  expect(options.signal).toBe(controller.signal);
});
