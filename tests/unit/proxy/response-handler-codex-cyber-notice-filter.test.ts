import { describe, expect, test } from "vitest";
import {
  createCodexCyberNoticeFilter,
  shouldHideCodexCyberNotice,
} from "@/app/v1/_lib/proxy/codex-cyber-notice-filter";

function sseJson(event: string, data: Record<string, unknown>): string {
  return [`event: ${event}`, `data: ${JSON.stringify(data)}`, "", ""].join("\n");
}

async function filterSseText(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(input));
      controller.close();
    },
  });

  return await new Response(stream.pipeThrough(createCodexCyberNoticeFilter())).text();
}

describe("Codex cyber notice response filter", () => {
  test("is enabled by default only for Codex providers", () => {
    const previous = process.env.CCH_HIDE_CODEX_CYBER_RISK_NOTICE;
    delete process.env.CCH_HIDE_CODEX_CYBER_RISK_NOTICE;

    expect(shouldHideCodexCyberNotice("codex")).toBe(true);
    expect(shouldHideCodexCyberNotice("openai-compatible")).toBe(false);

    process.env.CCH_HIDE_CODEX_CYBER_RISK_NOTICE = "0";
    expect(shouldHideCodexCyberNotice("codex")).toBe(false);

    if (previous === undefined) {
      delete process.env.CCH_HIDE_CODEX_CYBER_RISK_NOTICE;
    } else {
      process.env.CCH_HIDE_CODEX_CYBER_RISK_NOTICE = previous;
    }
  });

  test("removes Codex Trusted Access cyber verification metadata", async () => {
    const input = sseJson("response.metadata", {
      type: "response.metadata",
      response_id: "resp_1",
      sequence_number: 2,
      metadata: {
        openai_verification_recommendation: ["trusted_access_for_cyber"],
      },
    });

    const filtered = await filterSseText(input);

    expect(filtered).toContain("response.metadata");
    expect(filtered).toContain('"metadata":{}');
    expect(filtered).not.toContain("trusted_access_for_cyber");
    expect(filtered).not.toContain("openai_verification_recommendation");
  });

  test("preserves unrelated verification metadata recommendations", async () => {
    const input = sseJson("response.metadata", {
      type: "response.metadata",
      metadata: {
        openai_verification_recommendation: ["trusted_access_for_cyber", "other_program"],
        keep: "value",
      },
    });

    const filtered = await filterSseText(input);

    expect(filtered).not.toContain("trusted_access_for_cyber");
    expect(filtered).toContain("other_program");
    expect(filtered).toContain('"keep":"value"');
  });
});
