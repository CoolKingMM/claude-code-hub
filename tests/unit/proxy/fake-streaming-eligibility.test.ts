import { afterEach, describe, expect, test, vi } from "vitest";
import {
  isFakeStreamingEligible,
  isFakeStreamingProviderEligible,
} from "@/app/v1/_lib/proxy/fake-streaming/eligibility";
import { PROVIDER_GROUP } from "@/lib/constants/provider.constants";
import type { FakeStreamingWhitelistEntry } from "@/types/system-config";
import type { ClientFormat } from "@/app/v1/_lib/proxy/format-mapper";
import type { SystemSettings } from "@/types/system-config";

describe("isFakeStreamingEligible", () => {
  test("matches exact model for all groups when groupTags is empty", () => {
    const whitelist: FakeStreamingWhitelistEntry[] = [{ model: "gpt-image-2", groupTags: [] }];

    expect(isFakeStreamingEligible("gpt-image-2", "any-group", whitelist)).toBe(true);
    expect(isFakeStreamingEligible("gpt-image-2", "default", whitelist)).toBe(true);
    expect(isFakeStreamingEligible("gpt-image-2", null, whitelist)).toBe(true);
    expect(isFakeStreamingEligible("gpt-image-2", undefined, whitelist)).toBe(true);
  });

  test("rejects model not in whitelist", () => {
    const whitelist: FakeStreamingWhitelistEntry[] = [{ model: "gpt-image-2", groupTags: [] }];

    expect(isFakeStreamingEligible("claude-3-5-sonnet-latest", "default", whitelist)).toBe(false);
    expect(isFakeStreamingEligible("gpt-image", "default", whitelist)).toBe(false);
    expect(isFakeStreamingEligible("gpt-image-2-turbo", "default", whitelist)).toBe(false);
  });

  test("does not match by prefix or substring", () => {
    const whitelist: FakeStreamingWhitelistEntry[] = [{ model: "claude-3", groupTags: [] }];

    expect(isFakeStreamingEligible("claude-3", "default", whitelist)).toBe(true);
    expect(isFakeStreamingEligible("claude-3-5-sonnet-latest", "default", whitelist)).toBe(false);
    expect(isFakeStreamingEligible("anthropic/claude-3", "default", whitelist)).toBe(false);
  });

  test("matches only configured provider groups when groupTags is non-empty", () => {
    const whitelist: FakeStreamingWhitelistEntry[] = [
      { model: "gpt-image-2", groupTags: ["group-a", "group-b"] },
    ];

    expect(isFakeStreamingEligible("gpt-image-2", "group-a", whitelist)).toBe(true);
    expect(isFakeStreamingEligible("gpt-image-2", "group-b", whitelist)).toBe(true);
    expect(isFakeStreamingEligible("gpt-image-2", "group-c", whitelist)).toBe(false);
  });

  test("missing group resolves via default group constant", () => {
    const whitelistAll: FakeStreamingWhitelistEntry[] = [{ model: "gpt-image-2", groupTags: [] }];
    expect(isFakeStreamingEligible("gpt-image-2", null, whitelistAll)).toBe(true);

    const whitelistDefault: FakeStreamingWhitelistEntry[] = [
      { model: "gpt-image-2", groupTags: [PROVIDER_GROUP.DEFAULT] },
    ];
    expect(isFakeStreamingEligible("gpt-image-2", null, whitelistDefault)).toBe(true);
    expect(isFakeStreamingEligible("gpt-image-2", undefined, whitelistDefault)).toBe(true);
    expect(isFakeStreamingEligible("gpt-image-2", "", whitelistDefault)).toBe(true);

    const whitelistOther: FakeStreamingWhitelistEntry[] = [
      { model: "gpt-image-2", groupTags: ["group-a"] },
    ];
    expect(isFakeStreamingEligible("gpt-image-2", null, whitelistOther)).toBe(false);
  });

  test("returns false when whitelist is empty (explicit opt out)", () => {
    expect(isFakeStreamingEligible("gpt-image-2", "default", [])).toBe(false);
    expect(isFakeStreamingEligible("any-model", null, [])).toBe(false);
  });

  test("trims whitespace from inputs and whitelist values", () => {
    const whitelist: FakeStreamingWhitelistEntry[] = [
      { model: "gpt-image-2", groupTags: ["group-a"] },
    ];

    expect(isFakeStreamingEligible("  gpt-image-2  ", "  group-a  ", whitelist)).toBe(true);
    expect(isFakeStreamingEligible("gpt-image-2", " group-a ", whitelist)).toBe(true);
  });

  test("rejects empty model string", () => {
    const whitelist: FakeStreamingWhitelistEntry[] = [{ model: "gpt-image-2", groupTags: [] }];

    expect(isFakeStreamingEligible("", "default", whitelist)).toBe(false);
    expect(isFakeStreamingEligible("   ", "default", whitelist)).toBe(false);
  });

  test("default image-generation models match when whitelist contains them with empty groups", () => {
    const whitelist: FakeStreamingWhitelistEntry[] = [
      { model: "gpt-image-2", groupTags: [] },
      { model: "gpt-image-1.5", groupTags: [] },
      { model: "gemini-3.1-flash-image-preview", groupTags: [] },
      { model: "gemini-3-pro-image-preview", groupTags: [] },
    ];

    for (const model of [
      "gpt-image-2",
      "gpt-image-1.5",
      "gemini-3.1-flash-image-preview",
      "gemini-3-pro-image-preview",
    ]) {
      expect(isFakeStreamingEligible(model, "default", whitelist)).toBe(true);
      expect(isFakeStreamingEligible(model, "any-group", whitelist)).toBe(true);
    }
  });

  test("ignores duplicate model entries (deterministic first match)", () => {
    const whitelist: FakeStreamingWhitelistEntry[] = [
      { model: "gpt-image-2", groupTags: [] },
      { model: "gpt-image-2", groupTags: ["group-x"] },
    ];

    // Even if a duplicate slipped through (validation should prevent), the first
    // entry's "all groups" semantics should win, so any group matches.
    expect(isFakeStreamingEligible("gpt-image-2", "group-y", whitelist)).toBe(true);
  });
});

