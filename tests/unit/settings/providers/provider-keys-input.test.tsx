/** @vitest-environment happy-dom */
import { NextIntlClientProvider } from "next-intl";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";
import keyMessages from "../../../../messages/en/settings/providers/form/key.json";
import { ProviderKeysInput } from "@/app/[locale]/settings/providers/_components/forms/provider-form/components/provider-keys-input";
import { PROVIDER_KEY_BATCH_MAX, type ProviderKeyEntry } from "@/lib/provider-key-batch";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function KeysHarness({
  entries,
  disabled,
  onChange,
}: {
  entries: ProviderKeyEntry[];
  disabled?: boolean;
  onChange: (entries: ProviderKeyEntry[]) => void;
}) {
  const [values, setValues] = useState(entries);
  return (
    <ProviderKeysInput
      entries={values}
      disabled={disabled}
      onChange={(next) => {
        onChange(next);
        setValues(next);
      }}
    />
  );
}

function renderKeys(entries: ProviderKeyEntry[], disabled?: boolean) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let current = entries;
  act(() =>
    root.render(
      <NextIntlClientProvider
        locale="en"
        messages={{ settings: { providers: { form: { key: keyMessages } } } }}
      >
        <KeysHarness
          entries={entries}
          disabled={disabled}
          onChange={(next) => {
            current = next;
          }}
        />
      </NextIntlClientProvider>
    )
  );
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return { container, values: () => current };
}

function click(element: Element | null) {
  expect(element).not.toBeNull();
  act(() => (element as HTMLElement).click());
}

describe("多密钥输入列表", () => {
  test("追加、独立开关和移除保留其余密钥的状态", () => {
    const ui = renderKeys([
      { key: "one", is_enabled: true },
      { key: "two", is_enabled: false },
    ]);
    click(ui.container.querySelector('[aria-label="Enable key 1"]'));
    expect(ui.values()).toEqual([
      { key: "one", is_enabled: false },
      { key: "two", is_enabled: false },
    ]);
    click(ui.container.querySelector('[aria-label="Enable key 2"]'));
    expect(ui.values()[1].is_enabled).toBe(true);
    click(
      Array.from(ui.container.querySelectorAll("button")).find(
        (button) => button.textContent === "Add key"
      ) ?? null
    );
    expect(ui.values()[2]).toEqual({ key: "", is_enabled: true });
    click(ui.container.querySelector('[aria-label="Remove key 1"]'));
    expect(ui.values()).toEqual([
      { key: "two", is_enabled: true },
      { key: "", is_enabled: true },
    ]);
  });

  test("默认隐藏密钥，可统一显示和隐藏，最后一行不可移除", () => {
    const ui = renderKeys([{ key: "one", is_enabled: true }]);
    expect(ui.container.querySelector("input")?.type).toBe("password");
    expect(
      (ui.container.querySelector('[aria-label="Remove key 1"]') as HTMLButtonElement).disabled
    ).toBe(true);
    click(ui.container.querySelector('[aria-label="Show all keys"]'));
    expect(ui.container.querySelector("input")?.type).toBe("text");
    click(ui.container.querySelector('[aria-label="Hide all keys"]'));
    expect(ui.container.querySelector("input")?.type).toBe("password");
  });

  test("填写密钥会保留开关状态，并展示输入警告", () => {
    const ui = renderKeys([{ key: "Bearer abc", is_enabled: false }]);
    expect(ui.container.textContent).toContain(keyMessages.warnings.looks_like_auth_header);
    const input = ui.container.querySelector("input") as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "updated"
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(ui.values()).toEqual([{ key: "updated", is_enabled: false }]);
  });

  test("提交过程中禁止修改，达到上限时禁止追加", () => {
    const ui = renderKeys([{ key: "one", is_enabled: true }], true);
    for (const element of ui.container.querySelectorAll("button, input"))
      expect((element as HTMLInputElement).disabled).toBe(true);
    const full = renderKeys(
      Array.from({ length: PROVIDER_KEY_BATCH_MAX }, (_, i) => ({
        key: `key-${i}`,
        is_enabled: true,
      }))
    );
    const add = Array.from(full.container.querySelectorAll("button")).find(
      (button) => button.textContent === "Add key"
    );
    expect(add?.disabled).toBe(true);
  });
});
