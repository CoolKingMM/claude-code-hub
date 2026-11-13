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
    providerType: "claude",
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

describe("列表中的供应商密钥聚合", () => {
  test("同一供应商只有一个顶层条目，展开后以密钥编号显示，原名称和 ID 不改写", () => {
    const edit = vi.fn();
    render(list({ currentUser: admin, onEditProvider: edit }));
    expect(document.querySelectorAll('[data-testid^="provider-list-vendor-"]')).toHaveLength(1);
    expect(document.body.textContent).toContain("Agentrouter");
    expect(document.body.textContent).not.toContain("Agentrouter-2");
    expect(document.querySelector('[data-testid="key-10"]')).not.toBeNull();
    click('[aria-label="Expand keys for Agentrouter"]');
    expect(document.querySelector('[data-testid="key-164"]')?.textContent).toContain("Key 2");
    const props = renderKey.mock.calls.find(([props]) => props.provider.id === 164)?.[0];
    expect(props.provider.name).toBe("Agentrouter-2");
    expect(props.vendor.id).toBe(132);
    click('[data-testid="key-164"] button');
    expect(edit).toHaveBeenLastCalledWith(providers[1]);
    click('[aria-label="Collapse keys for Agentrouter"]');
    expect(document.querySelector('[data-testid="key-164"]')).toBeNull();
    click('[aria-label="Edit Provider"]');
    expect(edit).toHaveBeenLastCalledWith(providers[0]);
  });

  test("搜索或状态筛选只剩第二把密钥时，保留供应商名称和稳定的密钥编号", () => {
    render(list({ providers: [providers[1]], allProviders: providers }));
    expect(document.body.textContent).toContain("Agentrouter");
    expect(document.body.textContent).toContain("Showing 1 / 3 keys");
    expect(document.body.textContent).not.toContain("Agentrouter-2");
    click('[aria-label="Expand keys for Agentrouter"]');
    expect(document.querySelector('[data-testid="key-164"]')?.textContent).toContain("Key 2");
    expect(document.querySelector('[data-testid="key-163"]')).toBeNull();
  });

  test("排序或刷新不改变密钥编号，已有展开状态保留，回传各密钥原有运行数据", () => {
    const props = {
      providers: [providers[2], providers[0], providers[1]],
      allProviders: providers,
      statistics: { 164: { todayCalls: 2, todayCost: "1.50" } } as ProviderStatisticsMap,
      healthStatus: { 164: { circuitState: "open" as const } } as never,
      endpointCircuitInfo: { 164: [{ endpointId: 7, circuitState: "open" as const }] } as never,
      statisticsLoading: true,
      activeGroupFilter: "codex",
      allGroups: ["codex"],
      userGroups: ["codex"],
      isAdmin: true,
    };
    const rerender = render(list(props));
    click('[aria-label="Expand keys for Agentrouter"]');
    expect(document.querySelector('[data-testid="key-165"]')?.textContent).toContain("Key 3");
    rerender(list({ ...props, providers: [providers[1], providers[2], providers[0]] }));
    expect(document.querySelector('[data-testid="key-164"]')?.textContent).toContain("Key 2");
    const last = renderKey.mock.calls.filter(([p]) => p.provider.id === 164).at(-1)?.[0];
    expect(last.statistics).toBe(props.statistics[164]);
    expect(last.healthStatus.circuitState).toBe("open");
    expect(last.endpointCircuitInfo[0].endpointId).toBe(7);
    expect(last.activeGroupFilter).toBe("codex");
  });

  test("批量选择保持供应商聚合，可选择全部可见密钥或展开单选，筛选外选择保留", () => {
    render(<SelectionHarness />);
    const groupSelector = '[aria-label="Select all visible keys for Agentrouter"]';
    click(groupSelector);
    expect(document.querySelector(groupSelector)?.getAttribute("aria-checked")).toBe("true");
    click('[aria-label="Expand keys for Agentrouter"]');
    click('[aria-label="Select key 164"]');
    expect(document.querySelector(groupSelector)?.getAttribute("aria-checked")).toBe("mixed");
    const last = renderKey.mock.calls.at(-1)?.[0];
    expect(last.isSelected).toBe(true);
    click(groupSelector);
    click(groupSelector);
    expect(document.querySelector(groupSelector)?.getAttribute("aria-checked")).toBe("false");
    expect(document.querySelector('[data-testid="selected-ids"]')?.textContent).toBe("10");
  });

  test("统计按可见密钥汇总，包含不同渠道类型，不将首个密钥统计冒充供应商统计", () => {
    render(
      list({
        providers: [
          { ...providers[0], todayCallCount: 2, todayTotalCostUsd: "0.75" },
          providers[1],
          providers[2],
        ],
        statistics: { 164: { todayCalls: 3, todayCost: "1.25" } } as ProviderStatisticsMap,
      })
    );
    const group = document.querySelector('[data-testid="provider-list-vendor-132"]');
    expect(group?.textContent).toContain("5");
    expect(group?.textContent).toContain("2.00");
    expect(group?.textContent).toContain("2 keys enabled");
    expect(group?.textContent).toContain("Codex");
    expect(group?.textContent).toContain("Claude");
  });

  test("无供应商的记录各自保留，单密钥和空列表沿用原有展示", () => {
    const rerender = render(
      list({ providers: [providers[3], { ...providers[3], id: 11, providerVendorId: 0 }] })
    );
    expect(document.querySelectorAll('[data-testid^="provider-list-vendor-"]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-testid^="key-"]')).toHaveLength(2);
    rerender(list({ providers: [providers[0]] }));
    expect(document.querySelector('[data-testid="key-163"]')).not.toBeNull();
    rerender(list({ providers: [] }));
    expect(document.querySelector('[data-testid="key-163"]')).toBeNull();
    expect(document.body.textContent).toContain(enMessages.settings.providers.noProviders);
  });

  test("普通用户不显示供应商编辑，缺少选择回调不报错", () => {
    render(list({ isMultiSelectMode: true }));
    expect(document.querySelector('[aria-label="Edit Provider"]')).toBeNull();
    click('[aria-label="Select all visible keys for Agentrouter"]');
  });
});
