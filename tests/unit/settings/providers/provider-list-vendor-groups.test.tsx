/** @vitest-environment happy-dom */
import { NextIntlClientProvider } from "next-intl";
import { act, type ComponentProps, type ReactNode, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ProviderList } from "@/app/[locale]/settings/providers/_components/provider-list";
import type { ProviderDisplay, ProviderStatisticsMap } from "@/types/provider";
import type { User } from "@/types/user";
import enMessages from "../../../../messages/en";

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: [{ id: 132, displayName: "agentrouter" }] }),
}));
const renderKey = vi.hoisted(() => vi.fn());
vi.mock("@/app/[locale]/settings/providers/_components/provider-rich-list-item", () => ({
  ProviderRichListItem: (props: {
    provider: ProviderDisplay;
    displayName?: string;
    isMultiSelectMode: boolean;
    isSelected: boolean;
    isSelectionIndeterminate?: boolean;
    channelProviders?: ProviderDisplay[];
    onSelectChange?: (checked: boolean) => void;
    onEdit?: () => void;
  }) => {
    renderKey(props);
    return (
      <div data-testid={`key-${props.provider.id}`}>
        {props.displayName ?? props.provider.name}
        {props.isMultiSelectMode && (
          <button
            type="button"
            aria-label={`Select key ${props.provider.id}`}
            aria-pressed={props.isSelected}
            onClick={() => props.onSelectChange?.(!props.isSelected)}
          >
            select
          </button>
        )}
        <button type="button" onClick={props.onEdit}>
          edit
        </button>
      </div>
    );
  },
}));

const providers = [
  { id: 163, name: "Agentrouter", providerVendorId: 132, isEnabled: true, providerType: "codex" },
  {
    id: 164,
    name: "Agentrouter-2",
    providerVendorId: 132,
    isEnabled: false,
    providerType: "codex",
  },
  {
    id: 165,
    name: "Agentrouter-3",
    providerVendorId: 132,
    isEnabled: true,
    providerType: "codex",
  },
  {
    id: 10,
    name: "Other provider",
    providerVendorId: null,
    isEnabled: true,
    providerType: "codex",
  },
] as ProviderDisplay[];
const admin = { role: "admin" } as User;
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.clearAllMocks();
});

function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={enMessages} timeZone="UTC">
        {node}
      </NextIntlClientProvider>
    )
  );
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return (node: ReactNode) =>
    act(() =>
      root.render(
        <NextIntlClientProvider locale="en" messages={enMessages} timeZone="UTC">
          {node}
        </NextIntlClientProvider>
      )
    );
}
function click(selector: string) {
  const node = document.querySelector(selector) as HTMLElement;
  expect(node).not.toBeNull();
  act(() => node.click());
}
function list(props: Partial<ComponentProps<typeof ProviderList>> = {}) {
  return (
    <ProviderList providers={providers} healthStatus={{}} enableMultiProviderTypes {...props} />
  );
}

function SelectionHarness() {
  const [selected, setSelected] = useState(new Set([10]));
  return (
    <>
      <output data-testid="selected-ids">{[...selected].join(",")}</output>
      {list({
        providers: providers.slice(0, 3),
        allProviders: providers,
        isMultiSelectMode: true,
        selectedProviderIds: selected,
        onSelectProvider: (id, checked) =>
          setSelected((current) => {
            const next = new Set(current);
            if (checked) next.add(id);
            else next.delete(id);
            return next;
          }),
      })}
    </>
  );
}

