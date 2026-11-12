/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, test, vi } from "vitest";
import enMessages from "../../../../messages/en";
import { BasicInfoSection } from "../../../../src/app/[locale]/settings/providers/_components/forms/provider-form/sections/basic-info-section";

const providerFormContextMock = vi.hoisted(() => ({
  dispatch: vi.fn(),
  mode: "create" as "create" | "edit",
  state: {
    basic: {
      name: "",
      url: "",
      key: "",
      additionalKeys: [] as Array<{ key: string; is_enabled: boolean }>,
      websiteUrl: "",
    },
    routing: {
      providerType: "openai-compatible",
    },
    ui: {
      isPending: false,
    },
  },
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children?: ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children?: ReactNode }) => (
    <div data-testid="popover-content">{children}</div>
  ),
}));

vi.mock(
  "@/app/[locale]/settings/providers/_components/forms/provider-form/components/quick-paste-dialog",
  () => ({
    QuickPasteDialog: () => <button type="button">Quick Paste</button>,
  })
);

vi.mock(
  "@/app/[locale]/settings/providers/_components/forms/provider-form/provider-form-context",
  () => ({
    useProviderForm: () => ({
      state: providerFormContextMock.state,
      dispatch: providerFormContextMock.dispatch,
      mode: providerFormContextMock.mode,
      provider: null,
      hideUrl: false,
      hideWebsiteUrl: false,
      batchProviders: null,
    }),
  })
);

function renderWithIntl(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        {node}
      </NextIntlClientProvider>
    );
  });

  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("BasicInfoSection base URL guidance", () => {
  beforeEach(() => {
    providerFormContextMock.dispatch.mockClear();
    providerFormContextMock.mode = "create";
    providerFormContextMock.state.basic.additionalKeys = [];
    document.body.innerHTML = "";
  });

  test("新增表单追加密钥时保存第一行及逐条开关状态", () => {
    const { container, unmount } = renderWithIntl(<BasicInfoSection />);
    const add = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Add key"
    );
    expect(add).toBeDefined();
    act(() => add?.click());
    expect(providerFormContextMock.dispatch.mock.calls).toEqual([
      [{ type: "SET_KEY", payload: "" }],
      [{ type: "SET_KEY_IS_ENABLED", payload: true }],
      [{ type: "SET_ADDITIONAL_KEYS", payload: [{ key: "", is_enabled: true }] }],
    ]);
    unmount();
  });

  test("编辑时保留原密钥输入，并可追加及关闭新密钥", () => {
    providerFormContextMock.mode = "edit";
    const ui = renderWithIntl(<BasicInfoSection />);
    expect(document.getElementById("edit-key")).not.toBeNull();
    const add = Array.from(ui.container.querySelectorAll("button")).find(
      (button) => button.textContent === "Add key"
    );
    act(() => add?.click());
    expect(providerFormContextMock.dispatch).toHaveBeenLastCalledWith({
      type: "SET_ADDITIONAL_KEYS",
      payload: [{ key: "", is_enabled: true }],
    });
    expect(
      providerFormContextMock.dispatch.mock.calls.some(([event]) => event.type === "SET_KEY")
    ).toBe(false);
    ui.unmount();
    providerFormContextMock.state.basic.additionalKeys = [{ key: "new", is_enabled: true }];
    const updated = renderWithIntl(<BasicInfoSection />);
    const toggle = updated.container.querySelector('[aria-label="Enable key 1"]') as HTMLElement;
    act(() => toggle.click());
    expect(providerFormContextMock.dispatch).toHaveBeenLastCalledWith({
      type: "SET_ADDITIONAL_KEYS",
      payload: [{ key: "new", is_enabled: false }],
    });
    updated.unmount();
  });

  test("renders inline guidance text and tooltip help for the API address field", () => {
    const urlMessages = enMessages.settings.providers.form.url as {
      description: string;
      tooltip: string;
    };
    const { container, unmount } = renderWithIntl(<BasicInfoSection />);

    expect(document.getElementById("url")).not.toBeNull();
    expect(container.textContent).toContain(urlMessages.description);
    expect(container.textContent).toContain(urlMessages.tooltip);

    const helpTrigger = container.querySelector("button[data-smart-input-tooltip]");
    expect(helpTrigger).not.toBeNull();
    expect(helpTrigger?.getAttribute("aria-label")).toBe(urlMessages.tooltip);

    unmount();
  });
});
