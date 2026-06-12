import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { SystemSettingsForm } from "@/app/[locale]/settings/config/_components/system-settings-form";
import {
  SpecialHandlingForm,
  type SpecialHandlingFormLabels,
} from "@/app/[locale]/settings/special-handling/_components/special-handling-form";
import type { SystemSettings } from "@/types/system-config";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const systemConfigActionMocks = vi.hoisted(() => ({
  saveSystemSettings: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/api-client/v1/actions/system-config", () => systemConfigActionMocks);

const sonnerMocks = vi.hoisted(() => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));
vi.mock("sonner", () => sonnerMocks);

type FormSettings = Pick<
  SystemSettings,
  | "siteTitle"
  | "allowGlobalUsageView"
  | "currencyDisplay"
  | "billingModelSource"
  | "codexPriorityBillingSource"
  | "billNonSuccessfulRequests"
  | "billHedgeLosers"
  | "timezone"
  | "verboseProviderError"
  | "passThroughUpstreamErrorMessage"
  | "enableHttp2"
  | "enableOpenaiResponsesWebsocket"
  | "enableHighConcurrencyMode"
  | "interceptAnthropicWarmupRequests"
  | "enableThinkingSignatureRectifier"
  | "enableThinkingBudgetRectifier"
  | "enableBillingHeaderRectifier"
  | "enableResponseInputRectifier"
  | "enableCodexSessionIdCompletion"
  | "enableClaudeMetadataUserIdInjection"
  | "enableResponseFixer"
  | "allowNonConversationEndpointProviderFallback"
  | "fakeStreamingWhitelist"
  | "fakeStreamingProviderIds"
  | "enableProviderOutputSafetyFilter"
  | "providerOutputSafetyFilterRules"
  | "responseFixerConfig"
  | "quotaDbRefreshIntervalSeconds"
  | "quotaLeasePercent5h"
  | "quotaLeasePercentDaily"
  | "quotaLeasePercentWeekly"
  | "quotaLeasePercentMonthly"
  | "quotaLeaseCapUsd"
  | "ipGeoLookupEnabled"
  | "ipExtractionConfig"
>;

const baseSettings: FormSettings = {
  siteTitle: "Claude Code Hub",
  allowGlobalUsageView: true,
  currencyDisplay: "USD",
  billingModelSource: "original",
  codexPriorityBillingSource: "requested",
  billNonSuccessfulRequests: false,
  billHedgeLosers: true,
  timezone: "UTC",
  verboseProviderError: false,
  passThroughUpstreamErrorMessage: true,
  enableHttp2: true,
  enableOpenaiResponsesWebsocket: true,
  enableHighConcurrencyMode: false,
  interceptAnthropicWarmupRequests: false,
  enableThinkingSignatureRectifier: true,
  enableThinkingBudgetRectifier: true,
  enableBillingHeaderRectifier: true,
  enableResponseInputRectifier: true,
  enableCodexSessionIdCompletion: true,
  enableClaudeMetadataUserIdInjection: true,
  enableResponseFixer: true,
  allowNonConversationEndpointProviderFallback: true,
  fakeStreamingWhitelist: [
    { model: "gpt-image-2", groupTags: [] },
    { model: "gemini-3.1-flash-image-preview", groupTags: [] },
  ],
  fakeStreamingProviderIds: [101],
  enableProviderOutputSafetyFilter: true,
  providerOutputSafetyFilterRules: [String.raw`rm\s+-rf\s+\/`],
  responseFixerConfig: {
    fixEncoding: true,
    fixSseFormat: true,
    fixTruncatedJson: true,
    maxJsonDepth: 200,
    maxFixSize: 1024 * 1024,
  },
  quotaDbRefreshIntervalSeconds: 10,
  quotaLeasePercent5h: 0.05,
  quotaLeasePercentDaily: 0.05,
  quotaLeasePercentWeekly: 0.05,
  quotaLeasePercentMonthly: 0.05,
  quotaLeaseCapUsd: null,
  ipGeoLookupEnabled: true,
  ipExtractionConfig: null,
};

const providers = [
  {
    id: 101,
    name: "Anyrouter-codex",
    groupTag: "codex",
    priority: 20,
    groupPriorities: null,
  },
  {
    id: 202,
    name: "rawchat",
    groupTag: "codex",
    priority: 10,
    groupPriorities: null,
  },
  {
    id: 303,
    name: "default-channel",
    groupTag: null,
    priority: 0,
    groupPriorities: null,
  },
];

function loadMessages(locale: string) {
  const base = path.join(process.cwd(), `messages/${locale}/settings`);
  const read = (name: string) => JSON.parse(fs.readFileSync(path.join(base, name), "utf8"));

  return {
    settings: {
      common: read("common.json"),
      config: read("config.json"),
      requestFilters: read("requestFilters.json"),
    },
  };
}

function getSpecialHandlingLabels(): SpecialHandlingFormLabels {
  const messages = loadMessages("zh-CN").settings;
  const { fakeStreaming, providerOutputSafety } = messages.config.form;

  return {
    fakeStreaming,
    providerOutputSafety,
    saveSettings: messages.config.form.saveSettings,
    saving: messages.common.saving,
    saveFailed: messages.config.form.saveFailed,
    configUpdated: messages.config.form.configUpdated,
  };
}

function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={loadMessages("en")} timeZone="UTC">
        {node}
      </NextIntlClientProvider>
    );
  });

  return {
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function submitForm() {
  const form = document.body.querySelector("form");
  if (!form) throw new Error("未找到系统设置表单");

  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("SystemSettingsForm fake streaming provider handling", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  test("system config form does not submit special handling fields by default", async () => {
    const { unmount } = render(<SystemSettingsForm initialSettings={baseSettings} />);

    await submitForm();

    const payload = systemConfigActionMocks.saveSystemSettings.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;

    expect(payload).not.toHaveProperty("fakeStreamingWhitelist");
    expect(payload).not.toHaveProperty("fakeStreamingProviderIds");
    expect(payload).not.toHaveProperty("enableProviderOutputSafetyFilter");
    expect(payload).not.toHaveProperty("providerOutputSafetyFilterRules");

    unmount();
  });

  test("special handling form submits provider ids instead of legacy model whitelist", async () => {
    const { unmount } = render(
      <SpecialHandlingForm
        initialSettings={{
          fakeStreamingProviderIds: baseSettings.fakeStreamingProviderIds,
          enableProviderOutputSafetyFilter: baseSettings.enableProviderOutputSafetyFilter,
          providerOutputSafetyFilterRules: baseSettings.providerOutputSafetyFilterRules,
        }}
        providers={providers}
        labels={getSpecialHandlingLabels()}
      />
    );

    await submitForm();

    expect(systemConfigActionMocks.saveSystemSettings).toHaveBeenCalledWith({
      fakeStreamingProviderIds: [101],
      enableProviderOutputSafetyFilter: true,
      providerOutputSafetyFilterRules: [String.raw`rm\s+-rf\s+\/`],
    });
    expect(systemConfigActionMocks.saveSystemSettings.mock.calls.at(-1)?.[0]).not.toHaveProperty(
      "fakeStreamingWhitelist"
    );
    expect(document.body.textContent).toContain("供应商 / 渠道");
    expect(document.body.textContent).toContain("Anyrouter-codex");
    expect(document.body.textContent).toContain("rawchat");
    expect(document.body.textContent).not.toContain("default-channel");
    expect(document.body.textContent).toContain("渠道投毒命令过滤");

    unmount();
  });

  test("special handling form can disable provider switches", async () => {
    const { unmount } = render(
      <SpecialHandlingForm
        initialSettings={{
          fakeStreamingProviderIds: [101, 202],
          enableProviderOutputSafetyFilter: baseSettings.enableProviderOutputSafetyFilter,
          providerOutputSafetyFilterRules: baseSettings.providerOutputSafetyFilterRules,
        }}
        providers={providers}
        labels={getSpecialHandlingLabels()}
      />
    );

    const switches = [
      document.body.querySelector(
        'button[aria-label="为 Anyrouter-codex 启用避免长请求 499/CLIENT_ABORTED 中断"]'
      ),
      document.body.querySelector(
        'button[aria-label="为 rawchat 启用避免长请求 499/CLIENT_ABORTED 中断"]'
      ),
    ];
    if (switches.some((switchButton) => switchButton === null)) {
      throw new Error("未找到渠道开关");
    }
    await act(async () => {
      for (const switchButton of switches) {
        switchButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
      await Promise.resolve();
    });
    await submitForm();

    expect(systemConfigActionMocks.saveSystemSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        fakeStreamingProviderIds: [],
      })
    );

    unmount();
  });

  test("special handling form shows codex group providers sorted by priority", () => {
    const { unmount } = render(
      <SpecialHandlingForm
        initialSettings={{
          fakeStreamingProviderIds: baseSettings.fakeStreamingProviderIds,
          enableProviderOutputSafetyFilter: baseSettings.enableProviderOutputSafetyFilter,
          providerOutputSafetyFilterRules: baseSettings.providerOutputSafetyFilterRules,
        }}
        providers={providers}
        labels={getSpecialHandlingLabels()}
      />
    );

    const rawchatIndex = document.body.textContent?.indexOf("rawchat") ?? -1;
    const anyrouterIndex = document.body.textContent?.indexOf("Anyrouter-codex") ?? -1;
    const defaultIndex = document.body.textContent?.indexOf("default-channel") ?? -1;

    expect(rawchatIndex).toBeGreaterThanOrEqual(0);
    expect(anyrouterIndex).toBeGreaterThan(rawchatIndex);
    expect(defaultIndex).toBe(-1);

    unmount();
  });

  test("legacy model editor UI is not rendered by default", () => {
    const { unmount } = render(<SystemSettingsForm initialSettings={baseSettings} />);

    expect(document.querySelector('button[data-testid="fake-streaming-add"]')).toBeNull();
    expect(document.querySelector('button[data-testid^="fake-streaming-remove-"]')).toBeNull();
    expect(document.querySelector('input[data-testid^="fake-streaming-model-"]')).toBeNull();

    unmount();
  });

  test("zh-CN defines provider-based fake streaming labels", () => {
    const section = loadMessages("zh-CN").settings.config.form.fakeStreaming;
    expect(section.title).toBeTruthy();
    expect(section.description).toContain("供应商");
    expect(section.providerLabel).toBeTruthy();
    expect(section.selectedCount).toBeTruthy();
    expect(section.groupSelectLabel).toBeTruthy();
    expect(section.noProviders).toBeTruthy();
    expect(section.noProvidersInGroup).toBeTruthy();
    expect(section.defaultGroup).toBeTruthy();
    expect(section.providerToggleLabel).toBeTruthy();
    expect(section.emptyState).toBeTruthy();
  });
});