describe("原列表样式的渠道密钥聚合", () => {
  test("claude 分组通用与 Haiku 分开显示，编辑、统计和行开关各自绑定对应配置", () => {
    const general = {
      ...providers[0],
      id: 3,
      name: "Anyrouter-github",
      providerType: "claude",
      groupTag: "claude",
      priority: 2,
      allowedModels: null,
    } as ProviderDisplay;
    const haiku = {
      ...general,
      id: 107,
      name: "Anyrouter-github-haiku",
      priority: 0,
      allowedModels: [{ matchType: "exact", pattern: "claude-haiku-4-5-20251001" }],
      anthropicThinkingBudgetPreference: "10240",
    } as ProviderDisplay;
    const secondHaiku = { ...haiku, id: 108, name: "Anyrouter-haiku" };
    const edit = vi.fn();
    const select = vi.fn();
    const statistics = {
      3: { todayCalls: 7, todayCost: "2", lastCallTime: null, lastCallModel: null },
      107: { todayCalls: 3, todayCost: "0.4", lastCallTime: null, lastCallModel: null },
      108: { todayCalls: 2, todayCost: "0.2", lastCallTime: null, lastCallModel: null },
    };
    const rerender = render(
      list({
        providers: [general, haiku, secondHaiku],
        onEditProvider: edit,
        isMultiSelectMode: true,
        onSelectProvider: select,
        statistics,
      })
    );
    expect(document.querySelectorAll('[data-testid^="key-"]')).toHaveLength(2);
    expect(document.body.textContent).toContain("Anyrouter-github-haiku");
    const haikuProps = renderKey.mock.calls.find(([props]) => props.provider.id === 107)?.[0];
    expect(haikuProps.channelProviders.map((key: ProviderDisplay) => key.id)).toEqual([107, 108]);
    expect(haikuProps.statistics.todayCalls).toBe(5);
    expect(
      renderKey.mock.calls.find(([props]) => props.provider.id === 3)?.[0].statistics.todayCalls
    ).toBe(7);
    click('[data-testid="key-107"] button:last-child');
    expect(edit).toHaveBeenLastCalledWith(haiku);
    click('[aria-label="Select key 107"]');
    expect(select.mock.calls).toEqual([
      [107, true],
      [108, true],
    ]);
    rerender(list({ providers: [secondHaiku], allProviders: [general, haiku, secondHaiku] }));
    expect(document.querySelector('[data-testid="key-107"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="key-3"]')).toBeNull();
  });
  test("三个密钥仍复用一个原列表行，编辑绑定原渠道，列表不包含折叠摘要", () => {
    const edit = vi.fn();
    render(list({ currentUser: admin, onEditProvider: edit }));
    expect(document.querySelectorAll('[data-testid^="key-"]')).toHaveLength(2);
    expect(document.querySelector('[data-testid="key-163"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="key-164"]')).toBeNull();
    expect(document.querySelector('[data-testid="key-165"]')).toBeNull();
    expect(document.querySelector("[aria-expanded]")).toBeNull();
    expect(document.body.textContent).not.toContain("Agentrouter-2");
    const props = renderKey.mock.calls.find(([props]) => props.provider.id === 163)?.[0];
    expect(props.channelProviders.map((key: ProviderDisplay) => key.id)).toEqual([163, 164, 165]);
    expect(props.vendor.id).toBe(132);
    click('[data-testid="key-163"] button');
    expect(edit).toHaveBeenLastCalledWith(providers[0]);
  });

  test("筛选第二把密钥仍显示原渠道，包含全部密钥用于管理", () => {
    render(list({ providers: [providers[1]], allProviders: providers }));
    expect(document.querySelector('[data-testid="key-163"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain("Agentrouter-2");
    expect(renderKey.mock.calls[0][0].channelProviders).toHaveLength(3);
  });

  test("刷新或排序不改变渠道主记录，汇总统计且保留原列表运行配置", () => {
    const props = {
      providers: [providers[2], providers[0], providers[1]],
      allProviders: providers,
      statistics: {
        164: { todayCalls: 2, todayCost: "1.50", lastCallTime: null, lastCallModel: null },
      } as ProviderStatisticsMap,
      healthStatus: { 163: { circuitState: "open" as const } } as never,
      endpointCircuitInfo: { 163: [{ endpointId: 7, circuitState: "open" as const }] } as never,
      statisticsLoading: true,
      activeGroupFilter: "codex",
      allGroups: ["codex"],
      userGroups: ["codex"],
      isAdmin: true,
    };
    const rerender = render(list(props));
    rerender(list({ ...props, providers: [providers[1], providers[2], providers[0]] }));
    const last = renderKey.mock.calls.at(-1)?.[0];
    expect(last.provider.id).toBe(163);
    expect(last.statistics.todayCalls).toBe(2);
    expect(last.statistics.todayCost).toBe("1.5");
    expect(last.healthStatus.circuitState).toBe("open");
    expect(last.endpointCircuitInfo[0].endpointId).toBe(7);
    expect(last.activeGroupFilter).toBe("codex");
  });

  test("一个渠道复选框选择全部可见密钥，筛选外选择保留", () => {
    render(<SelectionHarness />);
    click('[aria-label="Select key 163"]');
    expect(document.querySelector('[data-testid="selected-ids"]')?.textContent).toBe(
      "10,163,164,165"
    );
    click('[aria-label="Select key 163"]');
    expect(document.querySelector('[data-testid="selected-ids"]')?.textContent).toBe("10");
  });

  test("不同渠道类型与未知供应商分别显示，单密钥和空列表沿用原样", () => {
    const rerender = render(
      list({
        providers: [
          providers[0],
          { ...providers[1], providerType: "claude" },
          providers[3],
          { ...providers[3], id: 11 },
        ],
      })
    );
    expect(document.querySelectorAll('[data-testid^="key-"]')).toHaveLength(4);
    rerender(list({ providers: [] }));
    expect(document.querySelectorAll('[data-testid^="key-"]')).toHaveLength(0);
    expect(document.body.textContent).toContain(enMessages.settings.providers.noProviders);
  });

  test("部分选中与筛选后的选择只涉及可见密钥", () => {
    const select = vi.fn();
    render(
      list({
        providers: [providers[1], providers[2]],
        allProviders: providers,
        isMultiSelectMode: true,
        selectedProviderIds: new Set([164]),
        onSelectProvider: select,
      })
    );
    expect(renderKey.mock.calls[0][0].isSelectionIndeterminate).toBe(true);
    click('[aria-label="Select key 163"]');
    expect(select.mock.calls).toEqual([
      [164, true],
      [165, true],
    ]);
  });
});
