import { describe, expect, test } from "vitest";

import {
  filterCodexHistoryForUpstream,
  isCodexHistoryFilterEnabledFor,
  resolveCodexHistoryFilterProviders,
} from "./codex-history-filter";

type LooseBody = {
  model?: string;
  stream?: boolean;
  store?: boolean;
  include?: string[];
  prompt_cache_key?: string;
  input: Array<Record<string, unknown>>;
};

function buildCodexBody(): LooseBody {
  return {
    model: "gpt-6.1-sol",
    stream: true,
    store: false,
    include: ["reasoning.encrypted_content"],
    prompt_cache_key: "cache-key",
    input: [
      {
        type: "message",
        id: "msg_local_dev",
        role: "developer",
        content: [{ type: "input_text", text: "instructions" }],
      },
      {
        type: "reasoning",
        id: "rs_065487a1deadbeef",
        encrypted_content: "opaque",
        summary: [],
      },
      {
        type: "message",
        id: "msg_065487a1deadbeef",
        role: "assistant",
        content: [{ type: "output_text", text: "done" }],
      },
      {
        type: "function_call",
        id: "fc_065487a1deadbeef",
        call_id: "call_1",
        name: "shell",
        arguments: "{}",
      },
      {
        type: "function_call_output",
        id: "fco_065487a1deadbeef",
        call_id: "call_1",
        output: "ok",
      },
    ],
  };
}

describe("resolveCodexHistoryFilterProviders", () => {
  test("未设置时返回空列表（默认关闭）", () => {
    const previous = process.env.CCH_CODEX_HISTORY_FILTER_PROVIDERS;
    delete process.env.CCH_CODEX_HISTORY_FILTER_PROVIDERS;
    try {
      expect(resolveCodexHistoryFilterProviders()).toEqual([]);
    } finally {
      if (previous === undefined) {
        delete process.env.CCH_CODEX_HISTORY_FILTER_PROVIDERS;
      } else {
        process.env.CCH_CODEX_HISTORY_FILTER_PROVIDERS = previous;
      }
    }
    expect(resolveCodexHistoryFilterProviders("")).toEqual([]);
    expect(resolveCodexHistoryFilterProviders("  ,  ")).toEqual([]);
  });

  test("按逗号拆分并归一化大小写与空白", () => {
    expect(resolveCodexHistoryFilterProviders(" AgentRouter , 163 ,agentrouter")).toEqual([
      "agentrouter",
      "163",
    ]);
  });
});

describe("isCodexHistoryFilterEnabledFor", () => {
  test("默认关闭", () => {
    expect(isCodexHistoryFilterEnabledFor({ id: 163, name: "agentrouter" }, "")).toBe(false);
  });

  test("按 provider 名称命中（大小写不敏感）", () => {
    expect(isCodexHistoryFilterEnabledFor({ id: 7, name: "AgentRouter" }, "agentrouter")).toBe(
      true
    );
  });

  test("按 provider id 命中", () => {
    expect(isCodexHistoryFilterEnabledFor({ id: 163, name: "agentrouter" }, "163")).toBe(true);
  });

  test("未列入白名单的 provider 不命中", () => {
    expect(isCodexHistoryFilterEnabledFor({ id: 12, name: "openai-official" }, "agentrouter")).toBe(
      false
    );
  });
});

describe("filterCodexHistoryForUpstream", () => {
  test("剥离 reasoning 条目及其密文", () => {
    const body = buildCodexBody();
    const result = filterCodexHistoryForUpstream(body);

    expect(result.applied).toBe(true);
    expect(result.droppedReasoningItems).toBe(1);
    expect(body.input.some((item) => item.type === "reasoning")).toBe(false);
  });

  test("剥离可移植条目上的服务端 item id，保留 call_id 配对", () => {
    const body = buildCodexBody();
    const result = filterCodexHistoryForUpstream(body);

    expect(result.strippedItemIds).toBe(4);
    for (const item of body.input) {
      expect(item).not.toHaveProperty("id");
    }
    expect(body.input.find((item) => item.type === "function_call")).toMatchObject({
      call_id: "call_1",
      name: "shell",
    });
  });

  test("强制 store: false", () => {
    const body = buildCodexBody();
    body.store = true;

    const result = filterCodexHistoryForUpstream(body);

    expect(result.forcedStoreFalse).toBe(true);
    expect(body.store).toBe(false);
  });

  test("丢弃无法跨资源的引用型与密文条目", () => {
    const body: LooseBody = {
      input: [
        { type: "item_reference", id: "msg_ref" },
        { type: "compaction", encrypted_content: "opaque" },
        { type: "message", id: "msg_1", role: "user", encrypted_content: "opaque" },
        { type: "message", id: "msg_2", role: "user", content: "hello" },
      ],
    };

    const result = filterCodexHistoryForUpstream(body);

    expect(result.droppedReferenceItems).toBe(2);
    expect(result.droppedEncryptedItems).toBe(1);
    expect(body.input).toHaveLength(1);
    expect(body.input[0]).toMatchObject({ role: "user", content: "hello" });
  });

  test("删除嵌套的 encrypted_content 内容片段", () => {
    const body: LooseBody = {
      input: [
        {
          type: "message",
          id: "msg_1",
          role: "assistant",
          content: [
            { type: "output_text", text: "visible" },
            { type: "encrypted_content", encrypted_content: "opaque" },
          ],
        },
      ],
    };

    const result = filterCodexHistoryForUpstream(body);

    expect(result.strippedEncryptedContentParts).toBe(1);
    expect(body.input[0]).toMatchObject({
      content: [{ type: "output_text", text: "visible" }],
    });
  });

  test("把历史 web_search_call 转成 assistant 文本并去掉 item id", () => {
    const body: LooseBody = {
      input: [
        {
          type: "web_search_call",
          id: "ws_065487a1",
          status: "completed",
          action: { type: "search", query: "codex" },
        },
      ],
    };

    const result = filterCodexHistoryForUpstream(body);

    expect(result.convertedWebSearchItems).toBe(1);
    expect(result.strippedItemIds).toBe(0);
    const converted = body.input[0];
    expect(converted.type).toBe("message");
    expect(converted.role).toBe("assistant");
    expect(converted.id).toBeUndefined();
    const content = converted.content as Array<{ text: string }>;
    expect(content[0].text).toContain("Historical web search activity");
    expect(content[0].text).toContain('"query":"codex"');
  });

  test("幂等：第二次过滤不再产生变更", () => {
    const body = buildCodexBody();
    filterCodexHistoryForUpstream(body);
    const second = filterCodexHistoryForUpstream(body);

    expect(second.applied).toBe(false);
    expect(second.strippedItemIds).toBe(0);
    expect(second.droppedReasoningItems).toBe(0);
  });

  test("字符串 input 保持原样，仍强制 store: false", () => {
    const stringInput = { input: "hello", store: true };
    const result = filterCodexHistoryForUpstream(stringInput);
    expect(stringInput.input).toBe("hello");
    expect(result.applied).toBe(true);
    expect(result.forcedStoreFalse).toBe(true);
  });

  test("空请求体不产生变更", () => {
    const result = filterCodexHistoryForUpstream(null);
    expect(result.applied).toBe(false);
  });
});
