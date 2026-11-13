/** @vitest-environment happy-dom */
import { NextIntlClientProvider } from "next-intl";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import dashboard from "../../../messages/en/dashboard.json";
import common from "../../../messages/en/common.json";
import { KeyList } from "@/app/[locale]/dashboard/_components/user/key-list";
import type { User, UserKeyDisplay } from "@/types/user";

const mocks = vi.hoisted(() => ({
  toggle: vi.fn(),
  refresh: vi.fn(),
  error: vi.fn(),
  limit: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/api-client/v1/actions/keys", () => ({
  toggleKeyEnabled: mocks.toggle,
  getUnmaskedKey: vi.fn(),
}));
vi.mock("@/lib/api-client/v1/actions/personal-keys", () => ({
  getPersonalKeyModelStats: vi.fn(async () => ({ ok: true, data: [] })),
}));
vi.mock("sonner", () => ({ toast: { error: mocks.error } }));
vi.mock("@/i18n/routing", () => ({
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/ui/relative-time", () => ({ RelativeTime: () => null }));
vi.mock("@/lib/utils/clipboard", () => ({
  isClipboardSupported: () => false,
  copyToClipboard: vi.fn(),
}));
vi.mock("@/app/[locale]/dashboard/_components/user/key-actions", () => ({
  KeyActions: () => null,
}));
vi.mock("@/app/[locale]/dashboard/_components/user/key-limit-usage", () => ({
  KeyLimitUsage: ({ keyId }: { keyId: number }) => {
    mocks.limit(keyId);
    return <div data-testid="limits" />;
  },
}));
vi.mock("@/components/ui/data-table", () => ({
  TableColumnTypes: {
    text: (
      key: string,
      _label: string,
      options: { render?: (value: unknown, record: unknown) => ReactNode }
    ) => ({ key, render: options.render }),
    number: (
      key: string,
      _label: string,
      options: { render?: (value: unknown, record: unknown) => ReactNode }
    ) => ({ key, render: options.render }),
    actions: (_label: string, render: (value: unknown, record: unknown) => ReactNode) => ({
      key: "actions",
      render,
    }),
  },
  DataTable: ({
    data,
    columns,
  }: {
    data: Record<string, unknown>[];
    columns: { key: string; render?: (value: unknown, record: unknown) => ReactNode }[];
  }) => (
    <div>
      {data.map((record) => (
        <div key={String(record.id)}>
          {columns.map((column) => (
            <div key={column.key}>{column.render?.(record[column.key], record)}</div>
          ))}
        </div>
      ))}
    </div>
  ),
}));
const key = {
  id: 10,
  name: "test",
  status: "enabled",
  maskedKey: "sk-***",
  canReveal: false,
  canCopy: false,
  todayUsage: 0,
  todayCallCount: 0,
  todayTokens: 0,
  modelStats: [],
  lastUsedAt: null,
  lastProviderName: null,
  limit5hUsd: null,
  limitDailyUsd: null,
  limitWeeklyUsd: null,
  limitMonthlyUsd: null,
  limitTotalUsd: 20,
  limitConcurrentSessions: 0,
} as UserKeyDisplay;
const cleanups: Array<() => void> = [];
beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
function render(role: "admin" | "user" = "admin", userId = -1) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={{ dashboard, common }}>
        <KeyList keys={[key]} currentUser={{ role, id: userId } as User} keyOwnerUserId={7} />
      </NextIntlClientProvider>
    )
  );
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return container;
}
async function toggle(container: HTMLElement) {
  await act(async () => {
    (container.querySelector('[role="switch"]') as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
describe("key controls and limits", () => {
  test("admin can disable a key and refresh its status", async () => {
    mocks.toggle.mockResolvedValue({ ok: true });
    const container = render();
    await toggle(container);
    expect(mocks.toggle).toHaveBeenCalledWith(10, false);
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  test.each([{ ok: false, error: "Denied" }, { ok: false }])(
    "failed toggles keep the existing state: %j",
    async (result) => {
      mocks.toggle.mockResolvedValue(result);
      const container = render();
      await toggle(container);
      expect(mocks.error).toHaveBeenCalledWith(result.error || common.error);
      expect(mocks.refresh).not.toHaveBeenCalled();
      expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
    }
  );
  test("transport failure unlocks the switch without changing status", async () => {
    mocks.toggle.mockRejectedValue(new Error("offline"));
    const container = render();
    await toggle(container);
    expect(mocks.error).toHaveBeenCalledWith(common.error);
    expect((container.querySelector('[role="switch"]') as HTMLButtonElement).disabled).toBe(false);
  });
  test("another owner cannot toggle keys", () => {
    const container = render("user", 99);
    expect((container.querySelector('[role="switch"]') as HTMLButtonElement).disabled).toBe(true);
  });
  test("total-only limits remain visible and load only when expanded", async () => {
    const container = render("user", 7);
    expect(mocks.limit).not.toHaveBeenCalled();
    const button = Array.from(container.querySelectorAll("button")).find((node) =>
      node.textContent?.includes(dashboard.keyList.detailsButton)
    );
    expect(button).toBeTruthy();
    await act(async () => {
      button?.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(mocks.limit).toHaveBeenCalledWith(10);
  });
});
