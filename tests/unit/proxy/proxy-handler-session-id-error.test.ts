import { beforeEach, describe, expect, test, vi } from "vitest";
import { resolveEndpointPolicy } from "@/app/v1/_lib/proxy/endpoint-policy";
import { V1_ENDPOINT_PATHS } from "@/app/v1/_lib/proxy/endpoint-paths";
import { ProxyResponses } from "@/app/v1/_lib/proxy/responses";
import { ProxyError } from "@/app/v1/_lib/proxy/errors";

const h = vi.hoisted(() => ({
  session: {
    originalFormat: "openai",
    sessionId: "s_123",
    requestUrl: new URL("http://localhost/v1/messages"),
    request: {
      model: "gpt",
      message: {},
    },
    getEndpointPolicy: () => resolveEndpointPolicy(h.session.requestUrl.pathname),
    isCountTokensRequest: () => false,
    getProviderChain: () => [],
    setOriginalFormat: () => {},
    setHighConcurrencyModeEnabled: () => {},
    setRawCrossProviderFallbackEnabled(enabled: boolean) {
      h.session.rawCrossProviderFallbackEnabled = enabled;
    },
    isRawCrossProviderFallbackEnabled: () => !!h.session.rawCrossProviderFallbackEnabled,
    recordForwardStart: () => {},
    messageContext: null,
    provider: null,
    rawCrossProviderFallbackEnabled: false,
  } as any,

  fromContextError: null as unknown,
  pipelineError: null as unknown,
  earlyResponse: null as Response | null,
  forwardResponse: new Response("ok", { status: 200 }),
  dispatchedResponse: null as Response | null,
  fakeStreamingResponse: null as Response | null,
  dispatchCalls: [] as Response[],
  forwarderCalls: 0,
  systemSettings: {
    enableHighConcurrencyMode: false,
    allowNonConversationEndpointProviderFallback: true,
  },

  endpointFormat: null as string | null,
  trackerCalls: [] as string[],
}));

vi.mock("@/app/v1/_lib/proxy/session", () => ({
  ProxySession: {
    fromContext: async () => {
      if (h.fromContextError) throw h.fromContextError;
      return h.session;
    },
  },
}));

vi.mock("@/app/v1/_lib/proxy/guard-pipeline", () => ({
  RequestType: { CHAT: "CHAT", COUNT_TOKENS: "COUNT_TOKENS" },
  GuardPipelineBuilder: {
    fromSession: () => ({
      run: async () => {
        if (h.pipelineError) throw h.pipelineError;
        return h.earlyResponse;
      },
    }),
    fromRequestType: () => ({
      run: async () => {
        if (h.pipelineError) throw h.pipelineError;
        return h.earlyResponse;
      },
    }),
  },
}));

vi.mock("@/app/v1/_lib/proxy/format-mapper", () => ({
  detectClientFormat: () => "openai",
  detectFormatByEndpoint: () => h.endpointFormat,
}));

vi.mock("@/app/v1/_lib/proxy/forwarder", () => ({
  ProxyForwarder: {
    send: async () => {
      h.forwarderCalls += 1;
      return h.forwardResponse;
    },
  },
}));

vi.mock("@/app/v1/_lib/proxy/response-handler", () => ({
  ProxyResponseHandler: {
    dispatch: async (_session: unknown, response: Response) => {
      h.dispatchCalls.push(response);
      return h.dispatchedResponse ?? response;
    },
  },
}));

vi.mock("@/app/v1/_lib/proxy/fake-streaming/proxy-integration", () => ({
  tryFakeStreamingPath: async () => h.fakeStreamingResponse,
}));

vi.mock("@/app/v1/_lib/proxy/error-handler", () => ({
  ProxyErrorHandler: {
    handle: async () => new Response("handled", { status: 502 }),
  },
}));

vi.mock("@/lib/config", () => ({
  getCachedSystemSettings: async () => h.systemSettings,
}));

vi.mock("@/lib/session-tracker", () => ({
  SessionTracker: {
    incrementConcurrentCount: async () => {
      h.trackerCalls.push("inc");
    },
    decrementConcurrentCount: async () => {
      h.trackerCalls.push("dec");
    },
  },
}));

vi.mock("@/lib/proxy-status-tracker", () => ({
  ProxyStatusTracker: {
    getInstance: () => ({
      startRequest: () => {
        h.trackerCalls.push("startRequest");
      },
      endRequest: () => {},
    }),
  },
}));

async function expectMessageSuffixOnly(
  response: Response,
  expectedStatus: number,
  expectedMessage: string
) {
  expect(response.status).toBe(expectedStatus);
  expect(response.headers.get("x-cch-session-id")).toBeNull();

  const body = await response.json();
  expect(body.error.message).toBe(`${expectedMessage} (cch_session_id: s_123)`);
}

