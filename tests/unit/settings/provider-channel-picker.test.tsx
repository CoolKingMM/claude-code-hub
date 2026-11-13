/** @vitest-environment happy-dom */
import { NextIntlClientProvider } from "next-intl";
import { act, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import config from "../../../messages/en/settings/config.json";
import {
  ProviderChannelPicker,
  type SpecialHandlingProvider,
} from "@/app/[locale]/settings/special-handling/_components/provider-channel-picker";
import {
  SpecialHandlingForm,
  type SpecialHandlingFormLabels,
} from "@/app/[locale]/settings/special-handling/_components/special-handling-form";

const actions = vi.hoisted(() => ({
  saveSystemSettings: vi.fn(async (_data: unknown) => ({ ok: true })),
}));
vi.mock("@/lib/api-client/v1/actions/system-config", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const providers: SpecialHandlingProvider[] = [
  {
    id: 1,
    name: "same-name",
    providerType: "codex",
    groupTag: "codex,shared",
    priority: 20,
    groupPriorities: { shared: 0 },
  },
  {
    id: 2,
    name: "same-name",
    providerType: "claude",
    groupTag: null,
    priority: 0,
    groupPriorities: null,
  },
  {
    id: 3,
    name: "Other channel",
    providerType: "codex",
    groupTag: "other,shared",
    priority: 10,
    groupPriorities: null,
  },
];
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.clearAllMocks();
});

function Harness({
  items,
  codexOnly,
  disabled,
}: {
  items: SpecialHandlingProvider[];
  codexOnly?: boolean;
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState([3]);
  return (
    <ProviderChannelPicker
      providers={items}
      selectedIds={selected}
      onToggle={(id) =>
        setSelected((ids) =>
          ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]
        )
      }
      label="Channels"
      toggleLabel="Enable {name}"
      testId="test"
      codexOnly={codexOnly}
      disabled={disabled}
    />
  );
}

function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={{ settings: { config } }} timeZone="UTC">
        {node}
      </NextIntlClientProvider>
    )
  );
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });
}
function click(selector: string) {
  const node = document.querySelector(selector) as HTMLElement;
  expect(node).not.toBeNull();
  act(() => node.click());
}
function input(value: string) {
  const node = document.querySelector(
    'input[aria-label="Search channel name, ID, type, or group"]'
  ) as HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function group(value: string) {
  const node = document.querySelector(
    'select[aria-label="Filter channel group"]'
  ) as HTMLSelectElement;
  act(() => {
    node.value = value;
    node.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("特殊处理完整渠道选择", () => {
  test("默认显示全部分组，超过 50 个渠道也完整展示并可滚动", () => {
    const items = Array.from({ length: 120 }, (_, index) => ({
      ...providers[index % 3],
      id: index + 1,
      name: `channel-${index + 1}`,
    }));
    render(<Harness items={items} />);
    click('[data-testid="test-picker"]');
    expect(document.querySelectorAll('[data-testid^="test-provider-"]')).toHaveLength(120);
    expect(document.querySelector('[data-testid="test-provider-120"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="test-list"]')?.className).toContain(
      "overflow-y-auto"
    );
  });

  test("名称、ID、类型和分组均可搜索，搜索不到时提示", () => {
    render(<Harness items={providers} />);
    click('[data-testid="test-picker"]');
    input("Other channel");
    expect(document.querySelectorAll('[data-testid^="test-provider-"]')).toHaveLength(1);
    input("2");
    expect(document.querySelector('[data-testid="test-provider-2"]')).not.toBeNull();
    input("codex");
    expect(document.querySelectorAll('[data-testid^="test-provider-"]')).toHaveLength(2);
    input("shared");
    expect(document.querySelectorAll('[data-testid^="test-provider-"]')).toHaveLength(2);
    input("missing");
    expect(document.body.textContent).toContain("No matching channels");
  });

  test("跨分组筛选保留选择，空分组可查看且多分组优先级有效", () => {
    render(<Harness items={providers} />);
    click('[data-testid="test-picker"]');
    group("default");
    click('[aria-label="Enable same-name (#2)"]');
    expect(document.querySelector('[data-testid="test-picker"]')?.textContent).toContain(
      "Selected 2"
    );
    group("shared");
    const rows = document.querySelectorAll('[data-testid^="test-provider-"]');
    expect(rows[0].getAttribute("data-testid")).toBe("test-provider-1");
    expect(
      document
        .querySelector('[aria-label="Enable Other channel (#3)"]')
        ?.getAttribute("aria-checked")
    ).toBe("true");
    group("");
    expect(
      document.querySelector('[aria-label="Enable same-name (#2)"]')?.getAttribute("aria-checked")
    ).toBe("true");
    click('[aria-label="Enable same-name (#2)"]');
    expect(
      document.querySelector('[aria-label="Enable same-name (#1)"]')?.getAttribute("aria-checked")
    ).toBe("false");
  });

  test("历史过滤显示其他类型并标记不可启用，所有 Codex 分组都可选择", () => {
    render(<Harness items={providers} codexOnly />);
    click('[data-testid="test-picker"]');
    expect(document.querySelectorAll('[data-testid^="test-provider-"]')).toHaveLength(3);
    expect(
      (document.querySelector('[aria-label="Enable same-name (#2)"]') as HTMLButtonElement).disabled
    ).toBe(true);
    expect(document.body.textContent).toContain(
      "History filtering is available for Codex channels only"
    );
    click('[aria-label="Enable same-name (#1)"]');
    expect(document.querySelector('[data-testid="test-picker"]')?.textContent).toContain(
      "Selected 2"
    );
  });

  test("没有渠道时显示空列表，保存中禁止打开", () => {
    render(<Harness items={[]} />);
    click('[data-testid="test-picker"]');
    expect(document.body.textContent).toContain("No matching channels");
    expect(document.querySelector('[data-testid="test-picker"]')?.textContent).toContain("All 0");
  });

  test("保存中渠道选择禁用", () => {
    render(<Harness items={providers} disabled />);
    expect(
      (document.querySelector('[data-testid="test-picker"]') as HTMLButtonElement).disabled
    ).toBe(true);
  });

  test("表单两张卡片分别保存选择，筛选不丢失其他分组的配置", async () => {
    const labels: SpecialHandlingFormLabels = {
      fakeStreaming: config.form.fakeStreaming,
      codexHistoryFilter: config.form.codexHistoryFilter,
      providerOutputSafety: config.form.providerOutputSafety,
      saveSettings: "Save",
      saving: "Saving",
      saveFailed: "Failed",
      configUpdated: "Saved",
    };
    render(
      <SpecialHandlingForm
        initialSettings={{
          fakeStreamingProviderIds: [3],
          enableCodexHistoryFilter: true,
          codexHistoryFilterProviderIds: [1],
          enableProviderOutputSafetyFilter: true,
          providerOutputSafetyFilterRules: [],
        }}
        providers={providers}
        labels={labels}
      />
    );
    click('[data-testid="fake-streaming-picker"]');
    group("default");
    click('[data-testid="fake-streaming-provider-2"] button');
    click('[data-testid="fake-streaming-picker"]');
    click('[data-testid="codex-history-filter-picker"]');
    click('[data-testid="codex-history-filter-provider-3"] button');
    click('[data-testid="codex-history-filter-picker"]');
    await act(async () => {
      document
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(actions.saveSystemSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        fakeStreamingProviderIds: [3, 2],
        codexHistoryFilterProviderIds: [1, 3],
        enableCodexHistoryFilter: true,
      })
    );
  });
});
