/** @vitest-environment happy-dom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import dashboard from "../../../messages/en/dashboard.json";
import {
  DashboardModelBreakdown,
  getModelColorStyle,
} from "@/app/[locale]/dashboard/_components/dashboard-model-breakdown";
import { formatTokenAmount } from "@/lib/utils/token";
import type { DashboardUsageData, DashboardUsageQuery } from "@/types/dashboard-usage";

const fetchUsage = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client/v1/actions/dashboard-usage", () => ({ getDashboardUsage: fetchUsage }));

const cleanups: Array<() => Promise<void>> = [];

function makeModelData(query: DashboardUsageQuery, count = 8): DashboardUsageData {
  const names = [
    "claude-opus-4-6",
    "gemini-2.5-pro",
    "gpt-5.4-codex",
    "deepseek-r1",
    "qwen3-coder",
    "custom-model-a",
    "custom-model-b",
    "custom-model-c",
  ].slice(0, count);
  const items = names.map((name, idx) => ({
    id: name,
    name,
    providerType: null,
    cost: (count - idx) * 10,
    requests: (count - idx) * 1000,
    inputTokens: (count - idx) * 2_000_000,
    outputTokens: (count - idx) * 500_000,
    cacheCreationTokens: (count - idx) * 10_000_000,
    cacheReadTokens: idx === 0 ? 1_500_000_000 : (count - idx) * 20_000_000,
  }));
  return {
    summary: {
      cost: items.reduce((sum, item) => sum + item.cost, 0),
      requests: items.reduce((sum, item) => sum + item.requests, 0),
      inputTokens: items.reduce((sum, item) => sum + item.inputTokens, 0),
      outputTokens: items.reduce((sum, item) => sum + item.outputTokens, 0),
      cacheCreationTokens: items.reduce((sum, item) => sum + item.cacheCreationTokens, 0),
      cacheReadTokens: items.reduce((sum, item) => sum + item.cacheReadTokens, 0),
    },
    items,
    totalCount: items.length,
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 20,
    startTime: "2026-01-01T00:00:00Z",
    endTime: "2026-01-02T00:00:00Z",
    timezone: "Asia/Shanghai",
    generatedAt: "2026-01-01T01:00:00Z",
  };
}

beforeEach(() => {
  fetchUsage.mockReset();
  fetchUsage.mockImplementation(async (q: DashboardUsageQuery) => makeModelData(q));
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function renderBreakdown() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={{ dashboard }}>
          <DashboardModelBreakdown currencyCode="USD" />
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
  cleanups.push(async () => {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
  });
  return container;
}

describe("formatTokenAmount", () => {
  test("formats K, M, B, T and edge values cleanly", () => {
    expect(formatTokenAmount(null)).toBe("-");
    expect(formatTokenAmount(undefined)).toBe("-");
    expect(formatTokenAmount(Number.NaN)).toBe("-");
    expect(formatTokenAmount(0)).toBe("0");
    expect(formatTokenAmount(999)).toBe("999");
    expect(formatTokenAmount(1_250)).toBe("1.25K");
    expect(formatTokenAmount(45_670_000)).toBe("45.67M");
    expect(formatTokenAmount(2_340_000_000)).toBe("2.34B");
    expect(formatTokenAmount(1_500_000_000_000)).toBe("1.5T");
    expect(formatTokenAmount(-1_500_000_000)).toBe("-1.5B");
  });
});

describe("DashboardModelBreakdown", () => {
  test("renders model consumption cards with compact M/B token formatting and expand toggle", async () => {
    const c = await renderBreakdown();
    expect(fetchUsage).toHaveBeenCalledWith(
      { period: "today", scope: "model", page: 1, pageSize: 20 },
      expect.anything()
    );
    expect(c.textContent).toContain("claude-opus-4-6");
    expect(c.textContent).toContain("gemini-2.5-pro");
    expect(c.textContent).toContain("1.5B");
    // Defaults to 6 visible models out of 8
    expect(c.querySelectorAll('[data-testid^="model-consumption-card-"]')).toHaveLength(6);

    const expandBtn = Array.from(c.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Show all 8 models")
    );
    expect(expandBtn).toBeTruthy();
    await act(async () => {
      expandBtn!.click();
    });
    expect(c.querySelectorAll('[data-testid^="model-consumption-card-"]')).toHaveLength(8);
  });

  test("switches period and handles empty state", async () => {
    const c = await renderBreakdown();
    fetchUsage.mockImplementation(async (q: DashboardUsageQuery) => makeModelData(q, 0));
    const sevenDaysBtn = Array.from(c.querySelectorAll("button")).find(
      (b) => b.textContent === dashboard.usage.periods["7days"]
    );
    expect(sevenDaysBtn).toBeTruthy();
    await act(async () => {
      sevenDaysBtn!.click();
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    expect(fetchUsage.mock.lastCall?.[0]).toMatchObject({ period: "7days", scope: "model" });
    expect(c.textContent).toContain(dashboard.usage.empty);
  });

  test("maps model families to distinct color palettes", () => {
    expect(getModelColorStyle("claude-sonnet-4-5", 0).dot).toContain("amber");
    expect(getModelColorStyle("gemini-4-neon", 0).dot).toContain("blue");
    expect(getModelColorStyle("gpt-5.4", 0).dot).toContain("emerald");
    expect(getModelColorStyle("deepseek-chat", 0).dot).toContain("sky");
    expect(getModelColorStyle("qwen-max", 0).dot).toContain("violet");
  });
});
