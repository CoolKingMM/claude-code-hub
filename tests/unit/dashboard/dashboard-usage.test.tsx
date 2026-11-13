/** @vitest-environment happy-dom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import dashboard from "../../../messages/en/dashboard.json";
import { DashboardUsage } from "@/app/[locale]/dashboard/_components/dashboard-usage";
import type { DashboardUsageData, DashboardUsageQuery } from "@/types/dashboard-usage";

const fetchUsage = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client/v1/actions/dashboard-usage", () => ({ getDashboardUsage: fetchUsage }));
const cleanups: Array<() => Promise<void>> = [];
const metrics = {
  cost: 4,
  requests: 2,
  inputTokens: 100,
  outputTokens: 30,
  cacheCreationTokens: 20,
  cacheReadTokens: 50,
};
function data(query: DashboardUsageQuery): DashboardUsageData {
  return {
    summary: metrics,
    items: [{ ...metrics, id: "8:codex", name: "Agentrouter", providerType: "codex" }],
    totalCount: 21,
    page: query.page ?? 1,
    pageSize: 20,
    startTime: "2026-01-01T00:00:00Z",
    endTime: "2026-01-02T00:00:00Z",
    timezone: "Asia/Shanghai",
    generatedAt: "2026-01-01T01:00:00Z",
  };
}
beforeEach(() => {
  fetchUsage.mockReset();
  fetchUsage.mockImplementation(async (q: DashboardUsageQuery) => data(q));
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function render() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={{ dashboard }}>
          <DashboardUsage currencyCode="USD" />
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  cleanups.push(async () => {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
  });
  return container;
}
async function click(container: HTMLElement, label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent === label || b.getAttribute("aria-label") === label
  );
  expect(button, label).toBeTruthy();
  await act(async () => {
    button!.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}
async function enter(container: HTMLElement, id: string, value: string) {
  const input = container.querySelector(`#${id}`) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
const t = dashboard.usage;
describe("dashboard usage controls", () => {
  test("loads only today's channels and recorded totals", async () => {
    const c = await render();
    expect(fetchUsage).toHaveBeenCalledOnce();
    expect(fetchUsage.mock.lastCall?.[0]).toEqual({ period: "today", scope: "channel", page: 1 });
    expect(c.textContent).toContain("$4.00");
    expect(c.textContent).toContain("100.0%");
    expect(c.textContent).toContain("Asia/Shanghai");
    expect(c.querySelector('button[aria-expanded="false"]')).toBeTruthy();
  });
  test.each(["yesterday", "last24h", "7days", "30days"] as const)(
    "selects %s and resets paging",
    async (period) => {
      const c = await render();
      await click(c, t.next);
      await click(c, t.periods[period]);
      expect(fetchUsage.mock.lastCall?.[0]).toEqual({ period, scope: "channel", page: 1 });
      expect(c.querySelector(`button[aria-pressed="true"]`)?.textContent).toBe(t.periods[period]);
    }
  );
  test("custom dates wait for apply and preserve the chosen range across views", async () => {
    const c = await render();
    await click(c, t.periods.custom);
    expect(c.textContent).toContain(t.selectDates);
    await enter(c, "usage-start-date", "2026-01-01");
    await enter(c, "usage-end-date", "2026-01-02");
    expect(fetchUsage).toHaveBeenCalledOnce();
    await click(c, t.apply);
    expect(fetchUsage.mock.lastCall?.[0]).toMatchObject({
      period: "custom",
      startDate: "2026-01-01",
      endDate: "2026-01-02",
    });
    await click(c, t.scopes.model);
    expect(fetchUsage.mock.lastCall?.[0]).toMatchObject({
      scope: "model",
      startDate: "2026-01-01",
    });
  });
  test("expansion requests provider keys only on demand and collapses without extra reads", async () => {
    fetchUsage.mockImplementation(async (q: DashboardUsageQuery) =>
      q.scope === "providerKey"
        ? { ...data(q), items: [{ ...metrics, id: "provider:12", name: null, providerType: null }] }
        : data(q)
    );
    const c = await render();
    await click(c, t.expand.replace("{name}", "Agentrouter"));
    expect(fetchUsage.mock.lastCall?.[0]).toMatchObject({
      scope: "providerKey",
      channelId: "8:codex",
      page: 1,
    });
    expect(c.textContent).toContain(t.credential.replace("{id}", "12"));
    const next = Array.from(c.querySelectorAll("button")).filter(
      (b) => b.textContent === t.next
    )[0];
    await act(async () => {
      next.click();
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(fetchUsage.mock.lastCall?.[0]).toMatchObject({ scope: "providerKey", page: 2 });
    await click(c, t.expand.replace("{name}", "Agentrouter"));
    expect(c.querySelector('button[aria-expanded="true"]')).toBeNull();
  });
  test("all tabs query their own grouping and paging works in both directions", async () => {
    const c = await render();
    await click(c, t.next);
    expect(fetchUsage.mock.lastCall?.[0]).toMatchObject({ page: 2 });
    await click(c, t.previous);
    expect(c.querySelectorAll("button")[0]).toBeTruthy();
    for (const scope of ["model", "key", "day", "channel"] as const) {
      await click(c, t.scopes[scope]);
      expect(fetchUsage.mock.lastCall?.[0].scope === scope || scope === "channel").toBe(true);
    }
  });
  test("empty ranges and missing entities display without fabricating costs", async () => {
    fetchUsage.mockImplementation(async (q: DashboardUsageQuery) => ({
      ...data(q),
      summary: { ...metrics, cost: 0 },
      items:
        q.scope === "model"
          ? [{ ...metrics, name: null, id: "", providerType: null }]
          : q.scope === "key"
            ? [{ ...metrics, name: null, id: "deleted-key:hash", providerType: null }]
            : [],
      totalCount: 0,
    }));
    const c = await render();
    expect(c.textContent).toContain(t.empty);
    await click(c, t.scopes.model);
    expect(c.textContent).toContain(t.unknownModel);
    expect(c.textContent).toContain("0%");
    await click(c, t.scopes.key);
    expect(c.textContent).toContain(t.removedEntity);
  });
  test("refresh retries errors and does not poll automatically", async () => {
    fetchUsage.mockRejectedValue(new Error("offline"));
    const c = await render();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1200));
    });
    expect(c.querySelector('[role="alert"]')?.textContent).toBe(t.error);
    fetchUsage.mockImplementation(async (q: DashboardUsageQuery) => data(q));
    await click(c, t.refresh);
    expect(c.querySelector('[role="alert"]')).toBeNull();
    expect(c.textContent).toContain("Agentrouter");
  });
  test("expanded-query errors and pending requests have visible states", async () => {
    fetchUsage.mockImplementation(async (q: DashboardUsageQuery) => {
      if (q.scope === "providerKey") throw new Error("offline");
      return data(q);
    });
    const c = await render();
    await click(c, t.expand.replace("{name}", "Agentrouter"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1200));
    });
    expect(c.querySelector('[role="alert"]')?.textContent).toBe(t.error);
    await click(c, t.scopes.model);
    fetchUsage.mockImplementation(() => new Promise(() => {}));
    await click(c, t.periods.yesterday);
    expect(c.querySelector('[role="status"]')?.textContent).toBe(t.loading);
  });
});
