/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { TagInput } from "@/components/ui/tag-input";

// 追踪所有挂载的 React root，确保即使某个用例断言失败提前抛出，afterEach 也能卸载，
// 避免残留已挂载的 root 污染后续用例的 document.activeElement / DOM。
const mountedRoots: Array<{ container: HTMLElement; root: Root; unmounted: boolean }> = [];

function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  const entry = { container, root, unmounted: false };
  mountedRoots.push(entry);
  return {
    container,
    unmount: () => {
      if (entry.unmounted) return;
      entry.unmounted = true;
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function typeAndSubmit(input: HTMLInputElement, value: string) {
  await act(async () => {
    input.focus();
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    valueSetter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  for (const entry of mountedRoots.splice(0)) {
    if (entry.unmounted) continue;
    entry.unmounted = true;
    act(() => entry.root.unmount());
    entry.container.remove();
  }
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("provider-group tag inputs", () => {
  test("默认 TagInput 仍应拒绝中文标签", async () => {
    const onChange = vi.fn();
    const onInvalidTag = vi.fn();
    const { container, unmount } = render(
      <TagInput value={[]} onChange={onChange} onInvalidTag={onInvalidTag} />
    );

    const input = container.querySelector("input");
    expect(input).toBeInstanceOf(HTMLInputElement);

    await typeAndSubmit(input as HTMLInputElement, "中文分组");

    expect(onChange).not.toHaveBeenCalled();
    expect(onInvalidTag).toHaveBeenCalledWith("中文分组", "invalid_format");

    unmount();
  });
});
