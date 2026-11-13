/** @vitest-environment happy-dom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ExistingProviderKeys } from "@/app/[locale]/settings/providers/_components/forms/provider-form/components/existing-provider-keys";
import type { ProviderDisplay } from "@/types/provider";
import enMessages from "../../../../messages/en";

const actions = vi.hoisted(() => ({ getProviders: vi.fn(), editProvider: vi.fn() }));
vi.mock("@/actions/providers", () => actions);
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
const keys = [
  {
    id: 163,
    name: "Agentrouter",
    maskedKey: "sk-***1",
    providerVendorId: 132,
    providerType: "codex",
    isEnabled: true,
  },
  {
    id: 164,
    name: "Agentrouter-2",
    maskedKey: "sk-***2",
    providerVendorId: 132,
    providerType: "codex",
    isEnabled: false,
  },
  {
    id: 165,
    name: "Agentrouter-3",
    maskedKey: "sk-***3",
    providerVendorId: 132,
    providerType: "codex",
    isEnabled: false,
  },
  {
    id: 166,
    name: "Agentrouter Claude",
    maskedKey: "sk-***4",
    providerVendorId: 132,
    providerType: "claude",
    isEnabled: true,
  },
] as ProviderDisplay[];
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.clearAllMocks();
});
function render(provider = keys[0], disabled = false) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={enMessages} timeZone="UTC">
          <ExistingProviderKeys provider={provider} disabled={disabled} />
        </NextIntlClientProvider>
      </QueryClientProvider>
    )
  );
  cleanups.push(() => {
    act(() => root.unmount());
    client.clear();
    container.remove();
  });
  return client;
}
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}
async function click(selector: string) {
  const button = document.querySelector(selector) as HTMLButtonElement;
  expect(button).not.toBeNull();
  await act(async () => {
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}
describe("编辑渠道中的已有密钥开关", () => {
  test("显示同渠道的全部掩码密钥，独立切换只更新对应 ID 并刷新缓存", async () => {
    actions.getProviders.mockResolvedValue(keys);
    actions.editProvider.mockResolvedValue({ ok: true });
    const client = render();
    await flush();
    expect(document.querySelectorAll('[data-testid^="existing-provider-key-"]')).toHaveLength(3);
    expect(document.body.textContent).toContain("sk-***2");
    expect(document.body.textContent).not.toContain("Agentrouter-2");
    await click('[aria-label="Enable key 2"]');
    expect(actions.editProvider).toHaveBeenCalledWith(164, { is_enabled: true });
    expect(actions.editProvider).toHaveBeenCalledTimes(1);
    expect(client.getQueryData<ProviderDisplay[]>(["providers"])?.[0].isEnabled).toBe(true);
  });
  test("切换失败显示错误且不修改其他密钥", async () => {
    actions.getProviders.mockResolvedValue(keys);
    actions.editProvider.mockResolvedValue({ ok: false, error: "save failed" });
    render();
    await flush();
    await click('[aria-label="Enable key 3"]');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("save failed");
    expect(
      document.querySelector('[aria-label="Enable key 3"]')?.getAttribute("aria-checked")
    ).toBe("false");
  });
  test("加载失败不允许使用未确认的密钥状态操作", async () => {
    actions.getProviders.mockRejectedValue(new Error("load failed"));
    render();
    await flush();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Failed to load");
    expect((document.querySelector('[role="switch"]') as HTMLButtonElement).disabled).toBe(true);
  });
  test("未知供应商只显示自己，表单保存中禁用开关", async () => {
    const provider = { ...keys[0], providerVendorId: null };
    actions.getProviders.mockResolvedValue([provider, { ...provider, id: 170 }]);
    render(provider, true);
    await flush();
    expect(document.querySelectorAll('[data-testid^="existing-provider-key-"]')).toHaveLength(1);
    expect((document.querySelector('[role="switch"]') as HTMLButtonElement).disabled).toBe(true);
  });
  test("保存开关时阻止其他开关并发，异常显示错误", async () => {
    actions.getProviders.mockResolvedValue(keys);
    let reject: (cause: Error) => void = () => {};
    actions.editProvider.mockImplementation(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        })
    );
    render();
    await flush();
    await click('[aria-label="Enable key 2"]');
    expect(
      Array.from(document.querySelectorAll('[role="switch"]')).every(
        (button) => (button as HTMLButtonElement).disabled
      )
    ).toBe(true);
    await act(async () => {
      reject(new Error("network failed"));
    });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("network failed");
  });
});