describe("handleProxyRequest - session id on errors", async () => {
  const { handleProxyRequest } = await import("@/app/v1/_lib/proxy-handler");

  beforeEach(() => {
    h.fromContextError = null;
    h.pipelineError = null;
    h.earlyResponse = null;
    h.forwardResponse = new Response("ok", { status: 200 });
    h.dispatchedResponse = null;
    h.fakeStreamingResponse = null;
    h.dispatchCalls.length = 0;
    h.forwarderCalls = 0;
    h.endpointFormat = null;
    h.trackerCalls.length = 0;
    h.session.originalFormat = "openai";
    h.session.sessionId = "s_123";
    h.session.requestUrl = new URL("http://localhost/v1/messages");
    h.session.request = { model: "gpt", message: {} };
    h.session.messageContext = null;
    h.session.provider = null;
    h.session.rawCrossProviderFallbackEnabled = false;
    h.session.getEndpointPolicy = () => resolveEndpointPolicy(h.session.requestUrl.pathname);
    h.session.isCountTokensRequest = () => false;
  });

  test("decorates early error response with message suffix only", async () => {
    h.session.originalFormat = "openai";
    h.earlyResponse = ProxyResponses.buildError(400, "bad request");
    const res = await handleProxyRequest({} as any);

    await expectMessageSuffixOnly(res, 400, "bad request");
  });

  test("decorates dispatch error response with message suffix only", async () => {
    h.session.originalFormat = "openai";
    h.forwardResponse = new Response("upstream", { status: 502 });
    h.dispatchedResponse = ProxyResponses.buildError(502, "bad gateway");

    const res = await handleProxyRequest({} as any);

    await expectMessageSuffixOnly(res, 502, "bad gateway");
  });

  test("covers claude format detection branch without breaking behavior", async () => {
    h.session.originalFormat = "claude";
    h.earlyResponse = ProxyResponses.buildError(400, "bad request");
    h.session.requestUrl = new URL("http://localhost/v1/unknown");
    h.session.request = { model: "gpt", message: { contents: [] } };

    const res = await handleProxyRequest({} as any);
    await expectMessageSuffixOnly(res, 400, "bad request");
  });

  test("covers endpoint format detection + tracking + finally decrement", async () => {
    h.session.originalFormat = "claude";
    h.endpointFormat = "openai";
    h.forwardResponse = new Response("ok", { status: 200 });

    h.session.sessionId = "s_123";
    h.session.messageContext = { id: 1, user: { id: 1, name: "u" }, key: { name: "k" } };
    h.session.provider = { id: 1, name: "p" };
    h.session.isCountTokensRequest = () => false;

    const res = await handleProxyRequest({} as any);
    expect(res.status).toBe(200);
    expect(h.trackerCalls).toEqual(["inc", "startRequest", "dec"]);
    expect(h.forwarderCalls).toBe(1);
    expect(h.dispatchCalls).toHaveLength(1);
  });

  test("fake streaming 命中时仍经过 response handler 以完成请求收尾", async () => {
    h.session.originalFormat = "response";
    h.session.sessionId = "s_123";
    h.session.messageContext = { id: 10, user: { id: 1, name: "u" }, key: { name: "k" } };
    h.session.provider = { id: 115, name: "AnyRouter-codex" };
    h.fakeStreamingResponse = new Response("event: response.completed\n\n", {
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8" },
    });
    h.dispatchedResponse = new Response("handled fake stream", { status: 200 });

    const res = await handleProxyRequest({} as any);

    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe("handled fake stream");
    expect(h.forwarderCalls).toBe(0);
    expect(h.dispatchCalls).toEqual([h.fakeStreamingResponse]);
  });

  test.each([
    {
      pathname: V1_ENDPOINT_PATHS.MESSAGES_COUNT_TOKENS,
      isCountTokensRequest: true,
    },
    {
      pathname: V1_ENDPOINT_PATHS.RESPONSES_COMPACT,
      isCountTokensRequest: false,
    },
  ])("raw endpoint $pathname 应统一跳过并发计数", async ({ pathname, isCountTokensRequest }) => {
    h.session.originalFormat = "claude";
    h.endpointFormat = "openai";
    h.forwardResponse = new Response("ok", { status: 200 });

    h.session.requestUrl = new URL(`http://localhost${pathname}`);
    h.session.getEndpointPolicy = () => resolveEndpointPolicy(h.session.requestUrl.pathname);
    h.session.sessionId = "s_123";
    h.session.messageContext = { id: 1, user: { id: 1, name: "u" }, key: { name: "k" } };
    h.session.provider = { id: 1, name: "p" };
    h.session.isCountTokensRequest = () => isCountTokensRequest;

    const res = await handleProxyRequest({} as any);

    expect(res.status).toBe(200);
    expect(h.trackerCalls).toEqual(["startRequest"]);
  });

  test("session not created and ProxyError thrown: returns buildError without session header", async () => {
    h.fromContextError = new ProxyError("upstream", 401);

    const res = await handleProxyRequest({} as any);
    expect(res.status).toBe(401);
    expect(res.headers.get("x-cch-session-id")).toBeNull();
    const body = await res.json();
    expect(body.error.message).toBe("upstream");
  });

  test("session created but pipeline throws: routes to ProxyErrorHandler.handle", async () => {
    h.pipelineError = new Error("pipeline boom");

    const res = await handleProxyRequest({} as any);
    expect(res.status).toBe(502);
    expect(await res.text()).toBe("handled");
  });

  test("session not created and non-ProxyError thrown: returns 500 buildError", async () => {
    h.fromContextError = new Error("boom");

    const res = await handleProxyRequest({} as any);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.message).toBe("代理请求发生未知错误");
  });
});
