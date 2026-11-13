/** @vitest-environment happy-dom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import dashboard from "../../../messages/en/dashboard.json";
import common from "../../../messages/en/common.json";
import customs from "../../../messages/en/customs.json";
import { ApiKeysPageClient, toKeyOwner } from "@/app/[locale]/dashboard/users/api-keys-page-client";
import { DashboardOverview } from "@/app/[locale]/dashboard/_components/dashboard-overview";
import type { UserDisplay } from "@/types/user";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  createUser: vi.fn(),
  overview: vi.fn(),
  toast: vi.fn(),
  keyList: vi.fn(),
  addDialog: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("sonner", () => ({ toast: { error: mocks.toast } }));
vi.mock("@/lib/api-client/v1/actions/users", () => ({ createUserOnly: mocks.createUser }));
vi.mock("@/lib/api-client/v1/actions/overview", () => ({ getOverviewData: mocks.overview }));
vi.mock("@/app/[locale]/dashboard/_components/user/key-list", () => ({
  KeyList: (props: unknown) => {
    mocks.keyList(props);
    return <div data-testid="keys" />;
  },
}));
vi.mock("@/app/[locale]/dashboard/_components/user/add-key-dialog", () => ({
  AddKeyDialog: (props: { open: boolean; userId: number }) => {
    mocks.addDialog(props);
    return props.open ? <div data-testid="add" data-owner={props.userId} /> : null;
  },
}));
vi.mock("@/app/[locale]/dashboard/_components/bento/metric-card", () => ({
  BentoMetricCard: ({ title, value }: { title: string; value: string | number }) => (
    <div>
      {title}: {value}
    </div>
  ),
}));

const owner: UserDisplay = {
  id: 7,
  name: "Personal",
  role: "user",
  isEnabled: true,
  rpm: null,
  dailyQuota: 20,
  limit5hUsd: 5,
  limit5hResetMode: "fixed",
  limitWeeklyUsd: 40,
  limitMonthlyUsd: 100,
  limitTotalUsd: 150,
  limitConcurrentSessions: 2,
  dailyResetMode: "rolling",
  dailyResetTime: "01:00",
  allowedClients: ["codex"],
  blockedClients: ["legacy"],
  allowedModels: ["model"],
  providerGroup: "private",
  keys: [],
};
const admin = { ...toKeyOwner(owner), id: -1, role: "admin" as const };
const cleanups: Array<() => void> = [];
beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function render(component: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={{ dashboard, common, customs }}>
          {component}
        </NextIntlClientProvider>
      </QueryClientProvider>
    )
  );
  cleanups.push(() => {
    act(() => root.unmount());
    client.clear();
    container.remove();
  });
  return container;
}
async function click(container: HTMLElement, label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (node) => node.textContent?.includes(label) || node.getAttribute("aria-label") === label
  );
  expect(button).toBeTruthy();
  await act(async () => {
    button?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

describe("personal API keys", () => {
  test("preserves all owner constraints and supplies defaults without changing identifiers", () => {
    expect(toKeyOwner(owner)).toMatchObject({
      id: 7,
      limitTotalUsd: 150,
      limit5hUsd: 5,
      allowedClients: ["codex"],
      blockedClients: ["legacy"],
      allowedModels: ["model"],
      dailyResetMode: "rolling",
      dailyResetTime: "01:00",
    });
    const fallback = toKeyOwner({
      id: 8,
      name: "old",
      role: "user",
      keys: [],
      isEnabled: false,
      rpm: null,
      dailyQuota: null,
    });
    expect(fallback).toMatchObject({
      id: 8,
      providerGroup: "default",
      dailyResetTime: "00:00",
      limit5hResetMode: "rolling",
      dailyResetMode: "fixed",
      description: "",
    });
    expect(fallback.limit5hUsd).toBeUndefined();
    expect(fallback.limitWeeklyUsd).toBeUndefined();
    expect(fallback.limitMonthlyUsd).toBeUndefined();
    expect(fallback.limitConcurrentSessions).toBeUndefined();
  });
  test("admin token uses the existing owner rather than sentinel -1 and opens the full limit form", async () => {
    const container = render(
      <ApiKeysPageClient owners={[owner]} currentUser={admin} currencyCode="USD" />
    );
    expect(mocks.keyList.mock.lastCall?.[0]).toMatchObject({
      keyOwnerUserId: 7,
      keyOwnerUser: { limitTotalUsd: 150 },
    });
    await click(container, dashboard.addKeyForm.title);
    expect(container.querySelector('[data-testid="add"]')?.getAttribute("data-owner")).toBe("7");
    expect(mocks.createUser).not.toHaveBeenCalled();
    await click(container, "Refresh");
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  test("a regular session only sees its own keys", () => {
    render(
      <ApiKeysPageClient
        owners={[{ ...owner, id: 99 }, owner]}
        currentUser={toKeyOwner(owner)}
        currencyCode="USD"
      />
    );
    expect(mocks.keyList.mock.lastCall?.[0]).toMatchObject({ keyOwnerUserId: 7 });
    expect(mocks.addDialog.mock.lastCall?.[0]).toMatchObject({ userId: 7, isAdmin: false });
  });
  test("missing regular owner cannot initialize or create another user's keys", () => {
    const container = render(
      <ApiKeysPageClient
        owners={[{ ...owner, id: 99 }]}
        currentUser={toKeyOwner(owner)}
        currencyCode="USD"
      />
    );
    expect(mocks.keyList.mock.lastCall?.[0]).toMatchObject({ keyOwnerUserId: 0, keys: [] });
    expect(
      Array.from(container.querySelectorAll("button")).find((node) =>
        node.textContent?.includes(dashboard.apiKeys.initialize)
      )?.disabled
    ).toBe(true);
    expect(mocks.addDialog).not.toHaveBeenCalled();
  });
  test("empty install initializes an owner only after an explicit click", async () => {
    mocks.createUser.mockResolvedValue({ ok: true, data: {} });
    const container = render(
      <ApiKeysPageClient owners={[]} currentUser={admin} currencyCode="USD" />
    );
    expect(mocks.createUser).not.toHaveBeenCalled();
    await click(container, dashboard.apiKeys.initialize);
    expect(mocks.createUser).toHaveBeenCalledWith({
      name: dashboard.apiKeys.defaultOwner,
      providerGroup: "default",
    });
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  test.each([{ ok: false, error: "Denied" }, { ok: false }])(
    "initialization reports API failure without refreshing: %j",
    async (result) => {
      mocks.createUser.mockResolvedValue(result);
      const container = render(
        <ApiKeysPageClient owners={[]} currentUser={admin} currencyCode="USD" />
      );
      await click(container, dashboard.apiKeys.initialize);
      expect(mocks.toast).toHaveBeenCalledWith(result.error || common.error);
      expect(mocks.refresh).not.toHaveBeenCalled();
    }
  );
  test("initialization reports transport failure", async () => {
    mocks.createUser.mockRejectedValue(new Error("offline"));
    const container = render(
      <ApiKeysPageClient owners={[]} currentUser={admin} currencyCode="USD" />
    );
    await click(container, dashboard.apiKeys.initialize);
    expect(mocks.toast).toHaveBeenCalledWith(common.error);
  });
  test("existing additional owners remain accessible", () => {
    const container = render(
      <ApiKeysPageClient
        owners={[owner, { ...owner, id: 8, name: "Old" }]}
        currentUser={admin}
        currencyCode="USD"
      />
    );
    expect(container.querySelector('[aria-label="Key owner"]')).toBeTruthy();
  });
});

describe("lightweight overview", () => {
  const overview = {
    concurrentSessions: 1,
    todayRequests: 12,
    todayCost: 1.2,
    avgResponseTime: 250,
    todayErrorRate: 0,
    yesterdaySamePeriodRequests: 0,
    yesterdaySamePeriodCost: 0,
    yesterdaySamePeriodAvgResponseTime: 0,
    recentMinuteRequests: 3,
  };
  test("shows spending and usage with direct links and refreshes on demand", async () => {
    mocks.overview.mockResolvedValue({ ok: true, data: { ...overview, todayRequests: 13 } });
    const container = render(
      <DashboardOverview isAdmin currencyCode="USD" initialOverview={overview} />
    );
    expect(container.textContent).toContain("12");
    expect(container.textContent).toContain("$1.20");
    expect(container.querySelector('a[href="/dashboard/providers"]')).toBeTruthy();
    expect(container.querySelector('a[href="/dashboard/users"]')).toBeTruthy();
    expect(mocks.overview).not.toHaveBeenCalled();
    await click(container, "Refresh");
    expect(mocks.overview).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("13");
  });
  test("regular sessions hide provider management and load their authorized overview", async () => {
    mocks.overview.mockResolvedValue({ ok: true, data: overview });
    let container!: HTMLDivElement;
    await act(async () => {
      container = render(<DashboardOverview isAdmin={false} currencyCode="USD" />);
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    expect(container.querySelector('a[href="/dashboard/providers"]')).toBeNull();
    expect(mocks.overview).toHaveBeenCalledOnce();
  });
  test("fetch failures show an error without inventing zero usage", async () => {
    mocks.overview.mockResolvedValue({ ok: false });
    let container!: HTMLDivElement;
    await act(async () => {
      container = render(<DashboardOverview isAdmin currencyCode="USD" />);
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      dashboard.apiKeys.fetchFailed
    );
    expect(container.textContent).toContain("-");
  });
});