describe("isFakeStreamingProviderEligible", () => {
  test("matches an enabled provider regardless of model or group", () => {
    expect(isFakeStreamingProviderEligible(42, [7, 42])).toBe(true);
    expect(isFakeStreamingProviderEligible(7, [7, 42])).toBe(true);
  });

  test("rejects missing, invalid, or unconfigured providers", () => {
    expect(isFakeStreamingProviderEligible(99, [7, 42])).toBe(false);
    expect(isFakeStreamingProviderEligible(null, [7, 42])).toBe(false);
    expect(isFakeStreamingProviderEligible(undefined, [7, 42])).toBe(false);
    expect(isFakeStreamingProviderEligible(42, [])).toBe(false);
    expect(isFakeStreamingProviderEligible(42, null)).toBe(false);
  });
});

describe("tryFakeStreamingPath provider eligibility", () => {
  afterEach(() => {
    vi.doUnmock("@/app/v1/_lib/proxy/fake-streaming/runner");
    vi.resetModules();
    vi.clearAllMocks();
  });

  test("enables fake streaming for every model on a selected provider", async () => {
    const buildFakeStreamingResponse = vi.fn(
      () => new Response("stream-path", { headers: { "Content-Type": "text/event-stream" } })
    );
    const buildFakeStreamingNonStreamResponse = vi.fn(async () => new Response("non-stream-path"));
    vi.doMock("@/app/v1/_lib/proxy/fake-streaming/runner", () => ({
      buildFakeStreamingResponse,
      buildFakeStreamingNonStreamResponse,
    }));

    const { tryFakeStreamingPath } = await import(
      "@/app/v1/_lib/proxy/fake-streaming/proxy-integration"
    );
    const session = createFakeStreamingSession({
      model: "provider-custom-model",
      providerId: 42,
      stream: true,
    });

    const response = await tryFakeStreamingPath(
      session,
      createSystemSettings({
        fakeStreamingProviderIds: [42],
        fakeStreamingWhitelist: [],
      })
    );

    expect(response).not.toBeNull();
    await expect(response?.text()).resolves.toBe("stream-path");
    expect(buildFakeStreamingResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        family: "anthropic",
        isStream: true,
      })
    );
    expect(buildFakeStreamingNonStreamResponse).not.toHaveBeenCalled();
    expect(session.request.message.stream).toBe(false);
  });

  test("treats an empty provider list as explicit opt out instead of legacy fallback", async () => {
    const buildFakeStreamingResponse = vi.fn(() => new Response("stream-path"));
    const buildFakeStreamingNonStreamResponse = vi.fn(async () => new Response("non-stream-path"));
    vi.doMock("@/app/v1/_lib/proxy/fake-streaming/runner", () => ({
      buildFakeStreamingResponse,
      buildFakeStreamingNonStreamResponse,
    }));

    const { tryFakeStreamingPath } = await import(
      "@/app/v1/_lib/proxy/fake-streaming/proxy-integration"
    );
    const session = createFakeStreamingSession({
      model: "legacy-model",
      providerId: 42,
      stream: true,
    });

    const response = await tryFakeStreamingPath(
      session,
      createSystemSettings({
        fakeStreamingProviderIds: [],
        fakeStreamingWhitelist: [{ model: "legacy-model", groupTags: [] }],
      })
    );

    expect(response).toBeNull();
    expect(buildFakeStreamingResponse).not.toHaveBeenCalled();
    expect(buildFakeStreamingNonStreamResponse).not.toHaveBeenCalled();
    expect(session.request.message.stream).toBe(true);
  });
});

function createFakeStreamingSession({
  model,
  providerId,
  stream,
  format = "claude",
}: {
  model: string;
  providerId: number;
  stream: boolean;
  format?: ClientFormat;
}) {
  const abortController = new AbortController();
  return {
    request: {
      model,
      message: { model, stream },
    },
    provider: {
      id: providerId,
      groupTag: "codex",
    },
    originalFormat: format,
    requestUrl: new URL("http://localhost/v1/messages"),
    clientAbortSignal: abortController.signal,
  } as never;
}

function createSystemSettings(
  overrides: Pick<SystemSettings, "fakeStreamingProviderIds" | "fakeStreamingWhitelist">
): SystemSettings {
  return overrides as SystemSettings;
}
