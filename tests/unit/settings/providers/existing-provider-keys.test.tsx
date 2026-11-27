/** @vitest-environment happy-dom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ExistingProviderKeys } from "@/app/[locale]/settings/providers/_components/forms/provider-form/components/existing-provider-keys";
import { TestingSection } from "@/app/[locale]/settings/providers/_components/forms/provider-form/sections/testing-section";
import type { ProviderDisplay } from "@/types/provider";
import enMessages from "../../../../messages/en";

vi.mock("framer-motion", () => ({
  motion: { div: ({ children }: { children?: ReactNode }) => <div>{children}</div> },
}));

const actions = vi.hoisted(() => ({
  getProviders: vi.fn(),
  editProvider: vi.fn(),
  batchUpdateProviders: vi.fn(),
}));
const testForm = vi.hoisted(() => ({
  state: {
    basic: { url: "https://example.com", key: "" },
    routing: { providerType: "codex", allowedModels: [], customHeadersText: "" },
    network: { proxyUrl: "http://proxy.example", proxyFallbackToDirect: true },
    mcp: { mcpPassthroughType: "none", mcpPassthroughUrl: "" },
    ui: { isPending: false },
  },
}));
vi.mock(
  "@/app/[locale]/settings/providers/_components/forms/provider-form/provider-form-context",
  () => ({
    useProviderForm: () => ({
      mode: "edit",
      provider: keys[0],
      state: testForm.state,
      dispatch: vi.fn(),
    }),
  })
);
vi.mock("@/app/[locale]/settings/providers/_components/forms/api-test-button", () => ({
  ApiTestButton: (props: { providerId?: number; apiKey: string; proxyUrl: string }) => (
    <div data-testid="selected-test-key" data-id={props.providerId} data-proxy={props.proxyUrl} />
  ),
}));
vi.mock("@/lib/api-client/v1/actions/providers", () => actions);
vi.mock("@/actions/providers", () => actions);
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
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
function render(provider = keys[0], disabled = false, testing = false) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={enMessages} timeZone="UTC">
          {testing ? (
            <TestingSection />
          ) : (
            <ExistingProviderKeys provider={provider} disabled={disabled} />
          )}
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
  test("测试页可选择同渠道的具体密钥，沿用表单网络设置", async () => {
    actions.getProviders.mockResolvedValue(keys);
    render(keys[0], false, true);
    await flush();
    const selected = () => document.querySelector('[data-testid="selected-test-key"]');
    expect(selected()?.getAttribute("data-id")).toBe("163");
    expect(selected()?.getAttribute("data-proxy")).toBe("http://proxy.example");
    await click('button[role="combobox"]');
    const option = Array.from(document.querySelectorAll('[role="option"]')).find((item) =>
      item.textContent?.includes("Agentrouter-2")
    );
    expect(option).not.toBeUndefined();
    expect(document.body.textContent).not.toContain("Agentrouter Claude");
    await act(async () => {
      option?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(selected()?.getAttribute("data-id")).toBe("164");
    expect(actions.editProvider).not.toHaveBeenCalled();
  });

  test("显示同渠道的全部掩码密钥，每行右侧仅保留一个开关按钮且无下拉菜单", async () => {
    actions.getProviders.mockResolvedValue(keys);
    actions.editProvider.mockResolvedValue({ ok: true });
    const client = render();
    await flush();
    expect(document.querySelectorAll("details")).toHaveLength(0);
    expect(document.querySelectorAll('[data-testid^="existing-provider-key-"]')).toHaveLength(3);
    const secondCard = document.querySelector('[data-testid="existing-provider-key-164"]');
    expect(secondCard?.querySelectorAll("button")).toHaveLength(1);
    expect(secondCard?.querySelector('[role="switch"]')).not.toBeNull();
    expect(document.body.textContent).toContain("sk-***2");
    expect(document.body.textContent).not.toContain("Agentrouter-2");
    await click('[aria-label="Enable key 2"]');
    expect(actions.editProvider).toHaveBeenCalledWith(164, { is_enabled: true });
    expect(actions.editProvider).toHaveBeenCalledTimes(1);
    expect(client.getQueryData<ProviderDisplay[]>(["providers"])?.[0].isEnabled).toBe(true);
  });

  test("多协议逻辑渠道不渲染下拉菜单，每把密钥右侧仅一个开关并一键同步全部协议", async () => {
    const grouped = [
      {
        id: 201,
        name: "AnyRouter",
        maskedKey: "sk-***a",
        providerVendorId: 50,
        providerType: "claude",
        protocolGroupId: "grp-multi",
        keyGroupId: 201,
        isEnabled: false,
      },
      {
        id: 202,
        name: "AnyRouter",
        maskedKey: "sk-***a",
        providerVendorId: 50,
        providerType: "codex",
        protocolGroupId: "grp-multi",
        keyGroupId: 201,
        isEnabled: true,
      },
      {
        id: 203,
        name: "AnyRouter",
        maskedKey: "sk-***a",
        providerVendorId: 50,
        providerType: "gemini",
        protocolGroupId: "grp-multi",
        keyGroupId: 201,
        isEnabled: false,
      },
      {
        id: 204,
        name: "AnyRouter-2",
        maskedKey: "sk-***b",
        providerVendorId: 50,
        providerType: "claude",
        protocolGroupId: "grp-multi",
        keyGroupId: 204,
        isEnabled: false,
      },
      {
        id: 205,
        name: "AnyRouter-2",
        maskedKey: "sk-***b",
        providerVendorId: 50,
        providerType: "codex",
        protocolGroupId: "grp-multi",
        keyGroupId: 204,
        isEnabled: false,
      },
    ] as ProviderDisplay[];
    const groupedAfterDisable = grouped.map((item) =>
      [201, 202, 203].includes(item.id) ? { ...item, isEnabled: false } : item
    );
    actions.getProviders.mockResolvedValueOnce(grouped).mockResolvedValue(groupedAfterDisable);
    actions.batchUpdateProviders.mockResolvedValue({ ok: true });
    const client = render(grouped[0]);
    await flush();

    // 不再使用 details 下拉菜单，且每把密钥卡片右侧仅有一个开关按钮
    expect(document.querySelectorAll("details")).toHaveLength(0);
    const cards = document.querySelectorAll('[data-testid^="existing-provider-key-"]');
    expect(cards).toHaveLength(2);
    expect(cards[0].querySelectorAll("button")).toHaveLength(1);
    expect(cards[1].querySelectorAll("button")).toHaveLength(1);
    expect(document.body.textContent).toContain("sk-***a");
    expect(document.body.textContent).toContain("sk-***b");

    // 密钥 1 在 codex 下处于启用状态，总开关应显示为已启用；点击关闭会同步关闭该密钥的全部协议行
    const firstSwitch = document.querySelector('[aria-label="Enable key 1"]');
    expect(firstSwitch?.getAttribute("aria-checked")).toBe("true");
    await click('[aria-label="Enable key 1"]');
    expect(actions.batchUpdateProviders).toHaveBeenCalledWith({
      providerIds: [201, 202, 203],
      updates: { is_enabled: false },
    });
    expect(actions.editProvider).not.toHaveBeenCalled();

    const updated = client.getQueryData<ProviderDisplay[]>(["providers"]) ?? [];
    expect(
      updated.filter((item) => [201, 202, 203].includes(item.id)).every((item) => !item.isEnabled)
    ).toBe(true);
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
